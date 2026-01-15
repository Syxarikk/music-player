/**
 * Media Server for Family Player
 * Allows phones and other devices to connect and play music
 */

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import * as path from 'path'
import * as fs from 'fs/promises'
import { createReadStream } from 'fs'
import * as mm from 'music-metadata'
import YTDlpWrap from 'yt-dlp-wrap'
import * as os from 'os'
import * as dotenv from 'dotenv'
import {
  AUDIO_EXTENSIONS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  YT_DLP_TIMEOUT_MS,
  isPathSafe,
  isPathAllowed,
  isValidAudioFile,
  isValidVideoId,
  getAudioMimeType,
} from './shared/constants'

// Load environment variables
dotenv.config()

/**
 * Security headers middleware (CSP, etc.)
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Content Security Policy - restrict what can be loaded
  // Note: 'unsafe-inline' for scripts is needed for Vite in dev mode
  // In production, consider using nonce-based CSP
  const isDev = process.env.NODE_ENV !== 'production'
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // CSS-in-JS needs this
    "img-src 'self' data: https:",
    "media-src 'self' blob:",
    "connect-src 'self' https://www.googleapis.com https://*.googlevideo.com",
    "font-src 'self'",
    "frame-ancestors 'none'", // Stronger than X-Frame-Options
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '))

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff')

  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block')

  // Referrer policy - don't leak referrer to external sites
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  next()
}

/**
 * DNS rebinding protection middleware
 * Validates Host header to prevent DNS rebinding attacks
 */
function dnsRebindingProtection(req: Request, res: Response, next: NextFunction) {
  const host = req.headers.host

  if (!host) {
    console.warn('DNS Rebinding: Blocked request without Host header from:', req.ip)
    return res.status(400).json({ error: 'Host header required' })
  }

  // Extract hostname (remove port if present)
  const hostname = host.split(':')[0].toLowerCase()

  // Allow localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return next()
  }

  // Allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  if (/^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(hostname)) {
    return next()
  }

  // Block all other hostnames (potential DNS rebinding attack)
  console.warn('DNS Rebinding: Blocked suspicious Host header:', host, 'from:', req.ip)
  return res.status(403).json({ error: 'Invalid host' })
}

// YouTube cache directory
const ytCacheDir = path.join(os.tmpdir(), 'family-player-yt-cache')
fs.mkdir(ytCacheDir, { recursive: true }).catch(() => {})

interface ServerConfig {
  port: number
  ytDlpPath: string
  staticPath?: string
  authToken?: string // Optional auth token for API security
}

interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  path: string
  coverArt?: string | null
  source?: string
  youtubeId?: string
}

// In-memory state (shared with all clients)
const serverState = {
  tracks: [] as Track[],
  queue: [] as Track[],
  currentTrack: null as Track | null,
  currentIndex: 0,
  isPlaying: false,
}

