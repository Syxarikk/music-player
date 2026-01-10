/**
 * Playlist Page - Simplified
 */

import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Play, Shuffle, MoreHorizontal, Edit2, Trash2, Music } from 'lucide-react'
import { useStore } from '../store/useStore'
import TrackList from '../components/TrackList'
import { formatTotalDuration, shuffleArray } from '../utils/audio'
import { formatCount, PLURAL_FORMS } from '../utils/pluralize'
import type { Track } from '../types'
import './PlaylistPage.css'

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isEditing, setIsEditing] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const { getPlaylists, getTracks, updatePlaylist, deletePlaylist, playTrack } =
    useStore()

  const playlists = getPlaylists()
  const tracks = getTracks()
  const playlist = playlists.find((p) => p.id === id)

  if (!playlist) {
    return (
      <div className="page">
        <div className="empty-state">
          <Music size={80} className="empty-state-icon" />
          <h2 className="empty-state-title">Плейлист не найден</h2>
        </div>
      </div>
    )
  }

  const playlistTracks = playlist.tracks
    .map((trackId) => tracks.find((t) => t.id === trackId))
    .filter((t): t is Track => t !== undefined)

  const coverArt = playlist.coverArt || playlistTracks[0]?.coverArt

  const handlePlay = () => {
    if (playlistTracks.length > 0) {
      playTrack(playlistTracks[0], playlistTracks)
    }
  }

  const handleShuffle = () => {
    if (playlistTracks.length > 0) {
      const shuffled = shuffleArray(playlistTracks)
      playTrack(shuffled[0], shuffled)
    }
  }

  const handleDelete = () => {
    deletePlaylist(playlist.id)
    navigate('/library')
  }

  const handleNameChange = (name: string) => {
    updatePlaylist(playlist.id, { name })
  }

  return (
    <div className="page playlist-page animate-fadeIn">
      <div className="playlist-header">
        <div className="playlist-cover-large">
          {coverArt ? (
            <img src={coverArt} alt={playlist.name} />
          ) : (
            <div className="playlist-cover-placeholder">
              <Music size={64} />
            </div>
          )}
        </div>

        <div className="playlist-info">
          <span className="playlist-type">Плейлист</span>

          {isEditing ? (
            <input
              type="text"
              defaultValue={playlist.name}
              className="playlist-name-edit"
              autoFocus
              onBlur={(e) => {
                handleNameChange(e.target.value)
                setIsEditing(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleNameChange((e.target as HTMLInputElement).value)
                  setIsEditing(false)
                }
              }}
            />
          ) : (
            <h1
              className="playlist-name"
              onClick={() => setIsEditing(true)}
            >
              {playlist.name}
            </h1>
          )}

          <div className="playlist-meta">
            <span>{formatCount(playlistTracks.length, PLURAL_FORMS.track)}</span>
            <span className="meta-dot">•</span>
            <span>{formatTotalDuration(playlistTracks)}</span>
          </div>
        </div>
      </div>

      <div className="playlist-actions">
        <button
          className="btn btn-primary btn-play"
          onClick={handlePlay}
          disabled={playlistTracks.length === 0}
        >
          <Play size={22} />
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleShuffle}
          disabled={playlistTracks.length === 0}
        >
          <Shuffle size={22} />
        </button>

        <div className="playlist-menu-wrapper">
          <button
            className="btn btn-ghost"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreHorizontal size={22} />
          </button>

          {showMenu && (
            <div className="playlist-menu">
              <button onClick={() => setIsEditing(true)}>
                <Edit2 size={16} />
                Переименовать
              </button>
              <button className="danger" onClick={handleDelete}>
                <Trash2 size={16} />
                Удалить плейлист
              </button>
            </div>
          )}
        </div>
      </div>

      {playlistTracks.length > 0 ? (
        <TrackList tracks={playlistTracks} />
      ) : (
        <div className="empty-state">
          <Music size={80} className="empty-state-icon" />
          <h2 className="empty-state-title">Плейлист пуст</h2>
          <p className="empty-state-text">
            Добавьте треки из библиотеки или найдите на YouTube
          </p>
        </div>
      )}
    </div>
  )
}
