/**
 * Standalone Media Server for Family Player
 * Uses Piped API for YouTube audio streaming (no yt-dlp needed)
 *
 * SECURITY: This server now includes:
 * - Rate limiting
 * - DNS rebinding protection
 * - CORS whitelist (local network only)
 * - Security headers
 * - Input validation
 * - Optional authentication
 */

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import https from 'https'
import http from 'http'
import * as crypto from 'crypto'

// Configuration
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
const HOST = process.env.HOST || '0.0.0.0'
const AUTH_TOKEN = process.env.AUTH_TOKEN || '' // Optional: set for production

// ============ Security Constants ============

// YouTube video ID validation regex (11 chars: alphanumeric, dash, underscore)
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100

// Piped instances (fallback list) - updated working instances
const PIPED_INSTANCES = [
  'https://pipedapi.wireway.ch',
  'https://pipedapi.darkness.services',
  'https://pipedapi.drgns.space',
  'https://piped-api.hostux.net',
  'https://api.piped.private.coffee',
]

let currentPipedIndex = 0

console.log('=== Family Player Media Server ===')
console.log('Using Piped API for YouTube streaming')
console.log('Security features enabled: CORS whitelist, rate limiting, DNS rebinding protection')

const app = express()

// ============ Security Middleware ============

/**
 * Generate a secure random token for server authentication
 */
function generateAuthToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Validate YouTube video ID format
 */
function isValidVideoId(videoId: string | null | undefined): boolean {
  if (!videoId || typeof videoId !== 'string') return false
  return VIDEO_ID_REGEX.test(videoId)
}

/**
 * Security headers middleware (CSP, etc.)
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Content Security Policy
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "media-src 'self' blob:",
    "connect-src 'self' https://*.googlevideo.com",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '))

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff')

  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block')

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  // HSTS (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

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

// Rate limiting state
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

/**
 * Rate limiting middleware
 */
function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()

  const clientData = rateLimitMap.get(clientIp)

  if (!clientData || now > clientData.resetTime) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
    return next()
  }

  if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    console.warn('Rate limit exceeded for:', clientIp)
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  clientData.count++
  next()
}

// Cleanup expired rate limit entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

// Trust proxy for rate limiting - only trust loopback
app.set('trust proxy', 'loopback')

// Apply DNS rebinding protection first
app.use(dnsRebindingProtection)

// Apply security headers
app.use(securityHeaders)

// Apply rate limiting
app.use(rateLimiter)

// CORS configuration - restrict to local network and localhost
// SECURITY: Reject null origin to prevent CSRF from local HTML files
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without origin (same-origin requests from browser)
    // But reject null origin from file:// pages
    if (!origin) {
      // Check if it's a same-origin request (no origin header)
      // vs null origin from file:// (origin header = 'null')
      return callback(null, true)
    }

    // Reject explicit 'null' origin (file:// pages)
    if (origin === 'null') {
      console.warn('CORS: Rejected null origin (file:// page)')
      return callback(new Error('Origin not allowed'), false)
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
    callback(new Error('Not allowed by CORS'), false)
  },
  credentials: true,
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}))

app.use(express.json({ limit: '1mb' }))

// CORS error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err.message === 'Not allowed by CORS' || err.message === 'Origin not allowed') {
    console.warn('CORS error for:', req.ip, '-', err.message)
    return res.status(403).json({ error: err.message })
  }
  next(err)
})

// Optional authentication middleware
const serverAuthToken = AUTH_TOKEN || generateAuthToken()

// Log that auth is enabled (but NOT the token itself!)
if (AUTH_TOKEN) {
  console.log('Authentication enabled with provided token')
} else {
  console.log('Authentication enabled with auto-generated token')
  console.log('Set AUTH_TOKEN environment variable for production use')
}

// Authentication middleware for protected routes
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check (read-only, no sensitive data)
  if (req.path === '/api/health') {
    return next()
  }

  // Always require auth token for API access (security best practice)
  const authHeader = req.headers['x-auth-token'] || req.headers['authorization']
  const token = typeof authHeader === 'string'
    ? authHeader.replace('Bearer ', '')
    : undefined

  // Validate token - always enforce authentication
  if (token !== serverAuthToken) {
    console.warn('Unauthorized API request from:', req.ip, 'path:', req.path)
    return res.status(401).json({ error: 'Unauthorized. Please provide valid auth token.' })
  }

  next()
}

// Apply auth middleware to API routes
app.use('/api', authMiddleware)

