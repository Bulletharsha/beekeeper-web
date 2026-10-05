import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  // Project-page hosting (e.g. GitHub Pages at /beekeeper-web/).
  base: '/beekeeper-web/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Beekeeper — Spelling Practice',
        short_name: 'Beekeeper',
        description: 'Audio-first spelling bee practice for Arya and Anjali.',
        theme_color: '#faf7f0',
        background_color: '#faf7f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell + words data: cache first, always available offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/data/words.json'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'beekeeper-words',
              expiration: { maxEntries: 1, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            // Scripps pronunciation MP3s: cache as played.
            urlPattern: ({ url }) =>
              url.hostname === 'd26o8czchimmmz.cloudfront.net',
            handler: 'CacheFirst',
            options: {
              cacheName: 'beekeeper-word-audio',
              expiration: { maxEntries: 2000, maxAgeSeconds: 90 * 24 * 3600 },
              rangeRequests: true,
            },
          },
          {
            // Groq TTS responses via the edge function: immutable per
            // text+voice, cache aggressively.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('supabase.co') &&
              url.pathname.startsWith('/functions/v1/tts'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'beekeeper-tts',
              expiration: { maxEntries: 500, maxAgeSeconds: 90 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
});
