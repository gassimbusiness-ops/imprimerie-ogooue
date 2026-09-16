/**
 * L'ECRAN MOCKUPS, MONTE POUR DE VRAI.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Le 14/09/2026, 112 tests unitaires etaient verts et l'application est devenue
 * ENTIEREMENT BLANCHE en production : aucun test ne montait un ecran.
 * `tests/outils/rendu-ecran.mjs` existe depuis pour ca, et cet ecran-ci n'y
 * etait pas encore passe — alors qu'il vient d'etre modifie en profondeur et
 * que PERSONNE ne l'a encore ouvert a l'oeil.
 *
 * Trois verdicts, les memes que pour les autres ecrans :
 *   1. l'ecran produit du CONTENU (pas un ecran blanc) ;
 *   2. AUCUNE ECRITURE en base pendant le simple affichage ;
 *   3. aucune exception ni rejet non rattrape pendant le montage.
 *
 * Et deux verdicts propres a la decision du 16/09/2026 :
 *   4. un bloc de texte vide est refuse A L'ECRAN, avec son message ;
 *   5. un numero saisi s'affiche verbatim a cote de l'apercu, et n'apparait
 *      JAMAIS dans le prompt qui part au modele.
 *
 * ⚠️ Ce que ce fichier ne prouve PAS : que l'apercu est beau. jsdom ne peint
 * rien. Il prouve que l'ecran vit, qu'il n'ecrit pas, et que le texte reste du
 * cote de l'application.
 *
 * Lancer :  node --test tests/rendu-ecran-mockup.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ─────────────────────────────────────────────────────────────────────────────
   Doublure d'<img>, posee AVANT le premier montage.

   `installerDom()` n'ecrase pas une globale deja definie. On en profite : sans
   ca, jsdom ne charge aucune ressource et ne declenche NI `onload` NI
   `onerror`. L'ecran resterait alors bloque sur sa recherche de photo jusqu'au
   delai de secours (6 s), et chaque test trainerait ces 6 secondes.

   Ici, toute image repond « illisible » au tour suivant : c'est exactement
   l'etat d'un poste sans photothèque, celui du magasin aujourd'hui.
   ───────────────────────────────────────────────────────────────────────────── */
class ImageDoublure {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.crossOrigin = null;
  }

  set src(v) {
    this._src = v;
    setTimeout(() => {
      if (typeof this.onerror === 'function') this.onerror(new Error('aucun reseau en test'));
    }, 0);
  }

  get src() { return this._src; }
}
if (globalThis.Image === undefined) globalThis.Image = ImageDoublure;

const { rendreEcran } = await import('./outils/rendu-ecran.mjs');

const ECRAN = 'src/features/mockup-ia/page.jsx';

/** Quelques devis/commandes, pour que le selecteur de rattachement ait a lire. */
const BASE = {
  devis: [{ id: 'd-1', numero: 'DEV-001', client_nom: 'Mairie de Moanda' }],
  commandes: [{ id: 'c-1', numero: 'CMD-REEL1', client_nom: 'BACOREF' }],
  mockups: [],
};

/* ── Petits outils d'interaction ──────────────────────────────────────────── */

function bouton(conteneur, texte) {
  const tous = [...conteneur.querySelectorAll('button')];
  return tous.find((b) => (b.textContent || '').trim() === texte)
    || tous.find((b) => (b.textContent || '').includes(texte));
}

async function cliquer(v, element) {
  await v.act(async () => {
    element.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/**
 * Saisit dans un champ controle par React.
 * Poser `element.value` ne suffit pas : React memorise la derniere valeur qu'il
 * a ecrite et ignore l'evenement si elle n'a pas change. Il faut passer par le
 * setter natif du prototype.
 */
async function saisir(v, element, valeur) {
  const proto = element.tagName === 'TEXTAREA'
    ? globalThis.HTMLTextAreaElement.prototype
    : globalThis.HTMLInputElement.prototype;
  const poser = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await v.act(async () => {
    poser.call(element, valeur);
    element.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
  await v.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. L'ECRAN VIT
   ═══════════════════════════════════════════════════════════════════════════ */

test('Mockups — l ecran s affiche, avec du contenu et sans exception', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.ok(v.texte.length > 200, `écran quasi vide (${v.texte.length} caractères) : écran blanc`);
    assert.match(v.texte, /Mockups/);
    assert.match(v.texte, /Configuration/);
    assert.match(v.texte, /Aperçu/);
    // La frontiere d'erreur a-t-elle pris la main ? Si oui, l'ecran affiche sa
    // panne au lieu de son contenu — ce n'est pas un ecran blanc, mais ce n'est
    // pas un ecran qui marche non plus.
    assert.doesNotMatch(v.texte, /a rencontre une erreur/i, 'la frontiere d\'erreur a capture une exception');
    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant le montage');
  } finally { await v.demonter(); }
});

test('Mockups — AUCUNE ecriture en base pendant le simple affichage', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.deepEqual(
      v.journal.ecritures, [],
      'consulter l’écran Mockups écrit en base — c’est le bug de référence C1/C2',
    );
    // Il doit tout de meme lire : les devis et commandes du rattachement.
    assert.ok(v.journal.lectures.includes('devis'), 'l’écran doit lire les devis');
    assert.ok(v.journal.lectures.includes('commandes'), 'l’écran doit lire les commandes');
  } finally { await v.demonter(); }
});

test('Mockups — le catalogue reel est propose, et rien d invente', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.match(v.texte, /T-shirt adulte/);
    assert.match(v.texte, /Blanc/);
    // Rouge, jaune et gris ne sont en stock sur aucun support : ils ne doivent
    // apparaitre dans aucun choix de coloris.
    const coloris = [...v.conteneur.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim());
    assert.ok(!coloris.includes('Rouge'), 'un coloris hors stock est propose');
    assert.ok(!coloris.includes('Gris'), 'un coloris hors stock est propose');
  } finally { await v.demonter(); }
});

