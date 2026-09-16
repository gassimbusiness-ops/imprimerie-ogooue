import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import pluginPromesses from "./eslint-rules/promesses.js";

// ════════════════════════════════════════════════════════════════════════════
//  CONFIGURATION ESLINT — IMPRIMERIE OGOOUE
// ════════════════════════════════════════════════════════════════════════════
//
//  AVANT (jusqu'au 2026-09-16) cette configuration ne protegeait presque rien :
//
//    files: ["src/components/**", "src/pages/**", "src/Layout.jsx"]
//              ^ existe          ^ N'EXISTE PAS   ^ N'EXISTE PAS
//
//  soit 7 fichiers reellement soumis a une regle, sur 143. `src/features/**`
//  (52 fichiers, tous les ecrans), `src/services/**` (27 fichiers, toute la
//  couche donnees) et `api/**` n'etaient couverts par RIEN.
//
//  Pire : `"no-unused-vars": "off"`. C'est exactement la regle qui aurait
//  attrape le bug d'inscription client (une variable `existing` jamais
//  declaree dans `src/features/login/page.jsx`, qui jetait un ReferenceError
//  apres la creation du compte et laissait dehors tout client saisissant un
//  code de parrainage). Le garde-fou etait desactive.
//
//  Note technique sur l'ancien fichier : les `...pluginJs.configs.recommended`
//  etaient spread AVANT la cle `rules` finale, donc entierement ecrases.
//  `no-undef` n'etait actif NULLE PART, meme sur les 7 fichiers couverts.
//
//  APRES : `src/**` + `api/**` + `tests/**` + `scripts/**` + les configs
//  racine, chacun avec son environnement (navigateur / Node), et les regles
//  qui attrapent les fautes reellement rencontrees sur ce projet.
//
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regles communes a tout code applicatif, quel que soit l'environnement.
 * Volontairement courtes : un lint rouge en permanence ne protege personne.
 */
const reglesCommunes = {
  // ── Le coeur du garde-fou : ce qui attrape les vrais bugs ───────────────
  //
  // no-undef : variable utilisee mais jamais declaree. C'est LA regle du bug
  // d'inscription. Elle est en `error` et doit le rester.
  "no-undef": "error",

  // Imports morts : bruit pur, corrigeable automatiquement, donc `error`.
  "unused-imports/no-unused-imports": "error",

  // Variables / parametres inutilises : souvent le signe d'un refactor
  // inacheve (un calcul dont on a perdu le consommateur). En `warn` parce
  // qu'un `_` prefixe suffit a lever le doute et que l'erreur bloquerait.
  "no-unused-vars": "off", // remplace par la version du plugin, ci-dessous
  "unused-imports/no-unused-vars": [
    "warn",
    {
      vars: "all",
      varsIgnorePattern: "^_",
      args: "after-used",
      argsIgnorePattern: "^_",
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^_",
    },
  ],

  // ── Promesses : l'ecran blanc du 14/09 venait d'une promesse rejetee ────
  //    non geree au demarrage. Voir eslint-rules/promesses.js.
  //
  //  `warn` et non `error`, en connaissance de cause : le depot compte
  //  ~100 chargements d'ecran non proteges (`useEffect(() => { load(); })`
  //  ou `load` n'a pas de try/catch). Les passer en erreur rendrait le lint
  //  rouge en permanence — l'etat qu'on vient precisement de quitter — et
  //  les corriger tous changerait le comportement de 30 ecrans en un bloc,
  //  ce que cette mission s'interdit. C'est un chantier a part entiere,
  //  ecran par ecran, avec un test par ecran. La regle le rend visible et
  //  denombrable ; c'est deja ce qui manquait.
  "promesses/pas-de-promesse-perdue": "warn",
  "no-async-promise-executor": "error", // un `new Promise(async () => ...)`
                                        // avale silencieusement les rejets
  "no-promise-executor-return": "error",
  "require-atomic-updates": "warn", // `x = await f(x)` sur une variable
                                    // partagee : ecrasement concurrent.
                                    // Bruyante sur les refs React
                                    // (`verrou.current`), d'ou `warn`.

  // ── Identifiants accentues ─────────────────────────────────────────────
  //
  // `scène` vs `scene` a rendu le mode incrustation muet pendant deux jours
  // sans que build ni lint ne voient quoi que ce soit : ce sont deux
  // identifiants VALIDES et DIFFERENTS en JavaScript, et l'oeil ne fait pas
  // la difference dans une diff. On interdit donc l'accent sur les
  // DECLARATIONS (variables, fonctions, parametres, classes).
  //
  // `properties: false` est deliberé : les cles de donnees metier accentuees
  // (payloads Supabase, libelles) sont legitimes et nombreuses. Seul le code
  // qu'on ecrit et qu'on relit est contraint.
  "id-match": [
    "error",
    "^[A-Za-z_$][A-Za-z0-9_$]*$",
    { properties: false, onlyDeclarations: true, ignoreDestructuring: true },
  ],

  // ── Fautes classiques peu couteuses a corriger ─────────────────────────
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-duplicate-case": "error",
  "no-unreachable": "error",
  "no-fallthrough": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-cond-assign": "error",
  "no-sparse-arrays": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "no-import-assign": "error",
  "no-func-assign": "error",
  "no-obj-calls": "error",
  "no-compare-neg-zero": "error",
  "no-empty-pattern": "error",
  "no-ex-assign": "error",
  "no-inner-declarations": "error",
  "no-invalid-regexp": "error",
  "no-misleading-character-class": "error",
  "no-new-native-nonconstructor": "error",
  "no-octal": "error",
  "no-prototype-builtins": "off", // `obj.hasOwnProperty(x)` sur des objets
                                  // litteraux maison : bruit, pas un bug ici
  "no-useless-escape": "warn",
  "no-control-regex": "off", // les regex de nettoyage de saisie utilisent
                             // volontairement \x00-\x1f
  "no-empty": ["warn", { allowEmptyCatch: true }], // un catch vide est un
                                                   // choix assume ici (voir
                                                   // les blocs « confort »)
};

