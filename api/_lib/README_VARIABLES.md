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
