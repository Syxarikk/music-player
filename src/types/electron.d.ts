/**
 * Electron API type definitions
 */

interface TrackMetadata {
  title: string
  artist: string
  album: string
  duration: number
  year?: number
  genre?: string
  coverArt: string | null
  path: string
}

interface ElectronAPI {
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  openFolderDialog: () => Promise<string | null>
  openFilesDialog: () => Promise<string[]>
  scanMusicFolder: (folderPath: string) => Promise<string[]>
  getFileMetadata: (filePath: string) => Promise<TrackMetadata>
  getAudioUrl: (filePath: string) => Promise<string>
  getYouTubeAudioUrl: (videoId: string) => Promise<string | null>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