/** Regles React communes aux fichiers d'interface. */
const reglesReact = {
  "react/jsx-uses-vars": "error",
  "react/jsx-uses-react": "error",
  "react/prop-types": "off", // projet en JS pur, pas de PropTypes
  "react/react-in-jsx-scope": "off", // JSX transform automatique (Vite)
  "react/no-unknown-property": [
    "error",
    { ignore: ["cmdk-input-wrapper", "toast-close"] },
  ],
  // Un hook appele conditionnellement casse l'ordre des hooks et produit des
  // etats fantomes. Jamais negociable.
  "react-hooks/rules-of-hooks": "error",
  // Dependances manquantes : cause classique de closure obsolete (un ecran
  // qui affiche des donnees perimees). Trop de cas legitimes pour bloquer,
  // donc `warn` et triage manuel.
  "react-hooks/exhaustive-deps": "warn",
  // Chaines non echappees dans le JSX : purement cosmetique en francais
  // (apostrophes partout), aucun rapport avec un bug.
  "react/no-unescaped-entities": "off",
  // On utilise systematiquement des listes derivees de donnees Supabase avec
  // des cles explicites ; la detection heuristique d'ESLint se trompe.
  "react/display-name": "off",
};

const parserOptionsReact = {
  ecmaVersion: 2022,
  sourceType: "module",
  ecmaFeatures: { jsx: true },
};

export default [
  // ── 1. Ce qu'on ne lint jamais ─────────────────────────────────────────
  {
    ignores: [
      "dist/**", // artefacts de build minifies : 8 fichiers, 0 information
      "node_modules/**",
      "public/**",
      "coverage/**",
      ".tmp-rendu-ecran-*/**", // dossiers temporaires des tests de rendu
      "src/components/ui/**", // shadcn/ui : code genere, non maintenu ici
    ],
  },

  // ── 2. Interface : src/** (navigateur + React) ─────────────────────────
  {
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        // Injecte a la compilation par `define` dans vite.config.js (ligne 8).
        // Sans cette declaration, `no-undef` le signale a tort : il n'existe
        // pas dans le source, seulement dans le bundle.
        __APP_BUILD__: "readonly",
      },
      parserOptions: parserOptionsReact,
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
      promesses: pluginPromesses,
    },
    rules: { ...reglesCommunes, ...reglesReact },
  },

  // ── 2 bis. src/lib/singpayAuth.js tourne cote serveur ──────────────────
  //  Ce module est importe par api/singpay-*.js et lit `process.env`. Il est
  //  physiquement dans src/ mais son environnement est Node.
  {
    files: ["src/lib/singpayAuth.js"],
    languageOptions: { globals: { ...globals.node } },
  },

  // ── 3. Fonctions serverless : api/** (Node) ────────────────────────────
  {
    files: ["api/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "unused-imports": pluginUnusedImports,
      promesses: pluginPromesses,
    },
    rules: reglesCommunes,
  },

  // ── 4. Tests : tests/** (Node + node:test) ─────────────────────────────
  //  Environnement Node, pas navigateur. Les tests instancient jsdom quand
  //  ils ont besoin d'un DOM : `globals.browser` ici masquerait justement les
  //  oublis d'instanciation.
  {
    files: ["tests/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "unused-imports": pluginUnusedImports,
      promesses: pluginPromesses,
    },
    rules: {
      ...reglesCommunes,
      // Dans un test, `assert.throws(() => obj.methode())` ou une expression
      // isolee sert de verification : pas de faux positif a chasser ici.
      "no-unused-expressions": "off",

      // BRUIT PUR, desactive sciemment : `await new Promise((r) => setTimeout(r, 5))`
      // est LA facon d'ecrire une pause en test. `setTimeout` renvoie un
      // identifiant de minuterie, donc l'executeur « retourne une valeur » et
      // la regle proteste — 12 fois, toutes dans des pauses de test, zero bug.
      // Le seul vrai danger de cette famille (`new Promise(async ...)`) reste
      // couvert par `no-async-promise-executor`, qui lui est actif partout.
      "no-promise-executor-return": "off",
    },
  },

  // ── 5. Scripts utilitaires : scripts/** (Node) ─────────────────────────
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "unused-imports": pluginUnusedImports,
      promesses: pluginPromesses,
    },
    rules: {
      ...reglesCommunes,
      "no-console": "off", // un script CLI parle dans le terminal
    },
  },

  // ── 6. Configuration racine (Node) ─────────────────────────────────────
  {
    files: ["*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "unused-imports": pluginUnusedImports,
      promesses: pluginPromesses,
    },
    rules: reglesCommunes,
  },
];

// Reference conservee : `pluginJs.configs.recommended` n'est volontairement
// plus spread. Les regles utiles ont ete reprises une par une ci-dessus, avec
// la raison de chaque desactivation ecrite a cote. Une regle desactivee sans
// explication est une regle qu'on reactivera par erreur dans six mois.
void pluginJs;
