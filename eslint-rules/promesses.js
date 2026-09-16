// ════════════════════════════════════════════════════════════════════════════
//  REGLE LOCALE — « pas de promesse perdue »
// ════════════════════════════════════════════════════════════════════════════
//
//  Pourquoi une regle maison plutot qu'un plugin du commerce :
//
//  La regle de reference (`@typescript-eslint/no-floating-promises`) a besoin
//  des types TypeScript pour savoir qu'un appel renvoie une promesse. Ce projet
//  est en JavaScript pur : ce service n'existe pas. `eslint-plugin-promise`
//  ajouterait une dependance pour ne couvrir, sans types, que le cas `.then()`.
//
//  Cette regle couvre donc ce qui est DECIDABLE sans types, c'est-a-dire ce que
//  le fichier lui-meme suffit a prouver :
//
//    1. l'appel, en position d'instruction, d'une fonction `async` declaree
//       dans le meme fichier, sans `await` ;
//    2. une chaine `.then(...)` en position d'instruction qui ne se termine
//       pas par un `.catch(...)` ;
//    3. un `new Promise(...)` en position d'instruction.
//
//  Le cas 1 est exactement la forme de l'ecran blanc du 14/09 : une fonction
//  d'amorcage `async` appelee sans `await` ni `.catch`, dont le rejet remontait
//  en `unhandledrejection` et laissait l'application sur un ecran vide.
//
//  ECHAPPATOIRE VOLONTAIRE : `void maFonction()` est accepte sans broncher.
//  C'est la facon standard d'ecrire « je sais que c'est asynchrone, je l'ignore
//  sciemment ». Une regle sans echappatoire lisible finit desactivee en masse.
//
//  CE QUE LA REGLE NE VOIT PAS (limite assumee, pas un oubli) : un appel a une
//  fonction asynchrone IMPORTEE d'un autre fichier. Sans types, rien dans le
//  fichier ne dit que `db.clients.create(...)` renvoie une promesse.
//
// ════════════════════════════════════════════════════════════════════════════

/** Le noeud est-il une fonction marquee `async` ? */
function estFonctionAsync(noeud) {
  if (!noeud) return false;
  return (
    (noeud.type === "FunctionDeclaration" ||
      noeud.type === "FunctionExpression" ||
      noeud.type === "ArrowFunctionExpression") &&
    noeud.async === true
  );
}

/**
 * Une fonction `async` dont CHAQUE `await` est enferme dans un `try` muni d'un
 * `catch` ne peut pratiquement pas rejeter : l'appeler sans `await` est alors
 * sans danger, et la signaler serait du bruit pur.
 *
 * C'est exactement le motif impose a `init()` dans `src/main.jsx` apres
 * l'ecran blanc du 14/09 (« chaque etape d'amorcage est isolee »). La regle
 * doit recompenser ce motif, pas le punir.
 *
 * Approximation assumee : un `throw` synchrone place hors de tout `try` ferait
 * quand meme rejeter la fonction. Cas rare, et le signaler couterait plus de
 * faux positifs qu'il n'attraperait de vrais bugs.
 */
function toutAwaitEstRattrape(fonction) {
  if (!fonction || !fonction.body || fonction.body.type !== "BlockStatement") {
    return false;
  }

  let auMoinsUnAwait = false;
  let tousRattrapes = true;

  /**
   * @param {object} noeud   noeud courant
   * @param {number} profondeurTry  nombre de `try{}` (avec catch) englobants
   */
  function parcourir(noeud, profondeurTry) {
    if (!noeud || typeof noeud.type !== "string") return;

    // On n'entre pas dans les fonctions imbriquees : leurs `await` leur
    // appartiennent, pas a la fonction analysee.
    if (
      noeud !== fonction &&
      (noeud.type === "FunctionDeclaration" ||
        noeud.type === "FunctionExpression" ||
        noeud.type === "ArrowFunctionExpression")
    ) {
      return;
    }

    if (noeud.type === "AwaitExpression") {
      auMoinsUnAwait = true;
      if (profondeurTry === 0) tousRattrapes = false;
    }

    if (noeud.type === "TryStatement") {
      const rattrape = Boolean(noeud.handler);
      parcourir(noeud.block, profondeurTry + (rattrape ? 1 : 0));
      if (noeud.handler) parcourir(noeud.handler.body, profondeurTry);
      if (noeud.finalizer) parcourir(noeud.finalizer, profondeurTry);
      return;
    }

    for (const cle of Object.keys(noeud)) {
      if (cle === "parent") continue;
      const valeur = noeud[cle];
      if (Array.isArray(valeur)) {
        for (const enfant of valeur) parcourir(enfant, profondeurTry);
      } else if (valeur && typeof valeur.type === "string") {
        parcourir(valeur, profondeurTry);
      }
    }
  }

  parcourir(fonction.body, 0);
  return auMoinsUnAwait && tousRattrapes;
}

