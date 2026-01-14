/**
 * YouTube API client for search and audio extraction
 * NOTE: YouTube Data API calls are proxied through the server to protect API keys
 */

import type { Track } from '../types'
import { isValidYouTubeId } from '../utils/sanitize'

// Piped API instances for audio extraction (updated January 2025)
// Can be overridden via VITE_PIPED_INSTANCES env variable (comma-separated)
const DEFAULT_PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.drgns.space',
  'https://pipedapi.nosebs.ru',
]

const PIPED_INSTANCES: string[] = import.meta.env.VITE_PIPED_INSTANCES
  ? (import.meta.env.VITE_PIPED_INSTANCES as string).split(',').map((s: string) => s.trim()).filter(Boolean)
  : DEFAULT_PIPED_INSTANCES

// Invidious API instances as fallback (updated January 2025)
// Can be overridden via VITE_INVIDIOUS_INSTANCES env variable (comma-separated)
const DEFAULT_INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://vid.puffyan.us',
]

const INVIDIOUS_INSTANCES: string[] = import.meta.env.VITE_INVIDIOUS_INSTANCES
  ? (import.meta.env.VITE_INVIDIOUS_INSTANCES as string).split(',').map((s: string) => s.trim()).filter(Boolean)
  : DEFAULT_INVIDIOUS_INSTANCES

/**
 * Piped video response
 */
interface PipedVideo {
  title: string
  uploader: string
  uploaderUrl: string
  duration: number
  thumbnailUrl: string
  audioStreams: {
    url: string
    format: string
    quality: string
    mimeType: string
    bitrate: number
    codec: string
  }[]
}

/**
 * Get the server URL for YouTube API proxy
 * Uses environment variable or falls back to relative path
 */
function getYouTubeServerUrl(): string {
  const serverUrl = import.meta.env.VITE_YOUTUBE_SERVER_URL
  if (serverUrl) return serverUrl

  // In Electron or same-origin web, use relative path
  if (typeof window !== 'undefined') {
    // Check if we have a stored server URL
    const stored = localStorage.getItem('family-player-server-url')
    if (stored) return stored
  }

  // Default: same origin or localhost in dev
  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }

  return ''
}

/**
 * Search videos on YouTube via server proxy
 * This protects the API key by keeping it server-side only
 */
export async function searchYouTube(
  query: string,
  maxResults = 20
): Promise<Track[]> {
  const serverUrl = getYouTubeServerUrl()

  try {
    const searchUrl = new URL(`${serverUrl}/api/youtube/search`)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('maxResults', maxResults.toString())

    const response = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Search failed' }))
      console.error('YouTube search error:', error)
      throw new Error(error.error || 'YouTube search failed')
    }

    const tracks: Track[] = await response.json()
    return tracks
  } catch (error) {
    console.error('YouTube search error:', error)

    // Fallback: try Piped API for search if server is unavailable
    console.log('Trying Piped API fallback for search...')
    return searchYouTubeViaPiped(query, maxResults)
  }
}

/**
 * Fallback search via Piped API (no API key needed)
 */
async function searchYouTubeViaPiped(
  query: string,
  maxResults = 20
): Promise<Track[]> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=music_songs`
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) continue

      const data = await response.json()
      const items = data.items || []

      return items.slice(0, maxResults).map((item: any) => ({
        id: `youtube-${item.url?.replace('/watch?v=', '') || item.videoId}`,
        title: item.title || 'Unknown',
        artist: item.uploaderName || item.uploader || 'Unknown',
        album: 'YouTube',
        duration: item.duration || 0,
        path: `youtube://${item.url?.replace('/watch?v=', '') || item.videoId}`,
        coverArt: item.thumbnail || null,
        source: 'youtube' as const,
        youtubeId: item.url?.replace('/watch?v=', '') || item.videoId,
      }))
    } catch (error) {
      console.warn(`Piped search failed for ${instance}:`, error)
      continue
    }
  }

  throw new Error('All search methods failed')
}

/**
 * Invidious video response
 */
interface InvidiousVideo {
  title: string
  author: string
  lengthSeconds: number
  videoThumbnails: { url: string; quality: string }[]
  adaptiveFormats: {
    url: string
    itag: string
    type: string
    bitrate: string
    container: string
    audioQuality?: string
  }[]
}

/**
 * Get audio stream URL from Piped (parallel requests, returns first success)
 * Each request has its own timeout to prevent premature cancellation
 */
