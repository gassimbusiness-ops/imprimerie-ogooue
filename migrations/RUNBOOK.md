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
  - ℹ️ depuis le 17/09/2026, `/api/zakat-analyse` et les trois `/api/singpay-*` gardent leurs
    URL mais ne sont plus des fichiers à la racine d'`api/` : le plan Vercel Hobby plafonne le
    projet à **12 fonctions serverless** et `api/` en comptait 13. Les logiques vivent dans
    `api/_lib/` (hors plafond) et sont servies par `api/ai.js` et `api/singpay.js` via les
    `rewrites` de `vercel.json`. Voir l'en-tête de `api/singpay.js` pour la procédure de
    démontage au passage au plan Pro.
- Le repli `VITE_ANTHROPIC_API_KEY` est supprimé d'`api/ai.js`
- Côté client, tous les appels IA passent par `apiFetch` qui joint le jeton

## Variables Vercel — état au 14/09/2026

Vérifié dans l'interface Vercel, projet `imprimerie-ogooue-app`.

| Nom | Valeur | Portée | État |
|---|---|---|---|
| `SUPABASE_URL` | `https://bcwkrrqmjpaohmafcncw.supabase.co` | Development, Preview, Production | ✅ **créée** — type Config, valeur relue et vérifiée |
| `APP_ORIGIN` | `https://imprimerie-ogooue-app.vercel.app` | Production | ✅ **créée** — type Config, valeur relue et vérifiée |
| `SESSION_SECRET` | 60 caractères aléatoires | Production (+ Preview si besoin) | 🟠 **générée, à coller** — voir `SECRETS_A_COLLER_LOCAL.txt` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` | Production (+ Preview si besoin) | 🔴 **à coller par Gassim uniquement** |

Les deux dernières sont des secrets : elles se créent avec le type **Secret**, pas Config.
Je ne les saisis pas moi-même — saisir une clé ou un mot de passe dans un formulaire n'entre
pas dans ce que je fais, même sur autorisation explicite. Le `SESSION_SECRET` est déjà généré
dans `migrations/SECRETS_A_COLLER_LOCAL.txt` (permissions 600, ajouté au `.gitignore`) :
il suffit de le copier-coller, puis de supprimer le fichier.

🔴 **Aucune de ces quatre variables ne doit porter le préfixe `VITE_`.** Ce préfixe indique à
Vite de l'inclure dans le bundle envoyé au navigateur.

### Ce que porte réellement le bundle de production — mesuré, pas déduit

Les 5 fichiers `assets/*.js` servis par `imprimerie-ogooue-app.vercel.app` ont été téléchargés
et inspectés le 14/09/2026 :

| Recherché | Trouvé |
|---|---|
| URL du projet Supabase | ✅ **présente en clair** dans `index-*.js` |
| Clé publiable Supabase (`sb_publishable_…`) | ✅ **présente en clair**, 1 occurrence, juste après l'URL |
| Clé au format JWT (`eyJ…`) | aucune |
| Clé OpenAI ou Anthropic (`sk-…`) | **aucune** — les 3 correspondances `sk-image-*` sont des noms de classes CSS |
| Chaîne `VITE_OPENAI_API_KEY` ou `OPENAI` | **absente du bundle** |

➡️ Cela **confirme** le constat n°1 de l'audit : la clé publiable est bien distribuée au
navigateur, donc la policy `allow_all_operations` ouvre la base à quiconque ouvre l'application.
La preuve ne vient plus de la lecture du code mais du bundle réellement servi.

### 🟠 `VITE_OPENAI_API_KEY` — arme chargée, pas encore tirée

Cette variable existe dans Vercel (ajoutée le 9 mars, portée « All Environments »). **Elle
n'est référencée nulle part dans le code** : `api/generate-image.js` et `api/generate-mockup.js`
lisent `process.env.OPENAI_API_KEY`, qui est une variable distincte et correctement nommée.
Vite n'inline que les `import.meta.env.VITE_X` réellement écrits dans les sources — c'est
pourquoi elle **n'apparaît pas** dans le bundle actuel, ce que la mesure ci-dessus confirme.

Mais il suffit d'**une seule ligne** de code écrivant `import.meta.env.VITE_OPENAI_API_KEY`
pour que la clé OpenAI de l'entreprise soit publiée dans le bundle au prochain build, sans
aucun avertissement.

**Action recommandée : supprimer `VITE_OPENAI_API_KEY` de Vercel.** Rien ne la lit, et
`OPENAI_API_KEY` couvre déjà le besoin côté serveur. À faire par Gassim, en même temps que
la rotation de la clé OpenAI si elle a pu circuler.

## Séquence

1. **Déployer le code** (merge de la branche, ou push sur `main`).
2. **Compléter les 2 variables secrètes** restantes (`SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`),
   puis redéployer pour que les 4 soient prises en compte. Les deux non secrètes sont déjà créées.
3. **Tester la connexion** avec un compte réel. Si elle échoue, `SUPABASE_SERVICE_ROLE_KEY`
   ou `SESSION_SECRET` est mal renseignée — le code n'est pas en cause.
4. **Tester une génération IA** (Catalogue → Générer image). Elle doit fonctionner connecté,
   et répondre 401 en navigation privée non connectée.
5. **Seulement alors**, appliquer `001_securiser_employes.sql`.
6. Retester la connexion. `auth-login` accepte les deux emplacements d'identifiants, donc
   le retour arrière reste possible tant que l'étape 7 n'est pas faite.

## ✅ Les deux endpoints qui bloquaient la migration sont écrits

`changePassword()` et `createUser()` écrivaient `password_hash` / `password_salt`
**directement dans `db.employes`**. Après la migration, ces écritures auraient été refusées
par la policy, et un nouveau mot de passe aurait été silencieusement ignoré.

C'est réglé : `api/auth-changer-mot-de-passe.js` et `api/auth-creer-utilisateur.js` existent,
tous deux derrière `exigerSession`.

Deux points de conception à connaître avant de relire ce code :
- **Création** : sans session admin, le rôle est **forcé à `client`** et le champ `role` du
  corps de la requête est ignoré. C'est ce qui empêche l'inscription publique de fabriquer
  un administrateur.
- Les champs métier de l'inscription publique sont envoyés **avec la création** sous la clé
  `extras`, et non par un second appel. Un second appel serait passé par `db.employes.update`,
  désormais réservé à l'admin, et les champs auraient été perdus sans erreur visible.

## Étape 1b — faite

`api/employes.js` existe et filtre selon le rôle porté par le jeton signé :

| Catégorie | Champs | Qui les voit |
|---|---|---|
| Publics | `id, nom, prenom, email, telephone, poste, role, actif` | toute session valide |
| Sensibles | `salaire_base, date_entree, date_naissance, adresse, cnss` | **admin seulement** |
| Interdits | `password_hash, password_salt, password_changed_at` | **personne, jamais** |

`GET` est filtré ; `POST` / `PATCH` / `DELETE` sont réservés à l'admin, qui ne peut pas
supprimer son propre compte.

Côté client, `src/services/db.js` expose `CollectionEmployes`, qui route `list / getById /
create / update / delete` vers `/api/employes`. **Un seul point d'interception** : les 13 sites
de lecture et les 10 sites d'écriture du reste de l'application n'ont pas été touchés.

## ⛔ Ce qui reste réellement ouvert après tout ça

La **lecture** de `app_data` reste autorisée à la clé publiable pour toutes les collections
autres que `employes`. Sont donc encore lisibles par quiconque ouvre l'application :
trésorerie, rapports de caisse, commandes, clients, stocks.

Fermer cela demande de vraies policies par rôle **et** une session Supabase Auth — c'est le
chantier suivant, celui qui exige une fenêtre de maintenance et un test par rôle. Les étapes 1
et 1b ferment les identifiants et l'escalade de privilèges ; elles ne ferment pas la lecture
générale.

## 🚦 Avant de déployer quoi que ce soit

L'application est **utilisée en production tous les jours par le gérant**. Aucun déploiement,
aucune migration, aucun redéploiement Vercel sans fenêtre convenue avec lui.

Les deux variables créées le 14/09/2026 ne changent rien tant qu'un redéploiement n'a pas eu
lieu — c'est voulu : le bouton « Redeploy » proposé par Vercel après leur création **n'a pas
été cliqué**.
