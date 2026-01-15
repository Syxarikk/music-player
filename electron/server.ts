/**
 * Media Server — production-safe
 * Used by Electron and local network clients
 */

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import os from 'os'
import dotenv from 'dotenv'
import YTDlpWrap from 'yt-dlp-wrap'

import {
  isPathSafe,
  isPathAllowed,
  isValidAudioFile,
  isValidVideoId,
  getAudioMimeType,
  YT_DLP_TIMEOUT_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
} from './shared/constants'

dotenv.config()

// ================== SECURITY: Rate Limiter ==================

interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()

  let entry = rateLimitStore.get(ip)

  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS }
    rateLimitStore.set(ip, entry)
  } else {
    entry.count++
  }

  // Clean up old entries periodically
  if (rateLimitStore.size > 10000) {
    for (const [key, val] of rateLimitStore.entries()) {
      if (now > val.resetTime) rateLimitStore.delete(key)
    }
  }

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    res.setHeader('Retry-After', Math.ceil((entry.resetTime - now) / 1000))
    return res.status(429).json({ error: 'Too many requests' })
  }

  next()
}

// ================== SECURITY: CORS Whitelist ==================

const CORS_WHITELIST_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
]

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // Allow requests without origin (Electron, curl, etc.)
  return CORS_WHITELIST_PATTERNS.some(pattern => pattern.test(origin))
}

// ================== SECURITY: DNS Rebinding Protection ==================

const ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]

function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false
  const hostname = host.split(':')[0].toLowerCase()

  // Allow localhost variants
  if (ALLOWED_HOSTS.includes(hostname)) return true

  // Allow local network IPs
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true

  return false
}

function dnsRebindingProtection(req: Request, res: Response, next: NextFunction) {
  const host = req.headers.host

  if (!isAllowedHost(host)) {
    console.warn('DNS rebinding attempt blocked:', host)
    return res.status(403).json({ error: 'Invalid host header' })
  }

  next()
}

// ================== CONFIG ==================

const ytCacheDir = path.join(os.tmpdir(), 'family-player-yt-cache')
fs.mkdir(ytCacheDir, { recursive: true }).catch(() => {})

interface ServerConfig {
  port: number
  ytDlpPath: string
  staticPath?: string
  authToken?: string
}

interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  path: string              // IMPORTANT: plain path (NO base64)
  coverArt?: string
  source?: 'local' | 'youtube'
  youtubeId?: string
}

// ================== YOUTUBE TYPES ==================

interface YouTubeSearchItem {
  id?: { videoId?: string }
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[]
}

interface YouTubeVideoItem {
  id: string
  snippet: {
    title: string
    channelTitle: string
    thumbnails?: {
      high?: { url: string }
    }
  }
  contentDetails: {
    duration: string
  }
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoItem[]
}

// ================== SERVER ==================

