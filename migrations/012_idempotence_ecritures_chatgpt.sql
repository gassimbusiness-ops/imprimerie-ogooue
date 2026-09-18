-- ════════════════════════════════════════════════════════════════════════════
-- 012 — Rendre l'idempotence des écritures ChatGPT RÉELLE, hors argent
--
--        ✅ **APPLIQUÉE le 2026-09-19 vers 00 h 05 (heure de Moanda)** sur le
--        projet bcwkrrqmjpaohmafcncw. Contrôle préalable refait avant la pose :
--        zéro doublon de `chatgpt_cle` dans les 16 collections. Contrôle après :
--        16 index créés, 16 valides, 0 invalide.
--
--        Note d'exécution : la passerelle SQL enveloppe les requêtes multiples
--        dans une transaction, ce que `CREATE INDEX CONCURRENTLY` interdit. Les
--        seize ordres ont donc été passés UN PAR UN, tels quels, sans retirer le
--        `CONCURRENTLY` — aucun verrou exclusif n'a été pris sur `app_data`.
--
--        (texte d'origine : ⚠️ NON APPLIQUÉE.) Rédigée le 2026-09-18 avec le pont d'écriture
--        ChatGPT. À exécuter par Gassim, dans l'ordre : contrôle (A) d'abord,
--        création (B) ensuite, preuve (C) pour finir.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Code associé    : api/_lib/chatgpt-ecriture.js
--                   src/services/chatgpt-gestes.js
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QUI EST DÉJÀ PROTÉGÉ, ET CE QUI NE L'EST PAS
--
-- Le dirigeant a demandé que ChatGPT écrive SANS confirmation. ChatGPT relance
-- volontiers une requête dont la réponse tarde : chaque écriture porte donc une
-- clé d'idempotence, et la même clé deux fois ne doit produire qu'UNE ligne.
--
-- L'ARGENT EST DÉJÀ SÛR. Tout mouvement écrit par le pont porte
-- `reference = 'chatgpt:<clé>'`, et l'index unique partiel
-- `idx_mouvements_reference_unique` (migration 005, vérifié `indisvalid = true`
-- en production le 18/09/2026) fait rejeter le second INSERT par PostgreSQL
-- avec le code 23505. Deux instances serverless simultanées ne peuvent pas
-- écrire deux fois la même dépense.
--
-- CE QUI NE L'EST PAS : les collections dont le témoin est le champ
-- `chatgpt_cle` — `taches`, `etapes_travaux`, `depots_hebdo`, et, depuis
-- l'élargissement du périmètre, `projets_travaux`, `produits_catalogue`,
-- `produits`, `mouvements_stock`, `rapports`, `commandes`, `clients`,
-- `evenements`, `prospects`, `objectifs`, `clotures_caisse`, `devis` et
-- `factures`. Ces
-- lignes portent la clé dans `chatgpt_cle`, et le pont la cherche AVANT
-- d'écrire. Cette lecture préalable referme la fenêtre courante — une relance
-- quelques secondes plus tard — mais PAS la course vraie : deux instances qui
-- reçoivent la même clé à la même milliseconde font toutes les deux leur
-- lecture, ne trouvent rien, et écrivent toutes les deux. C'est le
-- « check-then-act » décrit en tête de `src/services/execution-unique.js`, et
-- le verrou d'exécution unique du pont ne couvre qu'UNE instance.
--
-- CONSÉQUENCE SI RIEN N'EST FAIT : au pire, une tâche, une fiche client ou un
-- article de catalogue en double. **Aucun franc n'est en jeu** : toute ligne
-- d'argent écrite par le pont porte une `reference` protégée par l'index de la
-- migration 005 — y compris le mouvement d'une étape de travaux payée et celui
-- d'un mouvement de stock. C'est pour cela que cette migration n'est pas
-- urgente : elle empêche un doublon gênant, pas une perte d'argent.
--
-- ⚠️ DEUX CAS MÉRITENT L'INDEX PLUS QUE LES AUTRES :
--   · `clotures_caisse` — deux clôtures du même soir compteraient l'écart deux
--     fois dans les statistiques. Le pont vérifie déjà la clé (date, activité)
--     avant d'écrire, mais cette vérification est une lecture préalable ;
--   · `rapports` — deux rapports le même jour et la même activité doublent le
--     chiffre d'affaires de la journée.

-- ════════════════════════════════════════════════════════════════════════════
-- A. AVANT — mesurer, ne pas supposer
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un index unique se crée sur des données déjà uniques, sinon il échoue. On
-- vérifie donc qu'aucun doublon de clé n'existe déjà :
--
-- SELECT collection, data->>'chatgpt_cle' AS cle, count(*)
-- FROM app_data
-- WHERE collection IN ('taches', 'etapes_travaux', 'depots_hebdo',
--                      'projets_travaux', 'produits_catalogue', 'produits',
--                      'mouvements_stock', 'rapports', 'commandes', 'clients',
--                      'evenements', 'prospects', 'objectifs',
--                      'clotures_caisse', 'devis', 'factures')
--   AND data->>'chatgpt_cle' IS NOT NULL
--   AND data->>'chatgpt_cle' <> ''
-- GROUP BY 1, 2
-- HAVING count(*) > 1;
--
-- → Doit renvoyer ZÉRO ligne. S'il en renvoie, décider d'abord laquelle garder
--   (décision métier : laquelle correspond à ce qui a vraiment eu lieu ?), et
--   NE PAS supprimer l'autre : la marquer annulée, comme le fait le pont
--   (`annule_le`), pour que la trace reste.
--
-- [MESURE le 18/09/2026 sur la base de production, en LECTURE SEULE, avant la
--  mise en service du pont d'écriture]
--
--   SELECT count(*) FROM app_data
--   WHERE data ? 'chatgpt_cle' OR data ? 'via_chatgpt';
--   → 0
--
-- AUCUNE ligne, dans AUCUNE collection, ne porte encore la clé ni le marqueur.
-- Les seize index peuvent donc être créés tels quels, sans dédoublonnage
-- préalable. Volumes du jour, pour mémoire : rapports 237, mouvements_financiers
-- 32, etapes_travaux 18, taches 3, projets_travaux 1, le reste à zéro.

-- ════════════════════════════════════════════════════════════════════════════
-- B. L'INDEX — un par collection
-- ════════════════════════════════════════════════════════════════════════════
--
-- Index PARTIELS, pour trois raisons, les mêmes qu'à la migration 005 :
--   - `app_data` héberge TOUTES les collections : sans la clause `WHERE`, deux
--     collections différentes ne pourraient pas porter la même clé ;
--   - les lignes sans `chatgpt_cle` sont ignorées — ce sont les saisies faites
--     à l'écran par le gérant, qui n'ont aucune raison d'être uniques ;
--   - `CONCURRENTLY` évite de verrouiller la table pendant la création.
--
-- ⚠️ `CREATE INDEX CONCURRENTLY` ne peut PAS tourner dans une transaction.
--    Dans l'éditeur SQL de Supabase, exécuter CHAQUE instruction SEULE.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_taches
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'taches'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_etapes_travaux
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'etapes_travaux'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_depots_hebdo
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'depots_hebdo'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_projets_travaux
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'projets_travaux'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_produits_catalogue
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'produits_catalogue'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_produits
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'produits'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_mouvements_stock
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'mouvements_stock'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_rapports
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'rapports'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_commandes
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'commandes'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_clients
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'clients'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_evenements
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'evenements'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_prospects
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'prospects'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_objectifs
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'objectifs'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_clotures_caisse
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'clotures_caisse'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_devis
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'devis'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chatgpt_cle_factures
  ON app_data ((data->>'chatgpt_cle'))
  WHERE collection = 'factures'
    AND data->>'chatgpt_cle' IS NOT NULL
    AND data->>'chatgpt_cle' <> '';

-- Le code fonctionne DÉJÀ sans ces index (il fait sa lecture préalable) : cette
-- migration le rend sûr, elle ne le rend pas fonctionnel. `depot.creer()`
-- reconnaît le code 23505 et rend `{ insere: false }` — l'écriture est alors
-- constatée, pas rejouée, et aucun solde n'est touché une seconde fois.

-- ════════════════════════════════════════════════════════════════════════════
-- C. APRÈS — contrôle
-- ════════════════════════════════════════════════════════════════════════════
--
-- Les trois index existent et sont VALIDES :
--
-- SELECT i.relname AS index, idx.indisvalid, idx.indisunique
-- FROM pg_index idx
-- JOIN pg_class i ON i.oid = idx.indexrelid
-- WHERE i.relname LIKE 'idx_chatgpt_cle_%';
--
-- Une création CONCURRENTLY interrompue laisse un index INVALIDE qui ne protège
-- rien tout en occupant de la place : si `indisvalid` est false, le retirer
-- (`DROP INDEX idx_chatgpt_cle_<collection>;`) et recommencer.

-- ════════════════════════════════════════════════════════════════════════════
-- D. RETOUR ARRIÈRE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un DROP par index créé ci-dessus, par exemple :
-- DROP INDEX CONCURRENTLY IF EXISTS idx_chatgpt_cle_taches;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_chatgpt_cle_clotures_caisse;
-- (la liste complète des noms se lit avec la requête du § C)
--
-- Retirer ces index ne casse rien : on revient exactement à l'état d'avant,
-- c'est-à-dire à la lecture préalable seule.
