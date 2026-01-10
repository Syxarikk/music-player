/**
 * Profile Selector Component
 * Allows users to switch between profiles and create new ones
 */

import { useState } from 'react'
import { Users, Plus, Check, X, Trash2, ChevronDown } from 'lucide-react'
import { useStore, PROFILE_COLORS, PROFILE_AVATARS } from '../store/useStore'
import './ProfileSelector.css'

export default function ProfileSelector() {
  const {
    profiles,
    currentProfileId,
    createProfile,
    deleteProfile,
    switchProfile,
    getCurrentProfile,
  } = useStore()

  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState(PROFILE_AVATARS[0])
  const [selectedColor, setSelectedColor] = useState(PROFILE_COLORS[0])

  const currentProfile = getCurrentProfile()

  const handleCreate = () => {
    if (!newName.trim()) return

    createProfile(newName.trim(), selectedAvatar, selectedColor)
    setNewName('')
    setIsCreating(false)
    setSelectedAvatar(PROFILE_AVATARS[0])
    setSelectedColor(PROFILE_COLORS[0])
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (profiles.length <= 1) {
      alert('Нельзя удалить последний профиль')
      return
    }
    if (confirm('Удалить этот профиль? Все его данные будут потеряны.')) {
      deleteProfile(id)
    }
  }

  const handleSwitch = (id: string) => {
    switchProfile(id)
    setIsOpen(false)
  }

  // If no profiles exist, show create profile screen
  if (profiles.length === 0) {
    return (
      <div className="profile-welcome">
        <div className="profile-welcome-content">
          <Users size={56} strokeWidth={1.5} />
          <h2>Добро пожаловать!</h2>
          <p>Создайте профиль для начала работы</p>

          <div className="profile-create-form">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ваше имя"
              className="profile-name-input"
              autoFocus
            />

            <div className="profile-avatar-select">
              <span className="profile-select-label">Аватар:</span>
              <div className="profile-avatars">
                {PROFILE_AVATARS.slice(0, 12).map((avatar) => (
                  <button
                    key={avatar}
                    className={`profile-avatar-btn ${selectedAvatar === avatar ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(avatar)}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>

            <div className="profile-color-select">
              <span className="profile-select-label">Цвет:</span>
              <div className="profile-colors">
                {PROFILE_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`profile-color-btn ${selectedColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setSelectedColor(color)}
                  >
                    {selectedColor === color && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="btn btn-primary profile-create-btn"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Создать профиль
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="profile-selector">
      <button
        className="profile-current"
        onClick={() => setIsOpen(!isOpen)}
        style={{ borderColor: currentProfile?.color }}
      >
        <span className="profile-avatar">{currentProfile?.avatar}</span>
        <span className="profile-name">{currentProfile?.name}</span>
        <ChevronDown size={16} className={`profile-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-header">
            <span>Профили</span>
            <button className="profile-close-btn" onClick={() => setIsOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="profile-list">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={`profile-item ${profile.id === currentProfileId ? 'active' : ''}`}
                onClick={() => handleSwitch(profile.id)}
              >
                <span
                  className="profile-item-avatar"
                  style={{ backgroundColor: profile.color }}
                >
                  {profile.avatar}
                </span>
                <span className="profile-item-name">{profile.name}</span>
                {profile.id === currentProfileId && (
                  <Check size={16} className="profile-check" />
                )}
                <button
                  className="profile-delete-btn"
                  onClick={(e) => handleDelete(profile.id, e)}
                  title="Удалить профиль"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {isCreating ? (
            <div className="profile-create-inline">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Имя профиля"
                className="profile-inline-input"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') setIsCreating(false)
                }}
              />
              <div className="profile-inline-avatars">
                {PROFILE_AVATARS.slice(0, 8).map((avatar) => (
                  <button
                    key={avatar}
                    className={`profile-mini-avatar ${selectedAvatar === avatar ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(avatar)}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
              <div className="profile-inline-colors">
                {PROFILE_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`profile-mini-color ${selectedColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setSelectedColor(color)}
                  />
                ))}
              </div>
              <div className="profile-inline-actions">
                <button className="btn btn-sm btn-primary" onClick={handleCreate}>
                  Создать
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setIsCreating(false)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              className="profile-add-btn"
              onClick={() => setIsCreating(true)}
            >
              <Plus size={18} />
              <span>Добавить профиль</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
