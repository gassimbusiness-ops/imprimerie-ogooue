-- ════════════════════════════════════════════════════════════════════════════
-- 011 — Sortir les 20 photos du catalogue de la base de données
--
--        ⛔ NON APPLIQUÉE. Rédigée le 2026-09-18 après mesure en lecture seule
--           du projet bcwkrrqmjpaohmafcncw. Aucune écriture n'a été faite.
--
--        ⚠️ AUCUNE PHOTO N'EST SUPPRIMÉE. Le dirigeant a été explicite : ces
--           photos sont celles qu'on a générées, il les veut, « sinon le
--           catalogue ne sera pas bien fait ». On les DÉPLACE, et l'original
--           reste en base — dans une collection d'archive — jusqu'à ce qu'il
--           confirme sur son téléphone que le catalogue s'affiche bien.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Collection      : produits_catalogue
-- Archive         : produits_catalogue_photos_archive_011
-- Bucket Storage  : catalogue  (à créer — § B.1, en lecture publique, rien d'autre)
-- Modèle          : migrations/005, 006, 007, 009 (A contrôles, B décisions,
--                   C corps en transaction, D contrôles, E retour arrière)
-- Script associé  : scripts/migrer-photos-catalogue.mjs   (l'étape 2 ; le SQL
--                   ne sait pas téléverser dans Storage)
-- Code associé    : src/services/photos-catalogue.js      (lire les 2 formes)
--                   tests/photos-catalogue.test.mjs
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- A. CE QUI A ÉTÉ MESURÉ LE 2026-09-18, ET NON SUPPOSÉ
-- ════════════════════════════════════════════════════════════════════════════
--
-- A.1 — LE POIDS
--
--   produits_catalogue ......................... 195 lignes
--     pg_column_size(data), total .............. 20 634 952 o
--     length(data::text), total ................ 20 626 778 o
--
--   lignes portant un champ `images` ...........  17
--     poids de ces 17 lignes ................... 20 574 780 o = 99,71 %
--     longueur du seul champ `images` .......... 20 561 821 c = 99,68 %
--
--   → Ce ne sont pas « les doublons » qui pèsent. Les 145 doublons traités par
--     la migration 009 font 49 024 o, soit 0,24 %. Ce sont les photos, et
--     elles seules.
--
-- A.2 — LES PHOTOS, UNE PAR UNE
--
--   entrées dans les champs `images`, au total ..  20
--     · data-URL base64 .........................  19
--     · URL https déjà externe ..................   1
--   empreintes md5 distinctes, par entrée .......  20  → RIEN NE SE DÉDUPLIQUE
--   octets décodés (la photo elle-même), total ... ~15,4 Mo
--   `image_principale` ........................... un NOMBRE (un index), vaut
--                                                  0 sur les 17 lignes. Ce
--                                                  n'est PAS une photo.
--
--   ⚠️ LA 20ᵉ ENTRÉE N'EST PAS UNE PHOTO RÉCUPÉRABLE.
--      « Tee-shirt blanc KAF enfant » (2058a62e-…), rang 1 :
--        https://oaidalleapiprodscus.blob.core.windows.net/…  (474 caractères)
--      C'est une URL DALL·E SIGNÉE. Ces URL expirent en une à deux heures ;
--      celle-ci est morte depuis des mois. L'image est donc DÉJÀ cassée à
--      l'écran aujourd'hui, avant toute migration. On ne peut pas la rapatrier
--      (il n'y a rien à télécharger), on ne la supprime pas, et on ne prétend
--      pas l'avoir sauvée. Cette ligne garde par ailleurs une vraie photo au
--      rang 0 (41 927 caractères), qui elle sera bien migrée.
--
--   Les dix lignes les plus lourdes (longueur du champ `images`, caractères) :
--
--     Enveloppe invitation .......... 3 285 476   2 photos PNG
--     Polo Couleur KAF .............. 2 395 950   1 photo  PNG
--     Enveloppe ..................... 2 238 502   1 photo  PNG
--     Sous chemises ................. 2 230 746   1 photo  PNG
--     Chemises cartonnés élastique .. 2 148 114   1 photo  PNG
--     Casquettes .................... 2 122 846   1 photo  PNG
--     Enveloppe mariage ............. 2 046 026   1 photo  PNG
--     Papier couverture dossier ..... 1 943 838   1 photo  PNG
--     Tasse magique ................. 1 816 425   2 photos PNG + JPEG
--     Tee-shirt blanc adulte Perso. ..... 70 891  1 photo  JPEG
--
--   Les sept restantes vont de 12 731 à 56 387 caractères. La coupure est
--   nette : les PNG datent d'avant `compressSource()` (600 px, qualité 0,7,
--   src/features/catalogue/page.jsx), les JPEG d'après.
--
-- A.3 — CE QUI EST RÉELLEMENT SERVI À CHAQUE OUVERTURE D'ÉCRAN
--
--   La requête que fait `Collection.list()` (src/services/db.js) :
--     select data from app_data where collection = 'produits_catalogue'
--   Le corps de réponse mesuré :
--
--     avant ...................................... 20 629 118 o
--     photos remplacées par des URL de Storage ...      69 737 o
--     ────────────────────────────────────────────────────────────
--     facteur ....................................       295,8 ×
--
--   Ce chiffre est mesuré sur la réponse elle-même, pas déduit du poids de la
--   table. C'est celui qui compte : ce sont ces octets qui passent par la
--   connexion de Moanda.
--
-- A.4 — QUI TÉLÉCHARGE CES 20 Mo
--
--   Neuf fichiers appellent `db.produits_catalogue.list()` — la liste complète,
--   colonne `data` entière :
--
--     src/features/catalogue/page.jsx:988              catalogue du gérant
--     src/features/client-portal/catalogue.jsx:74      catalogue du client
--     src/features/client-portal/devis.jsx:38          devis du client
--     src/components/chatbot.jsx:16                    l'assistant
--     src/features/messagerie/page.jsx:171             partage d'un produit
--     src/features/tarifs-clients/page.jsx:26          tarifs par client
--     src/features/rapports-analyses/page.jsx:102      rapports & analyses
--     src/features/associe-portal/dashboard.jsx:234    portail associé
--     src/features/admin-import/page.jsx:145 et 468    import administrateur
--
--   La commande parlait de « sept écrans ». Il y en a neuf. Le chiffre n'a pas
--   été repris tel quel : il a été recompté.
--
-- A.5 — LE DÉGÂT QUI SE PROPAGE HORS DU CATALOGUE
--
--   `src/features/client-portal/catalogue.jsx` recopiait `p.images[0]` — la
--   data-URL ENTIÈRE — dans chaque ligne de commande. Relevé en base :
--
--     commandes ........ 5 lignes, 5 portent du base64, 163 117 o
--     _settings ........ 1 ligne, base64, 90 422 o   (bannière du portail)
--     employes ......... 1 ligne, base64, 52 709 o   (photo de profil)
--
--   Corrigé dans le code (`referencePhotoLegere()`), avec un test qui échoue
--   sur le code d'avant. ⚠️ Les 5 commandes DÉJÀ écrites gardent leur copie :
--   ce SQL ne les touche pas. Voir § F.2.
--
--   Contrôle à relancer :
--     SELECT collection, count(*) AS lignes,
--            count(*) FILTER (WHERE data::text LIKE '%data:image/%') AS avec_base64,
--            sum(pg_column_size(data)) AS octets
--     FROM app_data GROUP BY 1
--     HAVING count(*) FILTER (WHERE data::text LIKE '%data:image/%') > 0
--     ORDER BY 4 DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- B. LES DÉCISIONS — à relire avant d'exécuter quoi que ce soit
-- ════════════════════════════════════════════════════════════════════════════
--
-- B.0 — ORDRE OBLIGATOIRE. Cinq étapes, dans cet ordre, sans en sauter.
--
--       1. créer le bucket             § B.1       (Gassim, interface Supabase)
--       2. DÉPLOYER LE CODE            § B.2       (avant toute écriture)
--       3. archiver les 17 lignes      § C         (ce fichier, transaction)
--       4. téléverser et remplacer     § C.3       (le script Node)
--       5. contrôler                   § D         (dont l'écran du gérant)
--
--       ⚠️ L'étape 2 AVANT l'étape 4. Le code déployé doit déjà savoir lire une
--          URL. Il le sait (une balise `<img src>` accepte les deux formes, et
--          `src/services/photos-catalogue.js` normalise le reste) — mais un
--          navigateur qui n'a pas rechargé sert encore l'ancien bundle. Migrer
--          d'abord ferait afficher des vignettes cassées au comptoir le temps
--          d'un rafraîchissement.
--
-- B.1 — CRÉER LE BUCKET  ⚠️ EN LECTURE PUBLIQUE, ET RIEN D'AUTRE
--
--       Ce bucket n'a PAS été créé. Créer un espace de stockage, c'est décider
--       de règles d'accès : cela revient au dirigeant. La procédure exacte :
--
--         Supabase → Storage → New bucket
--           Name .................... catalogue
--           Public bucket ........... ✅ COCHÉ
--           File size limit ......... 5 MB
--           Allowed MIME types ...... image/png, image/jpeg, image/webp
--
--       Ce que « public » veut dire ici, précisément :
--         ✅ n'importe qui connaissant l'URL peut LIRE une image. C'est voulu :
--            ce sont des photos de produits, faites pour être vues par les
--            clients ; le portail client les affiche déjà aujourd'hui.
--         ⛔ personne ne peut ÉCRIRE, REMPLACER ni SUPPRIMER sans la clé
--            `service_role`. Un bucket public reste en écriture fermée.
--         ⛔ le bucket ne doit contenir QUE des photos de catalogue. Aucun
--            document, aucune facture, aucune pièce jointe de messagerie.
--
--       Les URL sont devinables (`…/catalogue/<uuid de ligne>/<rang>-<md5>.png`).
--       C'est acceptable pour un catalogue produit et pour rien d'autre.
--
--       Le bucket `mockups` existant (privé, 2 Mo) N'EST PAS réutilisable : il
--       est privé, et son plafond est sous le poids de la plus grosse photo
--       (1 796 943 o décodés pour « Polo Couleur KAF »).
--
--       Vérification, en SQL :
--         SELECT id, public, file_size_limit, allowed_mime_types
--         FROM storage.buckets WHERE name = 'catalogue';
--       Attendu : une ligne, `public = true`.
--
-- B.2 — LE CODE SAIT DÉJÀ LIRE LES DEUX FORMES
--
--       `src/services/photos-catalogue.js`, livré avec cette migration :
--         photosDuProduit()     les photos affichables, les deux formes,
--                               entrées vides écartées
--         photoPrincipale()     respecte l'index `image_principale`
--         referencePhotoLegere() ce qu'on a le droit de RECOPIER ailleurs
--
--       Branché sur les quatre points de lecture et de recopie qu'il était
--       permis de modifier : catalogue du gérant, catalogue du portail client,
--       partage de produit dans la messagerie.
--
--       `tests/photos-catalogue.test.mjs` monte les deux écrans de catalogue
--       sur un jeu « à mi-chemin » — une ligne migrée, une non migrée, une
--       ligne à moitié migrée, la photo DALL·E morte, une fiche sans photo, un
--       champ `images` vide, une entrée `null` — et vérifie qu'aucun écran ne
--       blanchit et qu'aucun produit ne disparaît.
--
-- B.3 — ON COPIE, ON NE DÉPLACE PAS (contrairement à la migration 009)
--
--       La 009 fait `UPDATE … SET collection = '…_archive_009'` : elle SORT la
--       ligne de l'application. Ici c'est impossible — les 17 lignes sont des
--       produits vivants, affichés au comptoir. On INSÈRE donc une copie dans
--       la collection d'archive, et la ligne d'origine reste en place.
--
--       L'archive ne garde que ce qui va être perdu : l'identifiant de la ligne
--       et le champ `images` d'origine. Pas la fiche entière — sinon un prix
--       modifié après coup serait restauré par le retour arrière, et personne
--       ne s'y attendrait.
--
--       Coût : l'archive pèse les mêmes ~20 Mo. C'est volontaire et temporaire.
--       Aucun écran ne lit cette collection, donc elle ne ralentit rien ; elle
--       ne sera supprimée qu'au § F.1, sur décision du dirigeant.
--
-- B.4 — QUAND LANCER : HORS DES HEURES D'OUVERTURE
--
--       Le script relit les 17 lignes au démarrage puis les réécrit. Si le
--       gérant modifie un prix pendant ce temps, l'écriture du script écrase sa
--       modification. Les 17 lignes se traitent en quelques minutes : le faire
--       le soir, imprimerie fermée, retire entièrement le risque.
--
-- B.5 — CE QUE CETTE MIGRATION NE FAIT PAS
--
--       · Elle ne dédoublonne pas : c'est la 009, indépendante. Les deux
--         peuvent être passées dans n'importe quel ordre — les 17 lignes à
--         photos sont toutes des lignes CONSERVÉES par la 009 (mesuré : images
--         sur un rang > 1 = 0).
--       · Elle ne touche pas aux 5 commandes qui portent déjà une photo
--         recopiée (§ F.2).
--       · Elle ne touche ni à `_settings` (bannière, 90 422 o) ni à la photo
--         de profil d'un employé (52 709 o) — § F.3.
--       · Elle ne change pas le chemin d'AJOUT d'une photo : une photo ajoutée
--         après la migration repart en base64 dans `images` (§ F.4). C'est la
--         limite la plus importante de ce travail, et elle est assumée ici
--         plutôt que découverte dans trois mois.


-- ════════════════════════════════════════════════════════════════════════════
-- C. LE CORPS
-- ════════════════════════════════════════════════════════════════════════════

-- ── C.1 — AVANT : l'état de départ, à noter avant de toucher à quoi que ce
--          soit. Attendu : 195 / 17 / 20 / 20 634 952.

SELECT
  count(*)                                                   AS lignes,
  count(*) FILTER (WHERE data ? 'images')                    AS lignes_avec_images,
  sum(jsonb_array_length(data->'images'))
    FILTER (WHERE jsonb_typeof(data->'images') = 'array')    AS photos,
  sum(pg_column_size(data))                                  AS octets,
  pg_size_pretty(sum(pg_column_size(data))::bigint)          AS poids
FROM app_data WHERE collection = 'produits_catalogue';


-- ── C.2 — ARCHIVER LES 17 CHAMPS `images` D'ORIGINE.
--
--         Une transaction. Si un contrôle déplaît : ROLLBACK, et il ne s'est
--         rien passé. Aucun écran ne lit `produits_catalogue_photos_archive_011`.

BEGIN;

INSERT INTO app_data (id, collection, data, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'produits_catalogue_photos_archive_011',
  jsonb_build_object(
    'archive_011',          true,
    'ligne_origine',        a.id::text,        -- la clé du retour arrière
    'produit_id',           a.data->>'id',
    'nom',                  a.data->>'nom',
    'image_principale',     a.data->'image_principale',
    'images_origine',       a.data->'images',  -- LES PHOTOS, telles quelles
    'archive_le',           now()
  ),
  now(), now()
FROM app_data a
WHERE a.collection = 'produits_catalogue'
  AND a.data ? 'images'
  -- Rejouable : une ligne déjà archivée n'est pas archivée deux fois.
  AND NOT EXISTS (
    SELECT 1 FROM app_data b
    WHERE b.collection = 'produits_catalogue_photos_archive_011'
      AND b.data->>'ligne_origine' = a.id::text
  );

-- Contrôle de l'archive AVANT de valider. Attendu : 17 / 20 / ~20 561 821.
-- Si l'un des trois diffère : ROLLBACK, et re-mesurer.
SELECT count(*)                                            AS lignes_archivees,
       sum(jsonb_array_length(data->'images_origine'))     AS photos_archivees,
       sum(length(data->>'images_origine'))                AS caracteres_archives
FROM app_data WHERE collection = 'produits_catalogue_photos_archive_011';

-- ⚠️ RELIRE LE RÉSULTAT CI-DESSUS AVANT DE VALIDER.
--    COMMIT;   ou   ROLLBACK;


-- ── C.3 — TÉLÉVERSER ET REMPLACER  (hors SQL : Postgres ne parle pas à Storage)
--
--   D'abord en simulation, toujours :
--
--     export SUPABASE_URL='https://bcwkrrqmjpaohmafcncw.supabase.co'
--     export SUPABASE_SERVICE_ROLE_KEY='…'      # Settings → API → service_role
--     node scripts/migrer-photos-catalogue.mjs
--
--   Le compte rendu doit annoncer 17 lignes, 19 photos à téléverser, 1 entrée
--   « déjà une URL, intacte » (la DALL·E morte du § A.2), 0 échec. Si l'un de
--   ces nombres diffère, s'arrêter et re-mesurer : rien n'a encore été écrit.
--
--   Puis, et seulement alors :
--
--     node scripts/migrer-photos-catalogue.mjs --appliquer
--
--   Le script est IDEMPOTENT : le chemin de l'objet dépend de son contenu, et
--   une entrée déjà migrée est une URL, donc sautée. Une coupure réseau à
--   Moanda se rattrape en relançant la même commande.
--
--   ⚠️ La clé `service_role` s'exporte dans le shell, le temps de la commande.
--      Elle ne s'écrit dans aucun fichier du dépôt, ne porte jamais le préfixe
--      `VITE_`, et n'est saisie par personne d'autre que Gassim.


-- ════════════════════════════════════════════════════════════════════════════
-- D. APRÈS — contrôles
-- ════════════════════════════════════════════════════════════════════════════

-- D.1 — PLUS UNE SEULE PHOTO EN BASE64. Attendu : 195 / 17 / 20 / 0.
--
-- SELECT count(*)                                              AS lignes,
--        count(*) FILTER (WHERE data ? 'images')               AS lignes_avec_images,
--        sum(jsonb_array_length(data->'images'))
--          FILTER (WHERE jsonb_typeof(data->'images')='array') AS photos,
--        count(*) FILTER (WHERE data::text LIKE '%data:image/%') AS reste_du_base64
-- FROM app_data WHERE collection = 'produits_catalogue';

-- D.2 — LE POIDS, mesuré et pas promis. Attendu : ~75 896 o (74 ko), contre
--       20 634 952 — soit 271,9 fois moins. Chiffre obtenu en simulant la
--       substitution en SQL le 2026-09-18, pas estimé à la louche :
--         URL modèle : …/object/public/catalogue/<uuid>/<rang>-<md5 12>.png
--
-- SELECT sum(pg_column_size(data))                     AS octets,
--        pg_size_pretty(sum(pg_column_size(data))::bigint) AS poids
-- FROM app_data WHERE collection = 'produits_catalogue';

-- D.3 — CE QUI EST RÉELLEMENT SERVI AUX NEUF ÉCRANS. Attendu : ~69 737 o.
--       C'est LE chiffre à donner au dirigeant : ce sont ces octets-là qui
--       traversent la connexion de Moanda.
--
-- SELECT length(jsonb_agg(jsonb_build_object('data', data)
--                         ORDER BY created_at)::text) AS octets_servis
-- FROM app_data WHERE collection = 'produits_catalogue';

-- D.4 — LES 20 ENTRÉES SONT TOUJOURS LÀ, ET CHACUNE POINTE QUELQUE PART.
--       Attendu : 20 entrées, 19 sur le bucket `catalogue`, 1 ailleurs
--       (la DALL·E morte), 0 vide.
--
-- SELECT count(*)                                                   AS entrees,
--        count(*) FILTER (WHERE v LIKE '%/storage/v1/object/public/catalogue/%') AS sur_le_bucket,
--        count(*) FILTER (WHERE v LIKE 'http%'
--                           AND v NOT LIKE '%/object/public/catalogue/%')        AS ailleurs,
--        count(*) FILTER (WHERE v IS NULL OR v = '')                AS vides
-- FROM app_data a, LATERAL jsonb_array_elements_text(a.data->'images') t(v)
-- WHERE a.collection = 'produits_catalogue';

-- D.5 — L'ARCHIVE EST INTACTE : les originaux n'ont pas bougé.
--       Attendu : 17 / 20, et toujours ~20 561 821 caractères.
--
-- SELECT count(*) AS lignes, sum(jsonb_array_length(data->'images_origine')) AS photos,
--        sum(length(data->>'images_origine')) AS caracteres
-- FROM app_data WHERE collection = 'produits_catalogue_photos_archive_011';

-- D.6 — CHAQUE LIGNE MIGRÉE A SON ARCHIVE, ET INVERSEMENT. Attendu : 0 ligne.
--
-- SELECT a.id, a.data->>'nom' AS sans_archive
-- FROM app_data a
-- WHERE a.collection = 'produits_catalogue' AND a.data ? 'images'
--   AND NOT EXISTS (SELECT 1 FROM app_data b
--                   WHERE b.collection = 'produits_catalogue_photos_archive_011'
--                     AND b.data->>'ligne_origine' = a.id::text);

-- D.7 — ⚠️ LE SEUL CONTRÔLE QUI COMPTE VRAIMENT.
--
--       Ouvrir le catalogue depuis le TÉLÉPHONE DU GÉRANT, sur la connexion de
--       Moanda, et regarder les dix produits photographiés du § A.2 : leur
--       photo doit être là. Puis ouvrir le portail client et refaire la même
--       vérification.
--
--       Un décompte SQL ne prouve pas qu'une image s'affiche. Une URL qui rend
--       400 compte comme « une entrée sur le bucket » au § D.4.
--
--       Tant que ce contrôle-là n'est pas fait par un humain, la migration
--       n'est pas terminée, et l'archive du § C.2 ne se supprime pas.


-- ════════════════════════════════════════════════════════════════════════════
-- E. RETOUR ARRIÈRE — exact, car rien n'a été supprimé
-- ════════════════════════════════════════════════════════════════════════════
--
-- « Remets les photos comme avant » remet les 20 entrées d'origine, à
-- l'identique, en une requête. Les objets restent dans le bucket (inoffensifs,
-- et utiles si on recommence). Le reste de la fiche — prix, stock, description,
-- tags — n'est PAS touché : seul `images` revient en arrière, et une
-- modification faite entre-temps est conservée.
--
--   BEGIN;
--
--   UPDATE app_data a
--   SET data = jsonb_set(a.data, '{images}', b.data->'images_origine', true),
--       updated_at = now()
--   FROM app_data b
--   WHERE b.collection = 'produits_catalogue_photos_archive_011'
--     AND b.data->>'archive_011' = 'true'
--     AND a.collection = 'produits_catalogue'
--     AND a.id::text = b.data->>'ligne_origine';
--
--   -- Contrôle : doit rendre 17 / 20 / 20 634 952 (le poids d'avant).
--   SELECT count(*) FILTER (WHERE data ? 'images')            AS lignes_avec_images,
--          sum(jsonb_array_length(data->'images'))
--            FILTER (WHERE jsonb_typeof(data->'images')='array') AS photos,
--          sum(pg_column_size(data))                          AS octets
--   FROM app_data WHERE collection = 'produits_catalogue';
--
--   COMMIT;   ou   ROLLBACK;
--
-- Le `updated_at` des 17 lignes ne revient pas à sa valeur d'origine : c'est le
-- seul écart, et aucun écran ne l'affiche pour cette collection.
--
-- Le retour arrière du CODE est indépendant et sans risque : le code sait lire
-- les deux formes dans les deux sens. Revenir au code d'avant après avoir
-- migré fonctionne aussi — `<img src>` accepte une URL.


-- ════════════════════════════════════════════════════════════════════════════
-- F. APRÈS CETTE MIGRATION — ce qui reste, et dans quel ordre
-- ════════════════════════════════════════════════════════════════════════════
--
-- F.1 — SUPPRIMER L'ARCHIVE. Décision du dirigeant, pas du script, et seulement
--       après le contrôle humain du § D.7. Tant qu'elle existe, la base pèse
--       toujours ses 20 Mo — mais aucun écran ne les télécharge, ce qui est
--       toute la différence.
--
--         DELETE FROM app_data
--         WHERE collection = 'produits_catalogue_photos_archive_011';
--
--       ⚠️ Après ce DELETE, le retour arrière du § E n'existe plus. Les photos
--          ne vivent alors plus que dans le bucket. Ne le faire que quand le
--          catalogue a été regardé, à Moanda, sur un vrai téléphone.
--
-- F.2 — LES 5 COMMANDES QUI PORTENT DÉJÀ UNE PHOTO RECOPIÉE (163 117 o).
--
--       Le code ne recopie plus (§ A.5), mais ces cinq lignes-là gardent leur
--       copie. Elles ne sont pas traitées ici : ce sont des commandes, la
--       collection la plus sensible du logiciel, et cinq lignes de 163 ko ne
--       justifient pas d'y écrire. À traiter par une migration dédiée si le
--       poids de `commandes` devient un problème — il ne l'est pas aujourd'hui.
--
-- F.3 — LA BANNIÈRE DU PORTAIL (`_settings`, 90 422 o) ET LA PHOTO DE PROFIL
--       D'UN EMPLOYÉ (52 709 o) sont elles aussi en base64. Ensemble : 143 ko,
--       soit 0,7 % de ce que pèse le catalogue. Le même bucket et le même
--       script les traiteraient — mais `_settings` est relu à chaque
--       démarrage, et une erreur là coûte plus cher que 143 ko.
--
-- F.4 — ⚠️ LA LIMITE LA PLUS IMPORTANTE : LE CHEMIN D'AJOUT N'A PAS CHANGÉ.
--
--       `ImageUploader` (src/features/catalogue/page.jsx) compresse toujours
--       vers une data-URL et l'écrit dans `images`. Une photo ajoutée APRÈS
--       cette migration repart donc en base64 dans la ligne.
--
--       Le dégât est borné — `compressSource()` (600 px, qualité 0,7) produit
--       des fichiers de 12 à 90 ko, contre les 1,7 à 3,2 Mo des PNG d'avant —
--       mais il n'est pas nul : la collection regrossira lentement.
--
--       Le chantier suivant, et il est court : téléverser dans le bucket au
--       moment de l'ajout, comme le fait déjà `src/features/mockup-ia/page.jsx`
--       (ligne 670) pour le bucket `mockups`. C'est cinq lignes dans
--       `ImageUploader`, plus la gestion de l'échec de téléversement. Il n'a
--       pas été fait ici pour ne pas mêler une migration de données à une
--       modification du chemin d'écriture du catalogue : deux couches
--       sensibles à la fois, c'est exactement ce que la règle de production
--       interdit.
--
-- F.5 — `Collection.list()` télécharge toujours la colonne `data` ENTIÈRE, pour
--       les 46 collections. Après cette migration, le catalogue n'est plus le
--       problème ; `audit_logs` (3 339 lignes, 1 556 385 o) devient la plus
--       lourde. Un `select` de colonnes choisies, ou une pagination, est le
--       chantier d'après.