/**
 * Remonte les portees pour retrouver ce a quoi un identifiant est lie.
 * Renvoie le noeud de fonction si l'identifiant designe une fonction locale,
 * sinon null (import, parametre, valeur inconnue...).
 */
function resoudreVersFonctionLocale(portee, nom) {
  let courante = portee;
  while (courante) {
    const variable = courante.variables.find((v) => v.name === nom);
    if (variable) {
      // Une variable reassignee plusieurs fois : on ne tranche pas.
      if (variable.defs.length !== 1) return null;
      const def = variable.defs[0];
      if (def.type === "FunctionName") return def.node;
      if (def.type === "Variable" && def.node.init) return def.node.init;
      return null;
    }
    courante = courante.upper;
  }
  return null;
}

/** Nom de la propriete appelee (`a.b.then()` -> "then"), ou null. */
function nomPropriete(callee) {
  if (!callee || callee.type !== "MemberExpression") return null;
  if (callee.computed) return null;
  return callee.property && callee.property.name ? callee.property.name : null;
}

/** La chaine `a().then().then()` contient-elle un `.catch` / `.finally` ? */
function chaineComporteRattrapage(noeud) {
  let courant = noeud;
  while (courant && courant.type === "CallExpression") {
    const prop = nomPropriete(courant.callee);
    if (prop === "catch" || prop === "finally") return true;
    courant =
      courant.callee && courant.callee.type === "MemberExpression"
        ? courant.callee.object
        : null;
  }
  return false;
}

const regle = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Interdit qu'une promesse parte sans await ni .catch en position d'instruction",
    },
    schema: [],
    messages: {
      appelAsyncSansAwait:
        "Promesse perdue : « {{nom}} » est une fonction async appelee sans `await` ni `.catch()`. " +
        "Si elle rejette, le rejet remonte en `unhandledrejection` et peut laisser l'ecran vide " +
        "(incident du 14/09). Ecrire `await {{nom}}(...)`, `{{nom}}(...).catch(...)`, " +
        "ou `void {{nom}}(...)` si l'oubli est volontaire.",
      thenSansCatch:
        "Promesse perdue : chaine `.then(...)` sans `.catch(...)`. Un rejet ici n'est attrape " +
        "par personne. Ajouter `.catch(...)` en fin de chaine.",
      promesseNue:
        "`new Promise(...)` en position d'instruction : la promesse est construite puis jetee. " +
        "L'affecter, la retourner, ou l'`await`.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    return {
      ExpressionStatement(noeud) {
        let expr = noeud.expression;

        // `void f()` : fire-and-forget assume, on laisse passer.
        if (expr.type === "UnaryExpression" && expr.operator === "void") return;

        // `await f()` en instruction : deja gere.
        if (expr.type === "AwaitExpression") return;

        // `new Promise(...)` nu.
        if (
          expr.type === "NewExpression" &&
          expr.callee.type === "Identifier" &&
          expr.callee.name === "Promise"
        ) {
          context.report({ node: expr, messageId: "promesseNue" });
          return;
        }

        if (expr.type !== "CallExpression") return;

        // Cas 2 : chaine `.then(...)` sans rattrapage.
        const prop = nomPropriete(expr.callee);
        if (prop === "then") {
          if (!chaineComporteRattrapage(expr)) {
            context.report({ node: expr, messageId: "thenSansCatch" });
          }
          return;
        }
        // Une chaine qui se termine par `.catch` ou `.finally` est geree.
        if (prop === "catch" || prop === "finally") return;

        // Cas 1 : appel direct d'une fonction async declaree dans le fichier.
        if (expr.callee.type !== "Identifier") return;
        const portee = sourceCode.getScope
          ? sourceCode.getScope(noeud)
          : context.getScope();
        const cible = resoudreVersFonctionLocale(portee, expr.callee.name);
        if (estFonctionAsync(cible) && !toutAwaitEstRattrape(cible)) {
          context.report({
            node: expr,
            messageId: "appelAsyncSansAwait",
            data: { nom: expr.callee.name },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    "pas-de-promesse-perdue": regle,
  },
};
