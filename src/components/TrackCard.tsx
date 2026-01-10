import { Play, Pause, Music } from 'lucide-react'
import { useStore, Track } from '../store/useStore'
import './TrackCard.css'

interface TrackCardProps {
  track: Track
  showArtist?: boolean
}

export default function TrackCard({ track, showArtist = true }: TrackCardProps) {
  const { player, playTrack, pauseTrack, resumeTrack, getTracks } = useStore()
  const tracks = getTracks()
  const isCurrentTrack = player.currentTrack?.id === track.id
  const isPlaying = isCurrentTrack && player.isPlaying

  const handleClick = () => {
    if (isCurrentTrack) {
      isPlaying ? pauseTrack() : resumeTrack()
    } else {
      playTrack(track, tracks)
    }
  }

  return (
    <div className={`track-card ${isCurrentTrack ? 'active' : ''}`} onClick={handleClick}>
      <div className="track-card-cover">
        {track.coverArt ? (
          <img src={track.coverArt} alt={track.album} />
        ) : (
          <div className="track-card-cover-placeholder">
            <Music size={32} />
          </div>
        )}
        <div className="track-card-play">
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </div>
      </div>
      <div className="track-card-info">
        <div className="track-card-title">{track.title}</div>
        {showArtist && <div className="track-card-artist">{track.artist}</div>}
      </div>
    </div>
  )
}
