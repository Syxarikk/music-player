/**
 * YouTube API client for search and audio extraction
 */

import type { Track } from '../types'

const API_KEY = 'AIzaSyD3X_ZolCBZMCI2F3sfcUxp3BCLTV53HG4'
const API_BASE = 'https://www.googleapis.com/youtube/v3'

// Piped API instances for audio extraction (updated January 2025)
// Multiple instances for reliability
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.drgns.space',
  'https://pipedapi.nosebs.ru',
]

// Invidious API instances as fallback (updated January 2025)
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://vid.puffyan.us',
]

/**
 * YouTube video search result
 */
interface YouTubeSearchItem {
  id: { videoId: string }
  snippet: {
    title: string
    channelTitle: string
    thumbnails: {
      default: { url: string }
      medium: { url: string }
      high: { url: string }
    }
    publishedAt: string
  }
}

/**
 * YouTube video details
 */
interface YouTubeVideoDetails {
  id: string
  contentDetails: {
    duration: string // ISO 8601 format: PT4M13S
  }
  snippet: {
    title: string
    channelTitle: string
    thumbnails: {
      default: { url: string }
      medium: { url: string }
      high: { url: string }
    }
  }
}

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
 * Parse ISO 8601 duration to seconds
 * PT4M13S -> 253
 * PT1H2M3S -> 3723
 */
function parseDuration(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0

  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)

  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Generate unique ID for YouTube track
 */
function generateYouTubeTrackId(videoId: string): string {
  return `youtube-${videoId}`
}

/**
 * Convert YouTube video to Track format
 */
function youtubeToTrack(
  video: YouTubeSearchItem,
  details?: YouTubeVideoDetails
): Track {
  const videoId = video.id.videoId
  const duration = details?.contentDetails?.duration
    ? parseDuration(details.contentDetails.duration)
    : 0

  return {
    id: generateYouTubeTrackId(videoId),
    title: video.snippet.title,
    artist: video.snippet.channelTitle,
    album: 'YouTube',
    duration,
    path: `youtube://${videoId}`,
    coverArt: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url,
    source: 'youtube',
    youtubeId: videoId,
  }
}

/**
 * Search videos on YouTube
 */
export async function searchYouTube(
  query: string,
  maxResults = 20
): Promise<Track[]> {
  try {
    // Search for videos
    const searchUrl = new URL(`${API_BASE}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('q', `${query} music`)
    searchUrl.searchParams.set('type', 'video')
    searchUrl.searchParams.set('videoCategoryId', '10') // Music category
    searchUrl.searchParams.set('maxResults', maxResults.toString())
    searchUrl.searchParams.set('key', API_KEY)

    const searchResponse = await fetch(searchUrl.toString())

    if (!searchResponse.ok) {
      const error = await searchResponse.json()
      console.error('YouTube search error:', error)
      throw new Error(error.error?.message || 'YouTube search failed')
    }

    const searchData = await searchResponse.json()
    const items: YouTubeSearchItem[] = searchData.items || []

    if (items.length === 0) {
      return []
    }

    // Get video details for duration
    const videoIds = items.map((item) => item.id.videoId).join(',')
    const detailsUrl = new URL(`${API_BASE}/videos`)
    detailsUrl.searchParams.set('part', 'contentDetails,snippet')
    detailsUrl.searchParams.set('id', videoIds)
    detailsUrl.searchParams.set('key', API_KEY)

    const detailsResponse = await fetch(detailsUrl.toString())
    const detailsData = await detailsResponse.json()
    const detailsMap = new Map<string, YouTubeVideoDetails>()

    if (detailsData.items) {
      for (const detail of detailsData.items) {
        detailsMap.set(detail.id, detail)
      }
    }

    // Convert to tracks
    return items.map((item) =>
      youtubeToTrack(item, detailsMap.get(item.id.videoId))
    )
  } catch (error) {
    console.error('YouTube search error:', error)
    throw error
  }
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
 * Get audio stream URL from Piped
 */
async function getAudioUrlFromPiped(videoId: string): Promise<string | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      console.log('Trying Piped instance:', instance)
      const url = `${instance}/streams/${videoId}`

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        console.warn(`${instance} returned status ${response.status}`)
        continue
      }

      const data: PipedVideo = await response.json()

      // Check for error in response
      if ((data as unknown as { error?: string }).error) {
        console.warn(`${instance} error:`, (data as unknown as { error: string }).error)
        continue
      }

      if (!data.audioStreams || data.audioStreams.length === 0) {
        console.warn(`${instance} has no audio streams`)
        continue
      }

      // Find best audio format (prefer higher bitrate)
      const audioStreams = data.audioStreams
        .filter((s) => s.mimeType && s.mimeType.startsWith('audio/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))

      if (audioStreams.length > 0) {
        console.log('Found audio URL from Piped', instance, '- bitrate:', audioStreams[0].bitrate)
        return audioStreams[0].url
      }
    } catch (error) {
      console.warn(`Piped instance ${instance} failed:`, error)
      continue
    }
  }
  return null
}

/**
 * Get audio stream URL from Invidious
 */
async function getAudioUrlFromInvidious(videoId: string): Promise<string | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log('Trying Invidious instance:', instance)
      const url = `${instance}/api/v1/videos/${videoId}`

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        console.warn(`${instance} returned status ${response.status}`)
        continue
      }

      const data: InvidiousVideo = await response.json()

      // Check for error in response
      if ((data as unknown as { error?: string }).error) {
        console.warn(`${instance} error:`, (data as unknown as { error: string }).error)
        continue
      }

      if (!data.adaptiveFormats || data.adaptiveFormats.length === 0) {
        console.warn(`${instance} has no adaptive formats`)
        continue
      }

      // Find best audio format
      const audioFormats = data.adaptiveFormats
        .filter((f) => f.type && f.type.startsWith('audio/'))
        .sort((a, b) => parseInt(b.bitrate || '0') - parseInt(a.bitrate || '0'))

      if (audioFormats.length > 0) {
        console.log('Found audio URL from Invidious', instance)
        return audioFormats[0].url
      }
    } catch (error) {
      console.warn(`Invidious instance ${instance} failed:`, error)
      continue
    }
  }
  return null
}

/**
 * Get audio stream URL - tries Piped then Invidious
 */
export async function getAudioUrl(videoId: string): Promise<string | null> {
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
        id: generateYouTubeTrackId(videoId),
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
