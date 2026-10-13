/**
 * Entry point: global styles, persistence (autosave, other tabs, share links in the hash), then the app.
 * The store itself is created (and bootstrapped from link / autosave / seed) when state/appStore is imported.
 * After the first render, the PDF and IFC libraries are fetched into the service worker's cache in an idle moment
 * (export/warmLazy.ts), so they work offline at the cabin after one online visit.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { startPersistence } from './state/appStore';

startPersistence();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // a small chunk of its own; it waits for an idle moment itself
  void import('./export/warmLazy').then((m) => m.warmLazyChunks(), () => undefined);
}
