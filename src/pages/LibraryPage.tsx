/**
 * Library Page - Simplified
 */

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Music, Heart, FolderOpen, Upload } from 'lucide-react'
import { useStore } from '../store/useStore'
import TrackList from '../components/TrackList'
import { generateId } from '../utils/id'
import { isElectron } from '../services/apiClient'
import './LibraryPage.css'

type Tab = 'tracks' | 'favorites'

export default function LibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)

  // Get tab from URL params, default to 'tracks'
  const tabParam = searchParams.get('tab') as Tab
  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam === 'favorites' ? 'favorites' : 'tracks'
  )

  const { getTracks, getFavorites, addTracks, addMusicFolder } = useStore()

  const tracks = getTracks()
  const favorites = getFavorites()
  const favoriteTracks = tracks.filter((t) => favorites.includes(t.id))

  // Sync tab state with URL params
  useEffect(() => {
    const tab = searchParams.get('tab') as Tab
    if (tab === 'tracks' || tab === 'favorites') {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  const handleAddFolder = async () => {
    if (!window.electronAPI) return

    const folderPath = await window.electronAPI.openFolderDialog()
    if (!folderPath) return

    setIsLoading(true)
    try {
      addMusicFolder(folderPath)
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
      setIsLoading(false)
    }
  }

  const handleAddFiles = async () => {
    if (!window.electronAPI) return

    setIsLoading(true)
    try {
      const files = await window.electronAPI.openFilesDialog()

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
      console.error('Error adding files:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="page library-page animate-fadeIn">
      <div className="page-header">
        <h1 className="page-title">Медиатека</h1>
        {isElectron && (
          <div className="library-actions">
            <button
              className="btn btn-secondary"
              onClick={handleAddFiles}
              disabled={isLoading}
            >
              <Upload size={18} />
              Добавить файлы
            </button>
            <button
              className="btn btn-primary"
              onClick={handleAddFolder}
              disabled={isLoading}
            >
              <FolderOpen size={18} />
              Добавить папку
            </button>
          </div>
        )}
      </div>

      <div className="library-tabs">
        <button
          className={`library-tab ${activeTab === 'tracks' ? 'active' : ''}`}
          onClick={() => handleTabChange('tracks')}
        >
          <Music size={18} />
          Все треки
          <span className="tab-count">{tracks.length}</span>
        </button>
        <button
          className={`library-tab ${activeTab === 'favorites' ? 'active' : ''}`}
          onClick={() => handleTabChange('favorites')}
        >
          <Heart size={18} />
          Избранное
          <span className="tab-count">{favoriteTracks.length}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Загрузка музыки...</p>
        </div>
      ) : activeTab === 'tracks' ? (
        tracks.length > 0 ? (
          <TrackList tracks={tracks} />
        ) : (
          <div className="empty-state">
            <Music size={80} className="empty-state-icon" />
            <h2 className="empty-state-title">Библиотека пуста</h2>
            <p className="empty-state-text">
              {isElectron
                ? 'Добавьте папку с музыкой или найдите на YouTube'
                : 'Найдите музыку на YouTube'}
            </p>
          </div>
        )
      ) : favoriteTracks.length > 0 ? (
        <TrackList tracks={favoriteTracks} />
      ) : (
        <div className="empty-state">
          <Heart size={80} className="empty-state-icon" />
          <h2 className="empty-state-title">Нет избранных треков</h2>
          <p className="empty-state-text">
            Нажмите на сердечко, чтобы добавить трек в избранное
          </p>
        </div>
      )}
    </div>
  )
}
