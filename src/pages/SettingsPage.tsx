/**
 * Settings Page - Simplified
 */

import { useState, useCallback } from 'react'
import { FolderOpen, Trash2, Volume2, Music, RefreshCw, Youtube, Server, Monitor, AlertCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import { generateId } from '../utils/id'
import { isElectron, isValidServerUrl } from '../services/apiClient'
import './SettingsPage.css'

/**
 * Validate server URL format with SSRF protection
 * Uses comprehensive validation from apiClient
 */
function validateServerUrl(url: string): boolean {
  if (!url) return true // Empty is valid (clears the setting)
  return isValidServerUrl(url)
}

export default function SettingsPage() {
  const {
    getMusicFolders,
    getTracks,
    addMusicFolder,
    removeMusicFolder,
    addTracks,
    audioSettings,
    setAudioSettings,
  } = useStore()

  const musicFolders = getMusicFolders()
  const tracks = getTracks()

  const [isScanning, setIsScanning] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  // Handle server URL change with validation (includes SSRF protection)
  const handleServerUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value

    if (value && !validateServerUrl(value)) {
      setUrlError('Недопустимый URL. Разрешены только http/https к локальной сети.')
    } else {
      setUrlError(null)
    }

    // Still update the value so user can see what they're typing
    setAudioSettings({ youtubeServerUrl: value })
  }, [setAudioSettings])

  const handleAddFolder = async () => {
    if (!window.electronAPI) return

    const folderPath = await window.electronAPI.openFolderDialog()
    if (folderPath) {
      addMusicFolder(folderPath)
      await scanFolder(folderPath)
    }
  }

  const scanFolder = async (folderPath: string) => {
    if (!window.electronAPI) return

    setIsScanning(true)
    try {
      const files = await window.electronAPI.scanMusicFolder(folderPath)

      // Process files in chunks to avoid blocking UI
      const CHUNK_SIZE = 10
      const allTracks = []

      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE)

        // Process chunk in parallel
        const chunkTracks = await Promise.all(
          chunk.map(async (filePath) => {
            try {
              const metadata = await window.electronAPI.getFileMetadata(filePath)
              return {
                ...metadata,
                id: generateId(),
              }
            } catch (err) {
              console.warn('Failed to get metadata for:', filePath, err)
              return null
            }
          })
        )

        // Filter out failed tracks and add to results
        allTracks.push(...chunkTracks.filter(Boolean))

        // Yield to UI thread between chunks (prevents freezing)
        if (i + CHUNK_SIZE < files.length) {
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }

      addTracks(allTracks)
    } catch (error) {
      console.error('Error scanning folder:', error)
    } finally {
      setIsScanning(false)
    }
  }

  const handleRescanAll = async () => {
    for (const folder of musicFolders) {
      await scanFolder(folder)
    }
  }

  return (
    <div className="page settings-page animate-fadeIn">
      <div className="page-header">
        <h1 className="page-title">Настройки</h1>
      </div>

      {isElectron && (
        <section className="settings-section">
          <div className="settings-section-header">
            <FolderOpen size={24} />
            <div>
              <h2>Папки с музыкой</h2>
              <p>Управление источниками музыкальной библиотеки</p>
            </div>
          </div>

          <div className="settings-content">
            <div className="folders-list">
              {musicFolders.length === 0 ? (
                <div className="folders-empty">
                  <p>Папки с музыкой не добавлены</p>
                </div>
              ) : (
                musicFolders.map((folder) => (
                  <div key={folder} className="folder-item">
                    <FolderOpen size={20} />
                    <span className="folder-path">{folder}</span>
                    <button
                      className="folder-remove"
                      onClick={() => removeMusicFolder(folder)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="folders-actions">
              <button className="btn btn-primary" onClick={handleAddFolder}>
                <FolderOpen size={18} />
                Добавить папку
              </button>
              {musicFolders.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={handleRescanAll}
                  disabled={isScanning}
                >
                  <RefreshCw
                    size={18}
                    className={isScanning ? 'animate-spin' : ''}
                  />
                  Пересканировать
                </button>
              )}
            </div>

            <div className="stats-info">
              <Music size={18} />
              <span>Всего треков: {tracks.length}</span>
            </div>
          </div>
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section-header">
          <Volume2 size={24} />
          <div>
            <h2>Воспроизведение</h2>
            <p>Настройки воспроизведения музыки</p>
          </div>
        </div>

        <div className="settings-content">
          <div className="setting-toggle">
            <div className="setting-toggle-info">
              <span className="setting-toggle-title">Кроссфейд</span>
              <span className="setting-toggle-desc">
                Плавный переход между треками
              </span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={audioSettings.crossfade}
                onChange={() =>
                  setAudioSettings({ crossfade: !audioSettings.crossfade })
                }
              />
              <span className="toggle-slider" />
            </label>
          </div>

          {audioSettings.crossfade && (
            <div className="setting-slider">
              <div className="setting-slider-header">
                <span>Длительность кроссфейда</span>
                <span className="setting-slider-value">
                  {audioSettings.crossfadeDuration} сек
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={audioSettings.crossfadeDuration}
                onChange={(e) =>
                  setAudioSettings({
                    crossfadeDuration: parseInt(e.target.value),
                  })
                }
                className="settings-range"
              />
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <Youtube size={24} />
          <div>
            <h2>YouTube</h2>
            <p>Настройки воспроизведения с YouTube</p>
          </div>
        </div>

        <div className="settings-content">
          <div className="setting-radio-group">
            <label className="setting-radio-title">Режим загрузки</label>

            <label className="setting-radio">
              <input
                type="radio"
                name="youtubeMode"
                value="server"
                checked={audioSettings.youtubeMode === 'server'}
                onChange={() => setAudioSettings({ youtubeMode: 'server' })}
              />
              <div className="setting-radio-content">
                <Server size={20} />
                <div>
                  <span className="setting-radio-label">Сервер</span>
                  <span className="setting-radio-desc">
                    Загрузка через удалённый сервер (рекомендуется)
                  </span>
                </div>
              </div>
            </label>

            {isElectron && (
              <label className="setting-radio">
                <input
                  type="radio"
                  name="youtubeMode"
                  value="local"
                  checked={audioSettings.youtubeMode === 'local'}
                  onChange={() => setAudioSettings({ youtubeMode: 'local' })}
                />
                <div className="setting-radio-content">
                  <Monitor size={20} />
                  <div>
                    <span className="setting-radio-label">Локально</span>
                    <span className="setting-radio-desc">
                      Загрузка через yt-dlp на этом компьютере
                    </span>
                  </div>
                </div>
              </label>
            )}
          </div>

          {audioSettings.youtubeMode === 'server' && (
            <div className="setting-input">
              <label className="setting-input-label">URL сервера</label>
              <input
                type="text"
                value={audioSettings.youtubeServerUrl}
                onChange={handleServerUrlChange}
                placeholder="http://your-server:3000"
                className={`settings-text-input ${urlError ? 'input-error' : ''}`}
              />
              {urlError ? (
                <span className="setting-input-error">
                  <AlertCircle size={14} />
                  {urlError}
                </span>
              ) : (
                <span className="setting-input-hint">
                  Адрес сервера с yt-dlp для загрузки YouTube аудио
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="settings-footer">
        <p>Family Player v1.0</p>
      </div>
    </div>
  )
}
