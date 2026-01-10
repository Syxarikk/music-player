/**
 * Queue Panel Component
 * Shows current playback queue with ability to reorder and remove tracks
 */

import { X, Music, GripVertical, Trash2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { formatTime } from '../utils/audio'
import './QueuePanel.css'

interface QueuePanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function QueuePanel({ isOpen, onClose }: QueuePanelProps) {
  const { player, playTrack, clearQueue } = useStore()
  const { queue, queueIndex, currentTrack } = player

  if (!isOpen) return null

  const upcomingTracks = queue.slice(queueIndex + 1)
  const previousTracks = queue.slice(0, queueIndex)

  const handleTrackClick = (index: number) => {
    const track = queue[index]
    if (track) {
      playTrack(track, queue)
    }
  }

  return (
    <div className="queue-panel-overlay" onClick={onClose}>
      <div className="queue-panel" onClick={(e) => e.stopPropagation()}>
        <div className="queue-panel-header">
          <h3>Очередь воспроизведения</h3>
          <div className="queue-panel-actions">
            {queue.length > 0 && (
              <button
                className="queue-clear-btn"
                onClick={clearQueue}
                title="Очистить очередь"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button className="queue-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="queue-panel-content">
          {currentTrack && (
            <div className="queue-section">
              <div className="queue-section-title">Сейчас играет</div>
              <div className="queue-item current">
                <div className="queue-item-cover">
                  {currentTrack.coverArt ? (
                    <img src={currentTrack.coverArt} alt={currentTrack.title} />
                  ) : (
                    <Music size={16} />
                  )}
                </div>
                <div className="queue-item-info">
                  <div className="queue-item-title">{currentTrack.title}</div>
                  <div className="queue-item-artist">{currentTrack.artist}</div>
                </div>
                <div className="queue-item-duration">
                  {formatTime(currentTrack.duration)}
                </div>
              </div>
            </div>
          )}

          {upcomingTracks.length > 0 && (
            <div className="queue-section">
              <div className="queue-section-title">
                Далее ({upcomingTracks.length})
              </div>
              <div className="queue-list">
                {upcomingTracks.map((track, idx) => (
                  <div
                    key={`${track.id}-${idx}`}
                    className="queue-item"
                    onClick={() => handleTrackClick(queueIndex + 1 + idx)}
                  >
                    <div className="queue-item-drag">
                      <GripVertical size={14} />
                    </div>
                    <div className="queue-item-cover">
                      {track.coverArt ? (
                        <img src={track.coverArt} alt={track.title} />
                      ) : (
                        <Music size={16} />
                      )}
                    </div>
                    <div className="queue-item-info">
                      <div className="queue-item-title">{track.title}</div>
                      <div className="queue-item-artist">{track.artist}</div>
                    </div>
                    <div className="queue-item-duration">
                      {formatTime(track.duration)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {previousTracks.length > 0 && (
            <div className="queue-section">
              <div className="queue-section-title">
                История ({previousTracks.length})
              </div>
              <div className="queue-list">
                {previousTracks.map((track, idx) => (
                  <div
                    key={`${track.id}-${idx}`}
                    className="queue-item history"
                    onClick={() => handleTrackClick(idx)}
                  >
                    <div className="queue-item-cover">
                      {track.coverArt ? (
                        <img src={track.coverArt} alt={track.title} />
                      ) : (
                        <Music size={16} />
                      )}
                    </div>
                    <div className="queue-item-info">
                      <div className="queue-item-title">{track.title}</div>
                      <div className="queue-item-artist">{track.artist}</div>
                    </div>
                    <div className="queue-item-duration">
                      {formatTime(track.duration)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {queue.length === 0 && (
            <div className="queue-empty">
              <Music size={48} />
              <p>Очередь пуста</p>
              <span>Добавьте треки для воспроизведения</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
