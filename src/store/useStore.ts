/**
 * Application store with family profiles support
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Track, Playlist, RepeatMode, AudioSettings, Profile } from '../types'
import { generateId } from '../utils/id'
import {
  DEFAULT_VOLUME,
  DEFAULT_CROSSFADE_DURATION,
  MAX_RECENTLY_PLAYED,
  RESTART_THRESHOLD_SECONDS,
} from '../constants/player'

// Re-export types for backward compatibility
export type { Track, Playlist, AudioSettings, Profile }

// Profile colors for selection
export const PROFILE_COLORS = [
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f97316', // orange
  '#22c55e', // green
  '#3b82f6', // blue
  '#ef4444', // red
  '#14b8a6', // teal
  '#f59e0b', // amber
]

// Profile avatars (emojis)
export const PROFILE_AVATARS = [
  '😊', '😎', '🎵', '🎧', '🎤', '🎸', '🎹', '🎺',
  '👨', '👩', '👦', '👧', '🧑', '👴', '👵', '🐱',
  '🐶', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🦄',
]

/**
 * Application state with profiles
 * All data is now isolated per profile
 */
interface AppState {
  // Profiles
  profiles: Profile[]
  currentProfileId: string | null

  // Library (per profile)
  tracks: Record<string, Track[]> // profileId -> tracks
  playlists: Record<string, Playlist[]> // profileId -> playlists
  recentlyPlayed: Record<string, string[]> // profileId -> trackIds
  favorites: Record<string, string[]> // profileId -> trackIds
  musicFolders: Record<string, string[]> // profileId -> folders
  audioSettings: AudioSettings

  // Player
  player: {
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

  // Profile Actions
  createProfile: (name: string, avatar: string, color: string) => Profile
  updateProfile: (id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>) => void
  deleteProfile: (id: string) => void
  switchProfile: (id: string) => void
  getCurrentProfile: () => Profile | null

  // Library Actions
  addTracks: (tracks: Track[]) => void
  removeTrack: (id: string) => void
  addMusicFolder: (path: string) => void
  removeMusicFolder: (path: string) => void
  getTracks: () => Track[]
  getMusicFolders: () => string[]

  // Playlist Actions
  createPlaylist: (name: string, description?: string) => Playlist
  updatePlaylist: (id: string, updates: Partial<Playlist>) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (playlistId: string, trackId: string) => void
  removeFromPlaylist: (playlistId: string, trackId: string) => void
  getPlaylists: () => Playlist[]

  // Favorites Actions (per profile)
  toggleFavorite: (trackId: string) => void
  isFavorite: (trackId: string) => boolean
  getFavorites: () => string[]

  // Player Actions
  playTrack: (track: Track, queue?: Track[]) => void
  pauseTrack: () => void
  resumeTrack: () => void
  nextTrack: () => void
  previousTrack: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  setRepeatMode: (mode: RepeatMode) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  addToQueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  addToRecentlyPlayed: (trackId: string) => void
  getRecentlyPlayed: () => string[]

  // Audio Settings
  setAudioSettings: (settings: Partial<AudioSettings>) => void
}

/**
 * Main application store
 */
export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ============ Initial State ============

      profiles: [],
      currentProfileId: null,
      tracks: {},
      playlists: {},
      recentlyPlayed: {},
      favorites: {},
      musicFolders: {},
      audioSettings: {
        crossfade: false,
        crossfadeDuration: DEFAULT_CROSSFADE_DURATION,
        normalizeVolume: false,
      },
      player: {
        isPlaying: false,
        currentTrack: null,
        queue: [],
        queueIndex: 0,
        volume: DEFAULT_VOLUME,
        isMuted: false,
        isShuffled: false,
        repeatMode: 'off',
        currentTime: 0,
        duration: 0,
      },

      // ============ Profile Actions ============

      createProfile: (name, avatar, color) => {
        const profile: Profile = {
          id: generateId(),
          name,
          avatar,
          color,
          createdAt: Date.now(),
        }

        set((state) => {
          const newState: Partial<AppState> = {
            profiles: [...state.profiles, profile],
          }
          // If this is the first profile, set it as current
          if (state.profiles.length === 0) {
            newState.currentProfileId = profile.id
          }
          return newState
        })

        return profile
      },

