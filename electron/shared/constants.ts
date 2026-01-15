/**
 * Shared constants between main process and server
 * Prevents code duplication and ensures consistency
 */

import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'

// ============ Audio Configuration ============

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.webm']

export const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
}

// ============ YouTube Configuration ============

// YouTube video ID validation regex (11 chars: alphanumeric, dash, underscore)
export const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

/**
 * Validate YouTube video ID format
 */
export function isValidVideoId(videoId: string | null | undefined): boolean {
  if (!videoId || typeof videoId !== 'string') return false
  return VIDEO_ID_REGEX.test(videoId)
}

// ============ Cache Configuration ============

export const MAX_CACHE_SIZE_MB = 500
export const MAX_CACHE_AGE_DAYS = 7
export const CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

// ============ Server Configuration ============

export const DEFAULT_SERVER_PORT = 3000
export const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100

// ============ Security Configuration ============

/**
 * Generate a secure random token for server authentication
 */
export function generateAuthToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Cache for Electron app paths (populated by main process)
let electronAppPaths: Record<string, string> | null = null

// User-added directories (populated via dialog selection)
const userAllowedDirectories: Set<string> = new Set()

/**
 * Set Electron app paths from main process
 * Call this early in main.ts with paths from app.getPath()
 */
export function setElectronPaths(paths: Record<string, string>): void {
  electronAppPaths = paths
}

/**
 * Add a user-selected directory to the allowed list
 * SECURITY: Only directories explicitly selected by user via dialog are added
 */
export function addUserAllowedDirectory(dirPath: string): void {
  if (dirPath && isPathSafe(dirPath)) {
    userAllowedDirectories.add(path.normalize(dirPath))
  }
}

/**
 * Remove a directory from the user-allowed list
 */
export function removeUserAllowedDirectory(dirPath: string): void {
  userAllowedDirectories.delete(path.normalize(dirPath))
}

/**
 * Get all user-allowed directories
 */
export function getUserAllowedDirectories(): string[] {
  return Array.from(userAllowedDirectories)
}

/**
 * Get allowed directories for file access (security whitelist)
 * SECURITY: Only specific directories, NOT entire drives or homedir
 * to prevent access to ~/.ssh, ~/.gnupg, system files, etc.
 */
export function getAllowedDirectories(): string[] {
  const home = os.homedir()
  const dirs: string[] = []

  // Use Electron app paths if available (handles localized Windows folders)
  if (electronAppPaths) {
    if (electronAppPaths.music) dirs.push(electronAppPaths.music)
    if (electronAppPaths.downloads) dirs.push(electronAppPaths.downloads)
    if (electronAppPaths.documents) dirs.push(electronAppPaths.documents)
    if (electronAppPaths.desktop) dirs.push(electronAppPaths.desktop)
  } else {
    // Fallback to common paths
    dirs.push(
      path.join(home, 'Music'),
      path.join(home, 'Downloads'),
      path.join(home, 'Documents'),
      path.join(home, 'Desktop')
    )
  }

  // Additional safe common paths (specific folders, NOT entire drives)
  dirs.push(
    // macOS specific
    path.join(home, 'Library', 'Music'),
    // Temp directory for YouTube cache
    os.tmpdir(),
    // Common shared music location on Windows
    'C:\\Users\\Public\\Music',
  )

  // Add user-selected directories (from folder dialog)
  for (const userDir of userAllowedDirectories) {
    dirs.push(userDir)
  }

  return dirs
}

/**
 * Check if path is safe (no traversal, null bytes, etc.)
 */
export function isPathSafe(filePath: string): boolean {
  if (!filePath) return false

  // Check for null bytes (common injection technique)
  if (filePath.includes('\0')) return false

  // Normalize and check for path traversal
  const normalized = path.normalize(filePath)
  if (normalized.includes('..')) return false

  // Must be absolute path
  if (!path.isAbsolute(normalized)) return false

  return true
}

/**
 * Check if path is a symlink (async version for main process)
 * Returns true if path is a symlink, false otherwise
 */
export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises')
    const stats = await fs.lstat(filePath)
    return stats.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * File access validation result with optional file handle
 * SECURITY: When fileHandle is returned, use it directly to avoid TOCTOU
 */
