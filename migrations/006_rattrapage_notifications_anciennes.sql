-- ════════════════════════════════════════════════════════════════════════════
-- 006 — Rattraper les anciennes notifications client
--
--        ✅ APPLIQUÉE EN PRODUCTION LE 2026-09-17, sur accord explicite.
--           Rédigée d'abord d'après une mesure en lecture seule, puis exécutée
--           dans l'ordre prescrit : simulation, correctif, contrôles.
--
--        CE QUI A ÉTÉ MESURÉ À L'EXÉCUTION :
--          simulation avant écriture ......... 18 lignes
--          UPDATE réellement appliqué ........ 18 lignes
--          restant à corriger après .......... 0
--          notifications du PERSONNEL encore
--            sur /commandes, donc intactes ... 16
--          total notifications, avant/après .. 92 / 92 (rien créé ni supprimé)
--
--        ⚠️ Les 16 intactes : le rapport de mesure en annonçait 15. La 16ᵉ est
--           une `commande_validee` adressée à un EMPLOYÉ (rôle `employe`, pas
--           `client`) : /commandes est le bon lien pour elle, et le filtre l'a
--           correctement laissée. Prédiction légèrement fausse, filtre juste.
--
--        CE QUI A ÉTÉ MESURÉ, ET NON SUPPOSÉ (2026-09-17) :
--          notifications_app ................................ 92 lignes
--          dont lues ........................................ 11
--          destinataire = un rôle ('admin' 52, 'all_staff' 8,
--            'client' 1) .................................... 61
--          destinataire = un UUID ........................... 31
--            · identifiant de COMPTE (employes.id) .......... 25
--            · identifiant de FICHE  (clients.id) ...........  6
--            · orphelin (ni l'un ni l'autre) ................  0
--          lien = '/commandes' .............................. 34
--            · type du PERSONNEL, lien correct .............. 15
--            · type `pourClient`, lien FAUX ................. 19
--
--        CONCLUSION DE LA MESURE, EN UNE LIGNE :
--          le volet « destinataire » n'a RIEN à corriger (voir § B),
--          le volet « lien » en a 19 (voir § C). Le script ne fait que le
--          second. Corriger le premier est impossible, pas seulement inutile.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Code associé    : src/services/notifications.js
--                   src/services/compte-client.js
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ LE PIÈGE DE CETTE MIGRATION — il n'était visible qu'en mesurant.
--
-- Le critère évident est « corriger toutes les notifications dont le lien vaut
-- /commandes ». Il est FAUX, et il casserait 15 lignes.
--
--   34 notifications portent `lien: '/commandes'`.
--   15 d'entre elles sont des types du PERSONNEL — `nouvelle_commande` (13) et
--   `rappel_operateur` (2) — pour lesquels `/commandes` est le BON lien : elles
--   s'adressent à `admin`, à `all_staff` ou à un opérateur, qui ont tous accès
--   à cet écran. Les envoyer sur `/client/commandes` reviendrait à sortir le
--   gérant de son propre logiciel à chaque clic.
--
-- Le tri ne se fait donc PAS sur le lien, mais sur le TYPE, et sur le RÔLE du
-- compte destinataire. C'est le même genre de détail que le `NULLIF` de la
-- migration 005 : invisible tant qu'on n'a pas compté.
--
-- ⚠️ SECOND POINT, de vocabulaire, qui a failli faire écrire le mauvais script.
--
-- Le champ ne s'appelle PAS `destinataire_id`. Il s'appelle `destinataire`, et
-- il est présent sur 92 lignes sur 92. `destinataire_id` n'existe que sur UNE
-- ligne (la confirmation de paiement SingPay), où il sert d'affinage nominatif
-- à une diffusion au rôle `client`. Tout script écrit contre `destinataire_id`
-- toucherait une ligne sur 92.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A. AVANT — contrôle, lecture seule, sans effet
-- ════════════════════════════════════════════════════════════════════════════

-- A.1 — La photo d'ensemble. Doit rendre 92 / 11 au 2026-09-17.

SELECT count(*)                                       AS total,
       count(*) FILTER (WHERE (data->'lu')::boolean)  AS lues,
       count(*) FILTER (WHERE NOT (data->'lu')::boolean) AS non_lues
