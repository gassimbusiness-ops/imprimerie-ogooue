/**
 * Harnais de RENDU d'un ecran, dans un vrai DOM.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires etaient verts et l'application est devenue
 * ENTIEREMENT BLANCHE en production : le rendu React etait place derriere
 * quatre `await` d'amorcage, et une exception l'a empeche. Aucun test unitaire
 * ne pouvait le voir, parce qu'aucun ne montait reellement l'interface.
 *
 * `tests/amorcage.test.mjs` verifie depuis ce jour-la le CONTRAT DE SOURCE de
 * main.jsx. C'est necessaire, ce n'est pas suffisant : ca ne dit rien de ce qui
 * se passe quand un ecran monte et que ses effets tournent.
 *
 * Ce harnais monte vraiment l'ecran :
 *   1. esbuild transforme le JSX et resout l'alias `@/` — le meme travail que
 *      Vite fait en production ;
 *   2. les feuilles lourdes ou impures (couche de donnees, session, PDF, toasts)
 *      sont remplacees par des doublures EN PLUS DE la resolution, jamais par
 *      une reecriture du code teste ;
 *   3. jsdom fournit le DOM, React monte pour de vrai, les `useEffect`
 *      s'executent et leurs promesses sont vidangees.
 *
 * Deux verdicts en sortent, et ce sont les deux qui comptent :
 *   - l'ecran a-t-il produit du CONTENU (pas un ecran blanc) ?
 *   - une ECRITURE en base est-elle partie pendant le simple affichage ?
 *     (c'etait le bug de reference C1/C2 : ouvrir un ecran modifiait la base.)
 *
 * Les doublures enregistrent chaque appel : on peut donc aussi affirmer ce qui
 * a ete LU, et avec quelles donnees.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Ajoute l'extension manquante, comme le resolveur de Vite. */
const EXTENSIONS = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js'];
function resoudreFichier(base) {
  for (const ext of EXTENSIONS) {
    const candidat = base + ext;
    if (existsSync(candidat) && !candidat.endsWith('/')) {
      // Un dossier existe aussi sans extension : on ne le retient pas tel quel.
      if (ext === '' && !/\.[a-z]+$/.test(candidat)) continue;
      return candidat;
    }
  }
  return base;
}

/** Collections ecrites/lues par les ecrans. La doublure les expose toutes. */
const COLLECTIONS = [
  'users', 'rapports', 'rapportLignes', 'clients', 'commandes', 'devis', 'factures',
  'produits', 'pointages', 'employes', 'mouvements_stock', 'parametres',
  'clotures_caisse', 'audit_logs', 'paiements_mobile', 'sms_notifications', 'taches',
  'produits_catalogue', 'prospects', 'charges_fixes', 'dettes', 'actionnaires',
  'investissements', 'objectifs', 'demandes_rh', 'projets_travaux', 'etapes_travaux',
  'evenements', 'conversations', 'messages_conv', 'tarifs_clients', 'apports_associes',
  'dettes_associes', 'remboursements_associes', 'investisseurs',
  'modifications_investisseurs', 'performances_employes', 'comptes_bancaires',
  'mouvements_financiers', 'depots_hebdo', 'campagnes_prospection', 'actions_marketing',
  'notifications_app', 'fidelite_clients', 'mockups', 'gouvernance_parametres',
];

/**
 * Doublure de la couche de donnees.
 * Toute ecriture est ENREGISTREE puis executee sur un tableau en memoire : on
 * peut donc affirmer « aucune ecriture pendant l'affichage » sans empecher
 * l'ecran de fonctionner s'il en fait une legitime dans un handler.
 */
function sourceDoublureDb(donnees) {
  return `
const journal = { lectures: [], ecritures: [] };
const tables = ${JSON.stringify(donnees)};
function collection(nom) {
  if (!tables[nom]) tables[nom] = [];
  return {
    async list() { journal.lectures.push(nom); return tables[nom].map((x) => ({ ...x })); },
    async getById(id) { journal.lectures.push(nom); return tables[nom].find((x) => x.id === id) || null; },
    async filter(c) {
      journal.lectures.push(nom);
      return tables[nom].filter((i) => Object.entries(c).every(([k, v]) => i[k] === v));
    },
    async create(d) {
      journal.ecritures.push({ collection: nom, operation: 'create', data: d });
      const item = { id: d.id || (nom + '-' + (tables[nom].length + 1)), ...d };
      tables[nom].push(item); return item;
    },
    async update(id, d) {
      journal.ecritures.push({ collection: nom, operation: 'update', id, data: d });
      const i = tables[nom].findIndex((x) => x.id === id);
      if (i === -1) throw new Error('ligne introuvable');
      tables[nom][i] = { ...tables[nom][i], ...d }; return tables[nom][i];
    },
    async delete(id) {
      journal.ecritures.push({ collection: nom, operation: 'delete', id });
      tables[nom] = tables[nom].filter((x) => x.id !== id); return true;
    },
  };
}
export const db = {};
${COLLECTIONS.map((c) => `db[${JSON.stringify(c)}] = collection(${JSON.stringify(c)});`).join('\n')}
export async function getSettings() { journal.lectures.push('_settings'); return {}; }
export async function saveSettings() { journal.ecritures.push({ collection: '_settings', operation: 'update' }); }
export function clearSettingsCache() {}
export const __journal = journal;
`;
}

