/**
 * LIRE LA REPONSE D'UN MODELE QUAND ELLE EST CENSEE ETRE DU JSON.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Un zero se lit comme une mesure. « Je n'ai pas pu lire la reponse » se lit
 * comme une panne. Quand on ne sait pas, on dit qu'on ne sait pas.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Pourquoi ce fichier existe (18/09/2026) ───────────────────────────────
 *
 * Ecran « Rapports & Analyses → Analyse IA » : la reponse du modele s'affichait
 * telle quelle — accolades, guillemets, cles, et jusqu'aux ``` d'ouverture —
 * avec un score de 0, alors que le texte affiche contenait
 * `"score_performance": 45`.
 *
 * Le modele repondait. L'ecran ne savait pas le lire, et — c'est le vrai
 * defaut — il INVENTAIT un zero pour remplir la jauge :
 *
 *     catch { setIaResult({ resume_performance: raw, score_performance: 0, … }) }
 *
 * Le gerant lisait donc « votre periode vaut 0/100 ». C'est faux, et c'est pire
 * qu'un ecran vide : un chiffre faux se decide dessus.
 *
 * Trois ecrans lisaient du JSON de modele, chacun avec sa propre recette :
 * Rapports & Analyses (accolade la plus large + JSON.parse), Dashboard
 * Financier (retrait des ``` + JSON.parse) et Performance RH (bloc de code,
 * puis accolades, puis JSON.parse). Trois recettes, trois comportements
 * differents sur la meme panne. Il n'y en a plus qu'une, ici.
 *
 * ── Ce que « tolerant » veut dire, et ce que ca ne veut pas dire ──────────
 *
 * TOLERANT : on accepte les formes que rend REELLEMENT un modele — un bloc de
 * code ```json, un bloc nu, un objet entoure de phrases de politesse, un objet
 * suivi d'une remarque qui contient elle-meme des accolades.
 *
 * PAS TOLERANT : on ne repare pas un objet tronque en rajoutant les accolades
 * manquantes. Une reponse coupee au milieu d'une liste de recommandations est
 * une reponse dont on ignore ce qu'elle disait ; la completer, c'est inventer.
 * On rend un echec nomme, et l'ecran le dit.
 */

/** Ce qui est arrive, quand ca n'a pas marche. */
export const RAISONS_LECTURE_IA = {
  VIDE: 'vide',
  SANS_OBJET: 'sans-objet',
  ILLISIBLE: 'illisible',
};

/**
 * Les messages sont ecrits pour le comptoir, pas pour un journal technique :
 * ils disent ce qui s'est passe ET ce que le gerant peut faire.
 */
const MESSAGES = {
  [RAISONS_LECTURE_IA.VIDE]:
    'Le service IA n\'a renvoyé aucune réponse. Aucune analyse n\'a pu être produite — '
    + 'relancez l\'analyse dans un instant.',
  [RAISONS_LECTURE_IA.SANS_OBJET]:
    'Le modèle a répondu, mais sa réponse ne contient aucun résultat exploitable : '
    + 'aucun chiffre n\'est affiché ci-dessous, et aucun n\'est inventé. Relancez l\'analyse.',
  [RAISONS_LECTURE_IA.ILLISIBLE]:
    'Le modèle a répondu, mais sa réponse est incomplète ou mal formée — elle a '
    + 'probablement été coupée en cours de route. Rien n\'en est affiché : un chiffre '
    + 'tiré d\'une réponse tronquée serait faux. Relancez l\'analyse.',
};

function echec(raison, brut) {
  return {
    ok: false,
    donnees: null,
    raison,
    message: MESSAGES[raison] || MESSAGES[RAISONS_LECTURE_IA.ILLISIBLE],
    brut,
  };
}

/**
 * Retire les clotures de bloc de code (``` ou ```json) sans toucher au reste.
 * Un modele les ajoute une fois sur deux, et jamais de la meme facon.
 */
function retirerCloturesDeBloc(texte) {
  return texte
    .replace(/```[a-zA-Z0-9_-]*[ \t]*\r?\n?/g, '')
    .replace(/```/g, '');
}

