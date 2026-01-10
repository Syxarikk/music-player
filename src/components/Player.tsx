import { useEffect, useRef, useCallback, useState } from 'react'
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
import QueuePanel from './QueuePanel'
import './Player.css'

/**
 * Get audio URL for any track (local or YouTube)
 */
async function getAudioUrl(track: Track): Promise<string | null> {
  if (isYouTubeTrack(track)) {
    const videoId = getVideoId(track)
    if (!videoId) {
      console.error('No video ID found for track:', track.title)
      return null
    }

    console.log(`Getting audio URL for YouTube video: ${videoId}, isElectron: ${isElectron}`)

    if (isElectron) {
      try {
        console.log('Trying yt-dlp via Electron...')
        const electronUrl = await window.electronAPI.getYouTubeAudioUrl(videoId)
        if (electronUrl) {
          console.log('yt-dlp success:', electronUrl)
          return electronUrl
        }
        console.log('yt-dlp returned null, falling back to Piped API...')
      } catch (err) {
        console.error('yt-dlp error:', err)
      }
      return await getPipedAudioUrl(videoId)
    } else if (isMobileStandalone) {
      return await getPipedAudioUrl(videoId)
    } else {
      return api.getAudioUrl(track)
    }
  }

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
  const actualVolume = isMuted ? 0 : volume

  const [isLoadingAudio, setIsLoadingAudio] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [showQueue, setShowQueue] = useState(false)
  const [isAudioReady, setIsAudioReady] = useState(false)

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

  useEffect(() => {
    return () => {
      soundRef.current?.unload()
      nextSoundRef.current?.unload()
      isCrossfading.current = false
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

    isCrossfading.current = false
    setAudioError(null)
    setIsAudioReady(false)

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
      setIsLoadingAudio(true)

      try {
        const audioUrl = await getAudioUrl(currentTrack)

        // Check if track changed while loading URL (using ref for accurate check)
        if (loadingTrackIdRef.current !== trackId) {
          console.log('Track changed during URL fetch, aborting load for:', trackId)
          return
        }

        if (!audioUrl) {
          setAudioError('Не удалось загрузить аудио')
          setIsLoadingAudio(false)
          return
        }

        // Double-check track hasn't changed and no sound is playing
        if (loadingTrackIdRef.current !== trackId) {
          console.log('Track changed before creating Howl, aborting')
          return
        }

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
            if (loadingTrackIdRef.current !== trackId) {
              console.log('Track changed after Howl loaded, unloading')
              newSound.unload()
              return
            }
            setDuration(newSound.duration() || 0)
            setIsLoadingAudio(false)
            setIsAudioReady(true)
            if (isPlayingRef.current && !newSound.playing()) {
              newSound.play()
            }
          },
          onend: () => {
            if (!isCrossfading.current) {
              nextTrack()
            }
          },
          onloaderror: () => {
            if (loadingTrackIdRef.current === trackId) {
              setAudioError('Ошибка загрузки аудио')
              setIsLoadingAudio(false)
            }
          },
        })

        soundRef.current = newSound
      } catch {
        if (loadingTrackIdRef.current === trackId) {
          setAudioError('Ошибка получения аудио')
          setIsLoadingAudio(false)
        }
      }
    }

    loadAudio()

    return () => {
      if (!isCrossfading.current && soundRef.current) {
        soundRef.current.stop()
        soundRef.current.unload()
        soundRef.current = null
      }
    }
  }, [currentTrack?.id])

  useEffect(() => {
    if (!soundRef.current) return
    if (isPlaying) {
      soundRef.current.play()
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
      if (!soundRef.current) return

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
              try {
                const nextUrl = await getAudioUrl(nextTrackData)
                if (!nextUrl) {
                  isCrossfading.current = false
                  return
                }

                nextSoundRef.current = new Howl({
                  src: [nextUrl],
                  html5: true,
                  volume: 0,
                  onload: () => {
                    if (nextSoundRef.current && isCrossfading.current) {
                      nextSoundRef.current.play()
                      nextTrack()

                      const fadeSteps = 20
                      const fadeInterval = (crossfadeDuration * 1000) / fadeSteps
                      let step = 0

                      const fadingOutSound = soundRef.current
                      const fadingInSound = nextSoundRef.current

                      const fadeTimer = setInterval(() => {
                        step++
                        const progress = step / fadeSteps

                        if (fadingInSound) {
                          fadingInSound.volume(actualVolume * progress)
                        }
                        if (fadingOutSound) {
                          fadingOutSound.volume(actualVolume * (1 - progress))
                        }

                        if (step >= fadeSteps) {
                          clearInterval(fadeTimer)
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

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !soundRef.current) return

    const rect = progressRef.current.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const newTime = percent * duration

    soundRef.current.seek(newTime)
    setCurrentTime(newTime)
    isCrossfading.current = false
  }

  const handleRepeatClick = () => {
    const currentIndex = REPEAT_MODES.indexOf(repeatMode)
    const nextMode = REPEAT_MODES[(currentIndex + 1) % REPEAT_MODES.length]
    setRepeatMode(nextMode)
  }

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const isFav = currentTrack ? isFavorite(currentTrack.id) : false

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
          {currentTrack.coverArt ? (
            <img src={currentTrack.coverArt} alt={currentTrack.album} />
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
          <span className="player-time">{formatTime(currentTime)}</span>
          <div
            className="player-progress"
            ref={progressRef}
            onClick={handleProgressClick}
          >
            <div
              className="player-progress-bar"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
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
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>
      </div>

      <QueuePanel isOpen={showQueue} onClose={() => setShowQueue(false)} />
    </div>
  )
}
