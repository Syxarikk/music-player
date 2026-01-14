import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Repeat,
  Repeat1,
  Shuffle,
  Heart,
  ListMusic,
  Music,
  Loader2,
  Youtube,
} from 'lucide-react'
import { Howl } from 'howler'
import { useStore } from '../store/useStore'
import type { Track } from '../types'
import { formatTime, UPDATE_INTERVAL_MS, MIN_CROSSFADE_TIME } from '../utils/audio'
import {
  isYouTubeTrack,
  getVideoId,
  getAudioUrl as getPipedAudioUrl,
} from '../services/youtubeApi'
import { api, isElectron, isMobileStandalone } from '../services/apiClient'
import { sanitizeImageUrl } from '../utils/sanitize'
import type { AudioSettings } from '../types'
import QueuePanel from './QueuePanel'
import './Player.css'

/**
 * Get audio URL for any track (local or YouTube)
 */
async function getAudioUrl(
  track: Track,
  audioSettings: AudioSettings
): Promise<string | null> {
  if (isYouTubeTrack(track)) {
    const videoId = getVideoId(track)
    if (!videoId) {
      console.error('No video ID found for track:', track.title)
      return null
    }

    // Check YouTube mode from settings
    if (audioSettings.youtubeMode === 'local' && isElectron) {
      // Local mode: use yt-dlp on this PC via Electron
      try {
        const electronUrl = await window.electronAPI.getYouTubeAudioUrl(videoId)
        if (electronUrl) return electronUrl
      } catch (err) {
        console.error('Local yt-dlp error:', err)
      }
      // Fallback to Piped API
      return await getPipedAudioUrl(videoId)
    }

    // Server mode: use remote server for YouTube downloads
    if (audioSettings.youtubeServerUrl) {
      return `${audioSettings.youtubeServerUrl}/api/youtube/audio/${videoId}`
    }

    // Mobile standalone: use Piped API
    if (isMobileStandalone) {
      return await getPipedAudioUrl(videoId)
    }

    // Web fallback
    return api.getAudioUrl(track)
  }

  // Local files
  if (isElectron) {
    return await window.electronAPI.getAudioUrl(track.path)
  } else if (isMobileStandalone) {
    return null
  } else {
    return api.getAudioUrl(track)
  }
}

const REPEAT_MODES = ['off', 'all', 'one'] as const