/**
 * Enumere les objets JSON EQUILIBRES du texte, du plus englobant au suivant.
 *
 * Le comptage d'accolades ignore celles qui sont a l'interieur d'une chaine
 * (« un texte avec } dedans » ne ferme rien) et respecte l'echappement.
 * C'est ce que ne savait faire aucune des trois recettes precedentes :
 * `/\{[\s\S]*\}/` va de la PREMIERE accolade a la DERNIERE, et avale donc la
 * phrase de conclusion du modele si elle contient une accolade.
 *
 * @returns {string[]} candidats, dans l'ordre ou ils apparaissent
 */
function objetsEquilibres(texte) {
  const trouves = [];
  let depart = -1;
  let profondeur = 0;
  let dansChaine = false;
  let echappe = false;

  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansChaine = false;
      continue;
    }
    if (c === '"') { dansChaine = true; continue; }
    if (c === '{') {
      if (profondeur === 0) depart = i;
      profondeur += 1;
      continue;
    }
    if (c === '}' && profondeur > 0) {
      profondeur -= 1;
      if (profondeur === 0 && depart >= 0) {
        trouves.push(texte.slice(depart, i + 1));
        depart = -1;
      }
    }
  }
  return trouves;
}

/** `JSON.parse` qui ne leve jamais, et qui n'accepte qu'un OBJET. */
function tenterObjet(candidat) {
  try {
    const v = JSON.parse(candidat);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    return null;
  } catch {
    return null;
  }
}

/**
 * Lit la reponse d'un modele censee contenir un objet JSON.
 *
 * Ne leve jamais, quelle que soit l'entree.
 *
 * @param {*} brut la reponse du modele, telle qu'elle est revenue
 * @returns {{ok: boolean, donnees: object|null, raison: string|null,
 *            message: string, brut: string}}
 *          `ok` vrai : `donnees` est l'objet lu, `message` est vide.
 *          `ok` faux : `donnees` vaut null — AUCUNE valeur de remplacement —
 *          et `message` est une phrase affichable telle quelle.
 */
export function lireJsonIA(brut) {
  let texte = '';
  try {
    texte = typeof brut === 'string' ? brut : (brut === null || brut === undefined ? '' : String(brut));
  } catch {
    // Un objet dont `toString` leve (Symbol, proxy hostile) : ce n'est pas
    // une reponse de modele, c'est une entree absurde. On la traite comme vide.
    texte = '';
  }

  const sansClotures = retirerCloturesDeBloc(texte).trim();
  if (!sansClotures) return echec(RAISONS_LECTURE_IA.VIDE, texte);

  // 1. La reponse est deja du JSON pur — le cas le plus frequent.
  const direct = tenterObjet(sansClotures);
  if (direct) return { ok: true, donnees: direct, raison: null, message: '', brut: texte };

  // 2. Un objet equilibre quelque part dans le texte.
  for (const candidat of objetsEquilibres(sansClotures)) {
    const lu = tenterObjet(candidat);
    if (lu) return { ok: true, donnees: lu, raison: null, message: '', brut: texte };
  }

  // 3. Rien d'exploitable. On distingue « il n'y avait pas d'objet » (le modele
  //    a repondu en prose) de « il y en avait un, mais il est casse » (coupure) :
  //    ce ne sont pas les memes suites a donner.
  return echec(
    sansClotures.includes('{') ? RAISONS_LECTURE_IA.ILLISIBLE : RAISONS_LECTURE_IA.SANS_OBJET,
    texte,
  );
}

/**
 * Un score renvoye par un modele, s'il en est un — `null` sinon.
 *
 * Trois ecrans dessinent une jauge a partir d'un champ du JSON
 * (`score_performance`, `score_sante`, `score_global`). Sans ce filtre, un
 * champ absent envoyait `undefined * 2,51` dans l'attribut `strokeDasharray`
 * du cercle : « NaN 251 » — une valeur manquante de plus, dans un attribut
 * cette fois. Le resultat est borne a [0, 100] : un « 145 » ne doit pas
 * dessiner un arc qui deborde, ni un « -3 » un arc negatif.
 *
 * @param {*} valeur
 * @returns {number|null}
 */
export function scoreLisible(valeur) {
  const n = typeof valeur === 'number' ? valeur : Number(valeur);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
