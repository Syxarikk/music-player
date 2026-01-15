/**
 * Main Application Component - Simplified
 */

import { lazy, Suspense, Component, ReactNode } from 'react'
import { HashRouter, BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isElectron } from './services/apiClient'
import { useStore } from './store/useStore'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Player from './components/Player'
import MobileNav from './components/MobileNav'
import ProfileSelector from './components/ProfileSelector'
import './styles/App.css'

// ================== Error Boundary ==================

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-screen">
          <div className="error-content">
            <h1>Что-то пошло не так</h1>
            <p>Произошла ошибка в приложении.</p>
            <pre className="error-details">
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

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
  // Optimized selector: only subscribe to profiles array changes
  const hasProfiles = useStore((state) => state.profiles.length > 0)

  // Show profile creation screen if no profiles exist
  if (!hasProfiles) {
    return (
      <div className={`app ${isElectron ? 'electron' : 'web'}`}>
        {isElectron && <TitleBar />}
        <ProfileSelector />
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Router>
        <div className={`app ${isElectron ? 'electron' : 'web'}`}>
          {isElectron && <TitleBar />}
          <div className="app-content">
            <Sidebar />
            <main className="main-view">
              <ErrorBoundary>
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
              </ErrorBoundary>
            </main>
          </div>
          <Player />
          <MobileNav />
        </div>
      </Router>
    </ErrorBoundary>
  )
}

export default App
