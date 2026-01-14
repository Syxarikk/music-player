/**
 * Shared Piped and Invidious instances configuration
 * Used by both client (youtubeApi.ts) and can be imported by server
 *
 * These instances provide YouTube audio streaming without API keys
 * Updated regularly - check https://piped.kavin.rocks/preferences for working instances
 */

// Piped API instances (updated January 2025)
// Can be overridden via VITE_PIPED_INSTANCES env variable (comma-separated)
export const DEFAULT_PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.drgns.space',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.wireway.ch',
  'https://pipedapi.darkness.services',
  'https://piped-api.hostux.net',
  'https://api.piped.private.coffee',
]

// Invidious API instances as fallback (updated January 2025)
// Can be overridden via VITE_INVIDIOUS_INSTANCES env variable (comma-separated)
export const DEFAULT_INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.private.coffee',
  'https://vid.puffyan.us',
]

/**
 * Get Piped instances from environment or defaults
 */
export function getPipedInstances(): string[] {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PIPED_INSTANCES) {
    return (import.meta.env.VITE_PIPED_INSTANCES as string)
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .filter((url: string) => url.startsWith('https://'))
  }
  return DEFAULT_PIPED_INSTANCES
}

/**
 * Get Invidious instances from environment or defaults
 */
export function getInvidiousInstances(): string[] {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_INVIDIOUS_INSTANCES) {
    return (import.meta.env.VITE_INVIDIOUS_INSTANCES as string)
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .filter((url: string) => url.startsWith('https://'))
  }
  return DEFAULT_INVIDIOUS_INSTANCES
}

/**
 * YouTube video ID validation regex (11 chars: alphanumeric, dash, underscore)
 */
export const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

/**
 * Validate YouTube video ID format
 */
export function isValidVideoId(videoId: string | null | undefined): boolean {
  if (!videoId || typeof videoId !== 'string') return false
  return VIDEO_ID_REGEX.test(videoId)
}
