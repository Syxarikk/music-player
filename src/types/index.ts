/**
 * Core type definitions for Music Player
 */

export type TrackSource = 'local' | 'youtube'

/**
 * User profile for family sharing
 */
export interface Profile {
  id: string
  name: string
  avatar: string // emoji or icon
  color: string // accent color
  createdAt: number
}

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  path: string
  coverArt?: string | null
  year?: number
  genre?: string
  addedAt?: number
  source?: TrackSource
  youtubeId?: string
}

export interface Playlist {
  id: string
  name: string
  description?: string
  coverArt?: string
  tracks: string[] // track IDs
  createdAt: number
}

export interface AudioSettings {
  crossfade: boolean
  crossfadeDuration: number
  normalizeVolume: boolean
  // YouTube settings
  youtubeMode: 'local' | 'server' // local = yt-dlp on PC, server = remote server
  youtubeServerUrl: string // URL of the media server for YouTube downloads
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlayerState {
  isPlaying: boolean
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  volume: number
  isMuted: boolean
  isShuffled: boolean
  repeatMode: RepeatMode
  currentTime: number
  duration: number
}
