/**
 * Sidebar Navigation Component - Simplified
 */

import { NavLink } from 'react-router-dom'
import { useCallback, memo } from 'react'
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
import { useShallow } from 'zustand/react/shallow'
import { sanitizeImageUrl } from '../utils/sanitize'
import ProfileSelector from './ProfileSelector'
import './Sidebar.css'

function Sidebar() {
  // Use shallow comparison to prevent unnecessary re-renders
  const { createPlaylist, playlists, tracksCount, favoritesCount } = useStore(
    useShallow((state) => ({
      createPlaylist: state.createPlaylist,
      playlists: state.currentProfileId ? (state.playlists[state.currentProfileId] || []) : [],
      tracksCount: state.currentProfileId ? (state.tracks[state.currentProfileId]?.length || 0) : 0,
      favoritesCount: state.currentProfileId ? (state.favorites[state.currentProfileId]?.length || 0) : 0,
    }))
  )

  const handleCreatePlaylist = useCallback(() => {
    const name = `Плейлист ${playlists.length + 1}`
    createPlaylist(name)
  }, [playlists.length, createPlaylist])

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
          {favoritesCount > 0 && (
            <span className="nav-badge">{favoritesCount}</span>
          )}
        </NavLink>
        <NavLink to="/library?tab=tracks" className="nav-item nav-item-small">
          <Music size={18} />
          <span>Все треки</span>
          {tracksCount > 0 && (
            <span className="nav-badge">{tracksCount}</span>
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
            playlists.map((playlist) => {
              const safeCoverArt = sanitizeImageUrl(playlist.coverArt)
              return (
                <NavLink
                  key={playlist.id}
                  to={`/playlist/${playlist.id}`}
                  className="nav-item nav-item-small"
                >
                  <div
                    className="playlist-cover-mini"
                    style={{
                      background: safeCoverArt
                        ? `url(${safeCoverArt})`
                        : 'var(--accent-gradient)',
                    }}
                  >
                    {!safeCoverArt && <Music size={12} />}
                  </div>
                  <span className="playlist-name">{playlist.name}</span>
                </NavLink>
              )
            })
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

// Memoize to prevent unnecessary re-renders
export default memo(Sidebar)
