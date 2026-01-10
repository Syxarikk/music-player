/**
 * Settings Page - Simplified
 */

import { useState } from 'react'
import { FolderOpen, Trash2, Volume2, Music, RefreshCw, Youtube, Server, Monitor } from 'lucide-react'
import { useStore } from '../store/useStore'
import { generateId } from '../utils/id'
import { isElectron } from '../services/apiClient'
import './SettingsPage.css'

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
      const newTracks = await Promise.all(
        files.map(async (filePath) => {
          const metadata = await window.electronAPI.getFileMetadata(filePath)
          return {
            ...metadata,
            id: generateId(),
          }
        })
      )
      addTracks(newTracks)
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
                onChange={(e) => setAudioSettings({ youtubeServerUrl: e.target.value })}
                placeholder="http://147.45.97.243:3000"
                className="settings-text-input"
              />
              <span className="setting-input-hint">
                Адрес сервера с yt-dlp для загрузки YouTube аудио
              </span>
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
