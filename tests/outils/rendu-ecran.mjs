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
import { existsSync, readFileSync } from 'node:fs';
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
  'messages_meta', 'bot_journal', 'bot_controle',
];

/**
 * Doublure de la couche de donnees.
 * Toute ecriture est ENREGISTREE puis executee sur un tableau en memoire : on
 * peut donc affirmer « aucune ecriture pendant l'affichage » sans empecher
 * l'ecran de fonctionner s'il en fait une legitime dans un handler.
 */
function sourceDoublureDb(donnees, echecsLecture = [], echecsEcriture = []) {
  return `
const journal = { lectures: [], ecritures: [] };
const tables = ${JSON.stringify(donnees)};
// Collections dont la LECTURE echoue — la coupure reseau de Moanda, simulee.
const ECHECS_LECTURE = new Set(${JSON.stringify(echecsLecture)});
// Collections dont l'ECRITURE echoue — le cas le plus couteux : l'utilisateur
// croit avoir enregistre.
const ECHECS_ECRITURE = new Set(${JSON.stringify(echecsEcriture)});
class ErreurLectureSimulee extends Error {
  constructor(nom) {
    super("Impossible de charger « " + nom + " ». La connexion n'a pas répondu — rien n'a été effacé. Vérifiez la connexion, puis réessayez.");
    this.name = 'ErreurLecture';
    this.collection = nom;
    this.estErreurLecture = true;
  }
}
class ErreurEcritureSimulee extends Error {
  constructor(nom, operation) {
    super("L'écriture de « " + nom + " » n'a PAS été enregistrée. Vérifiez votre connexion et recommencez : rien n'a été modifié.");
    this.name = 'ErreurEcriture';
    this.collection = nom;
    this.operation = operation;
    this.estErreurEcriture = true;
  }
}
function collection(nom) {
  if (!tables[nom]) tables[nom] = [];
  return {
    async list() {
      journal.lectures.push(nom);
      // Comme la vraie \`list()\` : elle N'ECHOUE JAMAIS, elle rend [].
      if (ECHECS_LECTURE.has(nom)) return [];
      return tables[nom].map((x) => ({ ...x }));
    },
    async listOuLeve() {
      journal.lectures.push(nom);
      if (ECHECS_LECTURE.has(nom)) throw new ErreurLectureSimulee(nom);
      return tables[nom].map((x) => ({ ...x }));
    },
    async getById(id) { journal.lectures.push(nom); return tables[nom].find((x) => x.id === id) || null; },
    async filter(c) {
      journal.lectures.push(nom);
      if (ECHECS_LECTURE.has(nom)) return [];
      return tables[nom].filter((i) => Object.entries(c).every(([k, v]) => i[k] === v));
    },
    async filterOuLeve(c) {
      journal.lectures.push(nom);
      if (ECHECS_LECTURE.has(nom)) throw new ErreurLectureSimulee(nom);
      return tables[nom].filter((i) => Object.entries(c).every(([k, v]) => i[k] === v));
    },
    async create(d) {
      journal.ecritures.push({ collection: nom, operation: 'create', data: d });
      if (ECHECS_ECRITURE.has(nom)) throw new ErreurEcritureSimulee(nom, 'create');
      const item = { id: d.id || (nom + '-' + (tables[nom].length + 1)), ...d };
      tables[nom].push(item); return item;
    },
    async update(id, d) {
      journal.ecritures.push({ collection: nom, operation: 'update', id, data: d });
      if (ECHECS_ECRITURE.has(nom)) throw new ErreurEcritureSimulee(nom, 'update');
      const i = tables[nom].findIndex((x) => x.id === id);
      if (i === -1) throw new Error('ligne introuvable');
      tables[nom][i] = { ...tables[nom][i], ...d }; return tables[nom][i];
    },
    async delete(id) {
      journal.ecritures.push({ collection: nom, operation: 'delete', id });
      if (ECHECS_ECRITURE.has(nom)) throw new ErreurEcritureSimulee(nom, 'delete');
      tables[nom] = tables[nom].filter((x) => x.id !== id); return true;
    },
  };
}
export const db = {};
${COLLECTIONS.map((c) => `db[${JSON.stringify(c)}] = collection(${JSON.stringify(c)});`).join('\n')}
/**
 * Doublure de la lecture PROJETEE. Elle projette pour de vrai : un ecran qui
 * lirait un champ non demande le trouverait absent ici comme en production,
 * au lieu de passer parce que la doublure est plus genereuse.
 */
export async function lireLignesMarquees({ collections, marqueur, champs }) {
  const sortie = [];
  for (const collection of collections) {
    journal.lectures.push(collection);
    if (ECHECS_LECTURE.has(collection)) throw new ErreurLectureSimulee(collection);
    for (const l of tables[collection] || []) {
      if (!l || !l[marqueur]) continue;
      const projete = { id: l.id };
      for (const c of champs) projete[c] = l[c];
      sortie.push({ collection, data: projete });
    }
  }
  return sortie;
}
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

/**
 * Un champ passe a `undefined` est RETIRE de l'utilisateur de session.
 *
 * Sans cela, un test ne pouvait pas exprimer « ce champ n'existe pas » : les
 * valeurs par defaut du harnais (`prenom: 'Gassim'`) le remplissaient toujours,
 * et `JSON.stringify` efface un `undefined` explicite. Or c'est exactement la
 * forme de production : les 14 lignes de `clients` relevees le 18/09/2026 n'ont
 * AUCUN champ `prenom`. Un test qui ne sait pas reproduire cette forme passe au
 * vert sans rien prouver.
 */
function retirerChampsAbsents(objet) {
  const copie = { ...objet };
  for (const [cle, valeur] of Object.entries(copie)) {
    if (valeur === undefined) delete copie[cle];
  }
  return copie;
}

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

/**
 * Fabrique une doublure INERTE d'un module du depot, en reprenant EXACTEMENT
 * sa liste d'exports.
 *
 * Ecrire la liste a la main condamnait le harnais a casser des qu'un ecran
 * importe une fonction de plus (« No matching export in export-pdf.js for
 * import printHTML »). On lit donc la source et on rend un no-op par export :
 * la doublure suit le depot toute seule.
 *
 * On ne remplace ainsi que des FEUILLES : PDF, notifications, journal d'audit,
 * appels IA. Rien de ce qui est teste n'est reecrit.
 */
function doublureInerte(cheminRelatif) {
  const chemin = resoudreFichier(resolve(RACINE, cheminRelatif));
  const src = existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
  const noms = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) {
    noms.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const brut of m[1].split(',')) {
      const nom = brut.trim().split(/\s+as\s+/).pop().trim();
      if (nom && /^[A-Za-z0-9_$]+$/.test(nom)) noms.add(nom);
    }
  }
  const lignes = [...noms].map(
    (n) => `export const ${n} = (...a) => { __inerte.push([${JSON.stringify(cheminRelatif)}, ${JSON.stringify(n)}, a]); return undefined; };`,
  );
  return `const __inerte = (globalThis.__appelsInertes ||= []);\n${lignes.join('\n')}\nexport default {};\n`;
}

/** Feuilles remplacees par des doublures inertes. */
const FEUILLES_INERTES = [
  'src/services/export-pdf',
  'src/services/notifications',
  'src/services/audit',
  'src/services/ai',
];

/**
 * Compile un ecran et ses dependances en un seul module ESM testable.
 *
 * @param {object} p
 * @param {string} p.ecran chemin du fichier d'ecran, relatif a la racine du depot
 * @param {object} [p.donnees] contenu initial des collections
 * @param {object} [p.utilisateur] utilisateur de session
 * @param {string[]} [p.echecsLecture] collections dont la lecture echoue (coupure reseau)
 * @param {string[]} [p.echecsEcriture] collections dont l'ecriture echoue
 * @returns {Promise<{module: object, journal: object, toasts: Array, nettoyer: () => Promise<void>}>}
 */
export async function compilerEcran({
  ecran, donnees = {}, utilisateur = {}, echecsLecture = [], echecsEcriture = [],
}) {
  // Le dossier de build vit DANS le depot (et pas dans /tmp) pour que Node
  // resolve `react` / `react-dom` en remontant jusqu'a ./node_modules. React
  // doit etre partage entre le bundle et le test, sinon deux instances
  // coexistent et les hooks ne trouvent pas leur dispatcher.
  const dossier = await mkdtemp(join(RACINE, '.tmp-rendu-ecran-'));
  const entree = join(dossier, 'entree.jsx');
  // `MemoryRouter` est exporte DEPUIS LE BUNDLE, et pas importe cote test :
  // react-router-dom est bundle avec l'ecran, si bien qu'un routeur importe
  // separement serait une autre instance du module — son contexte ne serait
  // pas celui que lisent les `<Link>` de l'ecran, et le montage echouerait sur
  // « Cannot destructure property 'basename' of useContext(...) as it is null ».
  await writeFile(entree, `
export { default as Ecran } from ${JSON.stringify(join(RACINE, ecran))};
export { __journal } from '@/services/db';
export { __appels } from 'sonner';
export { MemoryRouter } from 'react-router-dom';
`);

  // Les doublures de MODULES DU DEPOT sont posees par chemin ABSOLU, apres
  // resolution : le meme fichier est importe tantot en `@/services/db`, tantot
  // en `./db`. Filtrer sur la chaine d'import en raterait la moitie.
  const parChemin = new Map([
    [resoudreFichier(resolve(RACINE, 'src/services/db')),
      sourceDoublureDb(donnees, echecsLecture, echecsEcriture)],
    [resoudreFichier(resolve(RACINE, 'src/services/supabase')), DOUBLURE_SUPABASE],
    [resoudreFichier(resolve(RACINE, 'src/services/auth')), sourceDoublureAuth(
      retirerChampsAbsents({
        id: 'u-admin', prenom: 'Gassim', nom: 'Admin', role: 'admin', ...utilisateur,
      }),
    )],
    ...FEUILLES_INERTES.map((f) => [resoudreFichier(resolve(RACINE, f)), doublureInerte(f)]),
  ]);

  const plugin = {
    name: 'doublures',
    setup(b) {
      // `sonner` est un paquet : on l'intercepte par son nom.
      b.onResolve({ filter: /^sonner$/ }, (args) => ({ path: args.path, namespace: 'doublure' }));
      b.onLoad({ filter: /.*/, namespace: 'doublure' }, () => ({
        contents: DOUBLURE_TOAST, loader: 'js', resolveDir: RACINE,
      }));
      // `@/x` → `<racine>/src/x`, comme le fait vite.config.js. L'extension est
      // resolue ici : le depot importe sans extension, et esbuild ne complete
      // pas un chemin qu'un plugin lui rend deja absolu.
      b.onResolve({ filter: /^@\// }, (args) => ({
        path: resoudreFichier(resolve(RACINE, 'src', args.path.slice(2))),
      }));
      // Substitution par chemin absolu, quelle que soit l'orthographe d'import.
      b.onLoad({ filter: /\.(js|jsx)$/ }, (args) => {
        const remplacement = parChemin.get(args.path);
        if (!remplacement) return null;
        return { contents: remplacement, loader: 'jsx', resolveDir: RACINE };
      });
    },
  };

  const sortie = join(dossier, 'ecran.mjs');
  await build({
    entryPoints: [entree],
    outfile: sortie,
    bundle: true,
    format: 'esm',
    // React reste EXTERNE : une seule instance pour le bundle et pour le test.
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    platform: 'browser',
    jsx: 'automatic',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [plugin],
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    define: {
      'process.env.NODE_ENV': '"test"',
      __APP_BUILD__: '"test"',
      // Vite remplace `import.meta.env` a la compilation ; esbuild ne le fait
      // pas tout seul, et plusieurs modules le lisent au chargement.
      'import.meta.env': JSON.stringify({
        MODE: 'test', DEV: false, PROD: false, BASE_URL: '/',
        VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '',
      }),
    },
  });

  // Le module n'est PAS importe ici : certaines dependances lisent `window` des
  // leur evaluation. Le DOM doit exister avant. C'est `rendreEcran()` qui
  // enchaine correctement les deux etapes.
  return { sortie, nettoyer: () => rm(dossier, { recursive: true, force: true }) };
}

/**
 * Texte REELLEMENT affiche a l'instant present.
 *
 * ⚠️ Lecon du 16/09/2026 : `v.texte` est un instantane pris au montage. Six
 * tests avaient « verifie » un ecran jamais affiche parce qu'ils relisaient cet
 * instantane apres un clic. Apres toute interaction, passer par ici.
 *
 * @param {{conteneur: Element}} v le resultat de `rendreEcran`
 * @returns {string}
 */
export function texteVivant(v) {
  return v.conteneur.textContent || '';
}

/**
 * Installe un DOM complet dans les globales de Node.
 *
 * ⚠️ UN SEUL DOM PAR PROCESSUS, cree a la premiere demande et reutilise ensuite.
 *
 * Ce n'est pas une optimisation. En developpement, `react-dom` fabrique a son
 * CHARGEMENT un noeud technique (`invokeGuardedCallbackDev`) attache au
 * document du moment, et s'en sert pour propager les erreurs de rendu. Si un
 * second jsdom remplace le premier, ce noeud appartient a l'ancien document et
 * React echoue avec « Failed to execute 'dispatchEvent' on 'EventTarget' » —
 * une panne du HARNAIS, qui ressemble a s'y meprendre a une panne de l'ECRAN.
 *
 * L'isolement entre tests est assure autrement : chaque appel recompile son
 * propre bundle, avec sa propre doublure de base de donnees et son propre
 * journal. Ce qui est partage, c'est le DOM — remis a zero a chaque montage.
 *
 * @returns {{dom: JSDOM, restaurer: () => void}}
 */
let domPartage = null;

function installerDom() {
  if (domPartage) {
    // Remise a zero : conteneur vide, stockage vide, aucun etat de test passe.
    const w = domPartage.window;
    try { w.localStorage.clear(); w.sessionStorage.clear(); } catch { /* indisponible */ }
    w.document.body.innerHTML = '<div id="racine"></div>';
    return { dom: domPartage, restaurer() { w.document.body.innerHTML = '<div id="racine"></div>'; } };
  }

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
    DocumentFragment: w.DocumentFragment, HTMLDocument: w.HTMLDocument,
    SVGElement: w.SVGElement, Text: w.Text, Range: w.Range,
    MutationObserver: w.MutationObserver, FileReader: w.FileReader,
    Blob: w.Blob, File: w.File, FormData: w.FormData, URL: w.URL,
    HTMLFormElement: w.HTMLFormElement, HTMLButtonElement: w.HTMLButtonElement,
    HTMLTextAreaElement: w.HTMLTextAreaElement, HTMLSelectElement: w.HTMLSelectElement,
    PointerEvent: w.PointerEvent || w.MouseEvent, TouchEvent: w.TouchEvent,
  };
  // Toutes les interfaces DOM exposees par jsdom (NodeFilter, DocumentFragment,
  // TreeWalker…). Les enumerer plutot que les lister a la main : le premier
  // oubli se manifeste par un « X is not defined » DANS un effet React, c'est-
  // a-dire par un ecran blanc — exactement le symptome qu'on cherche a
  // detecter. Un harnais qui produit lui-meme de faux ecrans blancs ne sert
  // a rien.
  for (const nom of Object.getOwnPropertyNames(w)) {
    if (!/^[A-Z]/.test(nom)) continue;
    if (nom in globales) continue;
    if (globalThis[nom] !== undefined) continue;
    globales[nom] = w[nom];
  }

  const anciens = {};
  for (const [cle, valeur] of Object.entries(globales)) {
    anciens[cle] = Object.prototype.hasOwnProperty.call(globalThis, cle)
      ? globalThis[cle] : Symbol.for('absent');
    try { globalThis[cle] = valeur; } catch { /* globale non inscriptible */ }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  domPartage = dom;
  // Les globales ne sont PAS restaurees : le DOM vit tout le processus de test.
  // `anciens` n'est conserve que pour le diagnostic.
  void anciens;
  return {
    dom,
    restaurer() { w.document.body.innerHTML = '<div id="racine"></div>'; },
  };
}

/**
 * Compile, monte et vidange un ecran. C'est la fonction que les tests appellent.
 *
 * @param {object} p voir compilerEcran, plus `routeur` (enveloppe l'ecran dans
 *   un MemoryRouter, necessaire des que l'ecran rend un `<Link>`) et
 *   `proprietes` (props passees au composant monte).
 *
 *   `proprietes` sert aux composants qui ne sont pas des ecrans de route mais
 *   des FORMULAIRES appeles avec des props — `RapportForm({ rapport, onSave })`
 *   par exemple. Sans elle, le seul moyen d'atteindre un tel formulaire serait
 *   de piloter l'ecran parent au travers de ses menus Radix, qui se testent
 *   mal dans jsdom : le formulaire de saisie des ventes resterait sans test,
 *   et c'est celui par lequel passe chaque franc encaisse au comptoir.
 *
 *   Les props sont passees a l'execution, pas serialisees : un `onSave` peut
 *   donc etre une vraie fonction, et le test observe ce que le formulaire lui
 *   a REELLEMENT transmis.
 * @returns {Promise<{texte, html, conteneur, journal, toasts, demonter}>}
 */
export async function rendreEcran(p) {
  const { sortie, nettoyer } = await compilerEcran(p);
  // Les rejets attrapes par les ecrans ne doivent pas faire echouer le test :
  // seuls les rejets NON rattrapes sont collectes plus bas.
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
  // `React.act` depuis React 18.3 ; `react-dom/test-utils` en repli.
  const act = React.act || (await import('react-dom/test-utils')).act;

  const conteneur = globalThis.document.getElementById('racine');
  let racine;
  const erreurs = [];
  const capturer = (e) => erreurs.push(e?.reason || e?.error || e);
  globalThis.window.addEventListener('unhandledrejection', capturer);
  globalThis.window.addEventListener('error', capturer);

  // Les ecrans qui contiennent des `<Link>` ont besoin d'un routeur : sans lui,
  // le montage echoue au premier lien rendu. On n'enveloppe QUE sur demande
  // (`routeur: true`), pour ne rien changer aux tests deja ecrits.
  // `entreesRouteur` : l'adresse depuis laquelle on monte. Indispensable pour
  // tester une GARDE DE ROUTE — « un employe qui tape /associe » n'a de sens
  // qu'a partir d'une URL. Absent, le routeur demarre a « / » comme avant.
  const contenu = React.createElement(module.Ecran, p.proprietes || null);
  const element = p.routeur
    ? React.createElement(
      module.MemoryRouter,
      p.entreesRouteur ? { initialEntries: p.entreesRouteur } : null,
      contenu,
    )
    : contenu;

  await act(async () => {
    racine = createRoot(conteneur);
    racine.render(element);
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
