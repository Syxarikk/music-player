/**
 * Track Context Menu Component
 * Context menu with track actions
 */

import { useEffect, useRef, useState } from 'react'
import {
  Play,
  ListPlus,
  Heart,
  Trash2,
  Music,
  Plus,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Track } from '../types'
import './TrackContextMenu.css'

interface TrackContextMenuProps {
  track: Track
  position: { x: number; y: number }
  onClose: () => void
}

export default function TrackContextMenu({
  track,
  position,
  onClose,
}: TrackContextMenuProps) {
  const {
    playTrack,
    addToQueue,
    toggleFavorite,
    isFavorite,
    removeTrack,
    getPlaylists,
    addToPlaylist,
    createPlaylist,
  } = useStore()

  const playlists = getPlaylists()
  const menuRef = useRef<HTMLDivElement>(null)
  const [showPlaylists, setShowPlaylists] = useState(false)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  const isFav = isFavorite(track.id)

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let x = position.x
      let y = position.y

      if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 10
      }
      if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 10
      }

      setAdjustedPosition({ x, y })
    }
  }, [position])

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handlePlay = () => {
    playTrack(track)
    onClose()
  }

  const handleAddToQueue = () => {
    addToQueue(track)
    onClose()
  }

  const handleToggleFavorite = () => {
    toggleFavorite(track.id)
    onClose()
  }

  const handleDelete = () => {
    if (confirm(`Удалить "${track.title}" из медиатеки?`)) {
      removeTrack(track.id)
    }
    onClose()
  }

  const handleAddToPlaylist = (playlistId: string) => {
    addToPlaylist(playlistId, track.id)
    onClose()
  }

  const handleCreatePlaylist = () => {
    const name = prompt('Название нового плейлиста:')
    if (name?.trim()) {
      const playlist = createPlaylist(name.trim())
      if (playlist) {
        addToPlaylist(playlist.id, track.id)
      }
    }
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="track-context-menu"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <div className="context-menu-header">
        <div className="context-menu-track">
          {track.coverArt ? (
            <img
              src={track.coverArt}
              alt={track.title}
              className="context-menu-cover"
            />
          ) : (
            <div className="context-menu-cover-placeholder">
              <Music size={16} />
            </div>
          )}
          <div className="context-menu-info">
            <div className="context-menu-title">{track.title}</div>
            <div className="context-menu-artist">{track.artist}</div>
          </div>
        </div>
      </div>

      <div className="context-menu-divider" />

      <div className="context-menu-options">
        <button className="context-menu-option" onClick={handlePlay}>
          <Play size={18} />
          <span>Воспроизвести</span>
        </button>

        <button className="context-menu-option" onClick={handleAddToQueue}>
          <ListPlus size={18} />
          <span>Добавить в очередь</span>
        </button>

        <button
          className={`context-menu-option ${isFav ? 'active' : ''}`}
          onClick={handleToggleFavorite}
        >
          <Heart size={18} fill={isFav ? 'currentColor' : 'none'} />
          <span>{isFav ? 'Убрать из избранного' : 'В избранное'}</span>
        </button>

        <div className="context-menu-divider" />

        <div className="context-menu-submenu">
          <button
            className="context-menu-option"
            onClick={() => setShowPlaylists(!showPlaylists)}
          >
            <Plus size={18} />
            <span>Добавить в плейлист</span>
          </button>

          {showPlaylists && (
            <div className="context-submenu">
              <button
                className="context-menu-option new-playlist"
                onClick={handleCreatePlaylist}
              >
                <Plus size={16} />
                <span>Новый плейлист</span>
              </button>
              {playlists.map((playlist) => {
                const isInPlaylist = playlist.tracks.includes(track.id)
                return (
                  <button
                    key={playlist.id}
                    className={`context-menu-option ${isInPlaylist ? 'disabled' : ''}`}
                    onClick={() =>
                      !isInPlaylist && handleAddToPlaylist(playlist.id)
                    }
                    disabled={isInPlaylist}
                  >
                    <Music size={16} />
                    <span>{playlist.name}</span>
                    {isInPlaylist && (
                      <span className="in-playlist-badge">Добавлен</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="context-menu-divider" />

        <button className="context-menu-option danger" onClick={handleDelete}>
          <Trash2 size={18} />
          <span>Удалить из медиатеки</span>
        </button>
      </div>
    </div>
  )
}
