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
- **17/09/2026** — `api/_lib/comptes.js` : le seul endroit du serveur qui touche aux mots de
  passe. Il impose qu'un mot de passe soit écrit dans `auth_credentials` **ou** que l'appel
  échoue franchement, jamais entre les deux, et qu'il n'entre jamais dans `app_data`.
  Il vit dans `_lib/`, donc **ne consomme aucune des 12 fonctions serverless**.
- **17/09/2026** — `api/employes.js` **déplace** les identifiants reçus au lieu de les jeter ;
  `api/auth-creer-utilisateur.js` écrit les identifiants **avant** l'employé et annule en cas
  d'échec ; `api/auth-changer-mot-de-passe.js` vérifie l'existence de la cible et distingue
  503 (stockage absent) de 500 (vraie panne). Les trois journalisent l'acte dans `audit_logs`,
  jamais le mot de passe — `assainir()` remplace toute valeur secrète par `[omis]`.
- **17/09/2026** — `tests/identifiants-employes.test.mjs` : 27 tests, dont 9 échouent sur le
  code d'avant (vérifié sur une copie isolée).

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

## 📏 État réel de la production — mesuré le 17/09/2026

Projet Supabase `bcwkrrqmjpaohmafcncw`, en lecture seule.

| Mesure | Valeur |
|---|---|
| `app_data` | **4 092 lignes, 29 collections** (`audit_logs` 3 338, `rapports` 237, `produits_catalogue` 195, `notifications_app` 92, `produits` 45, `mouvements_stock` 44, `mouvements_financiers` 32, `clients` 14, `employes` 13, …) |
| Comptes dans `employes` | **13**, dont **3 `role: 'admin'`** |
| Empreintes encore inline dans `app_data` | **13 sur 13** |
| Comptes en double sur un même e-mail | **oui, toujours** : `imprimerieogooue@gmail.com` ×3 *(3 administrateurs)*, `imprimerieogooue.user@gmail.com` ×3, `minguisilou@gmail.com` ×3 — 9 lignes pour 3 personnes. Les 13 empreintes sont toutes distinctes. |
| Policies sur `app_data` | **1 seule : `allow_all_operations`**, `FOR ALL`, `USING (true)`, `WITH CHECK (true)`, rôles `{public}` |
| Table `auth_credentials` | **absente** — la migration 001 n'a jamais été appliquée |

➡️ Le trou n°1 de l'audit est **intact**. Rien de ce qui suit n'a encore été appliqué en base.

## 🔴 Ce que l'absence de `auth_credentials` cassait déjà, aujourd'hui, en production

Découvert le 17/09/2026 en croisant le code et la base. Ce n'était pas un risque futur :
c'était en panne, en silence, depuis que `api/employes.js` a été branché.

| Geste du gérant | Ce qu'il voyait | Ce qui se passait réellement |
|---|---|---|
| Paramètres → créer un utilisateur | « Utilisateur créé » | `api/employes.js` **supprimait** `password_hash`/`password_salt` (liste `CHAMPS_INTERDITS`) avant d'écrire : le compte n'avait **aucun mot de passe** et ne pourrait jamais se connecter |
| Paramètres → éditer, saisir un nouveau mot de passe | « Utilisateur modifié » | même suppression : **l'ancien mot de passe restait le seul valide** |
| Paramètres → bouton « changer le mot de passe » | « Erreur serveur » | écriture dans `auth_credentials`, table inexistante → 500 |
| Un visiteur s'inscrit depuis la page de connexion | « Erreur serveur », puis « Un compte avec cet email existe deja » | `auth-creer-utilisateur` insérait l'employé **puis** les identifiants ; la 2ᵉ écriture échouait et la 1ʳᵉ restait → **compte orphelin**, e-mail bloqué, visiteur enfermé dehors |

Corrigé le 17/09/2026 (voir « Ce qui est déjà fait »). Les mots de passe sont désormais
**déplacés** vers `auth_credentials` au lieu d'être jetés, et chaque création est **tout ou
rien** : soit le compte existe avec son mot de passe, soit il n'existe pas.

## Séquence — déploiement en DEUX TEMPS

L'ordre n'est pas une préférence : chaque inversion a une conséquence nommée plus bas.

### Temps 1 — le code (aucune modification de la base)

1. **Déployer le code** (merge de la branche, ou push sur `main`).
2. **Compléter les 2 variables secrètes** restantes (`SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`),
   puis redéployer pour que les 4 soient prises en compte. Les deux non secrètes sont déjà créées.
3. **Tester la connexion** avec un compte réel. Si elle échoue, `SUPABASE_SERVICE_ROLE_KEY`
   ou `SESSION_SECRET` est mal renseignée — le code n'est pas en cause.
4. **Tester une génération IA** (Catalogue → Générer image). Elle doit fonctionner connecté,
   et répondre 401 en navigation privée non connectée.

À ce stade la base n'a pas bougé. Créer un utilisateur depuis Paramètres répond désormais
**503** avec un message explicite au lieu de créer un compte muet : c'est voulu, et c'est
le signal que la PHASE A manque.

### Temps 2 — la base, en deux passes séparées

5. Exécuter le **CONTRÔLE AVANT** de `001_securiser_employes.sql` (lecture seule) et lire
   chaque ligne. Toute valeur inattendue → s'arrêter et rapporter.