      updateProfile: (id, updates) => {
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }))
      },

      deleteProfile: (id) => {
        set((state) => {
          const newProfiles = state.profiles.filter((p) => p.id !== id)
          const newFavorites = { ...state.favorites }
          const newRecentlyPlayed = { ...state.recentlyPlayed }
          const newTracks = { ...state.tracks }
          const newPlaylists = { ...state.playlists }
          const newMusicFolders = { ...state.musicFolders }

          delete newFavorites[id]
          delete newRecentlyPlayed[id]
          delete newTracks[id]
          delete newPlaylists[id]
          delete newMusicFolders[id]

          return {
            profiles: newProfiles,
            favorites: newFavorites,
            recentlyPlayed: newRecentlyPlayed,
            tracks: newTracks,
            playlists: newPlaylists,
            musicFolders: newMusicFolders,
            // Switch to another profile if current was deleted
            currentProfileId:
              state.currentProfileId === id
                ? newProfiles[0]?.id || null
                : state.currentProfileId,
          }
        })
      },

      switchProfile: (id) => {
        set({ currentProfileId: id })
      },

      getCurrentProfile: () => {
        const state = get()
        return state.profiles.find((p) => p.id === state.currentProfileId) || null
      },

      // ============ Library Actions ============

      addTracks: (newTracks) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profileTracks = state.tracks[profileId] || []
          const existingPaths = new Set(profileTracks.map((t) => t.path))
          const now = Date.now()
          const uniqueTracks = newTracks
            .filter((t) => !existingPaths.has(t.path))
            .map((t) => ({ ...t, addedAt: t.addedAt || now }))

          return {
            tracks: {
              ...state.tracks,
              [profileId]: [...profileTracks, ...uniqueTracks],
            },
          }
        })
      },

      removeTrack: (id) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profileTracks = state.tracks[profileId] || []
          const profileFavorites = state.favorites[profileId] || []

          return {
            tracks: {
              ...state.tracks,
              [profileId]: profileTracks.filter((t) => t.id !== id),
            },
            favorites: {
              ...state.favorites,
              [profileId]: profileFavorites.filter((tid) => tid !== id),
            },
          }
        })
      },

      addMusicFolder: (path) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profileFolders = state.musicFolders[profileId] || []
          if (profileFolders.includes(path)) return state

          return {
            musicFolders: {
              ...state.musicFolders,
              [profileId]: [...profileFolders, path],
            },
          }
        })
      },

      removeMusicFolder: (path) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profileFolders = state.musicFolders[profileId] || []

          return {
            musicFolders: {
              ...state.musicFolders,
              [profileId]: profileFolders.filter((f) => f !== path),
            },
          }
        })
      },

      getTracks: () => {
        const state = get()
        const profileId = state.currentProfileId
        if (!profileId) return []
        return state.tracks[profileId] || []
      },

      getMusicFolders: () => {
        const state = get()
        const profileId = state.currentProfileId
        if (!profileId) return []
        return state.musicFolders[profileId] || []
      },

      // ============ Playlist Actions ============

      createPlaylist: (name, description) => {
        const profileId = get().currentProfileId
        if (!profileId) {
          return { id: '', name: '', tracks: [], createdAt: 0 }
        }

        const playlist: Playlist = {
          id: generateId(),
          name,
          description,
          tracks: [],
          createdAt: Date.now(),
        }

        set((state) => {
          const profilePlaylists = state.playlists[profileId] || []
          return {
            playlists: {
              ...state.playlists,
              [profileId]: [...profilePlaylists, playlist],
            },
          }
        })

        return playlist
      },

      updatePlaylist: (id, updates) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profilePlaylists = state.playlists[profileId] || []

          return {
            playlists: {
              ...state.playlists,
              [profileId]: profilePlaylists.map((p) =>
                p.id === id ? { ...p, ...updates } : p
              ),
            },
          }
        })
      },

      deletePlaylist: (id) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profilePlaylists = state.playlists[profileId] || []

          return {
            playlists: {
              ...state.playlists,
              [profileId]: profilePlaylists.filter((p) => p.id !== id),
            },
          }
        })
      },

      addToPlaylist: (playlistId, trackId) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profilePlaylists = state.playlists[profileId] || []

          return {
            playlists: {
              ...state.playlists,
              [profileId]: profilePlaylists.map((p) =>
                p.id === playlistId && !p.tracks.includes(trackId)
                  ? { ...p, tracks: [...p.tracks, trackId] }
                  : p
              ),
            },
          }
        })
      },

      removeFromPlaylist: (playlistId, trackId) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profilePlaylists = state.playlists[profileId] || []

          return {
            playlists: {
              ...state.playlists,
              [profileId]: profilePlaylists.map((p) =>
                p.id === playlistId
                  ? { ...p, tracks: p.tracks.filter((t) => t !== trackId) }
                  : p
              ),
            },
          }
        })
      },

      getPlaylists: () => {
        const state = get()
        const profileId = state.currentProfileId
        if (!profileId) return []
        return state.playlists[profileId] || []
      },

      // ============ Favorites Actions (per profile) ============

      toggleFavorite: (trackId) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profileFavorites = state.favorites[profileId] || []
          const isFav = profileFavorites.includes(trackId)

          return {
            favorites: {
              ...state.favorites,
              [profileId]: isFav
                ? profileFavorites.filter((id) => id !== trackId)
                : [...profileFavorites, trackId],
            },
          }
        })
      },

      isFavorite: (trackId) => {
        const state = get()
        const profileId = state.currentProfileId
        if (!profileId) return false
        return (state.favorites[profileId] || []).includes(trackId)
      },

      getFavorites: () => {
        const state = get()
        const profileId = state.currentProfileId
        if (!profileId) return []
        return state.favorites[profileId] || []
      },

      // ============ Player Actions ============

      playTrack: (track, queue) => {
        const currentQueue = queue || [track]
        const index = currentQueue.findIndex((t) => t.id === track.id)

        set((state) => ({
          player: {
            ...state.player,
            currentTrack: track,
            queue: currentQueue,
            queueIndex: index >= 0 ? index : 0,
            isPlaying: true,
            currentTime: 0,
          },
        }))

        get().addToRecentlyPlayed(track.id)
      },

      pauseTrack: () => {
        set((state) => ({
          player: { ...state.player, isPlaying: false },
        }))
      },

      resumeTrack: () => {
        set((state) => ({
          player: { ...state.player, isPlaying: true },
        }))
      },

      nextTrack: () => {
        const { player } = get()
        const { queue, queueIndex, isShuffled, repeatMode } = player

        if (queue.length === 0) return

        let nextIndex: number

        if (repeatMode === 'one') {
          nextIndex = queueIndex
        } else if (isShuffled) {
          nextIndex = Math.floor(Math.random() * queue.length)
        } else {
          nextIndex = queueIndex + 1
          if (nextIndex >= queue.length) {
            if (repeatMode === 'all') {
              nextIndex = 0
            } else {
              return
            }
          }
        }

        const nextTrack = queue[nextIndex]
        set((state) => ({
          player: {
            ...state.player,
            currentTrack: nextTrack,
            queueIndex: nextIndex,
            currentTime: 0,
          },
        }))
        get().addToRecentlyPlayed(nextTrack.id)
      },

      previousTrack: () => {
        const { player } = get()
        const { queue, queueIndex, currentTime } = player

        if (queue.length === 0) return

        if (currentTime > RESTART_THRESHOLD_SECONDS) {
          set((state) => ({
            player: { ...state.player, currentTime: 0 },
          }))
          return
        }

        const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1
        const prevTrack = queue[prevIndex]

        set((state) => ({
          player: {
            ...state.player,
            currentTrack: prevTrack,
            queueIndex: prevIndex,
            currentTime: 0,
          },
        }))
      },

      setVolume: (volume) => {
        set((state) => ({
          player: { ...state.player, volume, isMuted: volume === 0 },
        }))
      },

      toggleMute: () => {
        set((state) => ({
          player: { ...state.player, isMuted: !state.player.isMuted },
        }))
      },

      toggleShuffle: () => {
        set((state) => ({
          player: { ...state.player, isShuffled: !state.player.isShuffled },
        }))
      },

      setRepeatMode: (mode) => {
        set((state) => ({
          player: { ...state.player, repeatMode: mode },
        }))
      },

      setCurrentTime: (time) => {
        set((state) => ({
          player: { ...state.player, currentTime: time },
        }))
      },

      setDuration: (duration) => {
        set((state) => ({
          player: { ...state.player, duration },
        }))
      },

      addToQueue: (track) => {
        set((state) => ({
          player: { ...state.player, queue: [...state.player.queue, track] },
        }))
      },

      removeFromQueue: (index) => {
        set((state) => {
          const newQueue = [...state.player.queue]
          newQueue.splice(index, 1)

          let newIndex = state.player.queueIndex
          if (index < newIndex) {
            newIndex--
          } else if (index === newIndex && newIndex >= newQueue.length) {
            newIndex = Math.max(0, newQueue.length - 1)
          }

          return {
            player: {
              ...state.player,
              queue: newQueue,
              queueIndex: newIndex,
            },
          }
        })
      },

      clearQueue: () => {
        set((state) => ({
          player: { ...state.player, queue: [], queueIndex: 0 },
        }))
      },

      addToRecentlyPlayed: (trackId) => {
        set((state) => {
          const profileId = state.currentProfileId
          if (!profileId) return state

          const profileRecent = state.recentlyPlayed[profileId] || []
          const filtered = profileRecent.filter((id) => id !== trackId)

          return {
            recentlyPlayed: {
              ...state.recentlyPlayed,
              [profileId]: [trackId, ...filtered].slice(0, MAX_RECENTLY_PLAYED),
            },
          }
        })
      },

      getRecentlyPlayed: () => {
        const state = get()
        const profileId = state.currentProfileId
        if (!profileId) return []
        return state.recentlyPlayed[profileId] || []
      },

      // ============ Audio Settings ============

      setAudioSettings: (settings) => {
        set((state) => ({
          audioSettings: { ...state.audioSettings, ...settings },
        }))
      },
    }),
    {
      name: 'music-player-storage',
      partialize: (state) => ({
        profiles: state.profiles,
        currentProfileId: state.currentProfileId,
        tracks: state.tracks,
        playlists: state.playlists,
        favorites: state.favorites,
        recentlyPlayed: state.recentlyPlayed,
        musicFolders: state.musicFolders,
        audioSettings: state.audioSettings,
        player: {
          volume: state.player.volume,
          isShuffled: state.player.isShuffled,
          repeatMode: state.player.repeatMode,
        },
      }),
    }
  )
)
