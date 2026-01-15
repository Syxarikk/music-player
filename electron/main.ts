/**
 * Electron Main Process
 * Production-ready with CSP, security hardening and optimizations
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  session,
} from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as mm from 'music-metadata'
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

dotenv.config()

// ================== GLOBAL STATE ==================

let mainWindow: BrowserWindow | null = null
let mediaServer: ReturnType<typeof createMediaServer> | null = null
let cacheCleanupInterval: NodeJS.Timeout | null = null

const isDev = !app.isPackaged
const PROTOCOL_NAME = 'local-audio'
const serverAuthToken = generateAuthToken()

// ================== CSP (SECURITY HARDENED) ==================

function setupCSP() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only apply 'unsafe-eval' in development (needed for Vite HMR)
    // Production builds don't need eval
    const scriptSrc = isDev
      ? `script-src 'self' file: 'unsafe-eval';`
      : `script-src 'self' file:;`

    // Allow local network IPs for media server access
    // NO hardcoded external IPs - users configure via settings
    const connectSrc = `
      connect-src
        'self'
        file:
        local-audio:
        ws://localhost:*
        wss://localhost:*
        http://localhost:*
        http://127.0.0.1:*
        http://192.168.*:*
        http://10.*:*
        http://172.16.*:*
        http://172.17.*:*
        http://172.18.*:*
        http://172.19.*:*
        http://172.20.*:*
        http://172.21.*:*
        http://172.22.*:*
        http://172.23.*:*
        http://172.24.*:*
        http://172.25.*:*
        http://172.26.*:*
        http://172.27.*:*
        http://172.28.*:*
        http://172.29.*:*
        http://172.30.*:*
        http://172.31.*:*
        https://*;
    `

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `
          default-src 'self' file:;
          ${scriptSrc}
          style-src 'self' 'unsafe-inline';
          img-src 'self' data: file: blob: https:;
          media-src 'self' file: blob: data: https://*;
          ${connectSrc}
          frame-ancestors 'none';
          base-uri 'self';
          form-action 'self';
          `,
        ],
      },
    })
  })
}

// ================== CUSTOM PROTOCOL ==================

protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL_NAME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

function registerLocalAudioProtocol() {
  protocol.handle(PROTOCOL_NAME, async (request) => {
    let fileHandle: fs.FileHandle | null = null

    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)

      if (filePath.startsWith('/audio/')) filePath = filePath.slice(7)
      if (filePath.startsWith('/')) filePath = filePath.slice(1)

      filePath = path.normalize(filePath)

      if (!isPathSafe(filePath) || !isPathAllowed(filePath) || !isValidAudioFile(filePath)) {
        return new Response('Forbidden', { status: 403 })
      }

      const stat = await fs.stat(filePath)
      if (!stat.isFile()) {
        return new Response('Forbidden', { status: 403 })
      }

      const fileSize = stat.size
      const contentType = getAudioMimeType(filePath)
      const range = request.headers.get('Range')

      const MAX_CHUNK = 10 * 1024 * 1024

      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          // Fix: properly handle empty strings in range parsing
          const start = match[1] && match[1].length > 0 ? parseInt(match[1], 10) : 0
          let end = match[2] && match[2].length > 0 ? parseInt(match[2], 10) : fileSize - 1

          // Validate parsed values
          if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
            return new Response('Range Not Satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${fileSize}` },
            })
          }

          if (end - start + 1 > MAX_CHUNK) end = start + MAX_CHUNK - 1

          fileHandle = await fs.open(filePath, 'r')
          const buffer = Buffer.alloc(end - start + 1)
          await fileHandle.read(buffer, 0, buffer.length, start)

          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(end - start + 1),
              'Accept-Ranges': 'bytes',
            },
          })
        }
      }

      fileHandle = await fs.open(filePath, 'r')
      const readSize = Math.min(fileSize, MAX_CHUNK)
      const buffer = Buffer.alloc(readSize)
      await fileHandle.read(buffer, 0, readSize, 0)

      return new Response(buffer, {
        status: fileSize > readSize ? 206 : 200,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        },
      })
    } catch {
      return new Response('Internal Error', { status: 500 })
    } finally {
      await fileHandle?.close().catch(() => {})
    }
  })
}

// ================== WINDOW ==================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../index.html'))
  }

  mainWindow.on('closed', () => (mainWindow = null))
}

// ================== APP LIFECYCLE ==================

app.whenReady().then(() => {
  setupCSP()

  setElectronPaths({
    music: app.getPath('music'),
    downloads: app.getPath('downloads'),
    documents: app.getPath('documents'),
    desktop: app.getPath('desktop'),
  })

  registerLocalAudioProtocol()
  createWindow()

  mediaServer = createMediaServer({
    port: DEFAULT_SERVER_PORT,
    ytDlpPath: app.isPackaged
      ? path.join(process.resourcesPath, 'yt-dlp.exe')
      : path.join(__dirname, '../../resources/yt-dlp.exe'),
    staticPath: isDev ? undefined : path.join(__dirname, '..'),
    authToken: serverAuthToken,
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

// ================== IPC (UI) ==================

ipcMain.handle('minimize-window', () => mainWindow?.minimize())
ipcMain.handle('maximize-window', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.handle('close-window', () => mainWindow?.close())

ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  const dir = res.filePaths[0]
  if (dir) addUserAllowedDirectory(dir)
  return dir ?? null
})
