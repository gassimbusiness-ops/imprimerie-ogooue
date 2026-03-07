import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './services/auth';
import App from './app';
import './index.css';
import { seedDatabase } from './services/seed';
import { loadImportedData } from './services/import-loader';
import { seedPapeterieProject, seedInventaire } from './utils/seed-data';
import { registerSW } from 'virtual:pwa-register';

// ── PWA — auto-update strategy ──
// Checks for new SW every 60s + on app resume (visibilitychange).
// When a new build is deployed on Vercel, the SW detects the change,
// activates immediately (skipWaiting + clientsClaim), and reloads the page.
const UPDATE_INTERVAL_MS = 60 * 1000; // 60 seconds

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (!registration) return;

    // Periodic check — catches updates even if the user never navigates
    setInterval(() => {
      if (!navigator.onLine) return;
      registration.update();
    }, UPDATE_INTERVAL_MS);

    // Check on app resume (user switches back from another app / tab)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) {
        registration.update();
      }
    });

    console.log(`[IO] PWA enregistrée — vérification auto toutes les ${UPDATE_INTERVAL_MS / 1000}s (build: ${typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev'})`);
  },
  onRegisterError(error) {
    console.error('[IO] Erreur enregistrement PWA:', error);
  },
});

// ── App init ──

async function init() {
  // Seed + import (idempotent — skips if data exists)
  await seedDatabase();
  await loadImportedData();
  await seedPapeterieProject();
  await seedInventaire();

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
}

init();
