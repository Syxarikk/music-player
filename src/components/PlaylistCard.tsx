import { useNavigate } from 'react-router-dom'
import { Play, Music } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { Playlist, Track } from '../types'
import { formatCount, PLURAL_FORMS } from '../utils/pluralize'
import './PlaylistCard.css'

interface PlaylistCardProps {
  playlist: Playlist
}

export default function PlaylistCard({ playlist }: PlaylistCardProps) {
  const navigate = useNavigate()
  const { getTracks, playTrack } = useStore()

  const tracks = getTracks()
  // Type-safe filter with type guard
  const playlistTracks = playlist.tracks
    .map((id) => tracks.find((t) => t.id === id))
    .filter((t): t is Track => t !== undefined)

  const coverArt = playlist.coverArt || playlistTracks[0]?.coverArt

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (playlistTracks.length > 0) {
      playTrack(playlistTracks[0], playlistTracks)
    }
  }

  return (
    <div className="playlist-card" onClick={() => navigate(`/playlist/${playlist.id}`)}>
      <div className="playlist-card-cover">
        {coverArt ? (
          <img src={coverArt} alt={playlist.name} />
        ) : (
          <div className="playlist-card-cover-placeholder">
            <Music size={32} />
          </div>
        )}
        <button className="playlist-card-play" onClick={handlePlay}>
          <Play size={24} />
        </button>
      </div>
      <div className="playlist-card-info">
        <div className="playlist-card-title">{playlist.name}</div>
        <div className="playlist-card-count">
          {formatCount(playlist.tracks.length, PLURAL_FORMS.track)}
        </div>
      </div>
    </div>
  )
}
