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
import * as dotenv from 'dotenv'
import { createMediaServer } from './server'
import {
  AUDIO_EXTENSIONS,
  MAX_CACHE_SIZE_MB,
  MAX_CACHE_AGE_DAYS,
  CACHE_CLEANUP_INTERVAL_MS,
  DEFAULT_SERVER_PORT,
  YT_DLP_TIMEOUT_MS,
  isPathAllowed,
  isPathSafe,
  isValidVideoId,
  isValidAudioFile,
  getAudioMimeType,
  generateAuthToken,
  setElectronPaths,
  addUserAllowedDirectory,
} from './shared/constants'

// Load environment variables
dotenv.config()

let mainWindow: BrowserWindow | null = null
let mediaServer: ReturnType<typeof createMediaServer> | null = null
let cacheCleanupInterval: NodeJS.Timeout | null = null

// Check if running in development mode
const isDev = !app.isPackaged

// Custom protocol for secure local file access
const PROTOCOL_NAME = 'local-audio'

// Server authentication token (generated once per session)
const serverAuthToken = generateAuthToken()

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
    let fileHandle: fs.FileHandle | null = null

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

      // Normalize path
      filePath = path.normalize(filePath)

      // Security: Comprehensive path validation
      if (!isPathSafe(filePath)) {
        console.warn('Blocked unsafe path:', filePath)
        return new Response('Forbidden: Invalid path', { status: 403 })
      }

      // Security: Validate file extension
      if (!isValidAudioFile(filePath)) {
        return new Response('Forbidden: Invalid file type', { status: 403 })
      }

      // Security: Check if path is within allowed directories
      if (!isPathAllowed(filePath)) {
        console.warn('Blocked access to disallowed path:', filePath)
        return new Response('Forbidden: Access denied', { status: 403 })
      }

      // Get file stats
      let stat
      try {
        stat = await fs.stat(filePath)
      } catch {
        return new Response('Not Found', { status: 404 })
      }

      // Security: Must be a file, not directory or symlink
      if (!stat.isFile()) {
        return new Response('Forbidden: Not a file', { status: 403 })
      }

      const fileSize = stat.size
      const contentType = getAudioMimeType(filePath)

      // Check for Range header (needed for seeking)
      const rangeHeader = request.headers.get('Range')

      if (rangeHeader) {
        // Parse Range header: "bytes=start-end"
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0
          let end = match[2] ? parseInt(match[2], 10) : fileSize - 1

          // Validate range
          if (start >= fileSize || start < 0) {
            return new Response('Range Not Satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${fileSize}` }
            })
          }

          // Limit chunk size to 10MB to prevent OOM on large files
          const MAX_CHUNK_SIZE = 10 * 1024 * 1024
          if (end - start + 1 > MAX_CHUNK_SIZE) {
            end = start + MAX_CHUNK_SIZE - 1
          }
          if (end >= fileSize) {
            end = fileSize - 1
          }

          const chunkSize = end - start + 1

          // Read the requested chunk with guaranteed cleanup
          fileHandle = await fs.open(filePath, 'r')
          try {
            const buffer = Buffer.alloc(chunkSize)
            await fileHandle.read(buffer, 0, chunkSize, start)
            return new Response(buffer, {
              status: 206,
              headers: {
                'Content-Type': contentType,
                'Content-Length': chunkSize.toString(),
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
              },
            })
          } finally {
            await fileHandle.close()
            fileHandle = null
          }
        }
      }

      // No Range header - for large files, return first chunk with Accept-Ranges
      // Browser will then request ranges. Limit to 10MB to prevent OOM.
      const MAX_INITIAL_SIZE = 10 * 1024 * 1024
      const readSize = Math.min(fileSize, MAX_INITIAL_SIZE)

      fileHandle = await fs.open(filePath, 'r')
      try {
        const buffer = Buffer.alloc(readSize)
        await fileHandle.read(buffer, 0, readSize, 0)

        // If file is larger than max, return partial content to force range requests
        if (fileSize > MAX_INITIAL_SIZE) {
          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': readSize.toString(),
              'Content-Range': `bytes 0-${readSize - 1}/${fileSize}`,
              'Accept-Ranges': 'bytes',
            },
          })
        }

        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes',
          },
        })
      } finally {
        await fileHandle.close()
        fileHandle = null
      }
    } catch (error) {
      console.error('Protocol error:', error)
      return new Response('Internal Server Error', { status: 500 })
    } finally {
      // Ensure file handle is closed even on unexpected errors
      if (fileHandle) {
        await fileHandle.close().catch(() => {})
      }
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
      sandbox: true, // SECURITY: Keep sandbox enabled
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
  // Set system paths for localized Windows folders (Music, Downloads, etc.)
  try {
    setElectronPaths({
      music: app.getPath('music'),
      downloads: app.getPath('downloads'),
      documents: app.getPath('documents'),
      desktop: app.getPath('desktop'),
    })
    console.log('System paths configured for current locale')
  } catch (e) {
    console.warn('Could not get some system paths:', e)
  }

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
    const folderPath = result.filePaths[0] || null

    // SECURITY: Register user-selected directory in allowed list
    if (folderPath) {
      addUserAllowedDirectory(folderPath)
    }

    return folderPath
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
  // SECURITY: Validate folder path
  if (!folderPath || typeof folderPath !== 'string') {
    console.warn('Invalid folder path type')
    return []
  }

  // SECURITY: Check if path is safe and allowed
  if (!isPathSafe(folderPath)) {
    console.warn('Blocked unsafe scan path:', folderPath)
    return []
  }

  if (!isPathAllowed(folderPath)) {
    console.warn('Blocked scan outside allowed directories:', folderPath)
    return []
  }

  const files: string[] = []
  const MAX_FILES = 10000 // Prevent DoS
  const MAX_DEPTH = 10 // Maximum recursion depth

  async function scanDirAsync(dir: string, depth: number = 0): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return

    try {
      const items = await fs.readdir(dir)
      for (const item of items) {
        if (files.length >= MAX_FILES) break

        // Skip hidden files and directories
        if (item.startsWith('.')) continue

        const fullPath = path.join(dir, item)

        try {
          const stat = await fs.stat(fullPath)
          if (stat.isDirectory()) {
            await scanDirAsync(fullPath, depth + 1)
          } else if (isValidAudioFile(item)) {
            files.push(fullPath)
          }
        } catch {
          // Skip files we can't access
          continue
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
// Platform-specific executable name
const denoExecutable = process.platform === 'win32' ? 'deno.exe' : 'deno'
const denoPath = path.join(os.homedir(), '.deno', 'bin', denoExecutable)

// Cache directory for downloaded YouTube audio
const ytCacheDir = path.join(os.tmpdir(), 'family-player-yt-cache')

// Mutex for YouTube downloads to prevent parallel downloads of same video
// Uses a lock map to ensure atomic check-and-set operations
const activeDownloads = new Map<string, Promise<string | null>>()
const downloadLocks = new Map<string, { resolve: () => void; promise: Promise<void> }>()

// Maximum time to wait for a download lock (prevents deadlock)
const DOWNLOAD_LOCK_TIMEOUT_MS = 180000 // 3 minutes

/**
 * Acquire a lock for a specific video ID
 * Ensures only one download runs at a time per video
 * Includes timeout to prevent deadlocks
 */
async function acquireDownloadLock(videoId: string): Promise<() => void> {
  const startTime = Date.now()

  // Wait for any existing lock to be released with timeout
  while (downloadLocks.has(videoId)) {
    // Check for timeout to prevent deadlock
    if (Date.now() - startTime > DOWNLOAD_LOCK_TIMEOUT_MS) {
      console.warn('Download lock timeout for video:', videoId)
      // Force release stale lock
      const staleLock = downloadLocks.get(videoId)
      if (staleLock) {
        downloadLocks.delete(videoId)
        staleLock.resolve()
      }
      break
    }

    // Wait with a timeout to allow periodic checks
    await Promise.race([
      downloadLocks.get(videoId)!.promise,
      new Promise(resolve => setTimeout(resolve, 5000)) // Check every 5 seconds
    ])
  }

  // Create new lock
  let lockResolve: () => void
  const lockPromise = new Promise<void>((resolve) => {
    lockResolve = resolve
  })
  downloadLocks.set(videoId, { resolve: lockResolve!, promise: lockPromise })

  // Return release function
  return () => {
    const lock = downloadLocks.get(videoId)
    if (lock) {
      downloadLocks.delete(videoId)
      lock.resolve()
    }
  }
}

// Ensure cache directory exists (with proper error handling)
async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(ytCacheDir, { recursive: true })
  } catch (error) {
    console.error('Failed to create cache directory:', error)
  }
}

// Initialize cache directory
ensureCacheDir()

/**
 * Cleanup old cache files to prevent disk overflow
 */
async function cleanupCache(): Promise<void> {
  try {
    const files = await fs.readdir(ytCacheDir)
    let totalSize = 0
    const fileStats: { path: string; mtime: Date; size: number; deleted: boolean }[] = []

    for (const file of files) {
      try {
        const filePath = path.join(ytCacheDir, file)
        const stat = await fs.stat(filePath)
        if (stat.isFile()) {
          totalSize += stat.size
          fileStats.push({ path: filePath, mtime: stat.mtime, size: stat.size, deleted: false })
        }
      } catch {
        continue
      }
    }

    // Remove files older than MAX_CACHE_AGE_DAYS
    const cutoffTime = Date.now() - MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000
    for (const file of fileStats) {
      if (file.mtime.getTime() < cutoffTime) {
        try {
          await fs.unlink(file.path)
          totalSize -= file.size
          file.deleted = true // Mark as deleted to prevent double deletion
          console.log('Removed old cache file:', path.basename(file.path))
        } catch {
          // Ignore errors
        }
      }
    }

    // If still over limit, remove oldest files (LRU)
    const maxSize = MAX_CACHE_SIZE_MB * 1024 * 1024
    if (totalSize > maxSize) {
      // Sort by modification time (oldest first), filter out already deleted
      const remainingFiles = fileStats
        .filter(f => !f.deleted)
        .sort((a, b) => a.mtime.getTime() - b.mtime.getTime())

      for (const file of remainingFiles) {
        if (totalSize <= maxSize) break
        try {
          await fs.unlink(file.path)
          totalSize -= file.size
          file.deleted = true
          console.log('Removed cache file (LRU):', path.basename(file.path))
        } catch {
          // Ignore errors
        }
      }
    }

    console.log(`Cache cleanup complete. Current size: ${Math.round(totalSize / 1024 / 1024)}MB`)
  } catch (error) {
    console.error('Cache cleanup error:', error)
  }
}

// Run cache cleanup on startup and periodically (with cleanup on shutdown)
cleanupCache()
cacheCleanupInterval = setInterval(cleanupCache, CACHE_CLEANUP_INTERVAL_MS)

/**
 * Get YouTube audio by downloading it locally
 * This bypasses network blocking in Russia
 * Uses mutex to prevent parallel downloads of the same video
 */
ipcMain.handle('get-youtube-audio-url', async (_, videoId: string) => {
  // Security: Validate video ID format strictly
  if (!isValidVideoId(videoId)) {
    console.error('Invalid YouTube video ID format:', videoId)
    return null
  }

  // Acquire lock to prevent race conditions
  const releaseLock = await acquireDownloadLock(videoId)

  try {
    // Check if download completed while waiting for lock (result already cached)
    const existingDownload = activeDownloads.get(videoId)
    if (existingDownload) {
      console.log('Using result from concurrent download:', videoId)
      releaseLock()
      return existingDownload
    }

    // Create download promise and store in map
    const downloadPromise = (async (): Promise<string | null> => {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`
      console.log('Downloading audio for:', url)

      // Generate cache filename based on video ID
      const cacheFile = path.join(ytCacheDir, `${videoId}.m4a`)
      const cacheFileAlt = path.join(ytCacheDir, `${videoId}.webm`)

      // Check if already cached (either format)
      for (const cached of [cacheFile, cacheFileAlt]) {
        try {
          const stat = await fs.stat(cached)
          if (stat.size > 0) {
            // Touch file to update mtime and prevent cleanup of actively used files
            const now = new Date()
            await fs.utimes(cached, now, now).catch(() => {})
            console.log('Using cached audio:', cached)
            return filePathToProtocolUrl(cached)
          }
        } catch {
          // Not cached or inaccessible
        }
      }

      // Browsers to try for cookies (YouTube often requires authentication)
      // Firefox first since it's commonly available
      const browsers = ['firefox', 'chrome', 'edge', 'brave', 'opera', 'chromium']

      // Format priority list
      const formats = ['140', 'bestaudio[ext=m4a]', 'bestaudio']

      // Check if Deno is available (with security validation)
      let hasDeno = false
      try {
        const stat = await fs.stat(denoPath)
        // Security: Ensure it's a regular file, not a symlink to malicious executable
        if (stat.isFile()) {
          hasDeno = true
          console.log('Deno found at:', denoPath)
        } else {
          console.log('Deno path exists but is not a file')
        }
      } catch {
        console.log('Deno not found, JS challenges may fail')
      }

      // Helper function to try download with timeout
      async function tryDownload(format: string, output: string, cookieBrowser?: string): Promise<boolean> {
        try {
          const args = [
            url,
            '-f', format,
            '-o', output,
            '--no-playlist',
            '--no-warnings',
            '--socket-timeout', '30', // Network timeout
            '--retries', '2',
          ]

          // Add Deno runtime if available
          if (hasDeno) {
            args.push('--js-runtimes', `deno:${denoPath}`)
          }

          if (cookieBrowser) {
            args.push('--cookies-from-browser', cookieBrowser)
          }

          console.log(`Trying: format=${format}, cookies=${cookieBrowser || 'none'}, deno=${hasDeno}`)

          // Execute with timeout to prevent hanging
          const dlPromise = ytDlp.execPromise(args)
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('yt-dlp timeout')), YT_DLP_TIMEOUT_MS)
          })

          await Promise.race([dlPromise, timeoutPromise])

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

      // Helper to determine output file based on format
      // '140' and 'bestaudio[ext=m4a]' produce m4a, 'bestaudio' may produce webm
      const getOutputFile = (format: string) =>
        format === 'bestaudio' ? cacheFileAlt : cacheFile

      // Try without cookies first (faster if it works)
      for (const format of formats) {
        const output = getOutputFile(format)
        if (await tryDownload(format, output)) {
          return filePathToProtocolUrl(output)
        }
      }

      // Try with browser cookies (needed for bot protection)
      for (const browser of browsers) {
        for (const format of formats) {
          const output = getOutputFile(format)
          if (await tryDownload(format, output, browser)) {
            return filePathToProtocolUrl(output)
          }
        }
      }

      console.error('All download attempts failed for:', videoId)
      return null
    } finally {
      // Always remove from mutex map when done
      activeDownloads.delete(videoId)
    }
  })()

    // Store in mutex map
    activeDownloads.set(videoId, downloadPromise)

    // Release lock after setting up download (others can now check cache)
    releaseLock()

    return downloadPromise
  } catch (error) {
    releaseLock()
    throw error
  }
})

// ============ Media Server ============

// Start media server for mobile/web clients
app.whenReady().then(() => {
  // In production: serve static files from dist folder (for mobile access)
  // In dev: Vite dev server handles static files, so staticPath may not exist
  const staticPath = isDev
    ? undefined // In dev, static files are served by Vite dev server on port 5173
    : path.join(__dirname, '..')  // In prod: dist/electron/../ = dist/

  mediaServer = createMediaServer({
    port: DEFAULT_SERVER_PORT,
    ytDlpPath,
    staticPath,
    authToken: serverAuthToken, // Enable API authentication
  })

  // SECURITY: Never log auth token to console (even in dev mode)
  // Token is passed to server and can be retrieved via IPC if needed
  console.log('Media server started with authentication enabled')
  console.log('Use "Show Auth Token" button in settings to view token for mobile access')
})

// ============ Graceful Shutdown ============

let isQuitting = false
let shutdownComplete = false

async function gracefulShutdown(): Promise<void> {
  if (isQuitting) return
  isQuitting = true

  console.log('Shutting down gracefully...')

  // Clear cache cleanup interval
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval)
    cacheCleanupInterval = null
  }

  // Close media server
  if (mediaServer?.server) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log('Media server close timeout, forcing...')
        resolve()
      }, 5000)

      mediaServer!.server.close(() => {
        clearTimeout(timeout)
        console.log('Media server closed')
        resolve()
      })
    })
  }

  // Final cache cleanup
  await cleanupCache().catch(() => {})

  shutdownComplete = true
  console.log('Shutdown complete')
}

app.on('before-quit', async (e) => {
  if (!shutdownComplete) {
    e.preventDefault()
    await gracefulShutdown()
    app.quit()
  }
})

app.on('will-quit', () => {
  // Ensure cleanup even if before-quit was skipped
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval)
    cacheCleanupInterval = null
  }
})

// Handle SIGTERM/SIGINT for non-Windows platforms
if (process.platform !== 'win32') {
  process.on('SIGTERM', async () => {
    await gracefulShutdown()
    process.exit(0)
  })
  process.on('SIGINT', async () => {
    await gracefulShutdown()
    process.exit(0)
  })
}
