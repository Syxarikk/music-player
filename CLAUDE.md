# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Family Player is a cross-platform music player application built with:
- **React + TypeScript** frontend with Vite bundler
- **Electron** for desktop (Windows/macOS)
- **Capacitor** for mobile (iOS/Android)
- **Express** media server for remote playback
- **Zustand** for state management with localStorage persistence

The app supports local audio files and YouTube streaming (via Piped/Invidious APIs or yt-dlp).

## Development Commands

```bash
# Web development
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Production build to dist/

# Electron desktop
npm run electron:dev     # Dev mode (compiles TS then runs Vite + Electron)
npm run electron:build   # Production build (build + compile + electron-builder)
npm run electron:compile # Compile electron/ TypeScript only

# iOS (requires Capacitor setup)
npm run ios:init         # Add iOS platform
npm run ios:sync         # Build web + sync to iOS
npm run ios:open         # Open in Xcode
npm run ios:run          # Build and run on device/simulator

# General
npm run cap:sync         # Build web + sync all Capacitor platforms
npm run preview          # Preview production build
```

## Architecture

### Three Runtime Environments

1. **Electron (Desktop)**: Full local file access, yt-dlp for YouTube downloads, custom `local-audio://` protocol for secure file streaming
2. **Web/Capacitor (Mobile)**: Connects to media server, uses Piped/Invidious APIs for YouTube
3. **Standalone Server** (`server/index.ts`): Lightweight YouTube proxy using Piped API only (no yt-dlp dependency)

### Key Source Structure

- `src/` - React frontend (shared across all platforms)
  - `store/useStore.ts` - Zustand store with profile-based data isolation
  - `services/youtubeApi.ts` - YouTube search/streaming via Piped, Invidious, or server proxy
  - `services/apiClient.ts` - Platform detection and Electron IPC wrappers
  - `components/Player.tsx` - Audio playback with Howler.js
  - `shared/instances.ts` - Piped/Invidious instance lists (shared with server)

- `electron/` - Electron main process
  - `main.ts` - Window creation, IPC handlers, local file scanning, yt-dlp integration
  - `server.ts` - Media server for LAN access (mobile can connect to desktop)
  - `shared/constants.ts` - Shared security utilities (path validation, auth tokens)
  - `preload.ts` - Context bridge for renderer

- `server/` - Standalone server (alternative to Electron server)
  - `index.ts` - Express server with Piped API proxy for YouTube

### Data Flow

```
[YouTube Track]
  Web/Mobile → Piped/Invidious API → Direct stream URL
  Electron   → yt-dlp download → local cache → local-audio:// protocol

[Local Track]
  Electron   → IPC scan-music-folder → local-audio:// protocol
  Mobile     → Media server API → /api/stream/:trackId
```

### Security Model

- Electron uses custom `local-audio://` protocol instead of `webSecurity: false`
- File access restricted to allowed directories (Music, Downloads, Documents, Desktop, user-selected)
- Path validation: no traversal (`..`), null bytes, symlinks
- Server authentication via `X-Auth-Token` header
- DNS rebinding protection on media server
- CORS whitelist for local network only
- Rate limiting (100 req/min per IP)

### State Management

Zustand store persists to localStorage with:
- Profile-isolated data (tracks, playlists, favorites per profile)
- `coverArt` excluded from persistence (too large)
- Limits: 5000 tracks/profile, 100 playlists/profile, 4MB total
- Automatic backup on corruption

### YouTube Modes (`audioSettings.youtubeMode`)

- `'server'` (default): Mobile connects to media server at `youtubeServerUrl`
- `'local'`: Electron uses yt-dlp to download to temp cache

## Environment Variables

- `VITE_YOUTUBE_SERVER_URL` - Media server URL for YouTube streaming
- `YOUTUBE_API_KEY` - YouTube Data API key (server-side only)
- `AUTH_TOKEN` - Server authentication token (standalone server)

## Platform Detection

```typescript
import { isElectron } from './services/apiClient'
// true in Electron, false in browser/Capacitor
```

Use `HashRouter` in Electron (file:// protocol), `BrowserRouter` in web.

## TypeScript Configuration

- `tsconfig.json` - Base config
- `electron/tsconfig.json` - Electron main process (CommonJS output to dist/electron/)
- `server/tsconfig.json` - Standalone server
