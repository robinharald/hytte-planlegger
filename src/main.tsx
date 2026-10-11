/**
 * Entry point: global styles, persistence (autosave, other tabs, share links in the hash), then the app.
 * The store itself is created (and bootstrapped from link / autosave / seed) when state/appStore is imported.
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
}