async function getAudioUrlFromPiped(videoId: string): Promise<string | null> {
  const INDIVIDUAL_TIMEOUT = 10000 // 10 seconds per instance
  const errors: { instance: string; error: string }[] = []

  try {
    // Create promise for each instance with individual timeout
    const requests = PIPED_INSTANCES.map(async (instance): Promise<string> => {
      const individualController = new AbortController()
      const timeoutId = setTimeout(() => individualController.abort(), INDIVIDUAL_TIMEOUT)

      try {
        const url = `${instance}/streams/${videoId}`
        const response = await fetch(url, {
          signal: individualController.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data: PipedVideo = await response.json()

        // Check for error in response
        if ((data as unknown as { error?: string }).error) {
          throw new Error((data as unknown as { error: string }).error)
        }

        if (!data.audioStreams || data.audioStreams.length === 0) {
          throw new Error('No audio streams')
        }

        // Find best audio format (prefer higher bitrate)
        const audioStreams = data.audioStreams
          .filter((s) => s.mimeType && s.mimeType.startsWith('audio/'))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))

        if (audioStreams.length === 0) {
          throw new Error('No valid audio streams')
        }

        console.log('Found audio URL from Piped', instance, '- bitrate:', audioStreams[0].bitrate)
        return audioStreams[0].url
      } catch (err) {
        // Log error for diagnostics
        const errorMsg = err instanceof Error ? err.message : String(err)
        errors.push({ instance, error: errorMsg })
        throw err
      } finally {
        clearTimeout(timeoutId)
      }
    })

    // Use Promise.any to get first successful result immediately
    const result = await Promise.any(requests)
    return result
  } catch (error) {
    // Promise.any throws AggregateError if all promises reject
    // Log all errors for diagnostics
    if (errors.length > 0) {
      console.warn('Piped API errors:', errors.map(e => `${e.instance}: ${e.error}`).join(', '))
    }
    return null
  }
}

/**
 * Get audio stream URL from Invidious (parallel requests, returns first success)
 * Each request has its own timeout to prevent premature cancellation
 */
async function getAudioUrlFromInvidious(videoId: string): Promise<string | null> {
  const INDIVIDUAL_TIMEOUT = 10000 // 10 seconds per instance
  const errors: { instance: string; error: string }[] = []

  try {
    // Create promise for each instance with individual timeout
    const requests = INVIDIOUS_INSTANCES.map(async (instance): Promise<string> => {
      const individualController = new AbortController()
      const timeoutId = setTimeout(() => individualController.abort(), INDIVIDUAL_TIMEOUT)

      try {
        const url = `${instance}/api/v1/videos/${videoId}`
        const response = await fetch(url, {
          signal: individualController.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data: InvidiousVideo = await response.json()

        // Check for error in response
        if ((data as unknown as { error?: string }).error) {
          throw new Error((data as unknown as { error: string }).error)
        }

        if (!data.adaptiveFormats || data.adaptiveFormats.length === 0) {
          throw new Error('No adaptive formats')
        }

        // Find best audio format
        const audioFormats = data.adaptiveFormats
          .filter((f) => f.type && f.type.startsWith('audio/'))
          .sort((a, b) => parseInt(b.bitrate || '0') - parseInt(a.bitrate || '0'))

        if (audioFormats.length === 0) {
          throw new Error('No valid audio formats')
        }

        console.log('Found audio URL from Invidious', instance)
        return audioFormats[0].url
      } catch (err) {
        // Log error for diagnostics
        const errorMsg = err instanceof Error ? err.message : String(err)
        errors.push({ instance, error: errorMsg })
        throw err
      } finally {
        clearTimeout(timeoutId)
      }
    })

    // Use Promise.any to get first successful result immediately
    const result = await Promise.any(requests)
    return result
  } catch (error) {
    // Promise.any throws AggregateError if all promises reject
    // Log all errors for diagnostics
    if (errors.length > 0) {
      console.warn('Invidious API errors:', errors.map(e => `${e.instance}: ${e.error}`).join(', '))
    }
    return null
  }
}

/**
 * Get audio stream URL - tries Piped then Invidious
 */
export async function getAudioUrl(videoId: string): Promise<string | null> {
  // Security: Validate video ID format
  if (!isValidYouTubeId(videoId)) {
    console.error('Invalid YouTube video ID format:', videoId)
    return null
  }

  console.log('Trying to get audio URL for video:', videoId)

  // Try Piped first
  const pipedUrl = await getAudioUrlFromPiped(videoId)
  if (pipedUrl) return pipedUrl

  // Try Invidious as fallback
  console.log('All Piped instances failed, trying Invidious...')
  const invidiousUrl = await getAudioUrlFromInvidious(videoId)
  if (invidiousUrl) return invidiousUrl

  console.error('All instances failed for video:', videoId)
  return null
}

/**
 * Get video info from Piped (alternative to YouTube API)
 */
export async function getVideoInfo(videoId: string): Promise<Track | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) continue

      const data: PipedVideo = await response.json()

      return {
        id: `youtube-${videoId}`,
        title: data.title,
        artist: data.uploader,
        album: 'YouTube',
        duration: data.duration,
        path: `youtube://${videoId}`,
        coverArt: data.thumbnailUrl || null,
        source: 'youtube',
        youtubeId: videoId,
      }
    } catch (error) {
      console.warn(`Piped instance ${instance} failed:`, error)
      continue
    }
  }

  return null
}

/**
 * Check if a track is from YouTube
 */
export function isYouTubeTrack(track: Track): boolean {
  return track.source === 'youtube' || track.path.startsWith('youtube://')
}

/**
 * Extract video ID from YouTube track
 */
export function getVideoId(track: Track): string | null {
  if (track.youtubeId) return track.youtubeId

  if (track.path.startsWith('youtube://')) {
    return track.path.replace('youtube://', '')
  }

  return null
}
