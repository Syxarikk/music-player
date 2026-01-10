import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.familyplayer.app',
  appName: 'Family Player',
  webDir: 'dist',

  // Server configuration for connecting to the home server
  server: {
    // In production, the app will connect to a configured server URL
    // This can be changed in the app settings
    cleartext: true, // Allow HTTP for local network
    allowNavigation: [
      'youtube.com',
      '*.youtube.com',
      '*.googlevideo.com',
      '*.piped.private.coffee',
      'piped.private.coffee',
    ],
  },

  ios: {
    // iOS specific settings
    contentInset: 'automatic',
    backgroundColor: '#0a0a0a',
    preferredContentMode: 'mobile',
    scrollEnabled: true,

    // Allow audio playback in background
    appendUserAgent: 'FamilyPlayer/1.0',

    // Enable background audio
    // Note: You also need to add UIBackgroundModes with 'audio' in Info.plist
  },

  android: {
    backgroundColor: '#0a0a0a',
    allowMixedContent: true,
  },

  plugins: {
    // Splash screen
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      launchAutoHide: true,
    },
    // Status bar
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0a0a0a',
    },
  },
}

export default config
