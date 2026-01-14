/**
 * AddTrackMenu Component
 * Menu for adding YouTube tracks to library, favorites, or playlists
 */

import { useState, useEffect, useRef } from 'react'
import {
  X,
  Library,
  Heart,
  ListPlus,
  Plus,
  Check,
  ListMusic
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Track } from '../types'
import { sanitizeImageUrl } from '../utils/sanitize'
import './AddTrackMenu.css'

interface AddTrackMenuProps {
  track: Track
  isOpen: boolean
  onClose: () => void
  position?: { x: number; y: number }
}

export default function AddTrackMenu({ track, isOpen, onClose, position }: AddTrackMenuProps) {
  const {
    getTracks,
    getPlaylists,
    addTracks,
    toggleFavorite,
    isFavorite,
    addToPlaylist,
    createPlaylist
  } = useStore()

  const tracks = getTracks()
  const playlists = getPlaylists()

  const [showPlaylists, setShowPlaylists] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Check if track is already in library
  const isInLibrary = tracks.some(t => t.id === track.id || t.path === track.path)
  const isTrackFavorite = isFavorite(track.id)

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleAddToLibrary = () => {
    if (!isInLibrary) {
      addTracks([{ ...track, addedAt: Date.now() }])
    }
    onClose()
  }

  const handleToggleFavorite = () => {
    // First add to library if not there
    if (!isInLibrary) {
      addTracks([{ ...track, addedAt: Date.now() }])
    }
    toggleFavorite(track.id)
    onClose()
  }

  const handleAddToPlaylist = (playlistId: string) => {
    // First add to library if not there
    if (!isInLibrary) {
      addTracks([{ ...track, addedAt: Date.now() }])
    }
    addToPlaylist(playlistId, track.id)
    onClose()
  }

  const handleCreatePlaylist = () => {
    if (!newPlaylistName.trim()) return

    // First add to library if not there
    if (!isInLibrary) {
      addTracks([{ ...track, addedAt: Date.now() }])
    }

    // Validate and sanitize playlist name (max 100 chars)
    const sanitizedName = newPlaylistName.trim().slice(0, 100)
    const playlist = createPlaylist(sanitizedName)
    if (playlist) {
      addToPlaylist(playlist.id, track.id)
    }

    setNewPlaylistName('')
    setIsCreatingPlaylist(false)
    onClose()
  }

  const menuStyle = position ? {
    position: 'fixed' as const,
    top: position.y,
    left: position.x,
  } : {}

  return (
    <div className="add-track-menu-overlay">
      <div
        ref={menuRef}
        className="add-track-menu"
        style={menuStyle}
      >
        <div className="add-track-menu-header">
          <div className="add-track-menu-track">
            {sanitizeImageUrl(track.coverArt) && (
              <img src={sanitizeImageUrl(track.coverArt)!} alt={track.title} className="add-track-menu-cover" />
            )}
            <div className="add-track-menu-info">
              <div className="add-track-menu-title">{track.title}</div>
              <div className="add-track-menu-artist">{track.artist}</div>
            </div>
          </div>
          <button className="add-track-menu-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {!showPlaylists ? (
          <div className="add-track-menu-options">
            <button
              className={`add-track-menu-option ${isInLibrary ? 'disabled' : ''}`}
              onClick={handleAddToLibrary}
              disabled={isInLibrary}
            >
              {isInLibrary ? <Check size={20} /> : <Library size={20} />}
              <span>{isInLibrary ? 'Уже в медиатеке' : 'Добавить в медиатеку'}</span>
            </button>

            <button
              className={`add-track-menu-option ${isTrackFavorite ? 'active' : ''}`}
              onClick={handleToggleFavorite}
            >
              <Heart size={20} fill={isTrackFavorite ? 'currentColor' : 'none'} />
              <span>{isTrackFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}</span>
            </button>

            <button
              className="add-track-menu-option"
              onClick={() => setShowPlaylists(true)}
            >
              <ListPlus size={20} />
              <span>Добавить в плейлист</span>
            </button>
          </div>
        ) : (
          <div className="add-track-menu-playlists">
            <button
              className="add-track-menu-back"
              onClick={() => setShowPlaylists(false)}
            >
              ← Назад
            </button>

            {isCreatingPlaylist ? (
              <div className="add-track-menu-create">
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  placeholder="Название плейлиста"
                  className="add-track-menu-input"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePlaylist()
                    if (e.key === 'Escape') setIsCreatingPlaylist(false)
                  }}
                />
                <button
                  className="add-track-menu-create-btn"
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim()}
                >
                  Создать
                </button>
              </div>
            ) : (
              <button
                className="add-track-menu-option new-playlist"
                onClick={() => setIsCreatingPlaylist(true)}
              >
                <Plus size={20} />
                <span>Создать новый плейлист</span>
              </button>
            )}

            {playlists.length > 0 && (
              <div className="add-track-menu-playlist-list">
                {playlists.map(playlist => {
                  const isInPlaylist = playlist.tracks.includes(track.id)
                  return (
                    <button
                      key={playlist.id}
                      className={`add-track-menu-playlist-item ${isInPlaylist ? 'in-playlist' : ''}`}
                      onClick={() => !isInPlaylist && handleAddToPlaylist(playlist.id)}
                      disabled={isInPlaylist}
                    >
                      <ListMusic size={18} />
                      <span className="playlist-name">{playlist.name}</span>
                      {isInPlaylist && <Check size={16} className="check-icon" />}
                    </button>
                  )
                })}
              </div>
            )}

            {playlists.length === 0 && !isCreatingPlaylist && (
              <div className="add-track-menu-empty">
                У вас пока нет плейлистов
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
