/**
 * Security utilities for sanitizing user input
 */

import { isValidVideoId } from '../shared/instances'

// Re-export for backward compatibility
export { isValidVideoId as isValidYouTubeId }

/**
 * Check if URL points to a local/private network address
 * Allows HTTP only for local network to prevent mixed content on public URLs
 */
function isLocalNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    // Allow localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true
    }

    // Allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (/^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(hostname)) {
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Sanitize image URL to prevent XSS attacks
 * Only allows safe protocols: https, http (local only), data:image/, local-audio://
 *
 * Security considerations:
 * - HTTP is only allowed for local network addresses (localhost, 192.168.x.x, etc.)
 * - This prevents mixed content warnings and MITM attacks on public URLs
 * - data: URLs are restricted to image/* MIME types
 */
export function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null

  // Remove any leading/trailing whitespace and normalize
  const trimmed = url.trim()

  // Block empty strings after trim
  if (!trimmed) return null

  // Block URLs with null bytes (injection technique)
  if (trimmed.includes('\0')) return null

  // Allow data URLs for base64 images (from metadata)
  // Strict check: must be data:image/ prefix
  if (trimmed.startsWith('data:image/')) {
    // Additional validation: check for reasonable data URL format
    // data:image/png;base64, or data:image/jpeg;base64,
    if (/^data:image\/[a-z]+;base64,/i.test(trimmed)) {
      return trimmed
    }
    // Allow data:image without base64 (e.g., data:image/svg+xml)
    if (/^data:image\/[a-z+]+,/i.test(trimmed)) {
      return trimmed
    }
    return null
  }

  // Allow HTTPS URLs (YouTube thumbnails, etc.)
  if (trimmed.startsWith('https://')) {
    return trimmed
  }

  // Allow HTTP URLs ONLY for local network addresses
  // This prevents mixed content warnings while allowing local server images
  if (trimmed.startsWith('http://')) {
    if (isLocalNetworkUrl(trimmed)) {
      return trimmed
    }
    // Block HTTP for public/external URLs
    console.warn('Blocked non-local HTTP image URL:', trimmed.substring(0, 50))
    return null
  }

  // Allow local-audio protocol (Electron local files)
  if (trimmed.startsWith('local-audio://')) {
    return trimmed
  }

  // Block everything else (javascript:, vbscript:, file:, etc.)
  return null
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
