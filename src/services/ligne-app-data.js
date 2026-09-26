/**
 * LA FORME D'UNE LIGNE NEUVE DE `app_data` — un seul identifiant, toujours.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `app_data` porte l'identifiant DEUX fois : la colonne `id` (clé primaire) et
 * la clé `id` du JSON `data`. Les écrans ne lisent que `data` : ils connaissent
 * `data.id`, puis `db.update(id)` cherche la ligne par la COLONNE `id`. Si les
 * deux diffèrent, la ligne est introuvable et ne se modifie plus.
 *
 * Le 26/09/2026, le dirigeant a vu « La modification de la tâche n'a PAS été
 * enregistrée (ligne introuvable) ». Recensement du même jour :
 *
 *   - `taches` (1)             — insérée à la main en SQL le 18/09, avec
 *                                `gen_random_uuid()` pour la colonne ET un
 *                                second `gen_random_uuid()` dans `data` ;
 *   - `paiements_singpay` (3)  — `api/_lib/singpay-initiate.js` tirait deux
 *                                `crypto.randomUUID()` différents ;
 *   - `notifications_app` (1)  — `api/_lib/singpay-encaissement.js`, idem.
 *
 * Et le même motif dormait dans `api/meta-webhook.js` (messages_meta),
 * `api/_lib/bot-depot.js` (bot_journal) et l'insertion des mouvements SingPay.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA RÈGLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   Toute insertion dans `app_data` passe par `ligneAppData()`. Elle pose la
 *   même valeur dans la colonne et dans `data.id`, et REFUSE deux valeurs
 *   différentes au lieu de choisir. `tests/ligne-app-data.test.mjs` parcourt le
 *   dépôt et échoue sur tout `.insert(` vers `app_data` qui ne passe pas par
 *   elle.
 *
 * ⚠️ Module PUR, partagé navigateur + serveur (`api/` l'importe par chemin
 * relatif). Aucun import de base, de session ou d'alias `@/` ici.
 */

/**
 * Fabrique la ligne à insérer.
 *
 * @param {object} arg
 * @param {string} arg.collection
 * @param {object} arg.data      le contenu ; son `id` éventuel est respecté
 * @param {string} [arg.id]      identifiant imposé ; doit égaler `data.id` s'il existe
 * @param {string} [arg.created_at]
 * @param {string} [arg.updated_at]
 * @returns {{id: string, collection: string, data: object, created_at?: string, updated_at?: string}}
 */
export function ligneAppData({ collection, data, id, created_at, updated_at } = {}) {
  if (!collection || typeof collection !== 'string') {
    throw new Error('ligneAppData : collection manquante');
  }
  const contenu = data && typeof data === 'object' ? data : {};
  const idData = contenu.id == null || contenu.id === '' ? null : String(contenu.id);
  const idImpose = id == null || id === '' ? null : String(id);

  if (idImpose && idData && idImpose !== idData) {
    throw new Error(
      `ligneAppData : deux identifiants pour une ligne de ${collection} `
      + `(colonne ${idImpose}, data.id ${idData}) — la ligne serait introuvable depuis l'écran`,
    );
  }

  const idFinal = idImpose || idData || globalThis.crypto.randomUUID();
  const ligne = { id: idFinal, collection, data: { ...contenu, id: idFinal } };
  if (created_at !== undefined) ligne.created_at = created_at;
  if (updated_at !== undefined) ligne.updated_at = updated_at;
  return ligne;
}
