import { Minus, Square, X } from 'lucide-react'
import './TitleBar.css'

export default function TitleBar() {
  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow()
  }

  const handleMaximize = () => {
    window.electronAPI?.maximizeWindow()
  }

  const handleClose = () => {
    window.electronAPI?.closeWindow()
  }

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <div className="titlebar-logo">
          <span className="logo-icon">🎵</span>
          <span className="logo-text">Family Player</span>
        </div>
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={handleMinimize}>
          <Minus size={16} />
        </button>
        <button className="titlebar-btn" onClick={handleMaximize}>
          <Square size={14} />
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={handleClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
