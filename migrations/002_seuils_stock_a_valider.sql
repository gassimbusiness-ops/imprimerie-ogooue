-- ════════════════════════════════════════════════════════════════════════════
-- 002 — Seuils d'alerte de stock écrasés par l'écran Stock
--
--        ⚠️  CE FICHIER N'A PAS ÉTÉ APPLIQUÉ. AUCUN `UPDATE` N'A ÉTÉ EXÉCUTÉ.
--        Il attend une décision de Gassim, article par article.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Rédigé le       : 2026-09-15
-- Correctif de code associé : src/features/stocks/page.jsx (l'écriture dans
--                             `load()` a été supprimée) + src/services/stocks-seuils.js
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QUI S'EST PASSÉ
--
-- `src/features/stocks/page.jsx:249-272` contenait, à l'intérieur de `load()`,
-- une « auto-correction » qui s'exécutait à CHAQUE ouverture de l'écran Stock :
--
--     if (type === 'consommable' && seuil < 10) {
--       updates.quantite_minimum = 10;
--       db.produits.update(item.id, updates).catch(() => {});
--     }
--
-- Tout seuil de consommable inférieur à 10 était donc remonté à 10, en base,
-- silencieusement, sans trace et sans message. Le gérant réglait « Papier
-- opaque » à 3 ; le lendemain l'écran le remontait à 10 puis l'alertait « 9/10 ».
--
-- ÉTAT MESURÉ LE 2026-09-15 (lecture seule) :
--   • 45 articles dans `produits`
--   • 26 articles ont un `quantite_minimum` valant EXACTEMENT 10
--   • aucun consommable n'a de seuil inférieur à 10
--   • les 5 seuls articles sous 10 sont des `type_article = 'machine'`
--     (seuil 5), que la condition ignorait
--
-- POURQUOI AUCUN `UPDATE` N'EST APPLIQUÉ AUTOMATIQUEMENT
--
-- On ne peut PAS distinguer, parmi les 26 articles à 10 :
--   (a) ceux dont le gérant a délibérément choisi 10 ;
--   (b) ceux dont la valeur choisie (3, 5, 1…) a été écrasée par le bug.
-- L'information d'origine n'existe plus : l'écrasement ne laissait pas de trace.
-- Écrire une valeur arbitraire à leur place reproduirait exactement le défaut
-- qu'on vient de corriger. La décision revient au gérant.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ÉTAPE 1 — CONSTAT (lecture seule, sans risque, à exécuter en premier)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.a — Les 26 articles suspects : consommables au seuil exactement 10.
--       C'est la liste à passer en revue avec le gérant.
SELECT
  id,
  data->>'nom'               AS article,
  data->>'categorie'         AS categorie,
  COALESCE(data->>'type_article', 'consommable') AS type_article,
  (data->>'quantite')::numeric          AS quantite,
  (data->>'quantite_minimum')::numeric  AS seuil_actuel,
  CASE
    WHEN (data->>'quantite')::numeric <= 10 THEN 'EN ALERTE à cause du seuil 10'
    ELSE ''
  END AS effet_visible,
  updated_at
FROM app_data
WHERE collection = 'produits'
  AND COALESCE(data->>'type_article', 'consommable') = 'consommable'
  AND (data->>'quantite_minimum') = '10'
ORDER BY (data->>'quantite')::numeric ASC, data->>'nom';

-- 1.b — Vue d'ensemble : répartition des seuils, pour mesurer l'ampleur.
SELECT
  COALESCE(data->>'type_article', 'consommable') AS type_article,
  (data->>'quantite_minimum')::numeric           AS seuil,
  count(*)                                       AS nb_articles
FROM app_data
WHERE collection = 'produits'
GROUP BY 1, 2
ORDER BY 3 DESC, 2;

-- 1.c — Les fausses alertes actuellement affichées au gérant :
--       articles marqués « Bas » UNIQUEMENT parce que le seuil vaut 10.
--       (« Papier opaque 9/10 » est ici.)
SELECT
  data->>'nom'                          AS article,
  (data->>'quantite')::numeric          AS quantite,
  (data->>'quantite_minimum')::numeric  AS seuil
FROM app_data
WHERE collection = 'produits'
  AND COALESCE(data->>'type_article', 'consommable') = 'consommable'
  AND (data->>'quantite_minimum') = '10'
  AND (data->>'quantite')::numeric > 0
  AND (data->>'quantite')::numeric <= 10
ORDER BY (data->>'quantite')::numeric;

