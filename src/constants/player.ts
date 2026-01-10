/**
 * Player-related constants
 */

// Time intervals (milliseconds)
export const UPDATE_INTERVAL_MS = 250

// Crossfade settings
export const MIN_CROSSFADE_TIME = 0.5
export const DEFAULT_CROSSFADE_DURATION = 3
export const MAX_CROSSFADE_DURATION = 10

// Playback
export const RESTART_THRESHOLD_SECONDS = 3
export const DEFAULT_VOLUME = 0.7

// Library
export const MAX_RECENTLY_PLAYED = 50

// Supported audio formats
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']
export const AUDIO_EXTENSIONS_FILTER = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac']

// Repeat modes
export const REPEAT_MODES = ['off', 'all', 'one'] as const
