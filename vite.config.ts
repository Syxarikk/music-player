import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Plugin to remove crossorigin attribute for file:// protocol compatibility
function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '')
    },
  }
}

export default defineConfig({
  plugins: [react(), removeCrossorigin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    // Disable crossorigin attribute for file:// protocol compatibility
    modulePreload: {
      polyfill: false,
    },
  },
  server: {
    port: 5173,
  },
  // Remove crossorigin attribute from script tags in production
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      return { relative: true }
    },
  },
})