test('Mockups — sans photo de support, l ecran dit quoi faire (jamais un vide muet)', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    assert.match(v.texte, /photothèque/i, 'l’écran doit dire où déposer la photo du support');
    assert.match(v.texte, /Aucune scène/i, 'l’absence d’aperçu doit être annoncée');
  } finally { await v.demonter(); }
});

test('Mockups — l ecran annonce que le texte est compose par l application', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    // La regle du 16/09 doit etre LISIBLE par le gerant, pas seulement vraie
    // dans le code : c'est elle qui lui dit ou regarder en cas de doute.
    assert.match(
      v.texte, /ne partent PAS au mod[eè]le/i,
      'l’écran doit dire que les blocs de texte ne partent pas au modèle',
    );
    assert.match(
      v.texte, /dessines par l'application|dessinés par l’application/i,
      'l’écran doit dire qui dessine le texte',
    );
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. UN BLOC DE TEXTE VIDE EST REFUSE, A L'ECRAN
   ═══════════════════════════════════════════════════════════════════════════ */

test('Mockups — ajouter un bloc et le laisser vide affiche le refus', async () => {
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    const ajouter = bouton(v.conteneur, 'Ajouter un texte');
    assert.ok(ajouter, 'le bouton « Ajouter un texte » est introuvable');

    await cliquer(v, ajouter);

    const texte = v.conteneur.textContent || '';
    assert.match(texte, /Bloc 1/, 'le bloc ajouté ne s’affiche pas');
    assert.match(
      texte, /bloc de texte n°1 est vide/i,
      'un bloc vide doit être refusé A L’ECRAN, avec son message — pas ignoré en silence',
    );
    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant l’interaction');
  } finally { await v.demonter(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE TEXTE SAISI S'AFFICHE VERBATIM — ET NE PART JAMAIS AU MODELE
   ═══════════════════════════════════════════════════════════════════════════ */

test('Mockups — le numero saisi s affiche verbatim et reste hors du prompt', async () => {
  const NUMERO = '060 44 46 34';
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await cliquer(v, bouton(v.conteneur, 'Ajouter un texte'));

    const champ = v.conteneur.querySelector('input[maxlength="60"]');
    assert.ok(champ, 'le champ de saisie du bloc de texte est introuvable');
    await saisir(v, champ, NUMERO);

    const texte = v.conteneur.textContent || '';
    // 1. Le refus « bloc vide » doit avoir disparu.
    assert.doesNotMatch(texte, /est vide/i, 'le bloc est renseigné, le refus doit tomber');
    // 2. La saisie est affichee telle quelle, pour la comparaison caractere a
    //    caractere. C'est contre CE bloc que l'apercu se relit.
    assert.ok(texte.includes(NUMERO), 'la saisie verbatim n’est pas affichée');

    // 3. ⛔ Le prompt qui part au modele ne doit rien en savoir.
    const prompt = v.conteneur.querySelector('textarea');
    assert.ok(prompt, 'la zone de prompt est introuvable');
    assert.ok(
      !prompt.value.includes(NUMERO) && !/060/.test(prompt.value),
      `le numéro s’est retrouvé dans le prompt envoyé au modèle : ${prompt.value.slice(0, 200)}`,
    );
    assert.match(
      prompt.value, /Do not write, add, invent or letter ANY text/,
      'le prompt doit porter la consigne « n’écris aucun texte »',
    );

    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant l’interaction');
    assert.deepEqual(v.journal.ecritures, [], 'saisir un texte ne doit rien écrire en base');
  } finally { await v.demonter(); }
});

test('Mockups — changer de mode ne remet jamais le texte dans le prompt', async () => {
  const NOM = 'IMPRIMERIE OGOOUÉ';
  const v = await rendreEcran({ ecran: ECRAN, donnees: BASE });
  try {
    await cliquer(v, bouton(v.conteneur, 'Ajouter un texte'));
    await saisir(v, v.conteneur.querySelector('input[maxlength="60"]'), NOM);

    // Les deux modes, l'un apres l'autre. C'est le mode « Rendu 3D IA » qui
    // demandait le texte au modele jusqu'au 16/09 — et qui l'a omis.
    for (const libelle of ['Incrustation exacte (2D)', 'Rendu 3D par l\'IA']) {
      const choix = bouton(v.conteneur, libelle);
      assert.ok(choix, `le mode « ${libelle} » est introuvable`);
      await cliquer(v, choix);
      const prompt = v.conteneur.querySelector('textarea');
      assert.ok(prompt, 'la zone de prompt est introuvable');
      assert.ok(
        !prompt.value.includes(NOM) && !/IMPRIMERIE|OGOOU/i.test(prompt.value),
        `mode « ${libelle} » : le nom du client est parti dans le prompt`,
      );
    }
    assert.deepEqual(v.erreurs.map(String), [], 'une exception est partie pendant l’interaction');
  } finally { await v.demonter(); }
});
