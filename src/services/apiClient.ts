/**
 * API Client for Family Player
 * Works both in Electron (via IPC) and Web (via HTTP)
 */

import type { Track } from '../types'
import { getAudioUrl as getPipedAudioUrl } from './youtubeApi'

// Detect if running in Electron
export const isElectron = typeof window !== 'undefined' && 'electronAPI' in window

// Detect if running as Capacitor app
export const isCapacitor = typeof window !== 'undefined' &&
  (window as any).Capacitor !== undefined

// Detect if running in standalone mobile mode (no server)
export const isMobileStandalone = isCapacitor && !isElectron

// Storage key for server URL
const SERVER_URL_KEY = 'family-player-server-url'

/**
 * Safe base64 encoding that handles Unicode strings
 */
function safeBase64Encode(str: string): string {
  try {
    // Use TextEncoder for proper UTF-8 handling
    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  } catch {
    // Fallback for older browsers
    return btoa(unescape(encodeURIComponent(str)))
  }
}

/**
 * Safe base64 decoding that handles Unicode strings
 * Exported for use in server.ts if needed
 */
export function safeBase64Decode(str: string): string {
  try {
    const binary = atob(str)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const decoder = new TextDecoder()
    return decoder.decode(bytes)
  } catch {
    // Fallback for older browsers
    return decodeURIComponent(escape(atob(str)))
  }
}

// Get stored server URL
function getStoredServerUrl(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(SERVER_URL_KEY) || ''
}

// Get API base URL
function getApiBase(): string {
  // In Electron, no API base needed (uses IPC)
  if (isElectron) return ''

  // Check for stored server URL (for mobile app)
  const storedUrl = getStoredServerUrl()
  if (storedUrl) return storedUrl

  // In development, use current host
  if (import.meta.env.DEV) {
    const host = window.location.hostname || 'localhost'
    return `http://${host}:3000`
  }

  // In production web mode on same server
  return ''
}

// API base URL (can be updated at runtime)
let API_BASE = getApiBase()

/**
 * Validate URL format for security
 * Only allows http/https protocols and valid URL structure
 * Includes SSRF protection - blocks dangerous internal ports
 */
function isValidServerUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false

  try {
    const parsed = new URL(url)

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false
    }

    // Block javascript:, data:, etc.
    if (parsed.protocol.includes('javascript') || parsed.protocol.includes('data')) {
      return false
    }

    // SSRF Protection: Block dangerous internal service ports
    const dangerousPorts = [22, 23, 25, 53, 110, 143, 389, 445, 587, 636, 993, 995, 1433, 1521, 3306, 5432, 5900, 6379, 11211, 27017]
    const port = parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
    if (dangerousPorts.includes(port)) {
      console.warn('Blocked potentially dangerous port:', port)
      return false
    }

    // Block metadata service IPs (cloud environments)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
      console.warn('Blocked cloud metadata service URL')
      return false
    }

    return true
  } catch {
    return false
  }
}

// Update API base URL (for mobile app server configuration)
// SECURITY: Validates URL before saving
export function setApiBase(url: string): void {
  // Allow empty string to clear
  if (url === '') {
    API_BASE = ''
    localStorage.removeItem(SERVER_URL_KEY)
    return
  }

  // Validate URL format
  if (!isValidServerUrl(url)) {
    console.error('Invalid server URL format:', url)
    return
  }

  API_BASE = url
  localStorage.setItem(SERVER_URL_KEY, url)
}

// Get current API base
export function getApiBaseUrl(): string {
  return API_BASE
}

/**
 * Unified API for both Electron and Web
 */
export const api = {
  // Check if we should use Electron API or HTTP
  useElectron: isElectron,

  // Health check
  async health(): Promise<{ status: string; version: string }> {
    const response = await fetch(`${API_BASE}/api/health`)
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`)
    }
    return response.json()
  },

  // Scan music folder
  async scanFolder(folderPath: string): Promise<Track[]> {
    if (isElectron) {
      const files = await window.electronAPI.scanMusicFolder(folderPath)
      const tracks: Track[] = []
      for (const file of files) {
        const metadata = await window.electronAPI.getFileMetadata(file)
        tracks.push({
          id: safeBase64Encode(file),
          ...metadata,
          source: 'local',
        })
      }
      return tracks
    }

    const response = await fetch(`${API_BASE}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Scan failed' }))
      throw new Error(error.error || `Scan failed: ${response.status}`)
    }
    const data = await response.json()
    return data.tracks
  },

  // Get all tracks
  async getTracks(): Promise<Track[]> {
    const response = await fetch(`${API_BASE}/api/tracks`)
    if (!response.ok) {
      throw new Error(`Failed to get tracks: ${response.status}`)
    }
    return response.json()
  },

  // Get audio URL for a track
  getAudioUrl(track: Track): string {
    if (track.source === 'youtube' && track.youtubeId) {
      if (isElectron) {
        // Electron will download and return file:// URL
        return '' // Handled by getYouTubeAudioUrl
      }
      // Web: stream from server
      return `${API_BASE}/api/youtube/audio/${track.youtubeId}`
    }

    if (isElectron) {
      // Local file in Electron - use secure protocol (resolved via IPC)
      // Note: actual URL is generated via getAudioUrl IPC call, this is fallback
      return `local-audio://audio/${encodeURIComponent(track.path.replace(/\\/g, '/'))}`
    }

    // Web: stream from server (use safe base64 for Unicode paths)
    const trackId = safeBase64Encode(track.path)
    return `${API_BASE}/api/stream/${trackId}`
  },

  // Get YouTube audio URL
  async getYouTubeAudioUrl(videoId: string): Promise<string | null> {
    if (isElectron) {
      return window.electronAPI.getYouTubeAudioUrl(videoId)
    }

    // Mobile standalone: use Piped API directly
    if (isMobileStandalone || !API_BASE) {
      console.log('Using Piped API directly for YouTube audio:', videoId)
      return getPipedAudioUrl(videoId)
    }

    // Web with server: stream from server
    return `${API_BASE}/api/youtube/audio/${videoId}`
  },

  // Search YouTube
  async searchYouTube(query: string): Promise<Track[]> {
    const response = await fetch(`${API_BASE}/api/youtube/search?q=${encodeURIComponent(query)}`)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Search failed' }))
      throw new Error(error.error || `YouTube search failed: ${response.status}`)
    }
    return response.json()
  },

  // Open folder dialog (Electron only)
  async openFolderDialog(): Promise<string | null> {
    if (isElectron) {
      return window.electronAPI.openFolderDialog()
    }
    // Web: show a text input or use server-side path
    return null
  },

  // Open files dialog (Electron only)
  async openFilesDialog(): Promise<string[]> {
    if (isElectron) {
      return window.electronAPI.openFilesDialog()
    }
    return []
  },

  // Window controls (Electron only)
  minimizeWindow() {
    if (isElectron) window.electronAPI.minimizeWindow()
  },

  maximizeWindow() {
    if (isElectron) window.electronAPI.maximizeWindow()
  },

  closeWindow() {
    if (isElectron) window.electronAPI.closeWindow()
  },
}

/**
 * Hook to get server connection status
 */
export async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get server URL for sharing
 */
export function getServerUrl(): string {
  return API_BASE || window.location.origin
}
