/**
 * Track List Component
 * Displays a list of tracks with play/favorite controls and context menu
 */

import { useState, useCallback, memo } from 'react'
import { Play, Pause, Heart, MoreHorizontal, Clock, Music } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import type { Track } from '../types'
import { formatTime } from '../utils/audio'
import { sanitizeImageUrl } from '../utils/sanitize'
import TrackContextMenu from './TrackContextMenu'
import './TrackList.css'

interface TrackListProps {
  tracks: Track[]
  showIndex?: boolean
}

interface ContextMenuState {
  track: Track | null
  position: { x: number; y: number }
}

function TrackList({ tracks, showIndex = true }: TrackListProps) {
  // Use optimized selectors to minimize re-renders
  const { currentTrackId, isPlaying, playTrack, pauseTrack, resumeTrack, toggleFavorite, isFavorite } = useStore(
    useShallow((state) => ({
      currentTrackId: state.player.currentTrack?.id,
      isPlaying: state.player.isPlaying,
      playTrack: state.playTrack,
      pauseTrack: state.pauseTrack,
      resumeTrack: state.resumeTrack,
      toggleFavorite: state.toggleFavorite,
      isFavorite: state.isFavorite,
    }))
  )

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    track: null,
    position: { x: 0, y: 0 },
  })

  const handleTrackClick = useCallback((track: Track) => {
    if (currentTrackId === track.id) {
      isPlaying ? pauseTrack() : resumeTrack()
    } else {
      playTrack(track, tracks)
    }
  }, [currentTrackId, isPlaying, pauseTrack, resumeTrack, playTrack, tracks])

  const handleContextMenu = useCallback((e: React.MouseEvent, track: Track) => {
    e.preventDefault()
    setContextMenu({
      track,
      position: { x: e.clientX, y: e.clientY },
    })
  }, [])

  const handleMoreClick = useCallback((e: React.MouseEvent, track: Track) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({
      track,
      position: { x: rect.right - 220, y: rect.bottom + 5 },
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu({ track: null, position: { x: 0, y: 0 } })
  }, [])

  return (
    <div className="track-list">
      <div className="track-list-header">
        {showIndex && <div className="track-col-index">#</div>}
        <div className="track-col-title">Название</div>
        <div className="track-col-album">Альбом</div>
        <div className="track-col-duration">
          <Clock size={16} />
        </div>
        <div className="track-col-actions" />
      </div>

      <div className="track-list-body">
        {tracks.map((track, index) => {
          const isCurrentTrack = currentTrackId === track.id
          const isTrackPlaying = isCurrentTrack && isPlaying
          const isFav = isFavorite(track.id)
          const safeCoverArt = sanitizeImageUrl(track.coverArt)

          return (
            <div
              key={track.id}
              className={`track-row ${isCurrentTrack ? 'active' : ''}`}
              onDoubleClick={() => handleTrackClick(track)}
              onContextMenu={(e) => handleContextMenu(e, track)}
            >
              {showIndex && (
                <div className="track-col-index">
                  <span className="track-index">{index + 1}</span>
                  <button
                    className="track-play-btn"
                    onClick={() => handleTrackClick(track)}
                  >
                    {isTrackPlaying ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                </div>
              )}

              <div className="track-col-title">
                <div className="track-cover-small">
                  {safeCoverArt ? (
                    <img src={safeCoverArt} alt={track.album} />
                  ) : (
                    <Music size={16} />
                  )}
                </div>
                <div className="track-info">
                  <div className={`track-name ${isCurrentTrack ? 'playing' : ''}`}>
                    {track.title}
                  </div>
                  <div className="track-artist">{track.artist}</div>
                </div>
              </div>

              <div className="track-col-album">{track.album}</div>

              <div className="track-col-duration">
                {formatTime(track.duration)}
              </div>

              <div className="track-col-actions">
                <button
                  className={`track-action-btn ${isFav ? 'active' : ''}`}
                  onClick={() => toggleFavorite(track.id)}
                >
                  <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="track-action-btn"
                  onClick={(e) => handleMoreClick(e, track)}
                  title="Дополнительно"
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {contextMenu.track && (
        <TrackContextMenu
          track={contextMenu.track}
          position={contextMenu.position}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}

// Memoize to prevent unnecessary re-renders when parent re-renders
export default memo(TrackList)