export interface FileAccessResult {
  valid: boolean
  error?: string
  fileHandle?: import('fs/promises').FileHandle
  stats?: import('fs').Stats
}

/**
 * Safely open a file with TOCTOU protection
 * Opens file and validates in a single atomic operation to prevent race conditions
 *
 * SECURITY: This function opens the file and returns the handle. The caller MUST:
 * 1. Use the returned fileHandle for all operations (don't reopen the file)
 * 2. Close the fileHandle when done
 *
 * @returns FileAccessResult with fileHandle if successful (caller must close it)
 */
export async function safeOpenFile(filePath: string): Promise<FileAccessResult> {
  const fs = await import('fs/promises')
  const constants = await import('fs').then(m => m.constants)

  // Basic path safety checks first (no file I/O needed)
  if (!isPathSafe(filePath)) {
    return { valid: false, error: 'Invalid path format' }
  }

  // Check if path is within allowed directories (no file I/O needed)
  if (!isPathAllowed(filePath)) {
    return { valid: false, error: 'Access denied to this directory' }
  }

  let fileHandle: import('fs/promises').FileHandle | null = null

  try {
    // Open file with O_NOFOLLOW to prevent symlink following (TOCTOU protection)
    // On Windows, O_NOFOLLOW doesn't exist, so we fall back to checking after open
    const openFlags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0)

    fileHandle = await fs.open(filePath, openFlags)

    // Get stats from the file handle (fstat - atomic, no TOCTOU)
    const stats = await fileHandle.stat()

    // Check if it's a symlink (additional check for Windows where O_NOFOLLOW may not work)
    // Use lstat on the path to detect symlinks
    const lstats = await fs.lstat(filePath)
    if (lstats.isSymbolicLink()) {
      await fileHandle.close()
      return { valid: false, error: 'Symlinks not allowed' }
    }

    // Verify it's a regular file
    if (!stats.isFile()) {
      await fileHandle.close()
      return { valid: false, error: 'Not a regular file' }
    }

    // Success - return the handle (caller must close it!)
    return { valid: true, fileHandle, stats }
  } catch (err) {
    // Clean up handle if opened
    if (fileHandle) {
      await fileHandle.close().catch(() => {})
    }

    // Handle specific errors
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ELOOP') {
      return { valid: false, error: 'Symlinks not allowed' }
    }
    if (error.code === 'ENOENT') {
      return { valid: false, error: 'File not found' }
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return { valid: false, error: 'Permission denied' }
    }

    return { valid: false, error: `File access error: ${error.code || 'unknown'}` }
  }
}

/**
 * Validate path is safe and not a symlink (comprehensive check)
 * Use this for file access validation in main process
 *
 * @deprecated Use safeOpenFile() instead to prevent TOCTOU vulnerabilities
 */
export async function validateFileAccess(filePath: string): Promise<{ valid: boolean; error?: string }> {
  // Basic path safety checks
  if (!isPathSafe(filePath)) {
    return { valid: false, error: 'Invalid path format' }
  }

  // Check if path is within allowed directories
  if (!isPathAllowed(filePath)) {
    return { valid: false, error: 'Access denied to this directory' }
  }

  // Check for symlinks (prevents symlink attacks)
  if (await isSymlink(filePath)) {
    return { valid: false, error: 'Symlinks not allowed' }
  }

  return { valid: true }
}

/**
 * Check if path is within allowed directories
 */
export function isPathAllowed(filePath: string): boolean {
  if (!isPathSafe(filePath)) return false

  const normalized = path.normalize(filePath)
  const allowed = getAllowedDirectories()

  return allowed.some(dir => {
    const normalizedDir = path.normalize(dir)
    return normalized.toLowerCase().startsWith(normalizedDir.toLowerCase())
  })
}

/**
 * Check if file has valid audio extension
 */
export function isValidAudioFile(filePath: string): boolean {
  if (!filePath) return false
  const ext = path.extname(filePath).toLowerCase()
  return AUDIO_EXTENSIONS.includes(ext)
}

/**
 * Get MIME type for audio file
 */
export function getAudioMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'audio/mpeg'
}

// ============ Timeout Configuration ============

export const YT_DLP_TIMEOUT_MS = 120000 // 2 minutes
export const STREAM_TIMEOUT_MS = 30000 // 30 seconds