FROM app_data
WHERE collection = 'notifications_app';

-- A.2 — Le destinataire est-il un compte, une fiche, ou un rôle ?
--
-- `employes` est la table des COMPTES de l'application : elle contient aussi
-- les lignes de rôle `client`. `clients` est l'annuaire des FICHES, et le lien
-- entre les deux est `clients.user_id`. Voir src/services/compte-client.js.

WITH n AS (
  SELECT data->>'destinataire' AS dest
  FROM app_data WHERE collection = 'notifications_app'
),
comptes AS (SELECT data->>'id' AS cid FROM app_data WHERE collection = 'employes'),
fiches  AS (SELECT data->>'id' AS fid FROM app_data WHERE collection = 'clients')
SELECT CASE
         WHEN dest IN ('admin','all_staff','client','employe','manager') THEN 'rôle : ' || dest
         WHEN EXISTS (SELECT 1 FROM comptes c WHERE c.cid = n.dest)      THEN 'COMPTE (employes.id)'
         WHEN EXISTS (SELECT 1 FROM fiches  f WHERE f.fid = n.dest)      THEN 'FICHE  (clients.id)'
         ELSE 'UUID orphelin'
       END AS classe,
       count(*) AS lignes
FROM n GROUP BY 1 ORDER BY 2 DESC;

-- A.3 — Les liens, ventilés par type. C'est cette requête qui révèle le piège.

SELECT data->>'type' AS type,
       data->>'lien' AS lien,
       count(*)      AS lignes,
       count(*) FILTER (WHERE (data->'lu')::boolean) AS lues
FROM app_data
WHERE collection = 'notifications_app'
GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- ════════════════════════════════════════════════════════════════════════════
-- B. LE VOLET « DESTINATAIRE » — MESURÉ, PUIS ABANDONNÉ
-- ════════════════════════════════════════════════════════════════════════════
--
-- 6 notifications portent un identifiant de FICHE. Les six sont de type
-- `facture_disponible`, écrites entre le 2026-05-31 et le 2026-06-03, et
-- AUCUNE n'est lue. Le rattrapage consisterait à remplacer l'id de fiche par
-- l'id du compte rattaché — comme le fait désormais `resoudreCompteClient()`.
--
-- IL N'Y A AUCUN COMPTE À METTRE À LA PLACE.
--
-- Les six fiches visées — TEST_E2E_NouveauClient2, SNEEM, Client test (deux
-- fois), GABON MINING, SODIM TP — portent toutes `user_id = NULL`. Sur les
-- 14 fiches de l'annuaire, UNE SEULE est rattachée à un compte portail
-- (« Ibrahim Abakar »). Ces six clients n'ont pas de compte : il n'existe
-- personne, nulle part, qui puisse lire ces lignes.
--
-- C'est exactement le cas `CIBLE_CLIENT.SANS_COMPTE` de compte-client.js. La
-- règle du code est de NE PAS ÉCRIRE la notification dans ce cas ; la règle de
-- cette migration est symétrique : ne pas prétendre réparer ce qui n'a pas de
-- destinataire possible.
--
-- Poser un `destinataire_id` sur ces lignes ne les rendrait pas lisibles non
-- plus : `getNotifications()` ne consulte `destinataire_id` que dans la branche
-- « le destinataire est un RÔLE ». Sur un destinataire UUID, il est ignoré.
--
-- Contrôle qui établit le fait (lecture seule) — doit rendre 6 lignes, toutes
-- avec `compte_rattache` vide :

SELECT n.data->>'type'    AS type,
       n.data->>'message' AS message,
       f.data->>'nom'     AS fiche,
       f.data->>'user_id' AS compte_rattache,
       n.data->>'lu'      AS lu,
       n.created_at::date AS ecrite_le
FROM app_data n
JOIN app_data f
  ON f.collection = 'clients'
 AND f.data->>'id' = n.data->>'destinataire'
WHERE n.collection = 'notifications_app'
ORDER BY n.created_at;