export default function Player() {
  const {
    player,
    audioSettings,
    getTracks,
    pauseTrack,
    resumeTrack,
    nextTrack,
    previousTrack,
    setVolume,
    toggleMute,
    toggleShuffle,
    setRepeatMode,
    setCurrentTime,
    setDuration,
    toggleFavorite,
    isFavorite,
    addTracks,
  } = useStore()

  const tracks = getTracks()

  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    isShuffled,
    repeatMode,
    currentTime,
    duration,
    queue,
    queueIndex,
  } = player

  const { crossfade, crossfadeDuration } = audioSettings

  const soundRef = useRef<Howl | null>(null)
  const nextSoundRef = useRef<Howl | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const isCrossfading = useRef(false)
  const isPlayingRef = useRef(isPlaying)
  const loadingTrackIdRef = useRef<string | null>(null)
  const isSeekingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isLoadingRef = useRef(false) // Mutex to prevent concurrent loads
  const activeFadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null) // Crossfade timer
  const isMountedRef = useRef(true) // Track component mount state for cleanup
  const actualVolume = isMuted ? 0 : volume

  // Refs for event handlers to avoid recreating listeners
  const calculateTimeFromEventRef = useRef<(e: MouseEvent | React.MouseEvent) => number>(() => 0)
  const performSeekRef = useRef<(time: number) => void>(() => {})
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Local volume state for immediate UI feedback (debounced store update)
  const [localVolume, setLocalVolume] = useState(volume)

  // Sync local volume with store when store changes externally
  useEffect(() => {
    setLocalVolume(volume)
  }, [volume])

  // Debounced volume handler - updates UI immediately, store with delay
  const handleVolumeChange = useCallback((newVolume: number) => {
    setLocalVolume(newVolume) // Immediate UI update

    // Debounce the store update
    if (volumeDebounceRef.current) {
      clearTimeout(volumeDebounceRef.current)
    }
    volumeDebounceRef.current = setTimeout(() => {
      setVolume(newVolume)
    }, 50)
  }, [setVolume])

  // Cleanup volume debounce on unmount
  useEffect(() => {
    return () => {
      if (volumeDebounceRef.current) {
        clearTimeout(volumeDebounceRef.current)
      }
    }
  }, [])

  const [isLoadingAudio, setIsLoadingAudio] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [showQueue, setShowQueue] = useState(false)
  const [isAudioReady, setIsAudioReady] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragTime, setDragTime] = useState(0)

  // Handle favorite toggle - add track to library first if needed
  const handleToggleFavorite = useCallback(() => {
    if (!currentTrack) return

    // Check if track is already in library
    const isInLibrary = tracks.some(t => t.id === currentTrack.id || t.path === currentTrack.path)

    // If it's a YouTube track and not in library, add it first
    if (!isInLibrary && isYouTubeTrack(currentTrack)) {
      addTracks([{ ...currentTrack, addedAt: Date.now() }])
    }

    toggleFavorite(currentTrack.id)
  }, [currentTrack, tracks, addTracks, toggleFavorite])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  // Track mount state for safe cleanup in async operations
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      // Abort any pending audio loading
      abortControllerRef.current?.abort()
      abortControllerRef.current = null

      // Clean up any active fade timer first to prevent callbacks
      if (activeFadeTimerRef.current) {
        clearInterval(activeFadeTimerRef.current)
        activeFadeTimerRef.current = null
      }

      // Safely stop and unload all audio instances
      try {
        if (soundRef.current) {
          soundRef.current.stop()
          soundRef.current.unload()
          soundRef.current = null
        }
      } catch (e) {
        console.warn('Error cleaning up soundRef:', e)
      }

      try {
        if (nextSoundRef.current) {
          nextSoundRef.current.stop()
          nextSoundRef.current.unload()
          nextSoundRef.current = null
        }
      } catch (e) {
        console.warn('Error cleaning up nextSoundRef:', e)
      }

      // Reset flags
      isCrossfading.current = false
      isLoadingRef.current = false
      loadingTrackIdRef.current = null
    }
  }, [])

  const getNextTrackData = useCallback((): Track | null => {
    if (queue.length === 0) return null

    if (repeatMode === 'one') return currentTrack

    let nextIdx = queueIndex + 1
    if (nextIdx >= queue.length) {
      if (repeatMode === 'all') {
        nextIdx = 0
      } else {
        return null
      }
    }

    return queue[nextIdx]
  }, [queue, queueIndex, repeatMode, currentTrack])

  useEffect(() => {
    if (!currentTrack) return

    // Store track ID to check if it changed during async loading
    const trackId = currentTrack.id
    loadingTrackIdRef.current = trackId

    // Abort any previous loading operation immediately
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Reset loading state - abort already signals cancellation to previous load
    isLoadingRef.current = false

    isCrossfading.current = false
    setAudioError(null)
    setIsAudioReady(false)

    // Use crossfade preloaded track if available
    if (nextSoundRef.current) {
      soundRef.current?.unload()
      soundRef.current = nextSoundRef.current
      nextSoundRef.current = null
      setDuration(soundRef.current?.duration() || 0)
      soundRef.current.volume(actualVolume)
      if (!soundRef.current.playing()) {
        soundRef.current.play()
      }
      setIsLoadingAudio(false)
      setIsAudioReady(true)
      return
    }

    // Stop and unload previous audio immediately
    if (soundRef.current) {
      soundRef.current.stop()
      soundRef.current.unload()
      soundRef.current = null
    }

    const loadAudio = async () => {
      // Set loading mutex
      isLoadingRef.current = true
      setIsLoadingAudio(true)

      try {
        // Check if aborted before starting
        if (abortController.signal.aborted) {
          isLoadingRef.current = false
          return
        }

        const audioUrl = await getAudioUrl(currentTrack, audioSettings)

        // Check if aborted or track changed
        if (abortController.signal.aborted || loadingTrackIdRef.current !== trackId) {
          console.log('Track load aborted for:', trackId)
          isLoadingRef.current = false
          return
        }

        if (!audioUrl) {
          setAudioError('Не удалось загрузить аудио')
          setIsLoadingAudio(false)
          isLoadingRef.current = false
          return
        }

        // Double-check before creating Howl
        if (abortController.signal.aborted || loadingTrackIdRef.current !== trackId) {
          console.log('Track changed before creating Howl, aborting')
          isLoadingRef.current = false
          return
        }

        // Clean up any existing sound
        if (soundRef.current) {
          soundRef.current.stop()
          soundRef.current.unload()
          soundRef.current = null
        }

        const isYouTube = isYouTubeTrack(currentTrack)
        const format = isYouTube ? ['m4a', 'mp4', 'webm'] : undefined

        const newSound = new Howl({
          src: [audioUrl],
          html5: true,
          format: format,
          volume: actualVolume,
          onload: () => {
            // Final check before playing
            if (abortController.signal.aborted || loadingTrackIdRef.current !== trackId) {
              newSound.unload()
              isLoadingRef.current = false
              return
            }
            setDuration(newSound.duration() || 0)
            setIsLoadingAudio(false)
            setIsAudioReady(true)
            isLoadingRef.current = false
            if (isPlayingRef.current && !newSound.playing()) {
              newSound.play()
            }
          },
          onend: () => {
            if (!isCrossfading.current) {
              nextTrack()
            }
          },
          onloaderror: (_id, error) => {
            if (!abortController.signal.aborted && loadingTrackIdRef.current === trackId) {
              console.error('Audio load error:', error)
              setAudioError('Ошибка загрузки аудио')
              setIsLoadingAudio(false)
              isLoadingRef.current = false
            }
          },
          onplayerror: (_id, error) => {
            if (!abortController.signal.aborted && loadingTrackIdRef.current === trackId) {
              console.error('Audio play error:', error)
              // Try to recover by unlocking audio context
              newSound.once('unlock', () => {
                newSound.play()
              })
            }
          },
        })

        // Only assign if not aborted
        if (!abortController.signal.aborted && loadingTrackIdRef.current === trackId) {
          soundRef.current = newSound
        } else {
          newSound.unload()
        }
      } catch (error) {
        if (!abortController.signal.aborted && loadingTrackIdRef.current === trackId) {
          console.error('Audio fetch error:', error)
          setAudioError('Ошибка получения аудио')
          setIsLoadingAudio(false)
        }
        isLoadingRef.current = false
      }
    }

    loadAudio()

    return () => {
      // Abort loading on cleanup first to prevent race conditions
      abortController.abort()
      isLoadingRef.current = false

      // Safely cleanup sound with try-catch to prevent errors
      if (!isCrossfading.current && soundRef.current) {
        try {
          soundRef.current.stop()
          soundRef.current.unload()
        } catch (e) {
          console.warn('Error during sound cleanup:', e)
        }
        soundRef.current = null
      }
    }
  }, [currentTrack?.id])

  useEffect(() => {
    if (!soundRef.current) return
    if (isPlaying) {
      // Only call play if not already playing to avoid restart
      if (!soundRef.current.playing()) {
        soundRef.current.play()
      }
    } else {
      soundRef.current.pause()
    }
  }, [isPlaying])

  useEffect(() => {
    if (!soundRef.current) return
    soundRef.current.volume(actualVolume)
  }, [actualVolume])

  useEffect(() => {
    if (!soundRef.current || !isPlaying || !isAudioReady) return

    const interval = setInterval(() => {
      if (!soundRef.current || isSeekingRef.current) return

      const current = soundRef.current.seek() as number
      const dur = soundRef.current.duration()

      if (typeof current === 'number' && !isNaN(current)) {
        setCurrentTime(current)
      }

      if (crossfade && dur > 0) {
        const timeLeft = dur - current

        if (
          timeLeft <= crossfadeDuration &&
          timeLeft > MIN_CROSSFADE_TIME &&
          !isCrossfading.current
        ) {
          const nextTrackData = getNextTrackData()

          if (nextTrackData && nextTrackData.id !== currentTrack?.id) {
            isCrossfading.current = true

            const prepareCrossfade = async () => {
              // Safety check: abort if component unmounted during async operation
              if (!isMountedRef.current) {
                isCrossfading.current = false
                return
              }

              try {
                const nextUrl = await getAudioUrl(nextTrackData, audioSettings)

                // Double-check mount state after async operation
                if (!isMountedRef.current || !nextUrl) {
                  isCrossfading.current = false
                  return
                }

                nextSoundRef.current = new Howl({
                  src: [nextUrl],
                  html5: true,
                  volume: 0,
                  onload: () => {
                    // Safety: verify component is still mounted and crossfade is still active
                    if (!isMountedRef.current) {
                      nextSoundRef.current?.unload()
                      nextSoundRef.current = null
                      isCrossfading.current = false
                      return
                    }

                    if (nextSoundRef.current && isCrossfading.current) {
                      nextSoundRef.current.play()
                      nextTrack()

                      const fadeSteps = 20
                      const fadeInterval = (crossfadeDuration * 1000) / fadeSteps
                      let step = 0

                      const fadingOutSound = soundRef.current
                      const fadingInSound = nextSoundRef.current

                      // Clear any previous fade timer before starting new one
                      if (activeFadeTimerRef.current) {
                        clearInterval(activeFadeTimerRef.current)
                      }

                      activeFadeTimerRef.current = setInterval(() => {
                        // Safety check: stop if component unmounted
                        if (!isMountedRef.current) {
                          if (activeFadeTimerRef.current) {
                            clearInterval(activeFadeTimerRef.current)
                            activeFadeTimerRef.current = null
                          }
                          return
                        }

                        step++
                        const progress = step / fadeSteps

                        if (fadingInSound) {
                          fadingInSound.volume(actualVolume * progress)
                        }
                        if (fadingOutSound) {
                          fadingOutSound.volume(actualVolume * (1 - progress))
                        }

                        if (step >= fadeSteps) {
                          if (activeFadeTimerRef.current) {
                            clearInterval(activeFadeTimerRef.current)
                            activeFadeTimerRef.current = null
                          }
                          fadingOutSound?.unload()
                        }
                      }, fadeInterval)
                    }
                  },
                  onloaderror: () => {
                    isCrossfading.current = false
                  },
                })
              } catch {
                isCrossfading.current = false
              }
            }

            prepareCrossfade()
          }
        }
      }
    }, UPDATE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [
    isPlaying,
    isAudioReady,
    crossfade,
    crossfadeDuration,
    currentTrack?.id,
    actualVolume,
    getNextTrackData,
    setCurrentTime,
    nextTrack,
  ])

  const calculateTimeFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!progressRef.current || !duration) return 0
    const rect = progressRef.current.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return percent * duration
  }, [duration])

  // Keep ref in sync with latest callback
  calculateTimeFromEventRef.current = calculateTimeFromEvent

  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !soundRef.current) return

    e.preventDefault()
    isSeekingRef.current = true
    const newTime = calculateTimeFromEvent(e)
    setIsDragging(true)
    setDragTime(newTime)
  }

  const handleProgressTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!progressRef.current || !soundRef.current) return
    if (e.touches.length > 0) {
      isSeekingRef.current = true
      const touch = e.touches[0]
      const newTime = calculateTimeFromEvent(touch as unknown as React.MouseEvent)
      setIsDragging(true)
      setDragTime(newTime)
    }
  }

  const performSeek = useCallback((newTime: number) => {
    if (!soundRef.current) return

    const clampedTime = Math.max(0, Math.min(newTime, duration || newTime))

    // Use Howler's public API for seeking
    // The html5 mode handles seeking internally
    soundRef.current.seek(clampedTime)

    // Update UI state immediately for responsiveness
    setCurrentTime(clampedTime)
    isCrossfading.current = false

    // Allow time updates again after a short delay
    setTimeout(() => {
      isSeekingRef.current = false
    }, 50)
  }, [setCurrentTime, duration])

  // Keep ref in sync with latest callback
  performSeekRef.current = performSeek

  useEffect(() => {
    if (!isDragging) return

    // Use refs to avoid recreating listeners when callbacks change
    const handleMouseMove = (e: MouseEvent) => {
      const newTime = calculateTimeFromEventRef.current(e)
      setDragTime(newTime)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0]
        const newTime = calculateTimeFromEventRef.current(touch as unknown as MouseEvent)
        setDragTime(newTime)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const newTime = calculateTimeFromEventRef.current(e)
      performSeekRef.current(newTime)
      setIsDragging(false)
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0]
        const newTime = calculateTimeFromEventRef.current(touch as unknown as MouseEvent)
        performSeekRef.current(newTime)
      }
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove)
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isDragging]) // Only re-run when isDragging changes

  const handleRepeatClick = () => {
    const currentIndex = REPEAT_MODES.indexOf(repeatMode)
    const nextMode = REPEAT_MODES[(currentIndex + 1) % REPEAT_MODES.length]
    setRepeatMode(nextMode)
  }

  // Memoize VolumeIcon for performance (use localVolume for immediate feedback)
  const VolumeIcon = useMemo(() => {
    if (isMuted || localVolume === 0) return VolumeX
    if (localVolume < 0.5) return Volume1
    return Volume2
  }, [isMuted, localVolume])

  const isFav = currentTrack ? isFavorite(currentTrack.id) : false

  // Sanitize cover art URL for security
  const safeCoverArt = useMemo(() =>
    sanitizeImageUrl(currentTrack?.coverArt),
    [currentTrack?.coverArt]
  )

  if (!currentTrack) {
    return (
      <div className="player player-empty">
        <div className="player-placeholder">
          <Music size={24} />
          <span>Выберите трек для воспроизведения</span>
        </div>
      </div>
    )
  }

  const isYouTube = isYouTubeTrack(currentTrack)

  return (
    <div className="player">
      <div className="player-track">
        <div className="player-cover">
          {safeCoverArt ? (
            <img src={safeCoverArt} alt={currentTrack.album} />
          ) : (
            <div className="player-cover-placeholder">
              <Music size={24} />
            </div>
          )}
          {isYouTube && (
            <div className="player-youtube-badge">
              <Youtube size={12} />
            </div>
          )}
          {isLoadingAudio && (
            <div className="player-loading-overlay">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}
        </div>
        <div className="player-info">
          <div className="player-title">{currentTrack.title}</div>
          <div className="player-artist">
            {currentTrack.artist}
            {audioError && <span className="player-error"> • {audioError}</span>}
          </div>
        </div>
        <button
          className={`player-like ${isFav ? 'active' : ''}`}
          onClick={handleToggleFavorite}
        >
          <Heart size={18} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="player-controls">
        <div className="player-buttons">
          <button
            className={`player-btn ${isShuffled ? 'active' : ''}`}
            onClick={toggleShuffle}
          >
            <Shuffle size={18} />
          </button>
          <button className="player-btn" onClick={previousTrack}>
            <SkipBack size={20} />
          </button>
          <button
            className="player-btn player-btn-main"
            onClick={isPlaying ? pauseTrack : resumeTrack}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button className="player-btn" onClick={nextTrack}>
            <SkipForward size={20} />
          </button>
          <button
            className={`player-btn ${repeatMode !== 'off' ? 'active' : ''}`}
            onClick={handleRepeatClick}
          >
            {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
        </div>

        <div className="player-progress-container">
          <span className="player-time">{formatTime(isDragging ? dragTime : currentTime)}</span>
          <div
            className={`player-progress ${isDragging ? 'dragging' : ''}`}
            ref={progressRef}
            onMouseDown={handleProgressMouseDown}
            onTouchStart={handleProgressTouchStart}
          >
            <div
              className="player-progress-bar"
              style={{ width: `${duration ? ((isDragging ? dragTime : currentTime) / duration) * 100 : 0}%` }}
            >
              <div className="player-progress-handle" />
            </div>
          </div>
          <span className="player-time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-extra">
        <button
          className={`player-btn ${showQueue ? 'active' : ''}`}
          onClick={() => setShowQueue(true)}
          title="Очередь воспроизведения"
        >
          <ListMusic size={18} />
        </button>
        <div className="player-volume">
          <button className="player-btn" onClick={toggleMute}>
            <VolumeIcon size={18} />
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : localVolume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>
      </div>

      <QueuePanel isOpen={showQueue} onClose={() => setShowQueue(false)} />
    </div>
  )
}
