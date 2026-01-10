/**
 * Standalone Media Server for Family Player
 * Run on VPS: npx ts-node server/index.ts
 * Or compile and run: tsc && node dist/server/index.js
 */

import express, { Request, Response } from 'express'
import cors from 'cors'
import * as path from 'path'
import * as fs from 'fs/promises'
import { createReadStream, statSync, existsSync } from 'fs'
import YTDlpWrap from 'yt-dlp-wrap'
import * as os from 'os'

// Configuration
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
const HOST = process.env.HOST || '0.0.0.0'
const YT_DLP_PATH = process.env.YT_DLP_PATH || '/usr/local/bin/yt-dlp'

// YouTube cache directory
const ytCacheDir = process.env.CACHE_DIR || path.join(os.tmpdir(), 'family-player-yt-cache')

console.log('=== Family Player Media Server ===')
console.log(`Cache directory: ${ytCacheDir}`)
console.log(`yt-dlp path: ${YT_DLP_PATH}`)

// Ensure cache directory exists
fs.mkdir(ytCacheDir, { recursive: true }).catch(() => {})

// Initialize yt-dlp
let ytDlp: YTDlpWrap
try {
  ytDlp = new YTDlpWrap(YT_DLP_PATH)
  console.log('yt-dlp initialized')
} catch (err) {
  console.error('Failed to initialize yt-dlp:', err)
  console.log('YouTube downloads will not work!')
}

const app = express()

// CORS - allow all origins for now
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}))

app.use(express.json())

// ============ API Routes ============

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    ytdlp: !!ytDlp,
    cacheDir: ytCacheDir,
  })
})

// Helper function to stream file with range support
function streamFile(filePath: string, req: Request, res: Response) {
  try {
    const stat = statSync(filePath)
    const fileSize = stat.size
    const range = req.headers.range

    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.webm': 'audio/webm',
    }
    const contentType = mimeTypes[ext] || 'audio/mpeg'

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
      const chunkSize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      })

      createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      })
      createReadStream(filePath).pipe(res)
    }
  } catch (err) {
    console.error('Stream error:', err)
    res.status(500).json({ error: 'Failed to stream file' })
  }
}

// Download and stream YouTube audio
app.get('/api/youtube/audio/:videoId', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params

    if (!videoId || videoId.length < 5) {
      return res.status(400).json({ error: 'Invalid video ID' })
    }

    const cacheFileM4a = path.join(ytCacheDir, `${videoId}.m4a`)
    const cacheFileWebm = path.join(ytCacheDir, `${videoId}.webm`)

    // Check if already cached
    for (const cacheFile of [cacheFileM4a, cacheFileWebm]) {
      if (existsSync(cacheFile)) {
        const stat = statSync(cacheFile)
        if (stat.size > 0) {
          console.log(`[CACHE HIT] ${videoId}`)
          return streamFile(cacheFile, req, res)
        }
      }
    }

    if (!ytDlp) {
      return res.status(503).json({ error: 'yt-dlp not available' })
    }

    console.log(`[DOWNLOAD] Starting: ${videoId}`)

    // Download with yt-dlp
    const url = `https://www.youtube.com/watch?v=${videoId}`
    const outputFile = cacheFileM4a

    try {
      await ytDlp.execPromise([
        url,
        '-f', '140/bestaudio[ext=m4a]/bestaudio',
        '-o', outputFile,
        '--no-warnings',
        '--no-playlist',
        '--socket-timeout', '30',
      ])

      // Verify download
      if (existsSync(outputFile)) {
        const stat = statSync(outputFile)
        if (stat.size > 0) {
          console.log(`[DOWNLOAD] Complete: ${videoId} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`)
          return streamFile(outputFile, req, res)
        }
      }

      // Try webm format as fallback
      const webmFile = cacheFileWebm
      await ytDlp.execPromise([
        url,
        '-f', 'bestaudio',
        '-o', webmFile,
        '--no-warnings',
        '--no-playlist',
      ])

      if (existsSync(webmFile)) {
        const stat = statSync(webmFile)
        if (stat.size > 0) {
          console.log(`[DOWNLOAD] Complete (webm): ${videoId}`)
          return streamFile(webmFile, req, res)
        }
      }

      return res.status(500).json({ error: 'Download failed' })
    } catch (downloadErr: any) {
      console.error(`[DOWNLOAD] Error: ${videoId}`, downloadErr.message || downloadErr)

      // Clean up partial files
      try { await fs.unlink(outputFile) } catch {}
      try { await fs.unlink(cacheFileWebm) } catch {}

      return res.status(500).json({ error: 'Download failed', details: downloadErr.message })
    }
  } catch (error: any) {
    console.error('YouTube audio error:', error)
    res.status(500).json({ error: 'Failed to get YouTube audio' })
  }
})

// Get cache info
app.get('/api/cache/info', async (req: Request, res: Response) => {
  try {
    const files = await fs.readdir(ytCacheDir)
    let totalSize = 0
    const items = []

    for (const file of files) {
      const filePath = path.join(ytCacheDir, file)
      const stat = statSync(filePath)
      totalSize += stat.size
      items.push({
        name: file,
        size: stat.size,
        created: stat.birthtime,
      })
    }

    res.json({
      count: files.length,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      items,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to get cache info' })
  }
})

// Clear cache
app.post('/api/cache/clear', async (req: Request, res: Response) => {
  try {
    const files = await fs.readdir(ytCacheDir)
    for (const file of files) {
      await fs.unlink(path.join(ytCacheDir, file))
    }
    res.json({ success: true, cleared: files.length })
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear cache' })
  }
})

// Start server
app.listen(PORT, HOST, () => {
  console.log(`\nServer running on http://${HOST}:${PORT}`)

  // Show external IP info
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`External access: http://${iface.address}:${PORT}`)
      }
    }
  }

  console.log('\nEndpoints:')
  console.log(`  GET  /api/health - Health check`)
  console.log(`  GET  /api/youtube/audio/:videoId - Stream YouTube audio`)
  console.log(`  GET  /api/cache/info - Cache statistics`)
  console.log(`  POST /api/cache/clear - Clear cache`)
})
