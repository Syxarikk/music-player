import { useStore } from '../store/useStore'
import TrackCard from '../components/TrackCard'
import PlaylistCard from '../components/PlaylistCard'
import { Clock, Heart, Music } from 'lucide-react'
import './HomePage.css'

export default function HomePage() {
  const { getTracks, getPlaylists, getRecentlyPlayed, getFavorites } = useStore()

  const tracks = getTracks()
  const playlists = getPlaylists()
  const recentlyPlayed = getRecentlyPlayed()
  const favorites = getFavorites()

  const recentTracks = recentlyPlayed
    .slice(0, 8)
    .map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean)

  const favoriteTracks = favorites
    .slice(0, 8)
    .map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean)

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Доброе утро'
    if (hour < 18) return 'Добрый день'
    return 'Добрый вечер'
  }

  return (
    <div className="page home-page animate-fadeIn">
      <div className="page-header">
        <h1 className="page-title">{greeting()}!</h1>
        <p className="page-subtitle">Что послушаем сегодня?</p>
      </div>

      {recentTracks.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">
              <Clock size={24} className="section-icon" />
              Недавно прослушанные
            </h2>
          </div>
          <div className="card-grid">
            {recentTracks.map(
              (track) => track && <TrackCard key={track.id} track={track} />
            )}
          </div>
        </section>
      )}

      {favoriteTracks.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">
              <Heart size={24} className="section-icon" />
              Избранное
            </h2>
          </div>
          <div className="card-grid">
            {favoriteTracks.map(
              (track) => track && <TrackCard key={track.id} track={track} />
            )}
          </div>
        </section>
      )}

      {playlists.length > 0 && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Плейлисты</h2>
          </div>
          <div className="card-grid">
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </section>
      )}

      {tracks.length === 0 && (
        <div className="empty-state">
          <Music size={80} className="empty-state-icon" />
          <h2 className="empty-state-title">Добро пожаловать!</h2>
          <p className="empty-state-text">
            Добавьте музыку через настройки или найдите на YouTube.
          </p>
        </div>
      )}
    </div>
  )
}
