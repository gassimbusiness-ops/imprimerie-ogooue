/**
 * Rattachement / création de la fiche client au moment de la FACTURE — IMPRIMERIE OGOOUÉ
 *
 * Ce module exécute la décision prise par `client-resolution.js`.
 * Il fait des entrées-sorties, mais elles sont **injectées** (`listerClients`, `creerClient`,
 * `notifier`) : aucun import de `db`, aucun React, aucun `new Date()`. C'est ce qui permet
 * de tester pour de vrai le chemin d'erreur dans `tests/client-annuaire.test.mjs`.
 *
 * ⚠️ RÈGLE NON NÉGOCIABLE : cette fonction ne jette jamais.
 * Si l'annuaire est injoignable ou si la création échoue, elle renvoie un `clientId` vide
 * et l'appelant enregistre quand même la facture avec le nom en clair.
 * Une facture perdue à cause de l'annuaire serait un bug plus grave que celui qu'on corrige.
 */
import { RESOLUTION, resoudreClient, construireNouveauClient } from './client-resolution.js';

/**
 * @typedef {object} EntreesSorties
 * @property {() => Promise<Array<object>>} listerClients  Relecture de l'annuaire.
 * @property {(data: object) => Promise<object>} creerClient
 * @property {(niveau: 'info'|'succes'|'erreur', message: string) => void} [notifier]
 * @property {Array<object>} [clientsConnus]  Annuaire déjà en mémoire, utilisé si la relecture échoue.
 */

/**
 * Garantit qu'une facture pointe vers une fiche de l'annuaire.
 *
 * Relit l'annuaire avant de décider : un autre poste a pu créer la fiche pendant que le
 * formulaire était ouvert. Il n'y a aucune contrainte d'unicité dans la base, donc rien ne
 * rattraperait le doublon après coup.
 *
 * @param {EntreesSorties} io
 * @param {{nom: string, adresse?: string, numero?: string, clientId?: string, dateISO?: string}} facture
 * @returns {Promise<{clientId: string, nom: string, statut: string, cree: boolean, echec: boolean, message: string}>}
 */
export async function assurerClientFacture(io, { nom, adresse = '', numero = '', clientId = '', dateISO = '' }) {
  const notifier = typeof io.notifier === 'function' ? io.notifier : () => {};

  // 1. Annuaire le plus frais possible — en dernier recours, celui déjà chargé à l'écran.
  let annuaire = Array.isArray(io.clientsConnus) ? io.clientsConnus : [];
  try {
    const frais = await io.listerClients();
    if (Array.isArray(frais)) annuaire = frais;
  } catch (e) {
    console.error('[devis-factures] Relecture annuaire impossible, etat local utilise:', e);
  }

  // 2. Décision (pure).
  const r = resoudreClient({ type: 'facture', clients: annuaire, nomSaisi: nom, clientId });

  if (r.statut === RESOLUTION.INVALIDE) {
    return { clientId: '', nom: '', statut: r.statut, cree: false, echec: false, message: r.message };
  }

  if (r.statut === RESOLUTION.EXISTANT) {
    // Rattachement à une fiche existante plutôt que création d'un doublon.
    // On le dit à l'utilisateur quand ce n'est pas lui qui a choisi la fiche.
    if (r.rattachement === 'par_nom') notifier('info', r.message);
    return { clientId: r.clientId, nom: r.nom, statut: r.statut, cree: false, echec: false, message: r.message };
  }

  // 3. Création.
  try {
    const fiche = await io.creerClient(
      construireNouveauClient({ nom: r.nom, adresse, numeroDocument: numero, date: dateISO }),
    );
    const id = fiche && fiche.id ? fiche.id : '';
    if (!id) throw new Error('fiche créée sans identifiant');
    const message = `Client « ${r.nom} » ajouté à l'annuaire`;
    notifier('succes', message);
    return { clientId: id, nom: r.nom, statut: r.statut, cree: true, echec: false, message };
  } catch (e) {
    const message = `Client « ${r.nom} » non ajouté à l'annuaire (${(e && e.message) || 'erreur'}). `
      + 'La facture est enregistrée avec le nom en clair — fiche à créer manuellement.';
    console.error('[devis-factures] Echec creation client auto:', e);
    notifier('erreur', message);
    return { clientId: '', nom: r.nom, statut: r.statut, cree: false, echec: true, message };
  }
}
