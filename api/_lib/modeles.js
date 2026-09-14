/**
 * Nom du modele Anthropic — source unique.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Les fonctions IA de l'application ne marchaient plus. Le log d'execution Vercel du
 * deploiement actif disait, mot pour mot :
 *
 *     not_found_error, "model: claude-sonnet-4-20250514"     → HTTP 404
 *
 * Ce n'etait donc PAS une cle revoquee — une cle revoquee renvoie 401, pas 404. La cle
 * authentifiait correctement ; c'est le NOM DU MODELE qui n'existait plus. Il etait ecrit
 * en dur, a l'identique, dans `api/ai.js` et `api/zakat-analyse.js`.
 *
 * C'est exactement le motif qui a fige le scheduler d'Aurelia en `v21.0` : une valeur qui
 * vieillit, ecrite en dur dans du code de production, et qui casse en silence le jour ou le
 * fournisseur la retire. Un nom de modele a une duree de vie ; le code doit le traiter
 * comme une configuration, pas comme une constante.
 *
 * RÈGLE : ne jamais reecrire un nom de modele en dur dans un endpoint. Passer par ici.
 * Pour changer de modele, poser `ANTHROPIC_MODEL` dans Vercel — aucun deploiement de code
 * n'est necessaire.
 */

/**
 * Defaut au 14/09/2026. Haiku 4.5 suffit largement pour ce que l'application demande
 * (resumer un rapport de caisse, rediger une fiche produit) et coute nettement moins cher
 * que Sonnet, ce qui compte quand la facture part sur le compte de l'imprimerie.
 * Pour plus de qualite d'analyse : poser ANTHROPIC_MODEL=claude-sonnet-5 dans Vercel.
 */
const MODELE_PAR_DEFAUT = 'claude-haiku-4-5-20251001';

export function modeleAnthropic() {
  const m = process.env.ANTHROPIC_MODEL;
  return m && m.trim() ? m.trim() : MODELE_PAR_DEFAUT;
}

/**
 * Transforme une reponse d'erreur Anthropic en message exploitable.
 *
 * L'ancien code renvoyait `Erreur API: 404` et jetait le corps de la reponse dans un
 * `console.error`. Resultat : sur l'ecran, le geant voyait un echec sans cause, et il a
 * fallu descendre dans les logs Vercel pour apprendre que le modele n'existait pas.
 * Un 404 sur cet endpoint a une seule cause plausible — autant la dire.
 */
export function messageErreurAnthropic(statut, corpsTexte) {
  if (statut === 404) {
    return `Le modele « ${modeleAnthropic()} » n'existe pas ou n'est pas accessible a cette cle. `
      + `Corriger la variable ANTHROPIC_MODEL dans Vercel.`;
  }
  if (statut === 401) return 'Cle API Anthropic invalide ou revoquee.';
  if (statut === 429) return 'Quota Anthropic atteint. Reessayer dans quelques minutes.';
  if (statut >= 500) return 'Service Anthropic indisponible. Reessayer plus tard.';
  // Pour les autres cas, on remonte le type d'erreur annonce par Anthropic, jamais le corps
  // complet : il peut contenir un echo de la requete, donc des donnees de l'entreprise.
  try {
    const j = JSON.parse(corpsTexte);
    const type = j?.error?.type;
    if (type) return `Erreur Anthropic (${statut}) : ${type}`;
  } catch {
    /* corps non JSON : on retombe sur le message generique */
  }
  return `Erreur API Anthropic : ${statut}`;
}
