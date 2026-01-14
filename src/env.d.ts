/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YOUTUBE_API_KEY: string
  readonly VITE_YOUTUBE_SERVER_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
