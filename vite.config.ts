/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';

/*
 * Relative base: the same build works on GitHub Pages (https://robinharald.github.io/hytte-planlegger/), in
 * `vite preview` (http://localhost:4173/) and in any folder; `npm run dev` serves at '/'. The service worker follows it:
 * it is registered as ./sw.js with scope ./ (so /hytte-planlegger/ on Pages), and the manifest's scope is ./ too.
 *
 * PWA (docs/phase2-plan.md §5): registerType 'prompt' + injectRegister false — src/ui/UpdateToast.tsx registers the
 * worker with `useRegisterSW` and asks before an update ("Ny versjon av appen er klar. [Oppdater]"); nothing reloads
 * by itself. Everything the app needs offline is precached (globPatterns: the JS chunks incl. the lazy Firebase one,
 * CSS, index.html, fonts, icons, the manifest), navigations fall back to index.html, and old caches are cleaned up.
 * The manifest has no start_url on purpose: it then defaults to the page the app was added from, which keeps
 * #f=<family> — a home-screen app on iOS has its own storage and would otherwise not know the family.
 * No service worker in `npm run dev` (devOptions off), so the dev server and its e2e projects are unaffected.
 */
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // The icons are precached by globPatterns already (no duplicate entries).
      includeManifestIcons: false,
      manifest: {
        name: 'Hytteplanlegger – Merkesvatnet',
        short_name: 'Hytteplanlegger',
        description: '2D/3D-planlegger for utvidelsen av hytta ved Merkesvatnet (Forslag D).',
        lang: 'nb',
        dir: 'ltr',
        start_url: undefined,
        scope: './',
        display: 'standalone',
        background_color: '#eef0ea',
        theme_color: '#4f6b55',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // The main chunk (three.js, the terrain) is well over workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // The plugin's virtual register module does not load in Vitest: a stand-in that registers nothing.
    alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/ui/UpdateToast.stub.ts', import.meta.url)) },
  },
});
