-- ════════════════════════════════════════════════════════════════════════════
-- 010 — PAPETERIE : séparer les deux activités dans la base
--
--        ⛔ NON APPLIQUÉE — à ne PAS exécuter sans accord explicite de Gassim.
--
--        Et surtout : ce fichier n'est PAS un prérequis du code livré.
--        L'application fonctionne sans lui, dès maintenant. Les sections A et B
--        sont des CONTRÔLES en lecture seule ; la section C est un garde-fou
--        facultatif ; la section D est le SEUL rattrapage de données envisagé,
--        et il n'est nécessaire QUE si une ligne de papeterie a été saisie
--        avant la mise en production de ce code.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Rédigé le       : 2026-09-18
-- Code associé    : src/services/activites.js  (la règle, écrite une fois)
--                   tests/activites.test.mjs   (la règle, prouvée)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── POURQUOI IL N'Y A RIEN À MIGRER ─────────────────────────────────────────
--
-- MESURE faite le 2026-09-18 sur la production, en LECTURE SEULE :
--
--     select collection, count(*) as lignes,
--            count(*) filter (where data ? 'activite') as avec_activite
--     from app_data group by collection order by lignes desc;
--
--     audit_logs 3339/0 · rapports 237/0 · produits_catalogue 195/0 ·
--     notifications_app 92/0 · produits 45/0 · mouvements_stock 44/0 ·
--     mouvements_financiers 32/0 · etapes_travaux 18/0 · clients 14/0 ·
--     comptes_bancaires 11/0 · factures 7/0 · employes 7/0 ·
--     charges_fixes 5/0 · commandes 5/0 · devis 4/0 · …
--
--     → AUCUNE ligne, dans AUCUNE collection, ne porte de champ `activite`.
--
-- Tout l'existant est donc de l'IMPRIMERIE. Le code le lit ainsi : dans
-- `src/services/activites.js`, l'absence du champ VAUT « imprimerie », et une
-- ligne sans champ n'apparaît jamais côté papeterie.
--
-- C'est un choix, et il vaut mieux que l'alternative :
--
--   • Un UPDATE de rattrapage réécrirait 4 083 lignes de jsonb pour n'ajouter
--     aucune information — on sait déjà que tout est de l'imprimerie. Chaque
--     ligne réécrite est une occasion de se tromper, et `updated_at` de toutes
--     les collections partirait au 18/09/2026, ce qui ferait mentir tous les
--     tris « plus récents d'abord ».
--   • Une valeur par défaut à la LECTURE reste juste même pour une ligne qui
--     remonterait plus tard d'une sauvegarde antérieure. L'UPDATE, lui, ne
--     protège que ce qui était là au moment où on l'a lancé.
--
-- Le stockage est une table générique unique `app_data(id, collection, data
-- jsonb)` : il n'y a ni colonne à ajouter, ni type à créer. `activite` est une
-- clé de plus dans `data`, écrite par le code à partir d'aujourd'hui.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A. CONTRÔLE — état des lieux (LECTURE SEULE, sans effet)
-- ════════════════════════════════════════════════════════════════════════════

select collection,
       count(*)                                          as lignes,
       count(*) filter (where data ? 'activite')         as avec_activite,
       count(*) filter (where data->>'activite' = 'papeterie') as papeterie,
       count(*) filter (where data->>'activite' = 'imprimerie') as imprimerie
from app_data
where collection in (
  'rapports', 'commandes', 'mouvements_financiers',
  'produits', 'charges_fixes', 'clotures_caisse'
)
group by collection
order by lignes desc;

-- ════════════════════════════════════════════════════════════════════════════
-- B. CONTRÔLE — aucune valeur d'activité inattendue (LECTURE SEULE)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Doit rendre ZÉRO ligne. Une ligne ici signifierait qu'une valeur autre que
-- 'imprimerie' / 'papeterie' est arrivée en base — un import, une écriture
-- manuelle, ou un bogue. Le code la lirait comme « imprimerie » (règle de
-- repli), donc rien ne planterait : c'est précisément pour cela qu'il faut la
-- CHERCHER, un chiffre faux ne lève aucune erreur, il s'affiche.