-- CE QU'IL FAUT FAIRE À LA PLACE — et qui n'est pas du SQL :
--   1. Ces six factures existent et sont dues. Le canal n'a jamais fonctionné :
--      prévenir ces clients par téléphone ou WhatsApp, une fois.
--   2. Rattacher la fiche au compte (`clients.user_id`) le jour où l'un de ces
--      clients crée un compte sur le portail. C'est le seul geste qui rend les
--      notifications futures lisibles — et il est déjà fait à l'inscription.
--   3. Deux des six fiches sont des fiches de TEST (« TEST_E2E_NouveauClient2 »,
--      « Client test »). Leur sort relève du nettoyage des données de test,
--      pas de ce fichier.

-- ════════════════════════════════════════════════════════════════════════════
-- C. LE VOLET « LIEN » — LE SEUL CORRECTIF DE CETTE MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- 19 notifications de type client portent `lien: '/commandes'`, une route du
-- PERSONNEL. Un compte de rôle `client` qui clique dessus est renvoyé sur son
-- tableau de bord par src/app.jsx:69, sans comprendre pourquoi. Le lien juste
-- est `/client/commandes`.
--
-- Ventilation mesurée le 2026-09-17, par rôle du compte destinataire :
--   rôle `client` ..... 18 lignes (4 lues, 14 non lues)   ← à corriger
--   rôle `employe` ....  1 ligne  (0 lue,   1 non lue)    ← à décider, voir C.2
--
-- Les 8 `facture_disponible` portent déjà `/client/factures` : rien à y faire.
-- Aucune `commande_annulee` ni `nouveau_message_client` n'existe en base.
--
-- ⚠️ CORRIGER UNE NOTIFICATION DÉJÀ LUE A-T-IL UN SENS ?
--    Oui, ici, et c'est une différence avec le destinataire. Une notification
--    lue reste dans la liste et reste cliquable : réparer son lien répare un
--    clic futur. Les 4 lignes lues sont donc incluses. Si Gassim préfère ne
--    toucher qu'aux non-lues, ajouter à la clause WHERE :
--        AND NOT (n.data->'lu')::boolean            -- passe de 18 à 14 lignes

-- ─── C.1 — LE CORRECTIF (18 lignes attendues) ───────────────────────────────
--
-- ⚠️ `jsonb_set(..., true)` : le quatrième argument crée la clé si elle manque.
--    Ici elle existe sur les 19 lignes visées, mais 3 notifications de la table
--    n'ont AUCUNE clé `lien` (`nouveau_client` ×2, `paiement_echoue` ×1, toutes
--    écrites hors de `createNotification`). Elles ne sont pas visées par le
--    WHERE ci-dessous, et ne doivent pas l'être.
--
-- ⚠️ `updated_at` est mis à jour sur les DEUX faces : la colonne et le champ du
--    document. `db.list()` ne rend que `data` (src/services/db.js) : une colonne
--    modifiée sans son champ JSON est invisible pour l'application.
--
-- À EXÉCUTER DANS UNE TRANSACTION, et à relire avant COMMIT.

BEGIN;

UPDATE app_data n
SET data = jsonb_set(
             jsonb_set(n.data, '{lien}', '"/client/commandes"'::jsonb, true),
             '{updated_at}', to_jsonb(now()::text), true
           ),
    updated_at = now()
FROM app_data c
WHERE n.collection = 'notifications_app'
  AND c.collection = 'employes'
  AND c.data->>'id' = n.data->>'destinataire'
  AND c.data->>'role' = 'client'
  AND n.data->>'type' IN ('commande_validee', 'commande_production',
                          'commande_prete', 'commande_livree', 'commande_annulee')
  AND n.data->>'lien' = '/commandes';

-- Attendu : UPDATE 18. Tout autre nombre = STOP, ROLLBACK, re-mesurer.
-- Si le compte est bon :
--   COMMIT;
-- sinon :
--   ROLLBACK;

-- ─── C.2 — LE CAS À UNE LIGNE, À TRANCHER SÉPARÉMENT ────────────────────────
--
-- Une `commande_validee` vise le compte « Opérateur Acceuil », de rôle
-- `employe`, qui a passé une commande depuis le PORTAIL (commande
-- fe560e2f-…, source `portail_client`). Elle est donc adressée à un membre du
-- personnel agissant comme client.
--
-- L'argument dans un sens : c'est SA commande, et `/client/commandes` est le
-- seul écran où il la voit comme un client la voit.
-- L'argument dans l'autre : il a accès à `/commandes`, où il voit la même
-- commande avec les outils du personnel. Rien n'est cassé aujourd'hui.
--
-- Une ligne, non lue, écrite le 2026-05-31. Aucun des deux choix n'a d'enjeu.
-- Elle est volontairement EXCLUE de C.1 ; pour l'inclure, remplacer
-- `c.data->>'role' = 'client'` par `c.data->>'role' IN ('client','employe')`.