6. Appliquer la **PHASE A** (création de `auth_credentials` + recopie). Non destructive.
7. Exécuter le **CONTRÔLE APRÈS PHASE A**. La première ligne doit valoir **0**.
8. **Tester la connexion de trois comptes de rôles différents** (admin, employé, client),
   puis **créer un utilisateur de test depuis Paramètres et se connecter avec**. C'est le
   seul test qui prouve que la chaîne complète fonctionne.
9. **Seulement alors**, et pas forcément le même jour, appliquer la **PHASE B**
   (retrait des empreintes de `app_data` + remplacement de la policy).
10. Exécuter le **CONTRÔLE APRÈS PHASE B**, puis retester les trois connexions.

La PHASE A seule est déjà un gain net et peut rester en place indéfiniment : `auth-login`
lit `auth_credentials` en priorité et retombe sur les champs inline, donc les deux
emplacements coexistent sans conflit.

## ⚠️ Ce qui casse, dans les deux sens

**Si la base est migrée avant que le code soit déployé** — c'est le scénario grave.
Le bundle actuellement servi en production date d'avant ces correctifs (aucun redéploiement
n'a eu lieu depuis le 14/09, le bouton « Redeploy » n'a pas été cliqué) :

- PHASE B → la policy refuse à la clé publiable toute écriture sur `employes` : plus aucune
  création ni modification d'employé depuis l'application, sans message d'erreur exploitable ;
- PHASE B → les empreintes disparaissent de `app_data`. Si le bundle servi compare encore le
  mot de passe **dans le navigateur** (comportement d'avant `auth-login`), **plus personne ne
  peut se connecter du tout**. C'est la panne totale, au comptoir, pendant les heures d'ouverture.

**Si le code est déployé sans que la base soit migrée** — c'est le scénario bénin, et c'est
l'état actuel :

- la connexion, la lecture, toutes les écritures métier continuent normalement ;
- créer un utilisateur ou changer un mot de passe répond **503** avec un message qui nomme la
  cause. Aucun compte fantôme n'est créé, aucun mot de passe n'est perdu. C'est exactement le
  comportement souhaité tant que la PHASE A n'est pas passée.

➡️ **En cas de doute, déployer le code et ne pas migrer.** L'inverse casse la production.

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

## 🔎 Les chemins du navigateur qui touchent encore `employes` — inventaire complet

Recherche exhaustive dans `src/` le 17/09/2026 (`db.employes.create|update|delete`,
`supabase.from('app_data')`, `password_hash|password_salt|hashPassword`).

**Aucun chemin du navigateur n'écrit plus directement dans `employes` avec la clé publiable.**
Les 6 sites d'écriture passent tous par `CollectionEmployes` (`src/services/db.js`), qui route
vers `/api/employes`, lui-même derrière `exigerSession` + contrôle admin. Le seul usage direct
de `supabase` restant hors de `db.js` est un canal temps réel en **lecture** sur `commandes`
(`src/features/commandes/page.jsx:217`).

| Site d'écriture | Chemin réel | État |
|---|---|---|
| `src/features/employes/page.jsx` 136, 145, 154 | `/api/employes` PATCH/POST/DELETE | ✅ |
| `src/features/parametres/page.jsx` 155, 167, 186, 255 | `/api/employes` PATCH/POST/DELETE | ✅ pour l'écriture |
| `src/services/seed.js` 86 | `/api/employes` POST | ✅ (401 sans session — voulu) |
| `src/services/auth.jsx` `createUser` / `changePassword` | `/api/auth-creer-utilisateur`, `/api/auth-changer-mot-de-passe` | ✅ |

➡️ **La condition posée par la migration 001 est donc remplie.**

### 🟠 Ce qui reste, et qui n'empêche pas la migration

Deux écrans **fabriquent encore l'empreinte dans le navigateur** avec
`src/services/crypto.js`, puis l'envoient au serveur :

- `src/features/parametres/page.jsx` 149-152 et 165-170 → `db.employes.update/create`
- `src/services/seed.js` 84-94 → `db.employes.create`

Ce n'est **pas** une écriture directe en base, et l'algorithme du navigateur
(`SHA-256(sel + mot_de_passe)` hexadécimal) est **identique** à `hacherMotDePasse` côté
serveur. `api/_lib/comptes.js` accepte donc ces empreintes en **pont de compatibilité** et les
range dans `auth_credentials` : c'est ce qui répare le mot de passe perdu sans toucher à ces
écrans, sur lesquels un autre chantier est en cours.

**Ce pont devrait disparaître** : les deux écrans doivent envoyer `motDePasse` en clair (sur
HTTPS) et laisser le serveur générer le sel, comme le fait déjà `/api/auth-creer-utilisateur`.
Tant que ce n'est pas fait, un sel généré par le navigateur suffit — mais le hachage reste du
SHA-256 simple, sans coût de calcul : **ce n'est pas un stockage de mot de passe acceptable à
terme** (bcrypt ou argon2 sont le vrai objectif, avec réinitialisation générale).

Deux détails cosmétiques à corriger dans le même passage, hors périmètre de ce chantier :

- `src/features/parametres/page.jsx:410` teste `emp.password_hash` pour afficher un badge
  « mot de passe défini ». Ce champ est filtré par `/api/employes` depuis toujours : **le badge
  affiche déjà la mauvaise réponse pour les 13 comptes**. Il faudrait le nourrir autrement.
- Le même écran accepte un mot de passe de **6 caractères** là où les endpoints en exigent
  **8** : l'utilisateur reçoit un refus après coup. Aligner sur 8.

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
