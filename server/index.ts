/**
 * Family Player Media Server
 * Production-safe with authentication, rate limiting, and security hardening
 * Uses Piped API for YouTube search
 */

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import https from 'https'

// ================= CONFIG =================

const PORT = Number(process.env.PORT) || 3000
const HOST = '0.0.0.0'
const AUTH_TOKEN = process.env.AUTH_TOKEN // Optional authentication token

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100

const PIPED_INSTANCES = [
  'https://pipedapi.wireway.ch',
  'https://pipedapi.darkness.services',
  'https://pipedapi.drgns.space',
  'https://piped-api.hostux.net',
  'https://api.piped.private.coffee',
]

let pipedIndex = 0

// ================= SECURITY: Rate Limiter =================

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

// ================= SECURITY: CORS Whitelist =================

const CORS_WHITELIST_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
]

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true // Allow requests without origin (curl, etc.)
  return CORS_WHITELIST_PATTERNS.some(pattern => pattern.test(origin))
}

// ================= SECURITY: DNS Rebinding Protection =================

const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]']

function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false
  const hostname = host.split(':')[0].toLowerCase()

  if (ALLOWED_HOSTS.includes(hostname)) return true
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

// ================= SECURITY: Authentication =================

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Health endpoint is always public
  if (req.path === '/api/health') return next()

  // If AUTH_TOKEN is configured, require it
  if (AUTH_TOKEN) {
    if (req.headers['x-auth-token'] !== AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  next()
}

// ================= HELPERS =================

/**
 * Safely extract string from req.query / req.params
 */
function getParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function isValidVideoId(id?: string): boolean {
  return typeof id === 'string' && VIDEO_ID_REGEX.test(id)
}

function nextPiped(): string {
  const url = PIPED_INSTANCES[pipedIndex % PIPED_INSTANCES.length]
  pipedIndex++
  return url
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error('Invalid JSON'))
          }
        })
      })
      .on('error', reject)
  })
}

// ================= APP =================

const app = express()

// Security middleware (order matters!)
app.use(dnsRebindingProtection)
app.use('/api', rateLimiter)
app.use(authMiddleware)

app.use(express.json())

// CORS with strict whitelist
app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) {
        cb(null, true)
      } else {
        console.warn('CORS blocked origin:', origin)
        cb(new Error('CORS not allowed'), false)
      }
    },
    credentials: true,
  }),
)

// ================= ROUTES =================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    method: 'piped',
    pipedInstances: PIPED_INSTANCES,
  })
})

/**
 * YouTube search via Piped
 */
app.get('/api/youtube/search', async (req: Request, res: Response) => {
  try {
    const query = getParam(req.query.q)
    if (!query) {
      return res.status(400).json({ error: 'Query required' })
    }

    const piped = nextPiped()
    const url = `${piped}/search?q=${encodeURIComponent(query)}&filter=music_songs`

    const data = await fetchJson(url)
    res.json(data)
  } catch (err) {
    console.error('Search error:', err)
    res.status(502).json({ error: 'Piped unavailable' })
  }
})

/**
 * Validate videoId endpoint (example, future use)
 */
app.get('/api/youtube/validate/:id', (req: Request, res: Response) => {
  const videoId = getParam(req.params.id)

  if (!isValidVideoId(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' })
  }

  res.json({ valid: true, videoId })
})

// ================= START =================

app.listen(PORT, HOST, () => {
  console.log(`✅ Family Player server running on http://${HOST}:${PORT}`)
  console.log(`   Auth: ${AUTH_TOKEN ? 'ENABLED (set AUTH_TOKEN env var)' : 'DISABLED (set AUTH_TOKEN for security)'}`)
  console.log(`   Rate limit: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s`)
})
