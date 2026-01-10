/**
 * Electron Main Process
 * Refactored with improved security
 */

import { app, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as mm from 'music-metadata'
import { pathToFileURL } from 'url'
import YTDlpWrap from 'yt-dlp-wrap'
import * as os from 'os'
import * as crypto from 'crypto'
import { createMediaServer } from './server'

let mainWindow: BrowserWindow | null = null

// Check if running in development mode
// In dev: not packaged and vite server should be running
// In prod: app is packaged
const isDev = !app.isPackaged
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.webm']

// Custom protocol for secure local file access
const PROTOCOL_NAME = 'local-audio'

// Register protocol scheme as privileged BEFORE app is ready
// This is required for the protocol to work with media streaming
protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL_NAME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
])

/**
 * Register custom protocol handler
 * This replaces webSecurity: false with a secure alternative
 * Supports Range requests for audio seeking
 */
function registerLocalAudioProtocol() {
  protocol.handle(PROTOCOL_NAME, async (request) => {
    try {
      // Extract file path from URL
      // URL format: local-audio://audio/C%3A%2FUsers%2F...
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)

      // Remove /audio/ prefix from pathname
      if (filePath.startsWith('/audio/')) {
        filePath = filePath.slice(7) // Remove '/audio/'
      } else if (filePath.startsWith('/')) {
        filePath = filePath.slice(1)
      }

      // Handle Windows paths (the path was encoded with forward slashes)
      if (process.platform === 'win32') {
        // Path is already in forward slash format: C:/Users/...
        // No need to convert
      }

      // Security: Validate file extension
      const ext = path.extname(filePath).toLowerCase()
      if (!AUDIO_EXTENSIONS.includes(ext)) {
        return new Response('Forbidden: Invalid file type', { status: 403 })
      }

      // Get file stats
      let stat
      try {
        stat = await fs.stat(filePath)
      } catch {
        return new Response('Not Found', { status: 404 })
      }

      const fileSize = stat.size
      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.webm': 'audio/webm',
      }
      const contentType = mimeTypes[ext] || 'audio/mpeg'

      // Check for Range header (needed for seeking)
      const rangeHeader = request.headers.get('Range')

      if (rangeHeader) {
        // Parse Range header: "bytes=start-end"
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          const chunkSize = end - start + 1

          // Read the requested chunk
          const fileHandle = await fs.open(filePath, 'r')
          const buffer = Buffer.alloc(chunkSize)
          await fileHandle.read(buffer, 0, chunkSize, start)
          await fileHandle.close()

          // Return 206 Partial Content
          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': chunkSize.toString(),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
            },
          })
        }
      }

      // No Range header - return full file
      const fileHandle = await fs.open(filePath, 'r')
      const buffer = Buffer.alloc(fileSize)
      await fileHandle.read(buffer, 0, fileSize, 0)
      await fileHandle.close()

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch (error) {
      console.error('Protocol error:', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  })
}

function createWindow() {
  // Preload is always in same directory as main.js (both in dev and prod without asar)
  const preloadPath = path.join(__dirname, 'preload.js')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload script to work
      webSecurity: true, // Enabled for security - use custom protocol for audio
      preload: preloadPath,
    },
  })

  // Open DevTools only in development
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    // In production, index.html is in dist folder (same level as electron folder in asar)
    const indexPath = path.join(__dirname, '../index.html')
    mainWindow.loadFile(indexPath)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Register F12 to toggle DevTools (dev only for security)
  if (isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }
}

// Register protocol before app is ready
app.whenReady().then(() => {
  registerLocalAudioProtocol()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// ============ IPC Handlers ============

ipcMain.handle('minimize-window', () => {
  console.log('minimize-window called, mainWindow:', !!mainWindow)
  if (mainWindow) {
    mainWindow.minimize()
    console.log('Window minimized')
  }
})

ipcMain.handle('maximize-window', () => {
  console.log('maximize-window called, mainWindow:', !!mainWindow)
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.handle('close-window', () => {
  console.log('close-window called, mainWindow:', !!mainWindow)
  if (mainWindow) {
    mainWindow.close()
  }
})

ipcMain.handle('open-folder-dialog', async () => {
  try {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Выберите папку с музыкой',
    })
    return result.filePaths[0] || null
  } catch (error) {
    console.error('Error opening folder dialog:', error)
    return null
  }
})

ipcMain.handle('open-files-dialog', async () => {
  try {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Аудио файлы', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] },
      ],
      title: 'Выберите музыкальные файлы',
    })
    return result.filePaths
  } catch (error) {
    console.error('Error opening files dialog:', error)
    return []
  }
})

ipcMain.handle('scan-music-folder', async (_, folderPath: string) => {
  const files: string[] = []

  async function scanDirAsync(dir: string): Promise<void> {
    try {
      const items = await fs.readdir(dir)
      for (const item of items) {
        const fullPath = path.join(dir, item)
        const stat = await fs.stat(fullPath)
        if (stat.isDirectory()) {
          await scanDirAsync(fullPath)
        } else if (AUDIO_EXTENSIONS.includes(path.extname(item).toLowerCase())) {
          files.push(fullPath)
        }
      }
    } catch (err) {
      console.error('Error scanning directory:', dir, err)
    }
  }

  await scanDirAsync(folderPath)
  return files
})

