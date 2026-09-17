-- ════════════════════════════════════════════════════════════════════════════
-- 008 — La file de publication de l'auto-posteur
--
--        🔴 NON APPLIQUÉE. À exécuter par Gassim dans l'éditeur SQL Supabase,
--        bloc par bloc, dans l'ordre. Rien dans cette migration ne modifie une
--        donnée existante : elle ne crée que des objets nouveaux.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw
-- Rédigé le       : 2026-09-18
-- Code associé    : api/_lib/autopost-depot.js · api/_lib/autopost-executeur.js
--                   api/autopost.js
-- ════════════════════════════════════════════════════════════════════════════
--
-- POURQUOI UNE TABLE DÉDIÉE ET PAS `app_data`
--
-- Deux raisons, et chacune suffirait.
--
-- 1. `app_data` n'a AUCUNE contrainte d'unicité. Deux insertions de la même clé
--    d'idempotence y réussissent toutes les deux, en silence. C'est exactement
--    le défaut qui a fait écrire deux fois le même encaissement SingPay, et que
--    la migration 005 a corrigé pour les mouvements financiers. On ne va pas
--    reproduire ici, en neuf, le bug qu'on vient de payer ailleurs.
--
-- 2. La policy `allow_all_operations` rend `app_data` lisible ET modifiable par
--    quiconque présente la clé `anon` — laquelle est dans le bundle public
--    (rang 1 de l'audit `08_AUDIT_COMPLET_APPLICATION.md`). Une file qui décide
--    de ce qui est publié sur la Page de l'entreprise n'a rien à faire dans une
--    table ouverte à Internet.
--
-- Les tables ci-dessous ne sont accessibles QU'AU rôle de service, donc au
-- serveur, donc jamais depuis un navigateur.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A. LA FILE
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ `instant_utc` est du TEXTE, pas un `timestamptz`. Un `timestamptz` relu par
--    le pilote revient dans le fuseau de la session, et la comparaison redevient
--    une affaire de configuration. Le manifeste porte déjà l'instant sous une
--    forme non ambiguë (`2026-09-21T16:30:00Z`) : on le range tel quel. C'est le
--    même raisonnement que `src/lib/dates.js` — les 55 300 F d'écart venaient
--    d'une conversion que personne n'avait demandée.
--
-- ⚠️ `date_locale` est la date MÉTIER du créneau (Africa/Libreville), utilisée
--    pour le plafond journalier. Elle ne se déduit pas de `instant_utc` sans le
--    fuseau : elle est donc stockée, pas recalculée.

CREATE TABLE IF NOT EXISTS autopost_file (
  -- La clé d'idempotence EST la clé primaire. Pas un champ parmi d'autres :
  -- publication_id | v<version> | canal | compte | instant_utc
  cle_idempotence     text PRIMARY KEY,

  publication_id      text NOT NULL,
  version_contenu     integer NOT NULL DEFAULT 1,
  canal               text NOT NULL CHECK (canal IN ('facebook','instagram','tiktok_handoff','whatsapp_handoff')),
  compte_cible_id     text,
  surface             text NOT NULL DEFAULT 'feed' CHECK (surface IN ('feed','reel','story')),

  instant_utc         text NOT NULL,
  date_locale         text NOT NULL,
  tolerance_minutes   integer NOT NULL DEFAULT 90,

  etat                text NOT NULL DEFAULT 'draft'
                        CHECK (etat IN ('draft','scheduled','executing','published',
                                        'failed','expired','suspended','reconciling','cancelled')),
  tentatives          integer NOT NULL DEFAULT 0,
  tentatives_max      integer NOT NULL DEFAULT 3,

  -- ⛔ LE TÉMOIN DE L'EFFET. C'est cette colonne, et elle seule, qui prouve
  --    qu'une publication est partie. Ni `etat`, ni `envoi_tente_a_utc`.
  id_distant          text,
  id_conteneur        text,          -- l'ancre Instagram, écrite AVANT media_publish
  envoi_tente_a_utc   text,          -- trace écrite AVANT le premier appel réseau

  legende             text,
  url_media           text,          -- URL signée courte, produite à l'approbation

  publication         jsonb NOT NULL,   -- le publication.json v2.0 complet
  approbation         jsonb,            -- l'APPROBATION.json, ou NULL = non approuvé
  resultat            jsonb,
  derniere_erreur     jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Un même identifiant distant ne peut pas apparaître deux fois : si deux lignes
-- portaient le même post Meta, c'est qu'on a publié deux fois. L'index rend ce
-- cas impossible au lieu de le rendre détectable après coup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_autopost_id_distant_unique
  ON autopost_file (id_distant)
  WHERE id_distant IS NOT NULL;

-- La lecture de la file à chaque passage : état + instant.
CREATE INDEX IF NOT EXISTS idx_autopost_file_etat_instant
  ON autopost_file (etat, instant_utc);

-- Le plafond journalier.
CREATE INDEX IF NOT EXISTS idx_autopost_file_date_locale
  ON autopost_file (date_locale) WHERE etat = 'published';

-- ════════════════════════════════════════════════════════════════════════════
-- B. L'INTERRUPTEUR — couche 1 du kill-switch
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 Pourquoi une LIGNE EN BASE et pas une variable d'environnement : sur
--    Vercel, changer une variable n'a d'effet qu'après redéploiement. Un arrêt
--    d'urgence qui exige un déploiement n'est pas un arrêt d'urgence. Ici,
--    basculer `actif` à false arrête la chaîne au prochain passage, en ~10 s,
--    sans rien perdre : la file est conservée.
--
-- La ligne est créée à `actif = false` et `mode = 'dry_run'`. C'est volontaire :
-- après cette migration, RIEN ne publie. Il faut deux gestes explicites de
-- Gassim (activer, puis passer en live) pour qu'une publication réelle parte.

CREATE TABLE IF NOT EXISTS autopost_controle (
  id                  text PRIMARY KEY DEFAULT 'global',
  actif               boolean NOT NULL DEFAULT false,
  mode                text NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run','live')),
  plafond_journalier  integer NOT NULL DEFAULT 4,
  motif               text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO autopost_controle (id, actif, mode, plafond_journalier, motif)
VALUES ('global', false, 'dry_run', 4,
        'Créé à l''arrêt le 18/09/2026. Ne sera activé qu''après : (1) le jeton Meta, '
        '(2) le test de visibilité en mode développement, (3) un média hébergé avec URL signée.')
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- C. LE JOURNAL — « un auto-poster qu'on ne peut pas regarder est un
--                   auto-poster qu'on ne peut pas réparer »
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pas d'unicité ici, et c'est voulu : une ligne de journal en double est un
-- désagrément, une publication en double est un incident.

CREATE TABLE IF NOT EXISTS autopost_journal (
  id                bigserial PRIMARY KEY,
  instant_utc       text NOT NULL,
  cle_idempotence   text,
  publication_id    text,
  canal             text,
  evenement         text NOT NULL,   -- passage | simulation | publication | echec | incertain
  resume            text,
  piste             text,            -- l'hypothèse posée À CÔTÉ du message brut, jamais à sa place
  bilan             jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autopost_journal_instant
  ON autopost_journal (instant_utc DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- D. LES POLICIES — fermées par défaut
-- ════════════════════════════════════════════════════════════════════════════
--
-- RLS activé SANS aucune policy permissive : personne ne passe, sauf le rôle de
-- service, qui contourne RLS par construction. C'est exactement ce qu'on veut :
-- le navigateur ne lit ni n'écrit ces tables. L'écran du gérant passe par
-- `/api/autopost-etat`, qui est côté serveur et exige une session signée.
--
-- ⛔ Ne PAS ajouter ici une policy `USING (true)` « pour que l'écran marche ».
--    C'est précisément la faute `allow_all_operations` de `app_data`.

ALTER TABLE autopost_file     ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopost_controle ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopost_journal  ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- E. CONTRÔLES APRÈS APPLICATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Les trois tables existent :
--    SELECT tablename FROM pg_tables WHERE tablename LIKE 'autopost%';
--
-- 2. L'interrupteur est bien à l'ARRÊT (attendu : actif = false, mode = dry_run) :
--    SELECT actif, mode, plafond_journalier FROM autopost_controle WHERE id = 'global';
--
-- 3. L'unicité du témoin est réelle — à exécuter dans un bloc ANNULÉ :
--    BEGIN;
--      INSERT INTO autopost_file (cle_idempotence, publication_id, canal, instant_utc,
--                                 date_locale, publication, id_distant)
--      VALUES ('TEST|v1|facebook|1|2026-09-21T08:00:00Z', 'PUB-2026-S39-1-01', 'facebook',
--              '2026-09-21T08:00:00Z', '2026-09-21', '{}'::jsonb, 'ID-DISTANT-TEST');
--      INSERT INTO autopost_file (cle_idempotence, publication_id, canal, instant_utc,
--                                 date_locale, publication, id_distant)
--      VALUES ('AUTRE|v1|facebook|1|2026-09-21T08:00:00Z', 'PUB-2026-S39-1-01', 'facebook',
--              '2026-09-21T08:00:00Z', '2026-09-21', '{}'::jsonb, 'ID-DISTANT-TEST');
--      -- ↑ DOIT échouer en 23505 (unique_violation). Si elle passe, l'index
--      --   manque et l'idempotence n'est pas garantie.
--    ROLLBACK;
--
-- 4. RLS est actif et sans policy permissive :
--    SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'autopost%';
--    SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'autopost%';
--    -- attendu : relrowsecurity = true partout, AUCUNE policy listée.
--
-- ════════════════════════════════════════════════════════════════════════════
-- F. RETOUR ARRIÈRE — immédiat, sans perte
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cette migration ne touche à aucune table existante. Pour tout défaire :
--
--   DROP TABLE IF EXISTS autopost_journal;
--   DROP TABLE IF EXISTS autopost_file;
--   DROP TABLE IF EXISTS autopost_controle;
--
-- L'application continue de fonctionner : l'écran d'auto-post affiche « état
-- indisponible » et rien d'autre n'en dépend.
--
-- Et avant même d'en arriver là, l'arrêt sans suppression tient en une ligne :
--
--   UPDATE autopost_controle SET actif = false, motif = 'arrêt manuel' WHERE id = 'global';
