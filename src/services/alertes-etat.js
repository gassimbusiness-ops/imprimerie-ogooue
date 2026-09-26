/**
 * Lecture, par le navigateur, de ce que le passage planifié a fait des alertes.
 *
 * Le tableau de bord CALCULE lui-même les alertes actives (même règle que le
 * serveur : `api/_lib/alertes.js`). Ce qu'il ne peut pas savoir seul, c'est ce
 * qui vit côté serveur : Telegram est-il configuré ? Quand la vérification
 * a-t-elle tourné pour la dernière fois ? Telegram a-t-il bien reçu telle
 * alerte ? Le passage l'écrit dans `app_data`, collection `alertes`
 * (`api/_lib/alertes-envoi.js`) ; ce module le relit.
 *
 * ⛔ LECTURE SEULE. Aucun jeton, aucune variable d'environnement serveur ici :
 *    le navigateur apprend « Telegram configuré : oui / non », jamais plus.
 *
 * Ce module-ci est PUR (phrases affichées, testées sans navigateur) ; la
 * lecture elle-même est dans `alertes-lecture.js`.
 */
/** Phrase d'état Telegram d'une alerte, pour un humain. */
export function phraseTelegram(trace) {
  const s = trace?.telegram?.statut;
  switch (s) {
    case 'envoye': return 'Envoyée sur Telegram';
    case 'non_configure': return 'Pas envoyée : Telegram non configuré';
    case 'echec': return 'Telegram a refusé — nouvel essai au prochain passage';
    case 'abandonne': return 'Telegram a refusé 3 fois — vérifier le bot et le groupe';
    case 'incertain':
    case 'en_cours': return 'Envoi Telegram incertain — vérifier le groupe';
    case 'a_envoyer': return 'Envoi Telegram au prochain passage';
    default: return 'Pas encore vue par la vérification automatique (≈ 9 h et 18 h)';
  }
}

/** Au-delà, la vérification planifiée (≈ 9 h et 18 h) est réputée ne plus tourner. */
export const FRAICHEUR_VERIFICATION_MS = 36 * 60 * 60 * 1000;

/** « sam. 26 sept., 09:04 » — heure de Moanda, quelle que soit la machine. */
export function libelleInstantMoanda(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    timeZone: 'Africa/Libreville', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * La phrase qui dit où en sont Telegram et la vérification automatique.
 *
 * ⚠️ Trois silences y sont dits en clair, parce que chacun ressemble à « tout va
 * bien » s'il se tait : Telegram non configuré ; vérification qui n'a jamais
 * tourné ; vérification qui ne tourne plus depuis 36 h. `alarme: true` les
 * affiche en couleur.
 *
 * @param {{chargement?: boolean, erreur?: string|null, disponible?: boolean, etat?: object|null}} serveur
 * @param {number} [maintenantMs]
 * @returns {{texte: string, alarme: boolean}}
 */
export function ligneEtatVerification(serveur, maintenantMs = Date.now()) {
  const s = serveur || {};
  if (s.chargement) return { texte: 'État de Telegram : lecture…', alarme: false };
  if (s.erreur) return { texte: `État de Telegram illisible (${s.erreur}).`, alarme: true };
  if (!s.disponible) return { texte: 'État de Telegram indisponible sans connexion à la base.', alarme: true };
  const etat = s.etat;
  if (!etat) {
    return { texte: 'La vérification automatique n’a pas encore tourné (elle passe vers 9 h et 18 h). Telegram : état inconnu.', alarme: true };
  }
  const quand = libelleInstantMoanda(etat.dernier_passage_le);
  const perimee = (maintenantMs - new Date(etat.dernier_passage_le).getTime()) > FRAICHEUR_VERIFICATION_MS;
  const suite = perimee ? ' ⚠️ Plus de 36 h sans vérification : aucune alerte ne part plus.' : '';
  if (etat.telegram_configure) {
    return { texte: `Telegram configuré. Dernière vérification : ${quand}.${suite}`, alarme: perimee };
  }
  return {
    texte: `Telegram non configuré : les alertes ne s’affichent que dans l’application. Dernière vérification : ${quand}.${suite}`,
    alarme: true,
  };
}