select collection, data->>'activite' as activite_inattendue, count(*)
from app_data
where data ? 'activite'
  and data->>'activite' not in ('imprimerie', 'papeterie')
group by 1, 2
order by 3 desc;

-- ════════════════════════════════════════════════════════════════════════════
-- C. GARDE-FOU FACULTATIF — interdire en base toute autre valeur
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⛔ NON APPLIQUÉE. À n'exécuter que si la section B rend zéro ligne, et après
--    accord explicite. Une contrainte posée sur une base qui la viole déjà
--    échoue — et une contrainte posée trop large ferait échouer des écritures
--    d'argent en production, ce qui est pire que le problème qu'elle prévient.
--
-- CE QU'ELLE FAIT : elle laisse passer toute ligne SANS champ `activite` (tout
-- l'existant, donc), et n'exige la bonne valeur que si le champ est présent.
--
-- CE QU'ELLE NE FAIT PAS : elle n'oblige personne à poser le champ. C'est
-- volontaire — 46 collections passent par `app_data`, et la plupart n'ont
-- aucune raison d'appartenir à une caisse (employés, clients, notifications,
-- journal d'audit…). Une contrainte NOT NULL les casserait toutes.
--
-- alter table app_data
--   add constraint app_data_activite_connue
--   check (
--     not (data ? 'activite')
--     or data->>'activite' in ('imprimerie', 'papeterie')
--   )
--   not valid;   -- `not valid` : ne contrôle QUE les écritures futures.
--
-- Puis, seulement après avoir vérifié que la section B est vide :
-- alter table app_data validate constraint app_data_activite_connue;
--
-- RETOUR ARRIÈRE :
-- alter table app_data drop constraint if exists app_data_activite_connue;

-- ════════════════════════════════════════════════════════════════════════════
-- D. RATTRAPAGE — uniquement si de la papeterie a été saisie AVANT ce code
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⛔ NON APPLIQUÉE, et normalement INUTILE.
--
-- Ce bloc n'a de sens que dans un seul cas : la papeterie a commencé à
-- encaisser avant que ce code ne soit en production, et ses ventes ont donc
-- été saisies comme de l'imprimerie. Il faut alors décider LIGNE PAR LIGNE
-- lesquelles appartiennent à la papeterie — ce que personne ne peut faire
-- rétrospectivement à partir de la seule base : il faut les cahiers du
-- comptoir. C'est exactement le « démêlage » que cette intervention existe
-- pour éviter, et c'est pourquoi le champ est posé maintenant.
--
-- La forme du rattrapage, pour mémoire, sur une liste d'identifiants ÉTABLIE
-- À LA MAIN et relue par Gassim — jamais sur un critère deviné :
--
-- update app_data
--    set data = jsonb_set(data, '{activite}', '"papeterie"'::jsonb, true),
--        updated_at = now()
--  where collection = 'rapports'
--    and id in ( /* identifiants relus un par un */ );
--
-- RETOUR ARRIÈRE (retire le champ, ce qui le fait relire « imprimerie ») :
-- update app_data
--    set data = data - 'activite'
--  where collection = 'rapports'
--    and id in ( /* les mêmes identifiants */ );
--
-- ════════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE GLOBAL DE L'INTERVENTION
-- ════════════════════════════════════════════════════════════════════════════
--
-- Aucun DDL n'a été exécuté, aucune donnée n'a été réécrite : revenir en
-- arrière se fait entièrement CÔTÉ CODE (git revert des fichiers listés dans
-- le rapport d'intervention). Les lignes déjà écrites avec `activite` restent
-- lisibles par l'ancien code, qui ignore simplement la clé en trop.
--
-- Si l'on tient à effacer la trace en base :
--
-- update app_data set data = data - 'activite' where data ? 'activite';
--
-- ⚠️ Cette commande fait perdre la séparation des deux caisses pour toutes les
--    lignes déjà saisies : tout redevient de l'imprimerie. À ne lancer que si
--    la papeterie est abandonnée.
-- ════════════════════════════════════════════════════════════════════════════