-- ─── C.3 — CE QUE CETTE MIGRATION NE TOUCHE PAS, ET POURQUOI ────────────────
--
-- `fidelite_clients` : 3 dossiers, sur 3 identifiants de COMPTE distincts.
-- Zéro dossier sur un identifiant de fiche, zéro client avec deux dossiers,
-- zéro point mal placé. Le défaut de code existe (le `client_id` brut de la
-- commande est utilisé comme clé), mais les 5 commandes de la base viennent
-- TOUTES du portail : le mécanisme n'a jamais eu l'occasion de produire un
-- doublon. Il n'y a rien à corriger en base. Voir
-- livrables_claude/28_DONNEES_A_RATTRAPER.md.

-- ════════════════════════════════════════════════════════════════════════════
-- D. APRÈS — contrôle
-- ════════════════════════════════════════════════════════════════════════════

-- D.1 — Plus aucune notification de type client ne pointe vers /commandes
--       pour un compte de rôle `client`. Attendu : 0.

SELECT count(*) AS restent_a_corriger
FROM app_data n
JOIN app_data c
  ON c.collection = 'employes' AND c.data->>'id' = n.data->>'destinataire'
WHERE n.collection = 'notifications_app'
  AND c.data->>'role' = 'client'
  AND n.data->>'type' IN ('commande_validee', 'commande_production',
                          'commande_prete', 'commande_livree', 'commande_annulee')
  AND n.data->>'lien' = '/commandes';

-- D.2 — Les liens du PERSONNEL n'ont pas bougé. Attendu : 15 (13 + 2).

SELECT data->>'type' AS type, count(*) AS lignes
FROM app_data
WHERE collection = 'notifications_app'
  AND data->>'lien' = '/commandes'
GROUP BY 1 ORDER BY 2 DESC;
-- Attendu exactement : nouvelle_commande 13, rappel_operateur 2.
-- Si un type `commande_*` apparaît encore ici, c'est la ligne de C.2.

-- D.3 — Rien n'a été créé ni supprimé. Attendu : 92, et 11 lues.

SELECT count(*) AS total,
       count(*) FILTER (WHERE (data->'lu')::boolean) AS lues
FROM app_data WHERE collection = 'notifications_app';

-- D.4 — La colonne et le champ JSON disent la même chose sur les lignes
--       touchées. Attendu : 0 ligne divergente.

SELECT count(*) AS incoherences
FROM app_data
WHERE collection = 'notifications_app'
  AND data->>'lien' = '/client/commandes'
  AND (data->>'updated_at') IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- E. RETOUR ARRIÈRE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cette migration change UN champ, sur des lignes identifiables par leur type.
-- Le retour arrière est le même UPDATE dans l'autre sens, et il est exact :
-- avant l'intervention, les 19 notifications de type `commande_*` portaient
-- TOUTES `/commandes`, sans exception (mesuré en A.3). Aucune information
-- n'est perdue par l'aller, donc aucune n'est inventée par le retour.
--
-- Attendu au retour : 18 lignes (ou 19 si C.2 a été inclus).
--
--   BEGIN;
--   UPDATE app_data n
--   SET data = jsonb_set(n.data, '{lien}', '"/commandes"'::jsonb, true),
--       updated_at = now()
--   FROM app_data c
--   WHERE n.collection = 'notifications_app'
--     AND c.collection = 'employes'
--     AND c.data->>'id' = n.data->>'destinataire'
--     AND c.data->>'role' = 'client'
--     AND n.data->>'type' IN ('commande_validee', 'commande_production',
--                             'commande_prete', 'commande_livree', 'commande_annulee')
--     AND n.data->>'lien' = '/client/commandes';
--   -- relire le compte, puis COMMIT; ou ROLLBACK;
--
-- Aucun index, aucune fonction, aucune contrainte n'est posée par ce fichier :
-- il n'y a rien d'autre à défaire.
