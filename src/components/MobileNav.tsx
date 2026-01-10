/**
 * Mobile Bottom Navigation
 * Shown only on small screens
 */

import { NavLink } from 'react-router-dom'
import { Home, Search, Heart, Library, Settings } from 'lucide-react'
import './MobileNav.css'

export default function MobileNav() {
  return (
    <nav className="mobile-nav">
      <NavLink
        to="/"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Home size={24} />
        <span>Главная</span>
      </NavLink>

      <NavLink
        to="/search"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Search size={24} />
        <span>Поиск</span>
      </NavLink>

      <NavLink
        to="/favorites"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Heart size={24} />
        <span>Любимое</span>
      </NavLink>

      <NavLink
        to="/library"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Library size={24} />
        <span>Медиатека</span>
      </NavLink>

      <NavLink
        to="/settings"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Settings size={24} />
        <span>Ещё</span>
      </NavLink>
    </nav>
  )
}