-- ════════════════════════════════════════════════════════════════════════════
-- ÉTAPE 2 — SAUVEGARDE OBLIGATOIRE AVANT TOUT `UPDATE`
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter AVANT toute écriture, et à conserver : c'est le chemin de retour
-- arrière de l'étape 3. Aucune donnée n'est supprimée, on copie.
--
-- CREATE TABLE IF NOT EXISTS sauvegarde_seuils_20260915 AS
-- SELECT id, collection, data, created_at, updated_at
-- FROM app_data
-- WHERE collection = 'produits';
--
-- Retour arrière (restaure les seuils tels qu'ils sont aujourd'hui) :
-- UPDATE app_data a
-- SET data = jsonb_set(a.data, '{quantite_minimum}', s.data->'quantite_minimum', true)
-- FROM sauvegarde_seuils_20260915 s
-- WHERE a.id = s.id;

-- ════════════════════════════════════════════════════════════════════════════
-- ÉTAPE 3 — CORRECTIF DE DONNÉES — À VALIDER PAR GASSIM, PUIS DÉCOMMENTER
--           Trois options. En choisir UNE. Aucune n'est appliquée en l'état.
-- ════════════════════════════════════════════════════════════════════════════

-- ── OPTION A (RECOMMANDÉE) — ne rien écrire du tout ────────────────────────
-- Le code est corrigé : l'écran n'écrase plus rien et le champ « Seuil min »
-- est éditable article par article. Le gérant reprend simplement les articles
-- qui l'intéressent (liste de la requête 1.c : une poignée) et fixe la vraie
-- valeur. C'est la seule option où chaque seuil est une décision humaine.
-- Aucun SQL à exécuter.

-- ── OPTION B — poser 5 sur les suspects ────────────────────────────────────
-- ⚠️ À lire avant de choisir cette option : la valeur d'origine N'EST PAS
-- récupérable. Le jeu d'amorçage (`src/services/seed.js`) utilise des seuils
-- VARIÉS — 1, 2, 3, 5, 20 selon l'article — et, surtout, aucun de ses articles
-- ne correspond aux articles réellement en base (le seed parle d'« Encre noire
-- imprimante jet » ou « Rame papier A4 80g » ; la production contient « Papier
-- opaque », « Polo blanc asiatique »…, saisis à la main par le gérant).
-- Écrire 5 partout, c'est donc poser une valeur inventée — plus douce que 10,
-- mais inventée quand même. À ne retenir que si le gérant DIT explicitement
-- que 5 lui convient comme point de départ pour ces 26 articles.
-- Le filtre est volontairement étroit : seuls les CONSOMMABLES à EXACTEMENT 10.
--
-- UPDATE app_data
-- SET data = jsonb_set(data, '{quantite_minimum}', '5'::jsonb, true),
--     updated_at = now()
-- WHERE collection = 'produits'
--   AND COALESCE(data->>'type_article', 'consommable') = 'consommable'
--   AND (data->>'quantite_minimum') = '10';
-- -- Attendu : 26 lignes.

-- ── OPTION C — vider le seuil pour forcer un réglage conscient ──────────────
-- Met les 26 suspects à 0 : plus aucune alerte sur ces articles tant que le
-- gérant n'a pas saisi sa valeur. Honnête, mais aveugle en attendant : pendant
-- cette période, une vraie rupture ne sera plus signalée par le seuil.
--
-- UPDATE app_data
-- SET data = jsonb_set(data, '{quantite_minimum}', '0'::jsonb, true),
--     updated_at = now()
-- WHERE collection = 'produits'
--   AND COALESCE(data->>'type_article', 'consommable') = 'consommable'
--   AND (data->>'quantite_minimum') = '10';
-- -- Attendu : 26 lignes.

-- ── Cas à part : le `type_article` réécrit en « machine » ───────────────────
-- Le même bloc reclassait en « machine » tout article dont le nom contenait
-- imprimante / ordinateur / scanner / plastifieuse / presse / laptop / pc /
-- ecran / moniteur, ou dont la catégorie était « Machines & Outils ».
-- Les 5 articles concernés aujourd'hui sont :
--   Imprimante Canon G3430, Imprimante Canon MF3414, Imprimante EPSON L8050,
--   Ordinateur de bureau HP, Ordinateur LENOVO 1000GB
-- Ce sont RÉELLEMENT des machines : la reclassification était juste dans ces
-- 5 cas. AUCUNE correction proposée. À surveiller seulement si un consommable
-- portant l'un de ces mots (ex. « Papier pour imprimante », « Chiffon écran »)
-- apparaît un jour classé « machine » — il sortirait alors à tort de la
-- valorisation du stock consommable (src/services/finance-calc.js:64-66).
-- Requête de contrôle :
--
-- SELECT id, data->>'nom' AS article, data->>'categorie' AS categorie
-- FROM app_data
-- WHERE collection = 'produits'
--   AND data->>'type_article' = 'machine'
--   AND data->>'nom' !~* '^(imprimante|ordinateur|scanner|plastifieuse|presse|laptop|pc |ecran|moniteur)';