export function createMediaServer(config: ServerConfig) {
  const app = express()
  const ytDlp = new YTDlpWrap(config.ytDlpPath)

  // ================== SECURITY MIDDLEWARE ==================

  // DNS Rebinding Protection (must be first)
  app.use(dnsRebindingProtection)

  // Rate Limiting
  app.use('/api', rateLimiter)

  app.use(express.json())

  // CORS with whitelist (local network only)
  app.use(cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true)
      } else {
        console.warn('CORS blocked origin:', origin)
        callback(new Error('CORS not allowed'), false)
      }
    },
    credentials: true,
  }))

  // ================== AUTH ==================

  if (config.authToken) {
    app.use('/api', (req, res, next) => {
      // Public endpoints (protected by rate limiting)
      const publicPaths = ['/health', '/youtube/search']
      if (publicPaths.includes(req.path)) return next()

      // All other endpoints require auth token
      if (req.headers['x-auth-token'] !== config.authToken) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
      next()
    })
  }

  // ================== API ==================

  app.get('/api/health', (_, res) => {
    res.json({ status: 'ok' })
  })

  // ---------- YOUTUBE SEARCH ----------

  app.get('/api/youtube/search', async (req: Request, res: Response) => {
    try {
      const query = String(req.query.q ?? '').trim()
      if (!query) return res.status(400).json({ error: 'Query required' })

      const apiKey = process.env.YOUTUBE_API_KEY
      if (!apiKey) {
        return res.status(500).json({ error: 'YOUTUBE_API_KEY missing' })
      }

      const searchUrl =
        `https://www.googleapis.com/youtube/v3/search` +
        `?part=snippet&type=video&videoCategoryId=10&maxResults=20` +
        `&q=${encodeURIComponent(query)}` +
        `&key=${apiKey}`

      const searchRes = await fetch(searchUrl)
      const searchData = (await searchRes.json()) as YouTubeSearchResponse

      const ids = searchData.items
        ?.map(i => i.id?.videoId)
        .filter(Boolean)
        .join(',')

      if (!ids) return res.json([])

      const detailsUrl =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=contentDetails,snippet&id=${ids}&key=${apiKey}`

      const detailsRes = await fetch(detailsUrl)
      const detailsData = (await detailsRes.json()) as YouTubeVideosResponse

      if (!Array.isArray(detailsData.items)) return res.json([])

      const tracks: Track[] = detailsData.items.map(v => ({
        id: `youtube-${v.id}`,
        title: v.snippet.title,
        artist: v.snippet.channelTitle,
        album: 'YouTube',
        duration: parseISODuration(v.contentDetails.duration),
        path: `youtube:${v.id}`,        // ✅ FIXED
        coverArt: v.snippet.thumbnails?.high?.url,
        source: 'youtube',
        youtubeId: v.id,
      }))

      res.json(tracks)
    } catch (e) {
      console.error('YT search error:', e)
      res.status(500).json({ error: 'Search failed' })
    }
  })

  // ---------- STREAM ----------

  app.get('/api/stream/:id', async (req, res) => {
    try {
      const decoded = Buffer.from(req.params.id, 'base64').toString('utf8')
      let filePath = decoded

      // ---- YouTube cached ----
      if (decoded.startsWith('youtube:')) {
        const videoId = decoded.replace('youtube:', '')
        if (!isValidVideoId(videoId)) return res.sendStatus(400)

        const m4a = path.join(ytCacheDir, `${videoId}.m4a`)
        const webm = path.join(ytCacheDir, `${videoId}.webm`)
        filePath = (await exists(m4a)) ? m4a : webm
      }

      // ---- Local file security ----
      if (!decoded.startsWith('youtube:')) {
        if (
          !isPathSafe(filePath) ||
          !isPathAllowed(filePath) ||
          !isValidAudioFile(filePath)
        ) {
          return res.sendStatus(403)
        }
      }

      await streamFile(filePath, req, res)
    } catch (e) {
      console.error('Stream error:', e)
      res.sendStatus(500)
    }
  })

  // ---------- YOUTUBE AUDIO ----------

  app.get('/api/youtube/audio/:id', async (req, res) => {
    const videoId = req.params.id
    if (!isValidVideoId(videoId)) return res.sendStatus(400)

    const outFile = path.join(ytCacheDir, `${videoId}.m4a`)

    if (!(await exists(outFile))) {
      try {
        await Promise.race([
          ytDlp.execPromise([
            `https://www.youtube.com/watch?v=${videoId}`,
            '-f', '140/bestaudio',
            '-o', outFile,
            '--no-playlist',
          ]),
          timeout(YT_DLP_TIMEOUT_MS),
        ])
      } catch {
        return res.status(500).json({ error: 'Download failed' })
      }
    }

    await streamFile(outFile, req, res)
  })

  if (config.staticPath) {
    app.use(express.static(config.staticPath))
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Media server: http://0.0.0.0:${config.port}`)
  })

  return { app, server }
}

// ================== HELPERS ==================

async function streamFile(file: string, req: Request, res: Response) {
  const stat = await fs.stat(file)
  const size = stat.size
  const type = getAudioMimeType(file)
  const range = req.headers.range

  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-')

    // Fix: properly handle empty strings in range parsing
    const start = startStr && startStr.length > 0 ? parseInt(startStr, 10) : 0
    let end = endStr && endStr.length > 0 ? parseInt(endStr, 10) : size - 1

    // Validate parsed values
    if (isNaN(start) || isNaN(end) || start < 0 || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      return res.end()
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': type,
    })

    createReadStream(file, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
    })

    createReadStream(file).pipe(res)
  }
}

async function exists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function timeout(ms: number) {
  return new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))
}

function parseISODuration(d: string): number {
  if (!d || typeof d !== 'string') return 0
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  const hours = parseInt(m[1] || '0', 10)
  const minutes = parseInt(m[2] || '0', 10)
  const seconds = parseInt(m[3] || '0', 10)
  return (isNaN(hours) ? 0 : hours) * 3600 +
         (isNaN(minutes) ? 0 : minutes) * 60 +
         (isNaN(seconds) ? 0 : seconds)
}