ipcMain.handle('get-file-metadata', async (_, filePath: string) => {
  const defaultMetadata = {
    title: path.basename(filePath, path.extname(filePath)),
    artist: 'Неизвестный исполнитель',
    album: 'Неизвестный альбом',
    duration: 0,
    path: filePath,
  }

  try {
    const metadata = await mm.parseFile(filePath)

    let coverArt: string | null = null
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0]
      coverArt = `data:${picture.format};base64,${picture.data.toString('base64')}`
    }

    return {
      title: metadata.common.title || defaultMetadata.title,
      artist: metadata.common.artist || defaultMetadata.artist,
      album: metadata.common.album || defaultMetadata.album,
      duration: metadata.format.duration || 0,
      year: metadata.common.year,
      genre: metadata.common.genre?.[0],
      coverArt,
      path: filePath,
    }
  } catch (err) {
    console.error('Error reading metadata:', filePath, err)
    return defaultMetadata
  }
})

/**
 * Convert file path to secure protocol URL
 * Used by the renderer process to load audio files
 */
ipcMain.handle('get-audio-url', (_, filePath: string) => {
  // Convert path to protocol URL
  const encodedPath = encodeURIComponent(filePath.replace(/\\/g, '/'))
  return `${PROTOCOL_NAME}://audio/${encodedPath}`
})

/**
 * Convert local file path to protocol URL (for YouTube cache)
 */
function filePathToProtocolUrl(filePath: string): string {
  const encodedPath = encodeURIComponent(filePath.replace(/\\/g, '/'))
  return `${PROTOCOL_NAME}://audio/${encodedPath}`
}

// Initialize yt-dlp with the binary path
// Use app.isPackaged for more reliable detection
const isPackaged = app.isPackaged
const ytDlpPath = isPackaged
  ? path.join(process.resourcesPath, 'yt-dlp.exe')
  : path.join(__dirname, '../../resources/yt-dlp.exe')

console.log('yt-dlp path:', ytDlpPath, 'isPackaged:', isPackaged)

const ytDlp = new YTDlpWrap(ytDlpPath)

// Deno path for JavaScript runtime (needed for YouTube bot protection bypass)
const denoPath = path.join(os.homedir(), '.deno', 'bin', 'deno.exe')

// Cache directory for downloaded YouTube audio
const ytCacheDir = path.join(os.tmpdir(), 'family-player-yt-cache')

// Ensure cache directory exists
fs.mkdir(ytCacheDir, { recursive: true }).catch(() => {})

/**
 * Get YouTube audio by downloading it locally
 * This bypasses network blocking in Russia
 */
ipcMain.handle('get-youtube-audio-url', async (_, videoId: string) => {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  console.log('Downloading audio for:', url)

  // Generate cache filename based on video ID
  const cacheFile = path.join(ytCacheDir, `${videoId}.m4a`)
  const cacheFileAlt = path.join(ytCacheDir, `${videoId}.webm`)

  // Check if already cached (either format)
  for (const cached of [cacheFile, cacheFileAlt]) {
    try {
      await fs.access(cached)
      console.log('Using cached audio:', cached)
      return filePathToProtocolUrl(cached)
    } catch {
      // Not cached
    }
  }

  // Browsers to try for cookies (YouTube often requires authentication)
  // Firefox first since it's commonly available
  const browsers = ['firefox', 'chrome', 'edge', 'brave', 'opera', 'chromium']

  // Format priority list
  const formats = ['140', 'bestaudio[ext=m4a]', 'bestaudio']

  // Check if Deno is available
  let hasDeno = false
  try {
    await fs.access(denoPath)
    hasDeno = true
    console.log('Deno found at:', denoPath)
  } catch {
    console.log('Deno not found, JS challenges may fail')
  }

  // Helper function to try download
  async function tryDownload(format: string, output: string, cookieBrowser?: string): Promise<boolean> {
    try {
      const args = [
        url,
        '-f', format,
        '-o', output,
        '--no-playlist',
        '--no-warnings',
      ]

      // Add Deno runtime if available
      if (hasDeno) {
        args.push('--js-runtimes', `deno:${denoPath}`)
      }

      if (cookieBrowser) {
        args.push('--cookies-from-browser', cookieBrowser)
      }

      console.log(`Trying: format=${format}, cookies=${cookieBrowser || 'none'}, deno=${hasDeno}`)
      await ytDlp.execPromise(args)

      // Verify download
      const stat = await fs.stat(output)
      if (stat.size > 0) {
        console.log('Download successful:', output, 'size:', stat.size)
        return true
      }
      await fs.unlink(output).catch(() => {})
      return false
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`Failed: ${msg.substring(0, 150)}`)
      await fs.unlink(output).catch(() => {})
      return false
    }
  }

  // Try without cookies first (faster if it works)
  for (const format of formats) {
    const output = format.includes('webm') ? cacheFileAlt : cacheFile
    if (await tryDownload(format, output)) {
      return filePathToProtocolUrl(output)
    }
  }

  // Try with browser cookies (needed for bot protection)
  for (const browser of browsers) {
    for (const format of formats) {
      const output = format.includes('webm') ? cacheFileAlt : cacheFile
      if (await tryDownload(format, output, browser)) {
        return filePathToProtocolUrl(output)
      }
    }
  }

  console.error('All download attempts failed for:', videoId)
  return null
})

// ============ Media Server ============

const SERVER_PORT = 3000

// Start media server for mobile/web clients
app.whenReady().then(() => {
  // Always serve static files from dist folder (for mobile access)
  const staticPath = isDev
    ? path.join(__dirname, '../../dist') // In dev: go up from dist/electron to project root, then dist
    : path.join(__dirname, '../dist')

  createMediaServer({
    port: SERVER_PORT,
    ytDlpPath,
    staticPath,
  })
})
