/**
 * Qui a le droit d'entrer dans quel portail.
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE
 *
 * `src/app.jsx` protegeait `/client` et `/associe` par une seule question :
 * « y a-t-il un utilisateur connecte ? ». La reponse etait oui pour TOUT compte,
 * y compris un employe et un client. Il suffisait de taper l'adresse dans la
 * barre du navigateur pour ouvrir le portail associe — c'est-a-dire la
 * tresorerie, le capital, la dette entre associes et la masse salariale.
 *
 * Aucun menu n'y menait : le defaut etait donc invisible en lecture d'ecran, et
 * seul un test par ROLE pouvait le voir. C'est ce que fait
 * `tests/acces-portail.test.mjs`.
 *
 * ── Le cas de l'administrateur, et pourquoi il garde l'acces ──────────────
 *
 * Le reste de l'application traite `admin` comme un SUR-ENSEMBLE, pas comme un
 * role parallele :
 *   - `src/services/auth.jsx` : `isManager = role === 'manager' || isAdmin`, et
 *     la matrice `PERMISSIONS.admin` contient tous les modules ;
 *   - `src/app.jsx` : l'ecran Zakat et l'ecran Gouvernance sont montes DEUX
 *     fois, une fois sous `/associe`, une fois dans l'application interne avec
 *     `RequirePermission module="gouvernance"` — que seul l'admin (et le
 *     manager, en lecture) possede ;
 *   - le document 33 decrit « Capital & Investisseurs » comme un ecran
 *     « admin, associé ».
 *
 * Fermer `/associe` a l'administrateur lui retirerait donc un acces qu'il a
 * deja par ailleurs, sans rien proteger. Il reste autorise sur les deux
 * portails. Le `manager` en revanche N'EST PAS admin : il n'entre nulle part.
 *
 * Module pur : aucun import, aucun effet. Il decide, il n'affiche rien.
 */

/** Les roles admis dans chaque portail. L'ordre n'a pas d'importance. */
export const ROLES_AUTORISES = {
  client: ['client', 'admin'],
  associe: ['associe', 'admin'],
};

/** Libelles lisibles par le gerant — les messages ne doivent pas parler code. */
const NOM_ROLE = {
  admin: 'administrateur',
  manager: 'manager',
  employe: 'employé',
  associe: 'associé',
  client: 'client',
};

const NOM_PORTAIL = {
  client: 'portail client',
  associe: 'portail associé',
};

/** Ce que chaque portail expose, nomme dans le refus : un refus muet ne s'explique pas. */
const CONTENU_PORTAIL = {
  associe: 'la trésorerie, le capital et les salaires',
  client: 'les commandes, les factures et les points de fidélité d’un client',
};

/**
 * Decide si `user` peut entrer dans `portail`.
 *
 * @param {{role?: string}|null|undefined} user l'utilisateur de session
 * @param {'client'|'associe'} portail
 * @returns {{autorise: boolean, code: string, motif: string}}
 *   `code` est stable et destine aux tests et au journal ; `motif` est la
 *   phrase montree a l'utilisateur. Les deux disent la MEME raison.
 */
export function accesPortail(user, portail) {
  const nomPortail = NOM_PORTAIL[portail];
  if (!nomPortail) {
    return {
      autorise: false,
      code: 'portail-inconnu',
      motif: `Portail inconnu : « ${String(portail)} ».`,
    };
  }

  if (!user) {
    return {
      autorise: false,
      code: 'non-connecte',
      motif: `Connectez-vous pour accéder au ${nomPortail}.`,
    };
  }

  const role = typeof user.role === 'string' ? user.role.trim() : '';
  if (!role) {
    // Un compte sans role n'est pas un compte « neutre » : c'est une fiche
    // incomplete. On refuse, sinon `''` passerait toutes les comparaisons
    // laxistes — c'est exactement le piege de `includes('')` du portail client.
    return {
      autorise: false,
      code: 'sans-role',
      motif: `Votre compte n’a aucun rôle défini : l’accès au ${nomPortail} est refusé.`,
    };
  }

  if (!ROLES_AUTORISES[portail].includes(role)) {
    return {
      autorise: false,
      code: 'role-interdit',
      motif: `Le ${nomPortail} affiche ${CONTENU_PORTAIL[portail]}. `
        + `Votre compte a le rôle « ${NOM_ROLE[role] || role} » : l’accès est refusé.`,
    };
  }

  return {
    autorise: true,
    code: 'autorise',
    motif: `Rôle « ${NOM_ROLE[role] || role} » : accès au ${nomPortail} autorisé.`,
  };
}
