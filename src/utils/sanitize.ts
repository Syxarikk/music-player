/**
 * Security utilities for sanitizing user input
 */

/**
 * Sanitize image URL to prevent XSS attacks
 * Only allows safe protocols: https, http, data:image/, local-audio://
 */
export function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  const trimmed = url.trim()

  // Allow data URLs for base64 images (from metadata)
  if (trimmed.startsWith('data:image/')) {
    return trimmed
  }

  // Allow HTTPS URLs (YouTube thumbnails, etc.)
  if (trimmed.startsWith('https://')) {
    return trimmed
  }

  // Allow HTTP URLs (local network servers)
  if (trimmed.startsWith('http://')) {
    return trimmed
  }

  // Allow local-audio protocol (Electron local files)
  if (trimmed.startsWith('local-audio://')) {
    return trimmed
  }

  // Block everything else (javascript:, etc.)
  return null
}

/**
 * Validate YouTube video ID format
 * YouTube IDs are exactly 11 characters: alphanumeric, dash, underscore
 */
export function isValidYouTubeId(videoId: string | null | undefined): boolean {
  if (!videoId) return false
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId)
}

/**
 * Sanitize file path to prevent path traversal attacks
 * Returns null if path is suspicious
 */
export function sanitizeFilePath(filePath: string): string | null {
  if (!filePath) return null

  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/')

  // Check for path traversal attempts
  if (normalized.includes('..')) {
    return null
  }

  // Check for null bytes (common injection technique)
  if (normalized.includes('\0')) {
    return null
  }

  return filePath
}

/**
 * Allowed audio file extensions
 */
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.webm']

/**
 * Check if file has valid audio extension
 */
export function isValidAudioExtension(filePath: string): boolean {
  if (!filePath) return false
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))
  return AUDIO_EXTENSIONS.includes(ext)
}
