-- ════════════════════════════════════════════════════════════════════════════
-- 009 — Dédoublonner le catalogue produits
--
--        ⛔ NON APPLIQUÉE. Rédigée le 2026-09-18 après mesure en lecture seule
--           du projet bcwkrrqmjpaohmafcncw. Aucune écriture n'a été faite.
--
--        ⚠️ LIRE LE § B AVANT D'EXÉCUTER. Cette migration NE RÉSOUT PAS la
--           lenteur du comptoir, contrairement à ce qui a été annoncé au
--           dirigeant. C'est mesuré, pas supposé — § B.0. Elle reste utile,
--           mais pour une autre raison : l'écran.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Collection      : produits_catalogue       Archive : produits_catalogue_archive_009
-- Modèle          : migrations/005, 006, 007 (même forme : A contrôles,
--                   B décisions, C corps en transaction, D contrôles, E retour)
-- Code associé    : src/utils/seed-data.js  (seedInventaire — la cause)
--                   src/features/catalogue/page.jsx  (l'écran du gérant)
--                   src/features/client-portal/catalogue.jsx  (l'écran client)
--                   src/services/db.js  (list() télécharge la colonne entière)
-- Livrable        : livrables_claude/35_NETTOYAGE_CATALOGUE.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QUI A ÉTÉ MESURÉ LE 2026-09-18, ET NON SUPPOSÉ
--
--   produits_catalogue ......................... 195 lignes
--     · noms distincts (clé retenue) ...........  50
--     · identifiants distincts ................. 195  (aucun doublon d'id)
--     · lignes en trop ......................... 145
--
--   ⚠️ LA CLÉ N'EST PAS `sku`. Le champ `sku` n'existe que sur 17 lignes, et
--      il est VIDE sur les 17. Un dédoublonnage « par sku » ne regrouperait
--      donc rien du tout. La seule clé disponible est le nom — et elle tient :
--        count(DISTINCT data->>'nom')               = 50
--        count(DISTINCT lower(trim(data->>'nom')))  = 50
--      Les deux donnent le même chiffre : il n'y a AUCUNE variante de casse,
--      d'accent ou d'espace à rattraper. La clé est exacte, pas approchée.
--
--   DOUBLONS IDENTIQUES OU DIVERGENTS — la question qui décide de tout :
--     empreinte md5 des champs métier (nom, categorie, prix_unitaire,
--     prix_achat, stock_actuel, stock_minimum, unite, actif), hors id et
--     horodatages :
--       empreintes métier distinctes ............  50  = nombre de noms
--     → DANS CHAQUE GROUPE, LES 145 DOUBLONS SONT IDENTIQUES AU CENTIME PRÈS.
--       0 divergence de prix. 0 divergence de stock. 0 divergence de catégorie.
--       Il n'y a donc AUCUN arbitrage « laquelle fait foi ? » à rendre.
--
--     empreinte md5 de la ligne entière ......... 62
--     → 12 groupes ont une ligne qui porte EN PLUS un bloc « vitrine »
--       (images, grille de prix, tags, description, délai). C'est la seule
--       divergence de la collection, et elle est traitée au § B.2.
--
--   IMAGES EN BASE64 DANS LA LIGNE :
--     lignes porteuses d'images ..................  17  (20 images au total)
--     poids de ces 17 lignes ..................... 20 574 780 o = 99,71 %
--     images identiques entre deux lignes ........   0  (17 empreintes md5
--                                                       distinctes : chaque
--                                                       photo est unique)
--     ⚠️ CES 17 LIGNES SONT TOUTES LE RANG 1 DE LEUR GROUPE — mesuré, pas
--        supposé : images sur un rang > 1 = 0. La règle « garder la plus
--        ancienne » conserve donc les 20 photos. Aucune image n'est perdue.
--
--   CE QUI POINTE VERS CES LIGNES (le vrai risque d'orphelins) :
--     commandes ......  5 lignes citent 4 identifiants catalogue
--                       ⚠️ ces citations sont IMBRIQUÉES dans le JSON (lignes
--                          de commande), pas au premier niveau. Une recherche
--                          `jsonb_each_text` au premier niveau ne les voit PAS.
--                          Celle du § A.4 les voit.
--     audit_logs ..... 32 lignes (`entity_id`) citent 17 identifiants
--     devis, factures, mouvements_stock, tarifs_clients, paiements : 0
--     → les 4 identifiants cités par les commandes et les 17 cités par le
--       journal sont TOUS des rangs 1, donc tous conservés.
--       ORPHELINS CRÉÉS PAR CETTE MIGRATION : 0.
--
--   HISTOIRE DES 195 LIGNES (created_at, à la seconde) :
--     07/03 19:15 ...  13 lignes — les 13 produits de démonstration de
--                      `seedCatalogue()`, réécrits à la main depuis (noms,
--                      prix, photos) entre le 09/03 et le 12/06. Aucun ne
--                      porte plus son sku d'origine (TEX-001 … DIV-001).
--     25/03 → 13/07 .  46 lignes en 5 vagues — 11 noms neufs, 35 redites
--     18/08 09:09 ...  45 lignes en 33 s — `seedInventaire()`, 24 noms neufs
--     19/08 .........   1 ligne
--     12/09 15:59 ...  45 lignes — MÊMES 45 NOMS qu'au 18/08, 0 neuf
--     17/09 06:52 ...  45 lignes — MÊMES 45 NOMS, 0 neuf
--   Les trois blocs de 45 sont rigoureusement identiques (intersection = 45).
--
-- POURQUOI — la cause est corrigée dans le code, le désordre reste
--
--   `seedInventaire()` (src/utils/seed-data.js) répondait à « la collection
--   a-t-elle plus de 5 lignes ? » en TÉLÉCHARGEANT la collection entière. Sur
--   la connexion de Moanda, 20 Mo expirent ; `list()` rend alors `[]`, `0 > 5`
--   est faux, et 45 lignes de plus sont écrites — ce qui alourdit la lecture du
--   démarrage suivant. Boucle qui s'auto-entretient. Le garde lit désormais
--   avec `compterOuLeve()` (head: true, quelques octets, et qui LÈVE au lieu
--   d'inventer un zéro). La cause ne rejouera plus.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A. AVANT — contrôles, lecture seule, sans effet
-- ════════════════════════════════════════════════════════════════════════════

-- A.1 — La photo d'ensemble. Doit rendre 195 / 50 / 145 au 2026-09-18.

SELECT count(*)                                       AS lignes,
       count(DISTINCT lower(trim(data->>'nom')))      AS produits_distincts,
       count(*) - count(DISTINCT lower(trim(data->>'nom'))) AS lignes_en_trop,
       count(DISTINCT data->>'id')                    AS identifiants_distincts
FROM app_data WHERE collection = 'produits_catalogue';

-- A.2 — La clé. `sku` est inutilisable, le nom est exact. Attendu : 17 / 0 / 50 / 50.

SELECT count(*) FILTER (WHERE data ? 'sku')                      AS champ_sku_present,
       count(*) FILTER (WHERE coalesce(trim(data->>'sku'),'') <> '') AS sku_renseigne,
       count(DISTINCT data->>'nom')                              AS noms_bruts,
       count(DISTINCT lower(trim(data->>'nom')))                 AS noms_normalises
FROM app_data WHERE collection = 'produits_catalogue';

-- A.3 — ⚠️ LE CONTRÔLE QUI DÉCIDE : identiques, ou divergents ?
--       Attendu : 50 empreintes métier (= le nombre de noms) → aucune
--       divergence de prix / stock / catégorie à arbitrer.
--       Et 62 empreintes totales → 12 groupes où une ligne porte en plus le
--       bloc vitrine. C'est la seule divergence, et elle est sur le rang 1.

WITH nettoye AS (
  SELECT lower(trim(data->>'nom')) AS nom,
         md5((data - 'id' - 'created_at' - 'updated_at')::text) AS totale,
         md5((data - 'id' - 'created_at' - 'updated_at' - 'images' - 'prix' - 'tags'
                   - 'description' - 'sku' - 'stock_lie' - 'delai_jours' - 'image_principale'
                   - 'details_techniques' - 'options_personnalisables' - 'vedette')::text) AS metier
  FROM app_data WHERE collection = 'produits_catalogue'
)
SELECT count(DISTINCT nom)    AS noms,
       count(DISTINCT metier) AS empreintes_metier,
       count(DISTINCT totale) AS empreintes_totales;

-- Le détail groupe par groupe, si l'on veut voir de ses yeux :
--
-- SELECT lower(trim(data->>'nom')) AS produit, count(*) AS lignes,
--        count(DISTINCT data->>'prix_unitaire') AS prix_differents,
--        count(DISTINCT data->>'prix_achat')    AS achats_differents,
--        count(DISTINCT data->>'stock_actuel')  AS stocks_differents,
--        count(*) FILTER (WHERE data ? 'images') AS lignes_avec_photo
-- FROM app_data WHERE collection = 'produits_catalogue'
-- GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;

-- A.4 — ⚠️ LES ORPHELINS. Ce qui cite un identifiant catalogue N'IMPORTE OÙ
--       dans le JSON, y compris imbriqué dans les lignes de commande. Le
--       `LIKE` est volontaire : `jsonb_each_text` au premier niveau RATE les
--       5 commandes. Attendu au 2026-09-18 :
--         audit_logs ... 32 lignes / 17 identifiants
--         commandes .....  5 lignes /  4 identifiants
--       et rien d'autre.

WITH cat AS (SELECT data->>'id' AS pid FROM app_data WHERE collection = 'produits_catalogue')
SELECT a.collection,
       count(DISTINCT a.id)   AS lignes_citantes,
       count(DISTINCT cat.pid) AS produits_cites
FROM cat
JOIN app_data a
  ON a.collection <> 'produits_catalogue'
 AND a.data::text LIKE '%' || cat.pid || '%'
GROUP BY 1 ORDER BY 2 DESC;

-- A.5 — ⚠️ LE CONTRÔLE DE SÛRETÉ. Combien de lignes qui SERAIENT archivées
--       portent une photo, ou sont citées ailleurs ? Attendu : 0 et 0.
--       Si l'une de ces deux colonnes n'est pas nulle, NE PAS EXÉCUTER LE § C :
--       le § B.2 est faux et il faut re-mesurer.

WITH r AS (
  SELECT a.data->>'id' AS pid, (a.data ? 'images') AS img,
         row_number() OVER (PARTITION BY lower(trim(a.data->>'nom'))
                            ORDER BY a.created_at, a.data->>'id') AS rang
  FROM app_data a WHERE a.collection = 'produits_catalogue'
)
SELECT count(*) FILTER (WHERE rang > 1 AND img) AS a_archiver_avec_photo,
       count(*) FILTER (WHERE rang > 1 AND EXISTS (
         SELECT 1 FROM app_data o
         WHERE o.collection <> 'produits_catalogue'
           AND o.data::text LIKE '%' || r.pid || '%')) AS a_archiver_cite_ailleurs
FROM r;

-- A.6 — LE POIDS, avant / après. C'est le chiffre qui a motivé la demande,
--       et c'est celui qui la contredit. Attendu au 2026-09-18 :
--         total ........ 20 634 952 o   gardé ..... 20 585 928 o
--         archivé ......     49 024 o   soit 0,24 % du poids
--         les 17 lignes à images ....... 20 574 780 o   soit 99,71 %

WITH r AS (
  SELECT a.data AS d, pg_column_size(a.data) AS o, (a.data ? 'images') AS img,
         row_number() OVER (PARTITION BY lower(trim(a.data->>'nom'))
                            ORDER BY a.created_at, a.data->>'id') AS rang
  FROM app_data a WHERE a.collection = 'produits_catalogue'
)
SELECT sum(o)                                   AS octets_aujourdhui,
       sum(o) FILTER (WHERE rang = 1)           AS octets_apres_009,
       sum(o) FILTER (WHERE rang > 1)           AS octets_liberes_par_009,
       round(100.0 * sum(o) FILTER (WHERE rang > 1) / sum(o), 2) AS pct_libere_par_009,
       sum(o) FILTER (WHERE img)                AS octets_tenus_par_les_images,
       round(100.0 * sum(o) FILTER (WHERE img) / sum(o), 2) AS pct_tenu_par_les_images,
       sum(pg_column_size(r.d - 'images')) FILTER (WHERE rang = 1) AS octets_si_009_ET_images_deportees
FROM r;

-- ════════════════════════════════════════════════════════════════════════════
-- B. CE QUE CETTE MIGRATION DÉCIDE — en toutes lettres, à lire avant d'exécuter
-- ════════════════════════════════════════════════════════════════════════════
--
-- B.0 — ⚠️ ELLE NE RÉGLERA PAS LA LENTEUR DU COMPTOIR. C'EST MESURÉ.
--
--   Les 145 lignes en trop pèsent 49 024 octets — 48 kio, 0,24 % de la
--   collection. Les 50 lignes conservées en pèsent 20 585 928, parce que 17
--   d'entre elles portent 20 photos encodées en base64 DANS la ligne :
--   20 574 780 octets à elles seules, soit 99,71 % du total.
--
--     aujourd'hui .............................. 20 634 952 o  (19,7 Mio)
--     après cette migration seule .............. 20 585 928 o  (19,6 Mio)
--     gain ..................................... 49 024 o   =  0,24 %
--
--   Une ouverture de catalogue qui prend 40 secondes à Moanda en prendra
--   39,9. Le dirigeant ne verra AUCUNE différence de vitesse. Lui dire le
--   contraire serait lui mentir sur un chiffre qu'il peut vérifier.
--
--   Le poids est dans les images, et les images sont dans les lignes QU'ON
--   GARDE. Le vrai chantier est le § F.1, pas celui-ci.
--
-- B.1 — CE QU'ELLE FAIT VRAIMENT, ET QUI VAUT LA PEINE : L'ÉCRAN.
--
--   `src/features/catalogue/page.jsx` fait `db.produits_catalogue.list()` et
--   affiche une carte par ligne, sans regroupement. Le gérant voit donc
--   aujourd'hui 195 cartes pour 50 produits : « Tee-shirt blanc KAF enfant »
--   ×10, « Polo blanc » ×8, « Chemises cartonnés élastique » ×7. Le portail
--   client (`client-portal/catalogue.jsx`) filtre sur `actif !== false` ; or
--   les 195 lignes sont actives — les clients voient donc les 195 cartes eux
--   aussi.
--
--   Après : 50 cartes des deux côtés. C'est un catalogue redevenu lisible, et
--   un client qui ne voit plus huit fois le même polo.
--
-- B.2 — ELLE GARDE LA LIGNE LA PLUS ANCIENNE DE CHAQUE NOM.
--
--   Ce n'est pas un choix par défaut, c'est le choix que la mesure impose :
--     · les 17 lignes porteuses de photos sont TOUTES le rang 1 de leur
--       groupe (rangs > 1 porteurs d'images = 0) → les 20 photos survivent ;
--     · les 4 identifiants cités par les 5 commandes sont TOUS des rangs 1
--       → aucune commande ne perd sa référence produit ;
--     · les 17 identifiants cités par le journal d'audit sont TOUS des rangs 1
--       → l'historique des 32 modifications reste rattaché ;
--     · les champs métier sont identiques dans chaque groupe → garder la plus
--       ancienne ou la plus récente donne EXACTEMENT le même prix, le même
--       stock, la même catégorie. Aucun arbitrage n'est rendu à la place du
--       dirigeant.
--
--   Autrement dit : la ligne la plus ancienne est la seule qui porte quelque
--   chose de plus que les autres. Les 145 écartées ne portent rien d'unique.
--
-- B.3 — ELLE NE SUPPRIME RIEN.
--
--   Les 145 lignes changent de collection : `produits_catalogue_archive_009`.
--   Elles sortent de l'application — la liste, le portail client, le chatbot,
--   les devis, les tarifs — parce que tous lisent par nom de collection. Elles
--   restent en base, intégralement, et le § E les remet en place à
--   l'identique. « Remets tout » est vrai.
--
--   ⚠️ À SAVOIR : la policy `app_data_select` de `app_data` vaut `true`. La
--      collection d'archive reste donc lisible par la clé publiable, comme
--      l'était `produits_catalogue`. Ce sont des fiches produit, sans secret :
--      c'est acceptable, et ce n'est ni meilleur ni pire qu'aujourd'hui. À ne
--      pas confondre avec l'archive des identifiants de la 007, qui elle est
--      sous RLS sans policy.
--
-- B.4 — CE QU'ELLE NE FAIT PAS.
--
--   · Elle ne touche PAS aux images (§ F.1). C'est un chantier à part, avec
--     un test sur un produit avant les seize autres.
--   · Elle ne fusionne PAS les quasi-homonymes (§ F.2) : « Badge » et
--     « Badges », « Mug Simple » et « Tasse simple », « Tee-shirt blanc
--     adulte » et « Tee-shirt blanc adulte Personnalisé », « Enveloppe
--     mariage » et « Enveloppe Mariage LOT DE 50 ». Ce sont des noms
--     DIFFÉRENTS : décider qu'ils désignent le même article est une décision
--     du dirigeant, pas d'un script. Le gérant verra donc encore ces couples.
--   · Elle ne corrige PAS les grilles de prix incohérentes (§ F.3).
--   · Elle ne supprime PAS `seedInventaire()`. La fonction n'a jamais amorcé
--     légitimement quoi que ce soit (sur une base neuve, `seedCatalogue()`
--     écrit 13 lignes avant elle, donc sa garde est toujours vraie) : ses
--     seuls effets en production ont été 135 doublons. La retirer est le geste
--     propre, mais c'est une décision produit.
--   · Elle ne pose PAS d'index unique sur le nom (§ F.4).

-- ════════════════════════════════════════════════════════════════════════════
-- C. LE CORPS — dans cet ordre, sans en sauter
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tout tient dans une transaction : si un contrôle intermédiaire déplaît,
-- ROLLBACK et il ne s'est rien passé.

BEGIN;

-- C.0 — La table de correspondance, calculée une fois et matérialisée, pour
--       que les contrôles et l'écriture voient exactement le même découpage.
--       `created_at, id` comme ordre : `id` départage les ex æquo à la
--       seconde, ce qui rend le résultat reproductible.

CREATE TEMP TABLE dedoublonnage_009 ON COMMIT DROP AS
WITH classes AS (
  SELECT a.id                              AS ligne,
         a.data->>'id'                     AS pid,
         lower(trim(a.data->>'nom'))       AS nom,
         (a.data ? 'images')               AS porte_une_photo,
         row_number() OVER (PARTITION BY lower(trim(a.data->>'nom'))
                            ORDER BY a.created_at, a.data->>'id') AS rang
  FROM app_data a
  WHERE a.collection = 'produits_catalogue'
)
SELECT d.ligne, d.pid AS a_archiver, g.pid AS a_garder, d.nom, d.porte_une_photo
FROM classes d
JOIN classes g ON g.nom = d.nom AND g.rang = 1
WHERE d.rang > 1;

-- Contrôle : doit rendre 145 lignes pour 45 produits (5 des 50 produits
-- n'ont qu'une seule ligne et n'apparaissent donc pas ici).
SELECT count(*) AS lignes_a_archiver, count(DISTINCT nom) AS produits_concernes
FROM dedoublonnage_009;

-- C.1 — ⚠️ LE GARDE-FOU. Il refuse d'écrire si une ligne à archiver porte une
--       photo, ou si quoi que ce soit la cite ailleurs dans la base. C'est ce
--       bloc qui tient la promesse « ça n'ouvrira pas de trucs » : il fait
--       échouer la transaction entière plutôt que de faire disparaître une
--       photo ou de créer un orphelin.

DO $$
DECLARE
  n_photos   int;
  n_cites    int;
  n_audit    int;
  n_gardes   int;
BEGIN
  SELECT count(*) INTO n_photos FROM dedoublonnage_009 WHERE porte_une_photo;
  IF n_photos > 0 THEN
    RAISE EXCEPTION
      '009 ARRÊT : % ligne(s) à archiver portent une photo. Le § B.2 est faux, re-mesurer.',
      n_photos;
  END IF;

  -- Les métiers : une commande, un devis, une facture, un mouvement de stock
  -- qui cite une ligne archivée devient un orphelin. C'est bloquant.
  SELECT count(*) INTO n_cites
  FROM dedoublonnage_009 d
  WHERE EXISTS (SELECT 1 FROM app_data o
                WHERE o.collection <> 'produits_catalogue'
                  AND o.collection <> 'audit_logs'
                  AND o.data::text LIKE '%' || d.a_archiver || '%');
  IF n_cites > 0 THEN
    RAISE EXCEPTION
      '009 ARRÊT : % ligne(s) à archiver sont citées par une commande, un devis ou une facture. Orphelins garantis, re-mesurer.',
      n_cites;
  END IF;

  -- Le journal d'audit est traité à part, et compté, pas ignoré : une entrée
  -- de journal qui vise une ligne archivée n'est pas une commande cassée —
  -- l'historique reste juste, la ligne existe toujours dans l'archive. On le
  -- DIT quand même, pour que personne ne le découvre après coup.
  -- Mesuré au 2026-09-18 : 0.
  SELECT count(*) INTO n_audit
  FROM dedoublonnage_009 d
  WHERE EXISTS (SELECT 1 FROM app_data o
                WHERE o.collection = 'audit_logs'
                  AND o.data->>'entity_id' = d.a_archiver);
  IF n_audit > 0 THEN
    RAISE NOTICE '009 : % ligne(s) archivée(s) sont citées par le journal d''audit (non bloquant, la ligne reste en base).', n_audit;
  END IF;

  SELECT count(DISTINCT lower(trim(data->>'nom'))) INTO n_gardes
  FROM app_data WHERE collection = 'produits_catalogue';
  RAISE NOTICE '009 : % produits distincts seront conservés, % lignes archivées, % citées par le journal.',
    n_gardes, (SELECT count(*) FROM dedoublonnage_009), n_audit;
END $$;

-- C.2 — ARCHIVER. Les lignes sortent de l'application en changeant de
--       collection ; rien n'est effacé. Deux témoins sont posés DANS la ligne
--       pour que le retour arrière ne devine rien :
--         `archive_009`             — la marque de cette migration
--         `archive_009_conserve_id` — l'identifiant de la ligne conservée
--       Attendu : 145 lignes.

UPDATE app_data a
SET collection = 'produits_catalogue_archive_009',
    data = jsonb_set(
             jsonb_set(a.data, '{archive_009}', to_jsonb(true), true),
             '{archive_009_conserve_id}', to_jsonb(d.a_garder), true
           ),
    updated_at = now()
FROM dedoublonnage_009 d
WHERE a.id = d.ligne;

-- C.3 — Il n'y a RIEN à réaffecter. Mesuré au § A.4 et re-vérifié au § C.1 :
--       aucune commande, aucun devis, aucune facture, aucun mouvement de stock
--       ne cite une ligne archivée. Le journal d'audit n'en cite aucune non
--       plus (ses 32 entrées visent les 17 lignes à photos, toutes conservées).
--       Cette étape existe pour dire qu'elle a été cherchée, pas oubliée.

-- ⚠️ RELIRE LES CONTRÔLES DU § D AVANT DE VALIDER.
--    COMMIT;   ou   ROLLBACK;

-- ════════════════════════════════════════════════════════════════════════════
-- D. APRÈS — contrôles
-- ════════════════════════════════════════════════════════════════════════════

-- D.1 — 50 lignes, 50 produits, 0 doublon. Et 145 en archive.
--
-- SELECT
--   (SELECT count(*) FROM app_data WHERE collection = 'produits_catalogue') AS lignes,
--   (SELECT count(DISTINCT lower(trim(data->>'nom'))) FROM app_data
--     WHERE collection = 'produits_catalogue') AS produits,
--   (SELECT count(*) FROM app_data WHERE collection = 'produits_catalogue_archive_009') AS archivees;

-- D.2 — ⚠️ LES 20 PHOTOS SONT TOUJOURS LÀ. Attendu : 17 lignes, 20 images,
--       17 empreintes distinctes — exactement comme avant.
--
-- SELECT count(*) AS lignes_avec_photo,
--        sum(jsonb_array_length(data->'images')) AS photos,
--        count(DISTINCT md5(data->>'images')) AS photos_distinctes
-- FROM app_data WHERE collection = 'produits_catalogue' AND data ? 'images';

-- D.3 — AUCUN ORPHELIN. Rien, nulle part, ne cite une ligne archivée.
--       Attendu : 0 ligne.
--
-- WITH arch AS (SELECT data->>'id' AS pid FROM app_data
--               WHERE collection = 'produits_catalogue_archive_009')
-- SELECT a.collection, count(DISTINCT a.id) AS lignes_orphelines
-- FROM arch JOIN app_data a
--   ON a.collection NOT IN ('produits_catalogue_archive_009')
--  AND a.data::text LIKE '%' || arch.pid || '%'
-- GROUP BY 1;

-- D.4 — LES 5 COMMANDES RETROUVENT LEURS 4 PRODUITS. Attendu : 5 / 4.
--
-- WITH cat AS (SELECT data->>'id' AS pid FROM app_data WHERE collection = 'produits_catalogue')
-- SELECT count(DISTINCT c.id) AS commandes, count(DISTINCT cat.pid) AS produits_cites
-- FROM app_data c JOIN cat ON c.data::text LIKE '%' || cat.pid || '%'
-- WHERE c.collection = 'commandes';

-- D.5 — LE POIDS, pour dire la vérité au dirigeant plutôt qu'une promesse.
--       Attendu : ~20 585 928 o. C'est-à-dire : à peine moins qu'avant.
--
-- SELECT count(*) AS lignes, sum(pg_column_size(data)) AS octets,
--        pg_size_pretty(sum(pg_column_size(data))::bigint) AS poids
-- FROM app_data WHERE collection = 'produits_catalogue';

-- D.6 — LE SEUL CONTRÔLE QUI COMPTE VRAIMENT : ouvrir le catalogue depuis le
--       téléphone du gérant, compter les cartes, et vérifier que les produits
--       photographiés ont toujours leur photo. Un décompte SQL ne prouve pas
--       qu'un catalogue est utilisable au comptoir.

-- ════════════════════════════════════════════════════════════════════════════
-- E. RETOUR ARRIÈRE — exact, car rien n'a été supprimé
-- ════════════════════════════════════════════════════════════════════════════
--
-- « Remets tout » redonne les 195 lignes, à l'identique, en une requête. Les
-- deux témoins posés en C.2 sont retirés au passage : la ligne redevient
-- exactement ce qu'elle était.
--
--   BEGIN;
--
--   UPDATE app_data
--   SET collection = 'produits_catalogue',
--       data = data - 'archive_009' - 'archive_009_conserve_id',
--       updated_at = now()
--   WHERE collection = 'produits_catalogue_archive_009'
--     AND data->>'archive_009' = 'true';
--
--   -- Contrôle : doit rendre 195 / 50 / 0.
--   SELECT (SELECT count(*) FROM app_data WHERE collection = 'produits_catalogue') AS lignes,
--          (SELECT count(DISTINCT lower(trim(data->>'nom'))) FROM app_data
--            WHERE collection = 'produits_catalogue') AS produits,
--          (SELECT count(*) FROM app_data
--            WHERE collection = 'produits_catalogue_archive_009') AS restantes;
--
--   COMMIT;   ou   ROLLBACK;
--
-- Le `updated_at` des 145 lignes ne revient pas à sa valeur d'origine : c'est
-- le seul écart, et il est sans effet — aucun écran ne l'affiche, aucun calcul
-- ne s'en sert pour cette collection.
--
-- Une fois le nettoyage validé et l'archive devenue inutile — décision du
-- dirigeant, pas du script :
--   DELETE FROM app_data WHERE collection = 'produits_catalogue_archive_009';

-- ════════════════════════════════════════════════════════════════════════════
-- F. APRÈS CETTE MIGRATION — ce qui reste, et dans quel ordre
-- ════════════════════════════════════════════════════════════════════════════
--
-- F.1 — ⚠️ LE VRAI CHANTIER : SORTIR LES 20 PHOTOS DES LIGNES.
--
--   Ce sont elles, et elles seules, qui rendent le catalogue lent : 20 574 780
--   octets sur 20 634 952, soit 99,71 %. Neuf lignes pèsent entre 1,7 et
--   3,2 Mio chacune (« Enveloppe invitation » 3 208 kio, « Polo Couleur KAF »
--   2 340 kio, « Enveloppe » 2 186 kio) ; les huit autres entre 12 et 69 kio.
--   Les 20 images sont toutes différentes (17 empreintes md5 distinctes, aucune
--   n'est un doublon d'une autre) : rien ne se déduplique côté photos.
--
--   Et ces 20 Mo sont téléchargés en entier par SEPT écrans, parce que
--   `Collection.list()` (src/services/db.js) ramène la colonne `data` complète :
--     catalogue (gérant) · portail client · devis client · chatbot ·
--     tarifs-clients · rapports-analyses · portail associé (deux fois).
--
--   Le bon endroit pour ces images existe déjà : le stockage de fichiers
--   Supabase (Storage). La ligne ne garderait que l'URL.
--
--     après 009 seule ......................... 20 585 928 o  (19,6 Mio)
--     après 009 ET images déportées ...........      23 816 o  (23 kio)
--                                                 soit 1/866e du poids actuel
--
--   Ce n'est PAS un effet de bord du dédoublonnage : c'est une intervention à
--   part, à faire sur UN produit d'abord (le plus lourd, « Enveloppe
--   invitation »), à vérifier à l'écran du gérant, puis sur les seize autres.
--   Elle touche aussi le code : `catalogue/page.jsx` écrit aujourd'hui du
--   base64 dans la ligne à chaque ajout de photo — tant que ce point n'est pas
--   corrigé, le poids reviendra.
--
-- F.2 — LES QUASI-HOMONYMES, à trancher par le dirigeant (5 couples) :
--       Badge (9 000 F, photo) / Badges (9 000 F) — mêmes prix, même stock
--       Mug Simple (3 000 F, photo) / Tasse simple (4 000 F)
--       Tee-shirt blanc adulte (3 000 F) / … Personnalisé (3 500 F, photo)
--       Enveloppe mariage (20 000 F, photo) / … LOT DE 50 (3 500 F, photo)
--       Papier couverture dossier (30 000 F, photo) / Papier couverture
--         reliure Transparent (15 000 F)
--       Un script ne peut pas décider que deux noms désignent un seul article.
--
-- F.3 — ⚠️ TROUVÉ EN CHEMIN, HORS PÉRIMÈTRE, MAIS À DIRE : DEUX PRIX POUR UN
--       MÊME PRODUIT. Le portail client affiche la grille `prix`, le comptoir
--       affiche `prix_unitaire`. AUCUNE des 17 lignes qui portent une grille
--       n'est cohérente — 9 affichent un autre prix, 8 n'en affichent aucun :
--         Chemises cartonnés élastique .... comptoir 10 000 F / client   500 F
--         Enveloppe Mariage LOT DE 50 .....           3 500 F /        25 000 F
--         Papier autocollant ..............          12 000 F /         2 000 F
--         Badge ...........................           9 000 F /         3 000 F
--         Mug Simple ......................           3 000 F /         4 500 F
--         Tee-shirt blanc KAF enfant ......           3 000 F /         4 500 F
--         Tee-shirt blanc adulte Personn. .           3 500 F /         5 000 F
--         Polo blanc ......................           5 000 F /         7 000 F
--         Polo Couleur KAF ................           6 000 F /         8 000 F
--         8 lignes ont une grille à 0 F → le client lit « Sur devis »
--           (Enveloppe invitation, Enveloppe mariage, Enveloppe, Sous chemises,
--            Papier couverture dossier, Tasse magique, Papier RAM, Casquettes)
--       Cette migration ne change rien à cela — ni en bien ni en mal — mais un
--       client peut aujourd'hui commander à 500 F un article vendu 10 000 F au
--       comptoir. C'est un sujet de caisse, pas de nettoyage.
--
-- F.4 — L'INDEX UNIQUE SUR LE NOM. À ne poser qu'APRÈS que le § D est vert, et
--       SEULEMENT si le dirigeant accepte qu'on ne puisse plus créer deux
--       fiches de même nom (deux variantes d'un produit devront porter des
--       noms distincts — ce qui est déjà le cas aujourd'hui).
--
--       ⚠️ `CREATE INDEX CONCURRENTLY` ne tourne pas dans une transaction :
--          l'exécuter seul.
--
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_catalogue_nom_unique
--     ON app_data ((lower(trim(data->>'nom'))))
--     WHERE collection = 'produits_catalogue'
--       AND data->>'nom' IS NOT NULL
--       AND trim(data->>'nom') <> '';
--
--   Retour arrière : DROP INDEX CONCURRENTLY IF EXISTS idx_catalogue_nom_unique;
--
--   C'est la seule protection qui survit à un vieux bundle resté dans le cache
--   d'un téléphone : `seedInventaire()` est corrigé dans le code, mais le
--   navigateur du gérant peut servir l'ancien pendant des jours.
