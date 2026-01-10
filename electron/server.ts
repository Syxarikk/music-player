/**
 * Media Server for Family Player
 * Allows phones and other devices to connect and play music
 */

import express, { Request, Response } from 'express'
import cors from 'cors'
import * as path from 'path'
import * as fs from 'fs/promises'
import { createReadStream, statSync } from 'fs'
import * as mm from 'music-metadata'
import { pathToFileURL } from 'url'
import YTDlpWrap from 'yt-dlp-wrap'
import * as os from 'os'

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']

// YouTube cache directory
const ytCacheDir = path.join(os.tmpdir(), 'family-player-yt-cache')
fs.mkdir(ytCacheDir, { recursive: true }).catch(() => {})

interface ServerConfig {
  port: number
  ytDlpPath: string
  staticPath?: string
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

  app.use(cors())
  app.use(express.json())

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
      if (!folderPath) {
        return res.status(400).json({ error: 'folderPath is required' })
      }

      const files: string[] = []

      async function scanDir(dir: string): Promise<void> {
        try {
          const items = await fs.readdir(dir)
          for (const item of items) {
            const fullPath = path.join(dir, item)
            const stat = await fs.stat(fullPath)
            if (stat.isDirectory()) {
              await scanDir(fullPath)
            } else if (AUDIO_EXTENSIONS.includes(path.extname(item).toLowerCase())) {
              files.push(fullPath)
            }
          }
        } catch (err) {
          console.error('Error scanning directory:', dir, err)
        }
      }

      await scanDir(folderPath)

      // Get metadata for all files
      const tracks: Track[] = []
      for (const filePath of files) {
        try {
          const metadata = await mm.parseFile(filePath)
          let coverArt: string | null = null

          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const picture = metadata.common.picture[0]
            coverArt = `data:${picture.format};base64,${picture.data.toString('base64')}`
          }

          tracks.push({
            id: Buffer.from(filePath).toString('base64'),
            title: metadata.common.title || path.basename(filePath, path.extname(filePath)),
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            duration: metadata.format.duration || 0,
            path: filePath,
            coverArt,
            source: 'local',
          })
        } catch (err) {
          // If metadata fails, add with basic info
          tracks.push({
            id: Buffer.from(filePath).toString('base64'),
            title: path.basename(filePath, path.extname(filePath)),
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            duration: 0,
            path: filePath,
            source: 'local',
          })
        }
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
      const filePath = Buffer.from(trackId, 'base64').toString('utf-8')

      // Check if it's a YouTube cached file
      if (filePath.startsWith('youtube:')) {
        const videoId = filePath.replace('youtube:', '')
        const cacheFile = path.join(ytCacheDir, `${videoId}.m4a`)

        try {
          await fs.access(cacheFile)
          return streamFile(cacheFile, req, res)
        } catch {
          return res.status(404).json({ error: 'YouTube audio not cached' })
        }
      }

      // Local file
      await fs.access(filePath)
      return streamFile(filePath, req, res)
    } catch (error) {
      console.error('Stream error:', error)
      res.status(404).json({ error: 'File not found' })
    }
  })

  // Helper function to stream file with range support
  function streamFile(filePath: string, req: Request, res: Response) {
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
      })
      createReadStream(filePath).pipe(res)
    }
  }

  // Search YouTube
  app.get('/api/youtube/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string
      if (!query) {
        return res.status(400).json({ error: 'Query is required' })
      }

      const API_KEY = 'AIzaSyD3X_ZolCBZMCI2F3sfcUxp3BCLTV53HG4'
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
      const cacheFile = path.join(ytCacheDir, `${videoId}.m4a`)

      // Check if already cached
      try {
        await fs.access(cacheFile)
        console.log('YouTube audio cached:', videoId)
        return streamFile(cacheFile, req, res)
      } catch {
        // Not cached, need to download
      }

      console.log('Downloading YouTube audio:', videoId)

      // Download with yt-dlp
      const url = `https://www.youtube.com/watch?v=${videoId}`
      await ytDlp.execPromise([
        url,
        '-f', '140/bestaudio[ext=m4a]/bestaudio',
        '-o', cacheFile,
        '--no-warnings',
        '--no-playlist',
      ])

      // Verify and stream
      try {
        await fs.access(cacheFile)
        return streamFile(cacheFile, req, res)
      } catch {
        return res.status(500).json({ error: 'Download failed' })
      }
    } catch (error) {
      console.error('YouTube audio error:', error)
      res.status(500).json({ error: 'Failed to get YouTube audio' })
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

  app.post('/api/queue', (req: Request, res: Response) => {
    const { tracks, currentIndex = 0 } = req.body
    serverState.queue = tracks
    serverState.currentIndex = currentIndex
    serverState.currentTrack = tracks[currentIndex] || null
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
    app.use((req: Request, res: Response, next: Function) => {
      // Only handle GET requests for non-API routes
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(config.staticPath!, 'index.html'))
      } else {
        next()
      }
    })
  }

  // Start server
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Media server running on http://0.0.0.0:${config.port}`)

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

  return { app, server }
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
