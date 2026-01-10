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

// Update API base URL (for mobile app server configuration)
export function setApiBase(url: string): void {
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
          id: btoa(file),
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
    const data = await response.json()
    return data.tracks
  },

  // Get all tracks
  async getTracks(): Promise<Track[]> {
    const response = await fetch(`${API_BASE}/api/tracks`)
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
      // Local file in Electron
      return `file:///${track.path.replace(/\\/g, '/')}`
    }

    // Web: stream from server
    const trackId = btoa(track.path)
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
