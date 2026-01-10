/**
 * Sidebar Navigation Component - Simplified
 */

import { NavLink } from 'react-router-dom'
import {
  Home,
  Library,
  Search,
  Settings,
  Plus,
  Heart,
  Music,
  ListMusic,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import ProfileSelector from './ProfileSelector'
import './Sidebar.css'

export default function Sidebar() {
  const { getPlaylists, createPlaylist, getTracks, getFavorites } = useStore()

  const playlists = getPlaylists()
  const tracks = getTracks()
  const favorites = getFavorites()

  const handleCreatePlaylist = () => {
    const name = `Плейлист ${playlists.length + 1}`
    createPlaylist(name)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-profile">
        <ProfileSelector />
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" className="nav-item">
          <Home size={22} />
          <span>Главная</span>
        </NavLink>
        <NavLink to="/search" className="nav-item">
          <Search size={22} />
          <span>Поиск</span>
        </NavLink>
        <NavLink to="/library" className="nav-item">
          <Library size={22} />
          <span>Медиатека</span>
        </NavLink>
      </nav>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Моя музыка</span>
        </div>
        <NavLink to="/library?tab=favorites" className="nav-item nav-item-small">
          <Heart size={18} className="icon-favorites" />
          <span>Избранное</span>
          {favorites.length > 0 && (
            <span className="nav-badge">{favorites.length}</span>
          )}
        </NavLink>
        <NavLink to="/library?tab=tracks" className="nav-item nav-item-small">
          <Music size={18} />
          <span>Все треки</span>
          {tracks.length > 0 && (
            <span className="nav-badge">{tracks.length}</span>
          )}
        </NavLink>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Плейлисты</span>
          <button className="sidebar-add-btn" onClick={handleCreatePlaylist}>
            <Plus size={18} />
          </button>
        </div>
        <div className="playlists-list">
          {playlists.length === 0 ? (
            <div className="playlists-empty">
              <ListMusic size={32} />
              <p>Пока нет плейлистов</p>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleCreatePlaylist}
              >
                Создать первый
              </button>
            </div>
          ) : (
            playlists.map((playlist) => (
              <NavLink
                key={playlist.id}
                to={`/playlist/${playlist.id}`}
                className="nav-item nav-item-small"
              >
                <div
                  className="playlist-cover-mini"
                  style={{
                    background: playlist.coverArt
                      ? `url(${playlist.coverArt})`
                      : 'var(--accent-gradient)',
                  }}
                >
                  {!playlist.coverArt && <Music size={12} />}
                </div>
                <span className="playlist-name">{playlist.name}</span>
              </NavLink>
            ))
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <NavLink to="/settings" className="nav-item nav-item-small">
          <Settings size={18} />
          <span>Настройки</span>
        </NavLink>
      </div>
    </aside>
  )
}