export function createMediaServer(config: ServerConfig) {
  const app = express()
  const ytDlp = new YTDlpWrap(config.ytDlpPath)

  // Rate limiting state (scoped to this server instance to prevent memory leaks on hot reload)
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
  let rateLimitCleanupInterval: NodeJS.Timeout | null = null

  // Rate limiting middleware
  const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()

    const clientData = rateLimitMap.get(clientIp)

    if (!clientData || now > clientData.resetTime) {
      rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
      return next()
    }

    if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' })
    }

    clientData.count++
    next()
  }

  // Trust proxy for rate limiting - only trust loopback to prevent IP spoofing
  app.set('trust proxy', 'loopback')

  // Apply DNS rebinding protection first (before any other processing)
  app.use(dnsRebindingProtection)

  // Apply security headers to all responses
  app.use(securityHeaders)

  // Apply rate limiting to all routes (not just API)
  app.use(rateLimiter)

  // Start rate limit cleanup interval
  rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [ip, data] of rateLimitMap.entries()) {
      if (now > data.resetTime) {
        rateLimitMap.delete(ip)
      }
    }
  }, RATE_LIMIT_WINDOW_MS)

  // CORS configuration - restrict to local network and localhost
  // SECURITY: Distinguishes between missing origin (same-origin, safe) and null origin (file://, risky)
  app.use(cors({
    origin: (origin, callback) => {
      // No origin header = same-origin request from browser (safe)
      // This happens when the request is made from the same origin as the server
      if (origin === undefined) {
        return callback(null, true)
      }

      // Explicit 'null' string origin = file:// page (potential CSRF risk)
      // Reject these for security
      if (origin === 'null') {
        console.warn('CORS: Rejected null origin (file:// page)')
        return callback(new Error('Null origin not allowed'), false)
      }

      // Allow localhost
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true)
      }

      // Allow local network (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      if (origin.match(/^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/)) {
        return callback(null, true)
      }

      // Allow Capacitor app
      if (origin.includes('capacitor://') || origin.includes('ionic://')) {
        return callback(null, true)
      }

      console.warn('CORS: Rejected origin:', origin)
      callback(new Error('Not allowed by CORS'))
    },
    credentials: true
  }))
  app.use(express.json({ limit: '1mb' })) // Limit request body size

  // CORS error handler - must be after cors() middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err.message === 'Not allowed by CORS' || err.message === 'Null origin not allowed') {
      console.warn('CORS error for:', req.ip, '-', err.message)
      return res.status(403).json({ error: err.message })
    }
    next(err)
  })

  // Authentication middleware for API routes
  // Generate token automatically if not provided (always require auth for security)
  if (!config.authToken) {
    const { generateAuthToken } = require('./shared/constants')
    config.authToken = generateAuthToken()
    // SECURITY: Don't log the token - it can be retrieved via settings UI
    console.log('Auth token auto-generated. Use settings UI to view token for mobile access.')
  }

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    // Allow health check without auth for discovery
    if (req.path === '/health') {
      return next()
    }

    // Allow YouTube search without auth for better UX (read-only, no sensitive data)
    if (req.path === '/youtube/search' && req.method === 'GET') {
      return next()
    }

    const authHeader = req.headers['x-auth-token'] || req.headers['authorization']
    const token = typeof authHeader === 'string'
      ? authHeader.replace('Bearer ', '')
      : undefined

    if (token !== config.authToken) {
      console.warn('Unauthorized API request from:', req.ip, 'path:', req.path)
      return res.status(401).json({ error: 'Unauthorized. Please provide valid auth token.' })
    }

    next()
  })
  console.log('API authentication enabled')

  // Serve static files (web app) if path provided
  if (config.staticPath) {
    app.use(express.static(config.staticPath))
  }

  // ============ API Routes ============

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0' })
  })

  // Get server state
  app.get('/api/state', (req: Request, res: Response) => {
    res.json(serverState)
  })

  // Scan folder for music
  app.post('/api/scan', async (req: Request, res: Response) => {
    try {
      const { folderPath } = req.body
      if (!folderPath || typeof folderPath !== 'string') {
        return res.status(400).json({ error: 'folderPath is required and must be a string' })
      }

      // Security: Validate path format
      if (!isPathSafe(folderPath)) {
        console.warn('Blocked unsafe scan path:', folderPath)
        return res.status(403).json({ error: 'Invalid path format' })
      }

      // Security: Check if path is within allowed directories
      if (!isPathAllowed(folderPath)) {
        console.warn('Blocked scan outside allowed directories:', folderPath)
        return res.status(403).json({ error: 'Access to this directory is not allowed' })
      }

      // Verify directory exists
      try {
        const stat = await fs.stat(folderPath)
        if (!stat.isDirectory()) {
          return res.status(400).json({ error: 'Path is not a directory' })
        }
      } catch {
        return res.status(404).json({ error: 'Directory not found' })
      }

      const files: string[] = []
      const MAX_FILES = 10000 // Limit to prevent DoS
      const MAX_DEPTH = 10 // Maximum recursion depth

      async function scanDir(dir: string, depth: number = 0): Promise<void> {
        if (depth > MAX_DEPTH || files.length >= MAX_FILES) return

        try {
          const items = await fs.readdir(dir)
          for (const item of items) {
            if (files.length >= MAX_FILES) break

            const fullPath = path.join(dir, item)

            // Skip hidden files and directories
            if (item.startsWith('.')) continue

            try {
              const stat = await fs.stat(fullPath)
              if (stat.isDirectory()) {
                await scanDir(fullPath, depth + 1)
              } else if (AUDIO_EXTENSIONS.includes(path.extname(item).toLowerCase())) {
                files.push(fullPath)
              }
            } catch {
              // Skip files we can't access
              continue
            }
          }
        } catch (err) {
          console.error('Error scanning directory:', dir, err)
        }
      }

      await scanDir(folderPath)

      // Get metadata for all files with parallel processing
      const CONCURRENCY = 10 // Process 10 files at a time
      const tracks: Track[] = []

      // Helper to process a single file
      const processFile = async (filePath: string): Promise<Track> => {
        try {
          const metadata = await mm.parseFile(filePath)
          let coverArt: string | null = null

          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const picture = metadata.common.picture[0]
            // Convert Uint8Array to base64 (music-metadata v10+ uses Uint8Array)
            const base64Data = Buffer.from(picture.data).toString('base64')
            coverArt = `data:${picture.format};base64,${base64Data}`
          }

          return {
            id: Buffer.from(filePath).toString('base64'),
            title: metadata.common.title || path.basename(filePath, path.extname(filePath)),
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            duration: metadata.format.duration || 0,
            path: filePath,
            coverArt,
            source: 'local',
          }
        } catch (err) {
          // If metadata fails, add with basic info
          return {
            id: Buffer.from(filePath).toString('base64'),
            title: path.basename(filePath, path.extname(filePath)),
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            duration: 0,
            path: filePath,
            source: 'local',
          }
        }
      }

      // Process files in parallel chunks
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        const chunk = files.slice(i, i + CONCURRENCY)
        const results = await Promise.all(chunk.map(processFile))
        tracks.push(...results)
      }

      serverState.tracks = tracks
      res.json({ count: tracks.length, tracks })
    } catch (error) {
      console.error('Scan error:', error)
      res.status(500).json({ error: 'Failed to scan folder' })
    }
  })

  // Get all tracks
  app.get('/api/tracks', (req: Request, res: Response) => {
    res.json(serverState.tracks)
  })

  // Stream local audio file
  app.get('/api/stream/:trackId', async (req: Request, res: Response) => {
    try {
      const trackId = req.params.trackId

      // Validate trackId format (base64)
      if (!trackId || typeof trackId !== 'string') {
        return res.status(400).json({ error: 'Invalid track ID' })
      }

      let filePath: string
      try {
        filePath = Buffer.from(trackId, 'base64').toString('utf-8')
      } catch {
        return res.status(400).json({ error: 'Invalid track ID encoding' })
      }

      // Check if it's a YouTube cached file
      if (filePath.startsWith('youtube:')) {
        const videoId = filePath.replace('youtube:', '')

        // Validate YouTube video ID
        if (!isValidVideoId(videoId)) {
          return res.status(400).json({ error: 'Invalid video ID format' })
        }

        const cacheFile = path.join(ytCacheDir, `${videoId}.m4a`)
        const cacheFileWebm = path.join(ytCacheDir, `${videoId}.webm`)

        // Check both possible cache formats
        for (const cachedFile of [cacheFile, cacheFileWebm]) {
          try {
            await fs.access(cachedFile)
            await streamFile(cachedFile, req, res)
            return
          } catch {
            continue
          }
        }
        return res.status(404).json({ error: 'YouTube audio not cached' })
      }

      // Security: Validate file path
      if (!isPathSafe(filePath)) {
        return res.status(403).json({ error: 'Invalid file path' })
      }

      // Security: Validate audio extension
      if (!isValidAudioFile(filePath)) {
        return res.status(403).json({ error: 'Invalid file type' })
      }

      // Security: Check if path is within allowed directories
      if (!isPathAllowed(filePath)) {
        return res.status(403).json({ error: 'Access denied' })
      }

      // Local file
      try {
        await fs.access(filePath)
      } catch {
        return res.status(404).json({ error: 'File not found' })
      }

      await streamFile(filePath, req, res)
    } catch (error) {
      console.error('Stream error:', error)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' })
      }
    }
  })

  // Helper function to stream file with range support
  async function streamFile(filePath: string, req: Request, res: Response): Promise<void> {
    try {
      const stat = await fs.stat(filePath)
      const fileSize = stat.size
      const range = req.headers.range
      const contentType = getAudioMimeType(filePath)

      // Helper to setup stream with proper cleanup and timeout
      const setupStream = (stream: ReturnType<typeof createReadStream>) => {
        // Timeout to prevent hanging streams (30 seconds inactivity)
        let lastActivity = Date.now()
        const STREAM_INACTIVITY_TIMEOUT = 30000

        const timeoutCheck = setInterval(() => {
          if (Date.now() - lastActivity > STREAM_INACTIVITY_TIMEOUT) {
            console.log('Stream timeout - destroying inactive stream')
            clearInterval(timeoutCheck)
            stream.destroy()
            if (!res.writableEnded) {
              res.end()
            }
          }
        }, 5000)

        stream.on('data', () => {
          lastActivity = Date.now()
        })

        stream.on('error', (err) => {
          console.error('Stream error:', err)
          clearInterval(timeoutCheck)
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' })
          }
          stream.destroy()
        })

        stream.on('end', () => {
          clearInterval(timeoutCheck)
        })

        // IMPORTANT: Close stream when client disconnects
        res.on('close', () => {
          clearInterval(timeoutCheck)
          stream.destroy()
        })

        res.on('error', () => {
          clearInterval(timeoutCheck)
          stream.destroy()
        })

        stream.pipe(res)
      }

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

        // Validate range
        if (start >= fileSize || end >= fileSize || start > end || start < 0) {
          res.status(416).json({ error: 'Range not satisfiable' })
          return
        }

        const chunkSize = end - start + 1

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        })

        setupStream(createReadStream(filePath, { start, end }))
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        })

        setupStream(createReadStream(filePath))
      }
    } catch (err) {
      console.error('Stream file error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' })
      }
    }
  }

  // Search YouTube
  app.get('/api/youtube/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string
      if (!query) {
        return res.status(400).json({ error: 'Query is required' })
      }

      // Get API key from environment variable
      const API_KEY = process.env.YOUTUBE_API_KEY || ''
      if (!API_KEY) {
        return res.status(500).json({ error: 'YouTube API key not configured' })
      }

      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query + ' music')}&type=video&videoCategoryId=10&maxResults=20&key=${API_KEY}`

      const searchResponse = await fetch(searchUrl)
      const searchData = await searchResponse.json() as { items?: any[] }

      if (!searchData.items) {
        return res.json([])
      }

      // Get video details for duration
      const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',')
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${API_KEY}`

      const detailsResponse = await fetch(detailsUrl)
      const detailsData = await detailsResponse.json() as { items?: any[] }

      const detailsMap = new Map()
      if (detailsData.items) {
        for (const detail of detailsData.items) {
          detailsMap.set(detail.id, detail)
        }
      }

      const tracks: Track[] = searchData.items.map((item: any) => {
        const videoId = item.id.videoId
        const details = detailsMap.get(videoId)
        const duration = details?.contentDetails?.duration
          ? parseDuration(details.contentDetails.duration)
          : 0

        return {
          id: `youtube-${videoId}`,
          title: item.snippet.title,
          artist: item.snippet.channelTitle,
          album: 'YouTube',
          duration,
          path: `youtube://${videoId}`,
          coverArt: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
          source: 'youtube',
          youtubeId: videoId,
        }
      })

      res.json(tracks)
    } catch (error) {
      console.error('YouTube search error:', error)
      res.status(500).json({ error: 'Search failed' })
    }
  })

  // Download and get YouTube audio
  app.get('/api/youtube/audio/:videoId', async (req: Request, res: Response) => {
    try {
      const { videoId } = req.params

      // Security: Validate YouTube video ID format (strict)
      if (!isValidVideoId(videoId)) {
        return res.status(400).json({ error: 'Invalid video ID format' })
      }

      const cacheFile = path.join(ytCacheDir, `${videoId}.m4a`)
      const cacheFileWebm = path.join(ytCacheDir, `${videoId}.webm`)

      // Check if already cached (either format)
      for (const cachedFile of [cacheFile, cacheFileWebm]) {
        try {
          const stat = await fs.stat(cachedFile)
          if (stat.size > 0) {
            // Touch file to update mtime and prevent cleanup
            const now = new Date()
            await fs.utimes(cachedFile, now, now).catch(() => {})
            console.log('YouTube audio cached:', videoId)
            await streamFile(cachedFile, req, res)
            return
          }
        } catch {
          continue
        }
      }

      console.log('Downloading YouTube audio:', videoId)

      // Download with yt-dlp (sanitized videoId ensures no injection)
      const url = `https://www.youtube.com/watch?v=${videoId}`

      try {
        // Execute with timeout to prevent hanging
        const downloadPromise = ytDlp.execPromise([
          url,
          '-f', '140/bestaudio[ext=m4a]/bestaudio',
          '-o', cacheFile,
          '--no-warnings',
          '--no-playlist',
          '--socket-timeout', '30',
          '--retries', '3',
        ])
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('yt-dlp timeout')), YT_DLP_TIMEOUT_MS)
        })

        await Promise.race([downloadPromise, timeoutPromise])
      } catch (dlError) {
        console.error('yt-dlp download error:', dlError)
        // Cleanup partial download
        await fs.unlink(cacheFile).catch(() => {})
        return res.status(500).json({ error: 'Download failed' })
      }

      // Verify and stream
      try {
        const stat = await fs.stat(cacheFile)
        if (stat.size === 0) {
          await fs.unlink(cacheFile).catch(() => {})
          return res.status(500).json({ error: 'Download resulted in empty file' })
        }
        await streamFile(cacheFile, req, res)
      } catch {
        // Cleanup any partial file
        await fs.unlink(cacheFile).catch(() => {})
        return res.status(500).json({ error: 'Download verification failed' })
      }
    } catch (error) {
      console.error('YouTube audio error:', error)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to get YouTube audio' })
      }
    }
  })

  // Queue management
  app.get('/api/queue', (req: Request, res: Response) => {
    res.json({
      queue: serverState.queue,
      currentIndex: serverState.currentIndex,
      currentTrack: serverState.currentTrack,
      isPlaying: serverState.isPlaying,
    })
  })

  // Validate track structure to prevent injection
  function isValidTrack(t: unknown): t is Track {
    if (!t || typeof t !== 'object') return false
    const track = t as Record<string, unknown>
    return (
      typeof track.id === 'string' &&
      typeof track.title === 'string' &&
      typeof track.artist === 'string' &&
      typeof track.album === 'string' && // Added missing album check
      typeof track.path === 'string' &&
      (track.duration === undefined || typeof track.duration === 'number') &&
      (track.coverArt === undefined || track.coverArt === null || typeof track.coverArt === 'string')
    )
  }

  app.post('/api/queue', (req: Request, res: Response) => {
    const { tracks, currentIndex = 0 } = req.body

    // Validate tracks array
    if (!Array.isArray(tracks)) {
      return res.status(400).json({ error: 'tracks must be an array' })
    }

    if (!tracks.every(isValidTrack)) {
      return res.status(400).json({ error: 'Invalid track format in queue' })
    }

    // Validate currentIndex
    if (typeof currentIndex !== 'number' || currentIndex < 0) {
      return res.status(400).json({ error: 'Invalid currentIndex' })
    }

    serverState.queue = tracks
    serverState.currentIndex = Math.min(currentIndex, tracks.length - 1)
    serverState.currentTrack = tracks[serverState.currentIndex] || null
    res.json({ success: true })
  })

  app.post('/api/queue/play', (req: Request, res: Response) => {
    const { index } = req.body
    if (index >= 0 && index < serverState.queue.length) {
      serverState.currentIndex = index
      serverState.currentTrack = serverState.queue[index]
      serverState.isPlaying = true
    }
    res.json({ success: true, currentTrack: serverState.currentTrack })
  })

  app.post('/api/player/state', (req: Request, res: Response) => {
    const { isPlaying } = req.body
    serverState.isPlaying = isPlaying
    res.json({ success: true })
  })

  // Fallback to index.html for SPA (must be last)
  if (config.staticPath) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Only handle GET requests for non-API routes
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(config.staticPath!, 'index.html'))
      } else {
        next()
      }
    })
  }

  // Start server - bind to 0.0.0.0 for LAN access but warn about security
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Media server running on http://0.0.0.0:${config.port}`)
    console.log('WARNING: Server is accessible from local network. Ensure you are on a trusted network.')

    // Get local IP
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`Access from other devices: http://${iface.address}:${config.port}`)
        }
      }
    }
  })

  // Cleanup function for graceful shutdown
  const cleanup = () => {
    if (rateLimitCleanupInterval) {
      clearInterval(rateLimitCleanupInterval)
      rateLimitCleanupInterval = null
    }
  }

  // Cleanup on server close
  server.on('close', cleanup)

  return { app, server, cleanup }
}

// Helper: Parse ISO 8601 duration
function parseDuration(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}
