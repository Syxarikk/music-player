/**
 * Search Page
 * Search through local library and YouTube
 */

import { useState, useMemo, useCallback, useDeferredValue } from 'react'
import { Search, X, Play, Plus, Loader2, Youtube, Music, AlertCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import TrackList from '../components/TrackList'
import AddTrackMenu from '../components/AddTrackMenu'
import { formatCount, PLURAL_FORMS } from '../utils/pluralize'
import { searchYouTube } from '../services/youtubeApi'
import { formatTime } from '../utils/audio'
import { sanitizeImageUrl } from '../utils/sanitize'
import type { Track } from '../types'
import './SearchPage.css'

type SearchTab = 'local' | 'youtube'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<SearchTab>('youtube')
  const { getTracks, playTrack, player } = useStore()

  const tracks = getTracks()

  // Track menu state
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  // YouTube search state
  const [youtubeResults, setYoutubeResults] = useState<Track[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [youtubeError, setYoutubeError] = useState<string | null>(null)
  const [hasSearchedYoutube, setHasSearchedYoutube] = useState(false)

  // Deferred query for better performance during typing
  const deferredQuery = useDeferredValue(query)
  const isSearchPending = query !== deferredQuery

  // Local search results - uses deferred query to avoid blocking UI
  const localResults = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase()
    if (!trimmed) return []

    return tracks.filter(
      (track) =>
        track.title.toLowerCase().includes(trimmed) ||
        track.artist.toLowerCase().includes(trimmed) ||
        track.album.toLowerCase().includes(trimmed)
    )
  }, [deferredQuery, tracks])

  const handleYoutubeSearch = useCallback(async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setYoutubeError(null)
    setHasSearchedYoutube(true)

    try {
      const results = await searchYouTube(query.trim())
      setYoutubeResults(results)
    } catch (err) {
      console.error('YouTube search error:', err)
      setYoutubeError(err instanceof Error ? err.message : 'Ошибка поиска')
      setYoutubeResults([])
    } finally {
      setIsSearching(false)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && activeTab === 'youtube') {
      handleYoutubeSearch()
    }
  }

  const handleClear = useCallback(() => {
    setQuery('')
    setYoutubeResults([])
    setHasSearchedYoutube(false)
    setYoutubeError(null)
  }, [])

  const handlePlayYoutubeTrack = (track: Track) => {
    playTrack(track, youtubeResults)
  }

  const handleOpenAddMenu = (track: Track) => {
    setSelectedTrack(track)
    setIsMenuOpen(true)
  }

  const handleCloseAddMenu = () => {
    setIsMenuOpen(false)
    setSelectedTrack(null)
  }

  return (
    <div className="page search-page animate-fadeIn">
      <div className="search-header">
        <div className="search-tabs">
          <button
            className={`search-tab ${activeTab === 'youtube' ? 'active' : ''}`}
            onClick={() => setActiveTab('youtube')}
          >
            <Youtube size={18} />
            YouTube
          </button>
          <button
            className={`search-tab ${activeTab === 'local' ? 'active' : ''}`}
            onClick={() => setActiveTab('local')}
          >
            <Music size={18} />
            Моя музыка
          </button>
        </div>

        <div className="search-input-wrapper">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeTab === 'youtube'
                ? 'Поиск музыки на YouTube...'
                : 'Поиск в моей медиатеке...'
            }
            className="search-input"
            autoFocus
          />
          {query && (
            <button className="search-clear" onClick={handleClear}>
              <X size={18} />
            </button>
          )}
          {activeTab === 'youtube' && (
            <button
              className="search-button"
              onClick={handleYoutubeSearch}
              disabled={isSearching || !query.trim()}
            >
              {isSearching ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                'Найти'
              )}
            </button>
          )}
        </div>
      </div>

      <div className="search-results">
        {/* Local Search Results */}
        {activeTab === 'local' && (
          <>
            {query.trim() ? (
              isSearchPending ? (
                <div className="search-loading">
                  <Loader2 size={24} className="animate-spin" />
                  <span>Поиск...</span>
                </div>
              ) : localResults.length > 0 ? (
                <>
                  <p className="search-results-count">
                    Найдено: {formatCount(localResults.length, PLURAL_FORMS.track)}
                  </p>
                  <TrackList tracks={localResults} />
                </>
              ) : (
                <div className="empty-state">
                  <Search size={80} className="empty-state-icon" />
                  <h2 className="empty-state-title">Ничего не найдено</h2>
                  <p className="empty-state-text">
                    Попробуйте изменить поисковый запрос
                  </p>
                </div>
              )
            ) : (
              <div className="search-placeholder">
                <Music size={64} />
                <h2>Поиск по медиатеке</h2>
                <p>Ищите по названию трека, исполнителю или альбому</p>
              </div>
            )}
          </>
        )}

        {/* YouTube Search Results */}
        {activeTab === 'youtube' && (
          <>
            {youtubeError && (
              <div className="search-error">
                <AlertCircle size={20} />
                <span>{youtubeError}</span>
              </div>
            )}

            {isSearching && (
              <div className="search-loading">
                <Loader2 size={32} className="animate-spin" />
                <span>Поиск на YouTube...</span>
              </div>
            )}

            {!isSearching && hasSearchedYoutube && youtubeResults.length === 0 && !youtubeError && (
              <div className="empty-state">
                <Search size={80} className="empty-state-icon" />
                <h2 className="empty-state-title">Ничего не найдено</h2>
                <p className="empty-state-text">
                  Попробуйте изменить запрос
                </p>
              </div>
            )}

            {youtubeResults.length > 0 && (
              <>
                <p className="search-results-count">
                  Найдено: {formatCount(youtubeResults.length, PLURAL_FORMS.track)}
                </p>
                <div className="youtube-results-list">
                  {youtubeResults.map((track) => (
                    <div
                      key={track.id}
                      className={`youtube-result-item ${
                        player.currentTrack?.id === track.id ? 'active' : ''
                      }`}
                    >
                      {(() => {
                        const safeCoverArt = sanitizeImageUrl(track.coverArt)
                        return (
                          <>
                            <div className="youtube-result-cover">
                              {safeCoverArt ? (
                                <img src={safeCoverArt} alt={track.title} />
                              ) : (
                                <div className="youtube-result-cover-placeholder">
                                  <Youtube size={24} />
                                </div>
                              )}
                              <button
                                className="youtube-result-play"
                                onClick={() => handlePlayYoutubeTrack(track)}
                              >
                                <Play size={20} fill="currentColor" />
                              </button>
                            </div>
                            <div className="youtube-result-info">
                              <div className="youtube-result-title">{track.title}</div>
                              <div className="youtube-result-artist">
                                {track.artist}
                                {track.duration > 0 && (
                                  <span className="youtube-result-duration">
                                    {' '}• {formatTime(track.duration)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="youtube-result-actions">
                              <button
                                className="youtube-result-action"
                                onClick={() => handleOpenAddMenu(track)}
                                title="Добавить"
                              >
                                <Plus size={20} />
                              </button>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Add Track Menu */}
            {selectedTrack && (
              <AddTrackMenu
                track={selectedTrack}
                isOpen={isMenuOpen}
                onClose={handleCloseAddMenu}
              />
            )}

            {!hasSearchedYoutube && !isSearching && (
              <div className="search-placeholder">
                <Youtube size={64} className="youtube-icon" />
                <h2>Поиск музыки на YouTube</h2>
                <p>Введите название песни или исполнителя и нажмите Enter</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
