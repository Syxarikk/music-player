/**
 * Audio utility functions
 */

// Player constants
export const UPDATE_INTERVAL_MS = 250
export const MIN_CROSSFADE_TIME = 0.5
export const RESTART_THRESHOLD_SECONDS = 3

/**
 * Converts a file path to a file:// URL for use in the browser/Electron
 * Handles both Windows and Unix paths
 */
export function getFilePath(path: string): string {
  if (path.startsWith('file://')) {
    return path
  }
  // Convert Windows backslashes to forward slashes
  return `file:///${path.replace(/\\/g, '/')}`
}

/**
 * Formats seconds to a human-readable time string (e.g., "3:45")
 */
export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Formats duration to a longer format (e.g., "3 мин 45 сек")
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0 мин'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  if (secs === 0) return `${mins} мин`
  return `${mins} мин ${secs} сек`
}

/**
 * Calculates total duration of tracks in hours and minutes
 */
export function formatTotalDuration(tracks: { duration: number }[]): string {
  const totalSeconds = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours} ч ${mins} мин`
  }
  return `${mins} мин`
}

/**
 * Shuffles an array using Fisher-Yates algorithm
 * Returns a new shuffled array without modifying the original
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