const DOUBLURE_SUPABASE = `
export const USE_SUPABASE = false;
export const supabase = null;
`;

function sourceDoublureAuth(utilisateur) {
  return `
import React from 'react';
const U = ${JSON.stringify(utilisateur)};
export function useAuth() {
  return {
    user: U,
    isAdmin: U.role === 'admin',
    isManager: U.role === 'manager',
    isAuthenticated: true,
    loading: false,
    hasPermission: () => true,
    login: async () => ({}),
    logout: async () => {},
    createUser: async (d) => ({ ...d, id: 'nouvel-utilisateur' }),
  };
}
export function AuthProvider({ children }) { return React.createElement(React.Fragment, null, children); }
export default useAuth;
`;
}

const DOUBLURE_TOAST = `
const appels = [];
function faire(niveau) { return (m) => { appels.push({ niveau, message: String(m) }); }; }
export const toast = Object.assign(faire('success'), {
  success: faire('success'), error: faire('error'), info: faire('info'),
  warning: faire('warning'), message: faire('message'), loading: faire('loading'),
  dismiss: () => {}, custom: faire('custom'), promise: () => {},
});
export const Toaster = () => null;
export const __appels = appels;
export default toast;
`;

/** Modules dont on ne veut ni le poids ni les effets de bord dans un test. */
const STUBS_INERTES = {
  '@/services/export-pdf': `
export const exportDocument = () => {}; export const exportCSV = () => {};
export const exportBonTravail = () => {}; export const exportRapportComplet = () => {};
export const exportFacture = () => {}; export const exportDevis = () => {};
export const exportRapportJournalier = () => {}; export const exportListe = () => {};
export default {};
`,
  '@/services/notifications': `
const n = async () => {};
export const notifyNouvelleCommande = n; export const notifyCommandeValidee = n;
export const notifyCommandeProduction = n; export const notifyCommandePrete = n;
export const notifyCommandeLivree = n; export const notifyFactureDisponible = n;
export const notifyTacheAssignee = n; export const notifyRappelOperateur = n;
export const notifyStockAlerte = n; export const notifyRapportSoumis = n;
export const getNotifications = async () => []; export const marquerLu = n;
export const compterNonLues = async () => 0;
`,
  '@/services/audit': `export const logAction = async () => {}; export default {};`,
  '@/services/ai': `
export const askAI = async () => ''; export const chatAI = async () => '';
export default {};
`,
};

/**
 * Compile un ecran et ses dependances en un seul module ESM testable.
 *
 * @param {object} p
 * @param {string} p.ecran chemin du fichier d'ecran, relatif a la racine du depot
 * @param {object} [p.donnees] contenu initial des collections
 * @param {object} [p.utilisateur] utilisateur de session
 * @returns {Promise<{module: object, journal: object, toasts: Array, nettoyer: () => Promise<void>}>}
 */
