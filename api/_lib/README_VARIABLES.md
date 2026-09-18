# Variables d'environnement du serveur — où elles vivent, ce qu'elles font

> Aucune VALEUR ne figure ici, et aucune ne doit jamais y figurer.
> Ce fichier dit seulement quelles variables existent, à quoi elles servent,
> et ce qui casse quand elles manquent.

| Variable | Sert à | Absente ⇒ |
|---|---|---|
| `SESSION_SECRET` | signer le jeton de session HMAC (`api/_lib/session.js`) | tous les endpoints protégés renvoient 401 |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | accès base côté serveur | aucune lecture ni écriture |
| `ANTHROPIC_API_KEY` | analyses IA | « Impossible de contacter le service IA » |
| `ANTHROPIC_MODEL` | nom du modèle — **configuration, jamais en dur** | repli sur le défaut de `modeles.js` |
| `OPENAI_API_KEY` | génération des mockups | l'écran Mockups ne génère plus |
| `SINGPAY_*` | encaissement Mobile Money | paiement indisponible |
| `SINGPAY_CALLBACK_SECRET` | secret partagé dans l'URL de rappel | le rappel est accepté sans ce contrôle |
| `META_VERIFY_TOKEN` | prouver à Meta que l'adresse de rappel est la nôtre | **403 — refus par défaut, voulu** |
| `META_APP_SECRET` | vérifier la signature de chaque message Meta | **403 — refus par défaut, voulu** |
| `META_PAGE_ACCESS_TOKEN` | publier sur la Page et sur Instagram (`api/_lib/autopost-meta.js`) | **simulation, sans aucun appel réseau — voulu** |
| `BOT_META_MODE` | `live` pour que le bot Messenger / Instagram ENVOIE réellement ses réponses ; toute autre valeur = simulation | **simulation — le bot compose et journalise, il n'envoie rien** |
| `META_PAGE_ID` · `META_INSTAGRAM_ID` | *facultatives.* Limiter le bot aux comptes de l'imprimerie — le jeton voit AUSSI la Page TopShop, dont les actifs sont dans le même portefeuille | le bot répond sur le compte qui a reçu le message, quel qu'il soit |
| `AUTOPOST_MODE` | `live` pour publier réellement ; toute autre valeur = simulation | simulation |
| `AUTOPOST_CLE_APPROBATION` | vérifier la signature HMAC des `APPROBATION.json` | la signature n'est pas contrôlée ; l'empreinte du contenu l'est toujours |
| `CRON_SECRET` | authentifier les tâches planifiées Vercel sur `/api/autopost-tick` | **toute tâche planifiée est refusée — voulu** |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` · `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` · `DRIVE_DOSSIER_PUBLICATIONS_ID` | lire le dossier `10_PUBLICATIONS/` du Drive en lecture seule | pas de lecture du Drive ; le dépôt se fait depuis l'application |
| `CHATGPT_BRIDGE_TOKEN` | ouvrir le pont de lecture `/api/chatgpt-*` à un GPT personnalisé (`api/chatgpt.js`) | **503 sur toutes les voies — le pont ne sert rien, y compris son schéma. Voulu.** |

## Le pont ChatGPT

`CHATGPT_BRIDGE_TOKEN` est **l'accès entier** : qui l'a, lit les salaires, la
trésorerie, le fichier clients et le journal d'audit. Il ne se partage pas.

- **32 caractères minimum** (`openssl rand -hex 32`). Plus court ⇒ traité comme absent.
- Comparé **à temps constant** (`empreintesEgales`), comme la signature de session.
- 🔴 **Révocation en dix secondes** : changer la valeur dans Vercel → Redeploy.
  Valeur changée ⇒ 401 à chaque appel ; variable supprimée ⇒ 503 et plus rien
  n'est servi. Aucune modification de code.
- Ce que le pont ne donnera **jamais**, quel que soit le jeton : les empreintes
  de mots de passe et leurs sels. Un test échoue si l'une d'elles apparaît.
- Mode d'emploi complet : `livrables_claude/PONT_CHATGPT.md`.

## Les variables de l'auto-poster

⛔ **Aucune ne porte le préfixe `VITE_`.** Ce préfixe demande à Vite d'inclure la valeur
dans le bundle envoyé au navigateur : un jeton de Page Meta y deviendrait public, et il
porte `ads_management` **sans plafond de dépense**.

**Il faut QUATRE verrous ouverts en même temps pour qu'une publication réelle parte**, et
aucun ne suffit seul :

1. `META_PAGE_ACCESS_TOKEN` présent ;
2. la ligne `autopost_controle` à `actif = true` et `mode = 'live'` — le verrou
   d'exploitation, qui se bascule en 10 secondes sans redéploiement ;
3. `AUTOPOST_MODE=live` — le cran de sûreté de déploiement, qui exige lui un
   redéploiement, et c'est précisément pour ça qu'il est un mauvais arrêt d'urgence et une
   bonne sécurité de fond ;
4. `mode_execution: "live"` sur la publication elle-même.

Les points 2 et 3 sont **deux verrous indépendants** : ni une ligne de base modifiée par
erreur, ni une variable oubliée à `live` dans Vercel ne peut mettre la Page de l'entreprise
en ligne toute seule. `tests/autopost-executeur.test.mjs` vérifie les deux sens.

Tant qu'il en manque une, le passage est journalisé comme **simulé** et ne touche pas le
réseau. C'est ce qui permet à toute la chaîne d'être développée, testée et relue **avant**
que le jeton n'existe.

`CRON_SECRET` : sans lui, `/api/autopost-tick` refuse les tâches planifiées. Une URL
publique capable de publier sur la Page de l'entreprise n'est pas une option. Un
administrateur connecté peut toujours déclencher un passage depuis l'écran.

Les trois variables `GOOGLE_*` / `DRIVE_*` ne sont **pas** posées aujourd'hui : elles
attendent que Gassim crée le compte de service et partage le seul dossier
`10_PUBLICATIONS/` avec lui, en Lecteur. La procédure est en tête de `api/autopost.js`.

## Les deux variables Meta

`META_VERIFY_TOKEN` est une chaîne aléatoire que **nous** choisissons. Elle doit être
identique **au caractère près** dans Vercel et dans le champ « Verify token » de Meta :
sinon Meta refuse l'URL **sans dire pourquoi**. C'est la panne la plus fréquente de cette
étape.

`META_APP_SECRET` vient de Meta (Paramètres de base de l'application).

Les deux doivent porter la **portée Production ET Preview**. Sans Preview, rien ne peut
être testé avant de brancher la production — c'est exactement le mur rencontré avec
`SESSION_SECRET` le 15/09.

⚠️ Le refus par défaut est délibéré : un endpoint qui accepterait n'importe quel jeton
parce que la variable est vide serait pire qu'un endpoint absent.

## Le bot Messenger et Instagram

`META_PAGE_ACCESS_TOKEN` sert **deux** chaînes : l'auto-poster publie avec, le bot répond
avec. Une seule variable, un seul jeton — mais deux modules, `autopost-meta.js` et
`bot-envoi.js`, parce que publier et répondre ne se diagnostiquent pas pareil.

⛔ **Le bot démarre ÉTEINT, et il faut DEUX verrous pour qu'il parle :**

1. la ligne `bot_controle` (collection `app_data`, marquée `cle: 'global'`) avec
   `actif: true` et `mode: 'live'` — c'est le **verrou d'exploitation**, il se bascule en
   dix secondes depuis l'écran Messagerie ou la console Supabase, sans redéploiement ;
2. `BOT_META_MODE=live` dans Vercel — c'est le **cran de sûreté de déploiement**, et le
   changer exige un redéploiement, ce qui en fait volontairement un mauvais arrêt
   d'urgence et une bonne sécurité de fond.

Aucun des deux n'ouvre seul. Une ligne de base modifiée par erreur ne met donc pas le bot
en face des clients, et une variable oubliée à `live` dans Vercel non plus.
`tests/bot-executeur.test.mjs` vérifie les deux sens.

⚠️ **Couper le bot ne demande AUCUNE variable** : c'est la ligne `bot_controle` qu'on passe
à `actif: false`, et le bouton existe dans l'écran Messagerie. Le rallumer, en revanche,
est un geste de déploiement — c'est voulu.
