-- ════════════════════════════════════════════════════════════════════════════
-- 007 — Fusionner les comptes en double
--
--        ⛔ NON APPLIQUÉE. Rédigée le 2026-09-17 après mesure en lecture seule
--           du projet bcwkrrqmjpaohmafcncw. Aucune écriture n'a été faite.
--
--        ⚠️ CETTE MIGRATION PREND UNE DÉCISION MÉTIER. Elle ne doit pas être
--           exécutée avant que Gassim ait lu le § B et dit oui à ce qu'il y lit.
--
--        CE QUI A ÉTÉ MESURÉ, ET NON SUPPOSÉ (2026-09-17) :
--          employes ......................................... 13 lignes
--            · identités distinctes (par e-mail) ............  7
--            · imprimerieogooue@gmail.com ................... ×3  (3 admins)
--            · imprimerieogooue.user@gmail.com .............. ×3
--            · Minguisilou@gmail.com ........................ ×3
--            · empreintes de mot de passe distinctes ........ 13/13
--          auth_credentials ................................. 13 lignes
--            · une par compte, doublons compris, 0 orpheline
--          RATTACHEMENTS SUR LES 6 COMPTES À FUSIONNER :
--            · d9528619 (opérateur 18/03) → 82 rapports.operateur_id
--            · les 5 autres ................................. 0 rattachement
--          Créations, en trois vagues :
--            · 07/03 19:15:01 ... admin        (amorçage)
--            · 13/03 14:25:05-06 opérateur + client test (saisis à la main :
--              leurs noms — « Acceuil », « test » — ne sont PAS ceux du seed)
--            · 18/03 01:14:56-57 les 3 comptes du seed, en 0,4 s
--            · 05/05 06:27:01-08 les 3 comptes du seed, en 6,6 s
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Code associé    : src/services/seed.js, src/services/amorcage-idempotent.js
--                   api/_lib/supabase-admin.js (le tri par created_at)
--                   api/auth-login.js (le .find() sur l'e-mail)
-- ════════════════════════════════════════════════════════════════════════════
--
-- POURQUOI CES DOUBLONS EXISTENT — la cause est corrigée dans le code
--
-- `seedDatabase()` décidait ainsi :
--
--     const existing = await db.employes.list();
--     if (existing.length > 0) return;
--
-- Le critère vivait donc déjà dans la BASE. Ce n'est pas lui qui a lâché :
-- c'est la lecture. `list()` n'échoue jamais — elle attrape l'erreur, la met
-- dans la console et rend `[]`, c'est-à-dire la réponse exacte d'une base
-- neuve. Un délai dépassé à Moanda suffisait donc à réécrire les 3 comptes.
--
-- La preuve que la base n'était pas vide ces soirs-là : au MÊME démarrage, les
-- gardes du catalogue (`seedCatalogue`) et du chantier (`seedPapeterieProject`)
-- ont tenu — aucune ligne n'a été créée dans `produits_catalogue` ni dans
-- `projets_travaux` les 18/03 et 05/05. C'est UNE requête sur quatre qui a
-- échoué, pas la connexion entière.
--
-- Le même défaut, sur la collection la plus lourde, a fait bien pire :
-- `produits_catalogue` pèse 20 Mo (une ligne atteint 3,2 Mo d'images en base64)
-- et `seedInventaire()` la lisait ENTIÈREMENT à chaque démarrage pour savoir si
-- elle contenait plus de 5 lignes. Elle a rejoué le 18/08, le 12/09 et encore
-- le 17/09 à 06:52 : 195 lignes pour ~45 articles réels. Ce volet-là n'est PAS
-- traité ici (voir § F).
--
-- ════════════════════════════════════════════════════════════════════════════
-- A. AVANT — contrôle, lecture seule, sans effet
-- ════════════════════════════════════════════════════════════════════════════

-- A.1 — La photo d'ensemble. Doit rendre 13 / 7 au 2026-09-17.

SELECT count(*)                                         AS comptes,
       count(DISTINCT lower(trim(data->>'email')))      AS identites
FROM app_data WHERE collection = 'employes';

-- A.2 — Les adresses en double, et l'ordre dans lequel la connexion les voit.
--       Le RANG 1 est celui que `api/auth-login.js` retient : il fait un
--       `.find()` sur une liste triée par `created_at` croissant.

SELECT lower(trim(data->>'email')) AS email,
       data->>'id'                 AS compte_id,
       data->>'role'               AS role,
       data->>'prenom' || ' ' || (data->>'nom') AS libelle,
       created_at,
       row_number() OVER (PARTITION BY lower(trim(data->>'email')) ORDER BY created_at) AS rang
FROM app_data
WHERE collection = 'employes'
  AND lower(trim(data->>'email')) IN (
    SELECT lower(trim(data->>'email')) FROM app_data
    WHERE collection = 'employes'
    GROUP BY 1 HAVING count(*) > 1
  )
ORDER BY email, created_at;

-- A.3 — ⚠️ LE CONTRÔLE QUI DÉCIDE DU CORPS DE LA MIGRATION.
--
-- Supprimer un compte sans réaffecter ce qui pend dessus détruit de
-- l'historique. Cette requête compte, champ par champ, ce qui pointe vers
-- CHAQUE compte en double. Au 2026-09-17, elle rend une seule ligne pour un
-- compte à fusionner : `rapports.operateur_id` = 82 sur d9528619.
--
-- Si elle en rend d'autres, S'ARRÊTER : le § C est incomplet.

WITH doublons AS (
  SELECT data->>'id' AS eid,
         row_number() OVER (PARTITION BY lower(trim(data->>'email')) ORDER BY created_at) AS rang
  FROM app_data
  WHERE collection = 'employes'
    AND lower(trim(data->>'email')) IN (
      SELECT lower(trim(data->>'email')) FROM app_data
      WHERE collection = 'employes' GROUP BY 1 HAVING count(*) > 1
    )
)
SELECT d.eid AS compte_a_fusionner, a.collection, kv.k AS champ, count(*) AS lignes
FROM doublons d
JOIN app_data a ON a.collection <> 'employes'
JOIN LATERAL jsonb_each_text(a.data) kv(k, v) ON kv.v = d.eid
WHERE d.rang > 1
GROUP BY 1, 2, 3
ORDER BY 4 DESC;

-- A.4 — Les identifiants. Doit rendre 13 lignes, 0 orpheline.

SELECT count(*) AS lignes,
       count(*) FILTER (
         WHERE employe_id NOT IN (SELECT data->>'id' FROM app_data WHERE collection = 'employes')
       ) AS orphelines
FROM auth_credentials;

-- A.5 — Hors périmètre, mais à signaler : 2 rapports portent un `operateur_id`
--       qui ne correspond à AUCUN compte existant (da55bbd1…, un compte disparu
--       avant mars). Cette migration n'y touche pas.

SELECT count(*) AS rapports_operateur_inconnu
FROM app_data r
WHERE r.collection = 'rapports'
  AND r.data->>'operateur_id' IS NOT NULL
  AND r.data->>'operateur_id' <> ''
  AND r.data->>'operateur_id' <> 'system'
  AND NOT EXISTS (
    SELECT 1 FROM app_data e WHERE e.collection = 'employes' AND e.data->>'id' = r.data->>'operateur_id'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- B. CE QUE LA FUSION DÉCIDE — en toutes lettres, à lire avant d'exécuter
-- ════════════════════════════════════════════════════════════════════════════
--
-- B.1 — ELLE GARDE LE COMPTE LE PLUS ANCIEN DE CHAQUE ADRESSE.
--
--   Les 3 comptes d'une même adresse portent 3 mots de passe différents (3 sels
--   différents, donc 3 empreintes différentes), et un seul est celui que la
--   personne connaît.
--
--   Garder le plus ancien, c'est garder CELUI QUI FONCTIONNE AUJOURD'HUI. Ce
--   n'est pas une supposition, c'est mesuré à deux endroits :
--     · dans le code : `lireCollection()` trie par `created_at` croissant et
--       `auth-login` fait un `.find()` — la connexion tombe donc toujours sur le
--       plus ancien, de façon reproductible ;
--     · dans le journal d'audit : le 18/03 à 01:34, soit 20 minutes APRÈS la
--       création des doublons d'admin, la connexion est enregistrée sur
--       f61af333 (le compte du 07/03). Le 05/05 à 06:27:50, soit 42 secondes
--       après la troisième vague, la connexion opérateur est enregistrée sur
--       75e89fe9 (le compte du 13/03). Les doublons n'ont jamais servi à
--       personne pour se connecter.
--
--   CE QUE CELA COÛTE, ET IL FAUT LE DIRE : si la personne connaît un mot de
--   passe qui est celui d'un compte plus récent, ce mot de passe est DÉJÀ
--   inopérant aujourd'hui — la migration ne le casse pas, elle rend ce fait
--   définitif. Rien n'est perdu pour autant : les comptes écartés sont ARCHIVÉS,
--   pas supprimés (§ C.2), et le § E les remet en place à l'identique.
--
-- B.2 — ELLE CHANGE LE PROPRIÉTAIRE DE 82 RAPPORTS.
--
--   82 rapports, du 06/04 au 16/09, portent `operateur_id` = d9528619, le
--   doublon d'opérateur créé le 18/03. Ils passent sur 75e89fe9, le compte
--   conservé. Même adresse e-mail, même personne : ce qui change à l'écran,
--   c'est le libellé affiché (« Opérateur Opérateur » devient « Opérateur
--   Acceuil »). Rien n'est supprimé, et l'ancien identifiant est conservé DANS
--   la ligne (champ `fusion_007_operateur_precedent`) pour que le retour
--   arrière soit exact.
--
--   Pourquoi ces rapports existent : l'écran de saisie choisit l'opérateur dans
--   une liste déroulante alimentée par `db.employes.list()`
--   (src/features/rapports/components/rapport-form.jsx). Trois lignes y
--   portaient le même libellé : une personne, deux identités, 82 rapports d'un
--   côté et 71 de l'autre. C'est exactement le désordre qu'on corrige.
--
-- B.3 — ELLE NE SUPPRIME AUCUN COMPTE.
--
--   Les 6 comptes écartés sortent de la collection `employes` — donc de
--   l'application, de la liste déroulante et de la connexion — en changeant de
--   collection. Leurs identifiants sont déplacés dans une table d'archive. Rien
--   n'est effacé : une suppression d'employé est une décision qui appartient à
--   Gassim, pas à un script de nettoyage.
--
-- B.4 — CE QU'ELLE NE FAIT PAS.
--
--   · Elle ne retire pas le tri par `created_at` de `api/_lib/supabase-admin.js`.
--     Après la fusion il n'y a plus d'homonyme, donc ce tri n'est plus la
--     condition de la connexion — mais on ne retire pas un filet le jour où on
--     déplace l'échelle. À traiter dans une intervention séparée.
--   · Elle ne touche pas aux 195 lignes de `produits_catalogue` (§ F).
--   · Elle ne réinitialise aucun mot de passe.

-- ════════════════════════════════════════════════════════════════════════════
-- C. LE CORPS — dans cet ordre, sans en sauter
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tout tient dans une transaction : si un contrôle intermédiaire déplaît,
-- ROLLBACK et il ne s'est rien passé.

BEGIN;

-- C.0 — La table de correspondance, calculée une fois et matérialisée, pour que
--       les trois écritures suivantes voient exactement le même découpage.

CREATE TEMP TABLE fusion_007 ON COMMIT DROP AS
WITH classes AS (
  SELECT data->>'id'                        AS eid,
         lower(trim(data->>'email'))        AS email,
         created_at,
         row_number() OVER (PARTITION BY lower(trim(data->>'email')) ORDER BY created_at, data->>'id') AS rang
  FROM app_data
  WHERE collection = 'employes'
)
SELECT d.eid AS a_fusionner, g.eid AS a_garder, d.email
FROM classes d
JOIN classes g ON g.email = d.email AND g.rang = 1
WHERE d.rang > 1;

-- Contrôle : doit rendre 6 lignes, 3 adresses.
SELECT count(*) AS comptes_a_fusionner, count(DISTINCT email) AS adresses FROM fusion_007;

-- C.1 — RÉAFFECTER CE QUI PEND SUR LES COMPTES ÉCARTÉS.
--       Au 2026-09-17, un seul champ est concerné : `rapports.operateur_id`
--       (82 lignes). L'ancienne valeur est conservée dans la ligne.
--       Attendu : 82 lignes.

UPDATE app_data r
SET data = jsonb_set(
      jsonb_set(r.data, '{operateur_id}', to_jsonb(f.a_garder), true),
      '{fusion_007_operateur_precedent}', to_jsonb(f.a_fusionner), true
    ),
    updated_at = now()
FROM fusion_007 f
WHERE r.collection = 'rapports'
  AND r.data->>'operateur_id' = f.a_fusionner;

-- C.2 — ARCHIVER LES COMPTES ÉCARTÉS (ils sortent de l'application, pas de la
--       base). Attendu : 6 lignes.

UPDATE app_data e
SET collection = 'employes_fusionnes_007',
    updated_at = now()
FROM fusion_007 f
WHERE e.collection = 'employes'
  AND e.data->>'id' = f.a_fusionner;

-- C.3 — ARCHIVER LEURS IDENTIFIANTS. `auth_credentials` porte une ligne par
--       compte, doublons compris : laisser ces 6 lignes en place laisserait 6
--       empreintes vivantes derrière des comptes qui n'existent plus.
--       Attendu : 6 lignes déplacées, 7 restantes.

CREATE TABLE IF NOT EXISTS auth_credentials_fusionnes_007 (
  employe_id      TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  updated_at      TIMESTAMPTZ,
  archive_le      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE auth_credentials_fusionnes_007 ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune policy : RLS sans policy = tout refusé à la clé
-- publiable. Seule `service_role` peut lire cette archive.

INSERT INTO auth_credentials_fusionnes_007 (employe_id, password_hash, password_salt, updated_at)
SELECT c.employe_id, c.password_hash, c.password_salt, c.updated_at
FROM auth_credentials c
JOIN fusion_007 f ON f.a_fusionner = c.employe_id
ON CONFLICT (employe_id) DO NOTHING;

DELETE FROM auth_credentials c
USING fusion_007 f
WHERE c.employe_id = f.a_fusionner;

-- ⚠️ RELIRE LES CONTRÔLES DU § D AVANT DE VALIDER.
--    COMMIT;   ou   ROLLBACK;

-- ════════════════════════════════════════════════════════════════════════════
-- D. APRÈS — contrôles
-- ════════════════════════════════════════════════════════════════════════════

-- D.1 — 7 comptes, 7 identités, 0 adresse en double.
--
-- SELECT count(*) AS comptes,
--        count(DISTINCT lower(trim(data->>'email'))) AS identites
-- FROM app_data WHERE collection = 'employes';

-- D.2 — Plus rien ne pointe vers un compte archivé. Attendu : 0 ligne.
--
-- SELECT a.collection, kv.k AS champ, count(*)
-- FROM app_data arch
-- JOIN app_data a ON a.collection NOT IN ('employes_fusionnes_007')
-- JOIN LATERAL jsonb_each_text(a.data) kv(k, v) ON kv.v = arch.data->>'id'
-- WHERE arch.collection = 'employes_fusionnes_007'
--   AND kv.k <> 'fusion_007_operateur_precedent'
-- GROUP BY 1, 2;

-- D.3 — L'opérateur conservé porte bien 153 rapports (71 + 82).
--
-- SELECT data->>'operateur_id' AS operateur, count(*)
-- FROM app_data WHERE collection = 'rapports' GROUP BY 1 ORDER BY 2 DESC;

-- D.4 — Un identifiant par compte, et aucun de plus. Attendu : 7 / 7 / 0.
--
-- SELECT (SELECT count(*) FROM auth_credentials) AS identifiants,
--        (SELECT count(*) FROM app_data WHERE collection = 'employes') AS comptes,
--        (SELECT count(*) FROM auth_credentials
--          WHERE employe_id NOT IN (SELECT data->>'id' FROM app_data WHERE collection = 'employes')) AS orphelins;

-- D.5 — LE SEUL CONTRÔLE QUI COMPTE VRAIMENT : se connecter, pour de vrai, avec
--       les trois comptes concernés, depuis le téléphone du gérant. Un décompte
--       SQL ne prouve pas qu'une personne peut entrer dans son logiciel.

-- ════════════════════════════════════════════════════════════════════════════
-- E. RETOUR ARRIÈRE — exact, car rien n'a été supprimé
-- ════════════════════════════════════════════════════════════════════════════
--
-- À exécuter dans cet ordre inverse. Les 82 rapports sont identifiables par le
-- champ témoin posé en C.1 : le retour ne devine rien.
--
--   BEGIN;
--
--   -- E.1 — Les comptes reviennent dans l'application (6 lignes)
--   UPDATE app_data SET collection = 'employes', updated_at = now()
--   WHERE collection = 'employes_fusionnes_007';
--
--   -- E.2 — Les identifiants reviennent (6 lignes)
--   INSERT INTO auth_credentials (employe_id, password_hash, password_salt, updated_at)
--   SELECT employe_id, password_hash, password_salt, updated_at
--   FROM auth_credentials_fusionnes_007
--   ON CONFLICT (employe_id) DO NOTHING;
--
--   -- E.3 — Les rapports retrouvent leur opérateur d'origine (82 lignes)
--   UPDATE app_data
--   SET data = (data - 'fusion_007_operateur_precedent')
--              || jsonb_build_object('operateur_id', data->>'fusion_007_operateur_precedent'),
--       updated_at = now()
--   WHERE collection = 'rapports'
--     AND data ? 'fusion_007_operateur_precedent';
--
--   -- relire les décomptes, puis COMMIT; ou ROLLBACK;
--
-- Une fois le retour arrière validé et l'archive devenue inutile :
--   DROP TABLE auth_credentials_fusionnes_007;

-- ════════════════════════════════════════════════════════════════════════════
-- F. APRÈS CETTE MIGRATION — ce qui reste à faire, et dans quel ordre
-- ════════════════════════════════════════════════════════════════════════════
--
-- F.1 — POSER LA CONTRAINTE D'UNICITÉ. À faire SEULEMENT après que le § D est
--       vert : l'index échoue s'il reste une adresse en double, ce qui est sa
--       raison d'être. C'est la seule protection qui survit à un vieux bundle
--       resté dans le cache d'un téléphone : le code peut être corrigé, le
--       navigateur du gérant peut encore servir l'ancien pendant des jours.
--
--       ⚠️ `CREATE INDEX CONCURRENTLY` ne tourne pas dans une transaction :
--          l'exécuter seul.
--       ⚠️ Effet de bord assumé : une tentative de création d'un compte avec une
--          adresse déjà prise remonte désormais une erreur PostgreSQL 23505 au
--          lieu du message « Un compte avec cet email existe deja ». Le contrôle
--          applicatif existe déjà (api/auth-creer-utilisateur.js, 409) ; l'index
--          ne sert que lorsqu'il est contourné ou perdu dans une course.
--
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_employes_email_unique
--     ON app_data ((lower(trim(data->>'email'))))
--     WHERE collection = 'employes'
--       AND data->>'email' IS NOT NULL
--       AND trim(data->>'email') <> '';
--
--   Retour arrière : DROP INDEX CONCURRENTLY IF EXISTS idx_employes_email_unique;
--
-- F.2 — LES 195 LIGNES DE `produits_catalogue`. Même cause, autre collection,
--       et le désordre y est six fois plus gros : 195 lignes pour ~45 articles
--       (« Tee-shirt blanc KAF enfant » ×10, « Polo blanc » ×8). Le code ne
--       rejouera plus, mais les doublons déjà écrits restent à l'écran du
--       gérant. Fusionner des articles, c'est décider quel prix et quel stock
--       font foi : c'est une migration à part, et une décision de Gassim.
--
-- F.3 — LES 2 RAPPORTS À OPÉRATEUR INCONNU (§ A.5). À rattacher ou à laisser,
--       après avoir demandé qui tenait la boutique ces deux jours-là.