export async function compilerEcran({ ecran, donnees = {}, utilisateur = {} }) {
  const dossier = await mkdtemp(join(tmpdir(), 'rendu-ecran-'));
  const entree = join(dossier, 'entree.jsx');
  await writeFile(entree, `
export { default as Ecran } from ${JSON.stringify(join(RACINE, ecran))};
export { __journal } from '@/services/db';
export { __appels } from 'sonner';
`);

  const doublures = {
    '@/services/db': sourceDoublureDb(donnees),
    '@/services/supabase': DOUBLURE_SUPABASE,
    '@/services/auth': sourceDoublureAuth({
      id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin', ...utilisateur,
    }),
    sonner: DOUBLURE_TOAST,
    ...STUBS_INERTES,
  };

  const plugin = {
    name: 'doublures',
    setup(b) {
      const noms = Object.keys(doublures);
      const motif = new RegExp(`^(${noms.map((n) => n.replace(/[/@.]/g, '\\$&')).join('|')})$`);
      b.onResolve({ filter: motif }, (args) => ({ path: args.path, namespace: 'doublure' }));
      b.onLoad({ filter: /.*/, namespace: 'doublure' }, (args) => ({
        contents: doublures[args.path], loader: 'js', resolveDir: RACINE,
      }));
      // `@/x` → `<racine>/src/x`, comme le fait vite.config.js. L'extension
      // est resolue ici : le depot importe partout sans extension, et esbuild
      // ne le fait pas pour un chemin qu'un plugin lui rend tout resolu.
      b.onResolve({ filter: /^@\// }, (args) => {
        const base = resolve(RACINE, 'src', args.path.slice(2));
        return { path: resoudreFichier(base) };
      });
    },
  };

  const sortie = join(dossier, 'ecran.mjs');
  await build({
    entryPoints: [entree],
    outfile: sortie,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [plugin],
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    define: { 'process.env.NODE_ENV': '"test"', __APP_BUILD__: '"test"' },
  });

  // Le module n'est PAS importe ici : certaines dependances lisent `window` des
  // leur evaluation. Le DOM doit exister avant. C'est `rendreEcran()` qui
  // enchaine correctement les deux etapes.
  return { sortie, nettoyer: () => rm(dossier, { recursive: true, force: true }) };
}

/**
 * Installe un DOM complet dans les globales de Node et rend de quoi le retirer.
 * @returns {{dom: JSDOM, restaurer: () => void}}
 */
function installerDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="racine"></div></body></html>', {
    url: 'https://exemple.test/', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.scrollTo = () => {};
  w.matchMedia = () => ({
    matches: false, media: '', onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = () => {};
  if (!w.HTMLElement.prototype.hasPointerCapture) {
    w.HTMLElement.prototype.hasPointerCapture = () => false;
    w.HTMLElement.prototype.setPointerCapture = () => {};
    w.HTMLElement.prototype.releasePointerCapture = () => {};
  }

  const globales = {
    window: w, document: w.document, navigator: w.navigator, location: w.location,
    HTMLElement: w.HTMLElement, HTMLInputElement: w.HTMLInputElement,
    Element: w.Element, Node: w.Node, Event: w.Event, CustomEvent: w.CustomEvent,
    MouseEvent: w.MouseEvent, KeyboardEvent: w.KeyboardEvent,
    getComputedStyle: w.getComputedStyle.bind(w), DOMRect: w.DOMRect,
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    matchMedia: w.matchMedia, ResizeObserver: w.ResizeObserver,
    IntersectionObserver: w.IntersectionObserver,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    self: w,
  };
  const anciens = {};
  for (const [cle, valeur] of Object.entries(globales)) {
    anciens[cle] = Object.prototype.hasOwnProperty.call(globalThis, cle)
      ? globalThis[cle] : Symbol.for('absent');
    try { globalThis[cle] = valeur; } catch { /* globale non inscriptible */ }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    dom,
    restaurer() {
      for (const [cle, valeur] of Object.entries(anciens)) {
        try {
          if (valeur === Symbol.for('absent')) delete globalThis[cle];
          else globalThis[cle] = valeur;
        } catch { /* globale non inscriptible */ }
      }
      try { w.close(); } catch { /* deja ferme */ }
    },
  };
}

/**
 * Compile, monte et vidange un ecran. C'est la fonction que les tests appellent.
 *
 * @param {object} p voir compilerEcran
 * @returns {Promise<{texte, html, conteneur, journal, toasts, demonter}>}
 */
export async function rendreEcran(p) {
  const { sortie, nettoyer } = await compilerEcran(p);
  const { restaurer } = installerDom();

  let module;
  try {
    module = await import(pathToFileURL(sortie).href);
  } catch (e) {
    restaurer(); await nettoyer();
    throw e;
  }

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react-dom/test-utils');

  const conteneur = globalThis.document.getElementById('racine');
  let racine;
  const erreurs = [];
  const capturer = (e) => erreurs.push(e?.reason || e?.error || e);
  globalThis.window.addEventListener('unhandledrejection', capturer);
  globalThis.window.addEventListener('error', capturer);

  await act(async () => {
    racine = createRoot(conteneur);
    racine.render(React.createElement(module.Ecran));
  });
  // Plusieurs tours de vidange : les `useEffect` lancent des promesses qui en
  // lancent d'autres (load() -> Promise.all -> setState -> re-rendu).
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  return {
    texte: conteneur.textContent || '',
    html: conteneur.innerHTML || '',
    conteneur,
    journal: module.__journal,
    toasts: module.__appels,
    erreurs,
    React,
    act,
    async demonter() {
      try { await act(async () => { racine.unmount(); }); } catch { /* best effort */ }
      restaurer();
      await nettoyer();
    },
  };
}
