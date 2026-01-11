/**
 * Standalone Media Server for Family Player
 * Uses Piped API for YouTube audio streaming (no yt-dlp needed)
 */

import express, { Request, Response } from 'express'
import cors from 'cors'
import https from 'https'
import http from 'http'

// Configuration
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
const HOST = process.env.HOST || '0.0.0.0'

// Piped instances (fallback list)
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.in.projectsegfau.lt',
]

let currentPipedIndex = 0

console.log('=== Family Player Media Server ===')
console.log('Using Piped API for YouTube streaming')

const app = express()

// CORS - allow all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}))

app.use(express.json())

// Helper: fetch JSON from URL
function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http

    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location
        if (redirectUrl) {
          return fetchJson(redirectUrl).then(resolve).catch(reject)
        }
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }

      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('Invalid JSON'))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy()
      reject(new Error('Timeout'))
    })
  })
}

// Get audio URL from Piped
async function getPipedAudioUrl(videoId: string): Promise<string | null> {
  // Try each Piped instance
  for (let i = 0; i < PIPED_INSTANCES.length; i++) {
    const instanceIndex = (currentPipedIndex + i) % PIPED_INSTANCES.length
    const instance = PIPED_INSTANCES[instanceIndex]

    try {
      console.log(`[PIPED] Trying ${instance} for ${videoId}`)
      const data = await fetchJson(`${instance}/streams/${videoId}`)

      if (data.audioStreams && data.audioStreams.length > 0) {
        // Sort by bitrate, prefer m4a/mp4
        const sorted = data.audioStreams
          .filter((s: any) => s.url)
          .sort((a: any, b: any) => {
            // Prefer m4a
            const aIsM4a = a.mimeType?.includes('mp4') ? 1 : 0
            const bIsM4a = b.mimeType?.includes('mp4') ? 1 : 0
            if (aIsM4a !== bIsM4a) return bIsM4a - aIsM4a
            // Then by bitrate
            return (b.bitrate || 0) - (a.bitrate || 0)
          })

        if (sorted.length > 0) {
          currentPipedIndex = instanceIndex // Remember working instance
          console.log(`[PIPED] Found audio stream for ${videoId}`)
          return sorted[0].url
        }
      }
    } catch (err: any) {
      console.log(`[PIPED] ${instance} failed: ${err.message}`)
    }
  }

  return null
}

// Proxy stream from URL
function proxyStream(sourceUrl: string, req: Request, res: Response) {
  const client = sourceUrl.startsWith('https') ? https : http

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }

  // Forward Range header for seeking
  if (req.headers.range) {
    headers['Range'] = req.headers.range
  }

  const proxyReq = client.get(sourceUrl, { headers }, (proxyRes) => {
    // Handle redirects
    if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302) {
      const redirectUrl = proxyRes.headers.location
      if (redirectUrl) {
        return proxyStream(redirectUrl, req, res)
      }
    }

    // Forward status and headers
    res.status(proxyRes.statusCode || 200)

    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges']
    for (const h of forwardHeaders) {
      if (proxyRes.headers[h]) {
        res.setHeader(h, proxyRes.headers[h] as string)
      }
    }

    // Ensure CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')

    proxyRes.pipe(res)
  })

  proxyReq.on('error', (err) => {
    console.error('[PROXY] Error:', err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy error' })
    }
  })

  req.on('close', () => {
    proxyReq.destroy()
  })
}

// ============ API Routes ============

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    method: 'piped',
    pipedInstances: PIPED_INSTANCES,
  })
})

// Stream YouTube audio
app.get('/api/youtube/audio/:videoId', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string

    if (!videoId || videoId.length < 5) {
      return res.status(400).json({ error: 'Invalid video ID' })
    }

    console.log(`[REQUEST] ${videoId}`)

    // Get audio URL from Piped
    const audioUrl = await getPipedAudioUrl(videoId)

    if (!audioUrl) {
      console.log(`[ERROR] No audio found for ${videoId}`)
      return res.status(404).json({ error: 'Audio not found' })
    }

    // Proxy the stream
    proxyStream(audioUrl, req, res)

  } catch (error: any) {
    console.error('[ERROR]', error.message)
    res.status(500).json({ error: 'Failed to get audio' })
  }
})

// Get info about a video
app.get('/api/youtube/info/:videoId', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.videoId as string
    const instance = PIPED_INSTANCES[currentPipedIndex]

    const data = await fetchJson(`${instance}/streams/${videoId}`)

    res.json({
      title: data.title,
      uploader: data.uploader,
      duration: data.duration,
      thumbnail: data.thumbnailUrl,
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

// Start server
app.listen(PORT, HOST, () => {
  console.log(`\nServer running on http://${HOST}:${PORT}`)
  console.log('\nEndpoints:')
  console.log(`  GET  /api/health - Health check`)
  console.log(`  GET  /api/youtube/audio/:videoId - Stream YouTube audio`)
  console.log(`  GET  /api/youtube/info/:videoId - Get video info`)
})
