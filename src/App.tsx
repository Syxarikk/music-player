/**
 * Main Application Component - Simplified
 */

import { lazy, Suspense } from 'react'
import { HashRouter, BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isElectron } from './services/apiClient'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Player from './components/Player'
import MobileNav from './components/MobileNav'
import './styles/App.css'

// Use HashRouter for Electron (file:// protocol doesn't support History API)
const Router = isElectron ? HashRouter : BrowserRouter

// Lazy load pages
const HomePage = lazy(() => import('./pages/HomePage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const PlaylistPage = lazy(() => import('./pages/PlaylistPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="spinner" />
    </div>
  )
}

function App() {
  return (
    <Router>
      <div className={`app ${isElectron ? 'electron' : 'web'}`}>
        {isElectron && <TitleBar />}
        <div className="app-content">
          <Sidebar />
          <main className="main-view">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/favorites" element={<Navigate to="/library?tab=favorites" replace />} />
                <Route path="/playlist/:id" element={<PlaylistPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <Player />
        <MobileNav />
      </div>
    </Router>
  )
}

export default App
