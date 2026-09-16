import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './services/auth';
import App from './app';
import './index.css';
import { seedDatabase } from './services/seed';
import { loadImportedData } from './services/import-loader';
import { seedPapeterieProject, seedInventaire } from './utils/seed-data';
import { installerFiletEcriture } from './services/filet-ecriture';
import { toast } from 'sonner';
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

/**
 * ⚠️ CHAQUE ETAPE D AMORCAGE EST ISOLEE. NE PAS REVENIR A UNE SUITE DE `await` NUS.
 *
 * Le 14/09/2026, le deploiement du verrou de session a rendu l application
 * ENTIEREMENT BLANCHE en production. La chaine exacte :
 *   seedDatabase() -> db.employes.create() -> POST /api/employes -> 401 (pas de
 *   session avant la connexion) -> `throw new Error('Creation refusee')`
 *   -> init() rejette -> ReactDOM.render() n est JAMAIS appele -> ecran blanc.
 *
 * La faute n est pas le 401 : c est que le rendu de l interface etait place
 * DERRIERE quatre `await` d amorcage. N importe quel echec — reseau coupe a
 * Moanda, base indisponible, permission refusee — suffisait a effacer
 * l application pour tout le monde.
 *
 * Regle : l interface s affiche TOUJOURS. L amorcage est un confort, pas une
 * condition. Un echec d amorcage se voit dans la console, jamais a la place de
 * l application.
 */
async function init() {
  // Filet global des echecs d'ecriture (constat C6). Pose AVANT l'amorcage pour
  // couvrir aussi les ecritures du seed. Ne leve jamais : voir filet-ecriture.js.
  try {
    installerFiletEcriture((message) => toast.error(message, { duration: 8000 }));
  } catch (e) {
    console.error('[init] filet d ecriture non pose :', e?.message || e);
  }

  const etapes = [
    ['seedDatabase', seedDatabase],
    ['loadImportedData', loadImportedData],
    ['seedPapeterieProject', seedPapeterieProject],
    ['seedInventaire', seedInventaire],
  ];

  for (const [nom, etape] of etapes) {
    try {
      await etape();
    } catch (e) {
      console.error(`[init] etape « ${nom} » ignoree :`, e?.message || e);
    }
  }

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