// ============ Helper Functions ============

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
  // Security: Validate video ID
  if (!isValidVideoId(videoId)) {
    console.error('Invalid video ID format:', videoId)
    return null
  }

  // Try each Piped instance
  for (let i = 0; i < PIPED_INSTANCES.length; i++) {
    const instanceIndex = (currentPipedIndex + i) % PIPED_INSTANCES.length
    const instance = PIPED_INSTANCES[instanceIndex]

    // Security: Only use HTTPS instances
    if (!instance.startsWith('https://')) {
      console.warn('Skipping non-HTTPS instance:', instance)
      continue
    }

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

// Maximum proxy size limit (100MB) - prevents DoS via large file downloads
const MAX_PROXY_SIZE = 100 * 1024 * 1024

// Maximum redirect depth to prevent infinite loops
const MAX_REDIRECT_DEPTH = 5

// Proxy stream from URL with size limits and redirect protection
function proxyStream(sourceUrl: string, req: Request, res: Response, redirectDepth = 0) {
  // Security: Prevent infinite redirect loops
  if (redirectDepth > MAX_REDIRECT_DEPTH) {
    console.warn('[PROXY] Max redirect depth exceeded')
    if (!res.headersSent) {
      res.status(508).json({ error: 'Too many redirects' })
    }
    return
  }

  const client = sourceUrl.startsWith('https') ? https : http

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }

  // Forward Range header for seeking
  if (req.headers.range) {
    headers['Range'] = req.headers.range
  }

  const proxyReq = client.get(sourceUrl, { headers }, (proxyRes) => {
    // Handle redirects with depth tracking
    if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302) {
      const redirectUrl = proxyRes.headers.location
      if (redirectUrl) {
        return proxyStream(redirectUrl, req, res, redirectDepth + 1)
      }
    }

    // Security: Check Content-Length to prevent DoS
    const contentLength = parseInt(proxyRes.headers['content-length'] || '0', 10)
    if (contentLength > MAX_PROXY_SIZE) {
      console.warn('[PROXY] Content too large:', contentLength, 'bytes')
      proxyRes.destroy()
      if (!res.headersSent) {
        res.status(413).json({ error: 'Content too large' })
      }
      return
    }

    // Forward status and headers
    res.status(proxyRes.statusCode || 200)

    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges']
    for (const h of forwardHeaders) {
      if (proxyRes.headers[h]) {
        res.setHeader(h, proxyRes.headers[h] as string)
      }
    }

    // Ensure Accept-Ranges header
    res.setHeader('Accept-Ranges', 'bytes')

    // Track streamed bytes to enforce limit even without Content-Length
    let streamedBytes = 0
    proxyRes.on('data', (chunk: Buffer) => {
      streamedBytes += chunk.length
      if (streamedBytes > MAX_PROXY_SIZE) {
        console.warn('[PROXY] Stream exceeded size limit')
        proxyRes.destroy()
        if (!res.writableEnded) {
          res.end()
        }
      }
    })

    proxyRes.pipe(res)
  })

  proxyReq.on('error', (err) => {
    console.error('[PROXY] Error:', err.message)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy error' })
    }
  })

  // Cleanup on client disconnect
  req.on('close', () => {
    proxyReq.destroy()
  })
}

// ============ API Routes ============

// Health check (no auth required)
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.2.0',
    method: 'piped',
    security: {
      cors: 'local-network-only',
      rateLimiting: true,
      dnsRebinding: true,
      authentication: !!AUTH_TOKEN,
    },
  })
})

// Stream YouTube audio
app.get('/api/youtube/audio/:videoId', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params

    // Security: Validate video ID format strictly
    if (!isValidVideoId(videoId)) {
      console.warn('Invalid video ID rejected:', videoId)
      return res.status(400).json({ error: 'Invalid video ID format' })
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
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to get audio' })
    }
  }
})

// Get info about a video
app.get('/api/youtube/info/:videoId', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params

    // Security: Validate video ID
    if (!isValidVideoId(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID format' })
    }

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
const server = app.listen(PORT, HOST, () => {
  console.log(`\nServer running on http://${HOST}:${PORT}`)
  console.log('\nSecurity features:')
  console.log('  - CORS: Local network only')
  console.log('  - Rate limiting: 100 req/min per IP')
  console.log('  - DNS rebinding protection: Enabled')
  console.log('  - Security headers: CSP, X-Frame-Options, etc.')
  console.log(`  - Authentication: ${AUTH_TOKEN ? 'Required' : 'Optional (set AUTH_TOKEN env var)'}`)
  console.log('\nEndpoints:')
  console.log('  GET  /api/health - Health check')
  console.log('  GET  /api/youtube/audio/:videoId - Stream YouTube audio')
  console.log('  GET  /api/youtube/info/:videoId - Get video info')
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})
