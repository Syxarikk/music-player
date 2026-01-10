/**
 * Electron Preload Script
 * Exposes safe APIs to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron'

console.log('Preload script loading...')

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // File dialogs
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openFilesDialog: () => ipcRenderer.invoke('open-files-dialog'),

  // Music operations
  scanMusicFolder: (folderPath: string) => ipcRenderer.invoke('scan-music-folder', folderPath),
  getFileMetadata: (filePath: string) => ipcRenderer.invoke('get-file-metadata', filePath),

  // Secure audio URL generation
  getAudioUrl: (filePath: string) => ipcRenderer.invoke('get-audio-url', filePath),

  // YouTube audio URL
  getYouTubeAudioUrl: (videoId: string) => ipcRenderer.invoke('get-youtube-audio-url', videoId),
})

console.log('Preload script loaded! electronAPI is now available.')

export type ElectronAPI = {
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  openFolderDialog: () => Promise<string | null>
  openFilesDialog: () => Promise<string[]>
  scanMusicFolder: (folderPath: string) => Promise<string[]>
  getFileMetadata: (filePath: string) => Promise<{
    title: string
    artist: string
    album: string
    duration: number
    year?: number
    genre?: string
    coverArt?: string | null
    path: string
  }>
  getAudioUrl: (filePath: string) => Promise<string>
  getYouTubeAudioUrl: (videoId: string) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
