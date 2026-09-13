# Étape 1 — ordre de déploiement

⚠️ **L'ordre compte.** Appliquer la migration avant de déployer le code coupe la connexion
pour toute l'équipe.

## Ce qui est déjà fait (dans le code, commité)

- `api/auth-login.js` — connexion vérifiée côté serveur, ne renvoie plus ni empreinte ni sel
- `api/auth-email-disponible.js` — unicité d'email sans exposer la table
- `api/_lib/session.js` — jeton de session signé HMAC-SHA256
- `api/_lib/limite.js` — limite de débit par IP
- Les 4 endpoints IA (`ai`, `generate-image`, `generate-mockup`, `zakat-analyse`) exigent une
  session, plafonnent `max_tokens` à 2000, et limitent le débit
- Le repli `VITE_ANTHROPIC_API_KEY` est supprimé d'`api/ai.js`
- Côté client, tous les appels IA passent par `apiFetch` qui joint le jeton

## Variables à créer dans Vercel (Settings → Environment Variables)

| Nom | Valeur | Portée |
|---|---|---|
| `SUPABASE_URL` | l'URL du projet Supabase | Production + Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé `service_role` (Supabase → Settings → API) | Production + Preview |
| `SESSION_SECRET` | 64 caractères aléatoires — `openssl rand -hex 32` | Production + Preview |
| `APP_ORIGIN` | `https://imprimerie-ogooue-app.vercel.app` | Production |

🔴 **Aucune de ces quatre variables ne doit porter le préfixe `VITE_`.** Ce préfixe indique à
Vite de l'inclure dans le bundle envoyé au navigateur. Vérifier aussi que
`VITE_ANTHROPIC_API_KEY` n'existe plus dans la configuration Vercel.

## Séquence

1. **Déployer le code** (merge de la branche, ou push sur `main`).
2. **Créer les 4 variables** ci-dessus, puis redéployer pour qu'elles soient prises en compte.
3. **Tester la connexion** avec un compte réel. Si elle échoue, `SUPABASE_SERVICE_ROLE_KEY`
   ou `SESSION_SECRET` est mal renseignée — le code n'est pas en cause.
4. **Tester une génération IA** (Catalogue → Générer image). Elle doit fonctionner connecté,
   et répondre 401 en navigation privée non connectée.
5. **Seulement alors**, appliquer `001_securiser_employes.sql`.
6. Retester la connexion. `auth-login` accepte les deux emplacements d'identifiants, donc
   le retour arrière reste possible tant que l'étape 7 n'est pas faite.

## ⛔ Ce qui bloque encore l'application de la migration

`changePassword()` et `createUser()` dans `src/services/auth.jsx` écrivent toujours
`password_hash` / `password_salt` **directement dans `db.employes`**. Après la migration :

- l'écriture partira dans `app_data`, où la policy `app_data_update` la refusera pour
  `collection = 'employes'` ;
- et même si elle passait, `auth-login` lirait en priorité `auth_credentials`, donc le
  nouveau mot de passe serait ignoré.

**Il faut donc deux endpoints de plus avant l'étape 5** : `api/auth-changer-mot-de-passe.js`
et `api/auth-creer-utilisateur.js`, tous deux protégés par `exigerSession` et réservés au
rôle `admin` pour la création.

Je ne les ai pas écrits : ils touchent à la création de comptes, et je préfère les faire
valider avant plutôt que de livrer un chemin d'écriture d'identifiants non testé.

## Étape 1b — ce qui reste ouvert après cette migration

La **lecture** de `app_data` reste autorisée à la clé anon, car les écrans Employés,
Pointage et Performance RH lisent la collection directement. Sont donc encore lisibles par
quiconque possède la clé anon : salaires, trésorerie, rapports de caisse, clients.

Les empreintes de mots de passe, elles, ne le sont plus — et la création d'un compte
administrateur depuis le navigateur est fermée. C'est la moitié du chemin, faite sans rien
casser.

Pour fermer la lecture, il faut un endpoint `api/employes.js` qui renvoie des données
filtrées selon le rôle du jeton, et migrer les trois écrans dessus. C'est l'étape 1b.
