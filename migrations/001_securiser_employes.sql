-- ============================================================================
-- Migration 001 — sortir les identifiants de la table publique
--
-- ⚠️ CETTE MIGRATION SE JOUE EN DEUX TEMPS, SÉPARÉS PAR UN DÉPLOIEMENT.
--    NE PAS COLLER LE FICHIER ENTIER DANS L'ÉDITEUR SQL.
--    Lire migrations/RUNBOOK.md — l'ordre compte, et se tromper d'ordre coupe
--    la connexion de toute l'équipe, au comptoir, un jour ouvré.
--
--    PHASE A — création + recopie. Non destructive, réversible, sans effet de
--              bord sur l'application en cours d'exécution.
--              ✅ APPLIQUÉE EN PRODUCTION LE 17/09/2026, contrôles relus :
--                 13 empreintes recopiées, 13 identiques, 0 manquante ;
--                 `auth_credentials` : RLS activée, 0 policy (la clé publiable
--                 n'a donc aucun droit dessus) ; les 13 empreintes inline sont
--                 TOUJOURS en place — rien n'a été détruit.
--              Appliquée AVANT le déploiement du code, volontairement : la
--              table attendait déjà quand le nouveau code est arrivé, donc le
--              503 « stockage indisponible » n'est jamais apparu à l'écran.
--    PHASE B — retrait des empreintes de `app_data` + remplacement de la policy.
--              DESTRUCTIVE. Ne s'applique qu'après vérification de la PHASE A.
--              🔴 NON APPLIQUÉE. C'est elle qui ferme la base : tant qu'elle
--                 n'est pas passée, `allow_all_operations` reste la seule règle
--                 de `app_data`. Elle exige un test de connexion PAR RÔLE
--                 (admin, employé, client), donc des mots de passe — c'est le
--                 seul geste de cette migration qui ne peut pas être automatisé.
--
-- ── CONSTAT, RE-VÉRIFIÉ SUR LA BASE DE PRODUCTION LE 17/09/2026 ────────────
--   projet `bcwkrrqmjpaohmafcncw`
--   • `app_data` : 4 092 lignes, 29 collections. `employes` en contient 13,
--     dont 3 administrateurs, et 13 sur 13 portent encore `password_hash`
--     ET `password_salt` en clair dans le JSON.
--   • policy `allow_all_operations` : FOR ALL, USING (true), WITH CHECK (true),
--     roles = {public}. C'est toujours la SEULE policy de la table.
--   • `auth_credentials` : N'EXISTE PAS. La migration n'a jamais été appliquée.
--   • la clé publiable est compilée dans le bundle JavaScript servi au public
--     (mesuré sur les fichiers `assets/*.js` — voir RUNBOOK).
--   Conséquence : lecture, écriture et suppression de TOUTE la base par
--   quiconque ouvre l'application, y compris la création d'un `role: 'admin'`.
--
--   • Comptes en double, toujours présents : `imprimerieogooue@gmail.com` ×3
--     (3 administrateurs), `imprimerieogooue.user@gmail.com` ×3,
--     `minguisilou@gmail.com` ×3. Les 13 empreintes sont toutes distinctes.
--     ⚠️ Ces doublons NE SONT PAS traités ici : chaque ligne a son propre `id`,
--     donc chacune est recopiée telle quelle et la connexion continue de
--     retenir la plus ancienne (voir le commentaire de `lireCollection` dans
--     api/_lib/supabase-admin.js). Dédoublonner est une décision métier —
--     lequel des 3 mots de passe est le bon ? — et ne se fait pas ici.
-- ============================================================================


-- ############################################################################
-- ## CONTRÔLE AVANT — LECTURE SEULE. À exécuter d'abord, seul, et à lire.
-- ##
-- ## N'écrit rien. Si l'une des lignes ne dit pas ce qui est annoncé en face,
-- ## S'ARRÊTER et rapporter : la base n'est pas dans l'état attendu.
-- ############################################################################

SELECT 'employes' AS controle,
       count(*)                                                AS valeur,
       '13 attendu'                                            AS attendu
FROM app_data WHERE collection = 'employes'
UNION ALL
SELECT 'employes avec empreinte inline',
       count(*), 'doit valoir le nombre ci-dessus'
FROM app_data
WHERE collection = 'employes'
  AND data->>'password_hash' IS NOT NULL AND data->>'password_salt' IS NOT NULL
UNION ALL
SELECT 'employes SANS empreinte (seront muets apres migration)',
       count(*), '0 espere — sinon ces comptes ne peuvent deja plus se connecter'
FROM app_data
WHERE collection = 'employes'
  AND (data->>'password_hash' IS NULL OR data->>'password_salt' IS NULL)
UNION ALL
SELECT 'identifiants JSON dupliques (ecraseraient une recopie)',
       count(*), '0 obligatoire'
FROM (
  SELECT data->>'id' FROM app_data WHERE collection = 'employes'
  GROUP BY 1 HAVING count(*) > 1
) x
UNION ALL
SELECT 'employes sans id dans le JSON',
       count(*), '0 obligatoire — la recopie les perdrait'
FROM app_data WHERE collection = 'employes' AND data->>'id' IS NULL
UNION ALL
SELECT 'auth_credentials deja presente',
       count(*), '0 = PHASE A a faire / 1 = PHASE A deja faite'
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'auth_credentials'
UNION ALL
SELECT 'policies sur app_data',
       count(*), '1 avant migration (allow_all_operations) / 4 apres PHASE B'
FROM pg_policies WHERE tablename = 'app_data'
UNION ALL
SELECT 'fonction update_updated_at presente',
       count(*), '1 attendu — sinon retirer l ALTER FUNCTION de la PHASE B'
FROM pg_proc WHERE proname = 'update_updated_at' AND pronamespace = 'public'::regnamespace;


-- ############################################################################
-- ## PHASE A — créer et recopier. NON DESTRUCTIVE.
-- ##
-- ## À appliquer APRÈS que le code soit déployé et la connexion testée.
-- ## Ne retire rien, ne change aucune policy. L'application continue de
-- ## fonctionner exactement comme avant pendant et après cette phase :
-- ## `api/auth-login.js` lit `auth_credentials` en priorité et retombe sur les
-- ## champs inline s'il ne trouve rien — les deux emplacements coexistent.
-- ############################################################################

BEGIN;

-- 1. Table dédiée aux identifiants. RLS activée, AUCUNE policy :
--    la clé publiable n'a donc aucun droit dessus. `service_role` contourne RLS
--    et reste seule capable de lire — c'est ce que fait /api/auth-login.
CREATE TABLE IF NOT EXISTS auth_credentials (
  employe_id      TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune CREATE POLICY ici. RLS sans policy = tout refusé.

-- 2. Recopier les identifiants existants. Aucun mot de passe n'est réinitialisé :
--    l'algorithme reste SHA-256(sel + mot_de_passe), les empreintes sont déplacées
--    telles quelles. Chaque employé ayant son propre `id`, les comptes en double
--    sont recopiés séparément et gardent chacun leur mot de passe.
INSERT INTO auth_credentials (employe_id, password_hash, password_salt)
SELECT
  data->>'id',
  data->>'password_hash',
  data->>'password_salt'
FROM app_data
WHERE collection = 'employes'
  AND data->>'id' IS NOT NULL
  AND data->>'password_hash' IS NOT NULL
  AND data->>'password_salt' IS NOT NULL
ON CONFLICT (employe_id) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      password_salt = EXCLUDED.password_salt,
      updated_at    = NOW();

COMMIT;

-- ── CONTRÔLE APRÈS PHASE A — lecture seule ─────────────────────────────────
-- La première ligne DOIT valoir 0. Si elle ne vaut pas 0, NE PAS PASSER EN
-- PHASE B : les comptes manquants perdraient leur mot de passe définitivement.
SELECT 'employes avec empreinte mais SANS ligne recopiee' AS controle,
       count(*) AS valeur, '0 OBLIGATOIRE avant la PHASE B' AS attendu
FROM app_data a
WHERE a.collection = 'employes'
  AND a.data->>'password_hash' IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth_credentials c WHERE c.employe_id = a.data->>'id')
UNION ALL
SELECT 'empreintes recopiees a l identique',
       count(*), 'doit valoir 13'
FROM app_data a
JOIN auth_credentials c ON c.employe_id = a.data->>'id'
WHERE a.collection = 'employes'
  AND c.password_hash = a.data->>'password_hash'
  AND c.password_salt = a.data->>'password_salt'
UNION ALL
SELECT 'lignes auth_credentials au total', count(*), 'doit valoir 13' FROM auth_credentials
UNION ALL
SELECT 'policies sur auth_credentials',
       count(*), '0 OBLIGATOIRE — une seule policy ouvrirait la table a la cle publiable'
FROM pg_policies WHERE tablename = 'auth_credentials'
UNION ALL
SELECT 'RLS active sur auth_credentials',
       CASE WHEN relrowsecurity THEN 1 ELSE 0 END, '1 OBLIGATOIRE'
FROM pg_class WHERE relname = 'auth_credentials' AND relnamespace = 'public'::regnamespace;

-- 🛑 ARRÊT ICI. Tester la connexion de trois comptes de rôles différents avant
--    de continuer. La PHASE B ne s'applique pas le même jour si un doute reste :
--    la PHASE A seule est déjà un gain (les identifiants sont désormais lisibles
--    par le serveur sans dépendre de `app_data`), et elle ne casse rien.


-- ############################################################################
-- ## PHASE B — retirer et verrouiller. ⚠️ DESTRUCTIVE.
-- ##
-- ## NE PAS APPLIQUER si le contrôle ci-dessus n'a pas donné 0 à la première
-- ## ligne, ni si le code déployé n'est pas celui du 17/09/2026 ou postérieur.
-- ##
-- ## CE QUI CASSE SI ELLE EST APPLIQUÉE TROP TÔT — voir RUNBOOK section
-- ## « Ce qui casse, dans les deux sens ».
-- ############################################################################

BEGIN;

-- 3. Retirer les identifiants de la table publique.
--    C'est l'étape qui ferme réellement la fuite : jusqu'ici les empreintes
--    existaient à deux endroits, dont un lisible par la clé du bundle.
UPDATE app_data
SET data = data - 'password_hash' - 'password_salt'
WHERE collection = 'employes'
  AND (data ? 'password_hash' OR data ? 'password_salt');

-- 4. Interdire à la clé publiable de créer, modifier ou supprimer un employé.
--    C'est ce qui ferme la création d'un compte administrateur depuis le navigateur.
--    La LECTURE reste autorisée pour l'instant : les écrans Employés, Pointage et
--    Performance RH passent déjà par /api/employes, mais les 28 autres collections
--    lisent encore directement. Le verrou en lecture est le chantier suivant.
DROP POLICY IF EXISTS allow_all_operations ON app_data;

CREATE POLICY app_data_select ON app_data
  FOR SELECT USING (true);

CREATE POLICY app_data_insert ON app_data
  FOR INSERT WITH CHECK (collection <> 'employes');

CREATE POLICY app_data_update ON app_data
  FOR UPDATE USING (collection <> 'employes')
              WITH CHECK (collection <> 'employes');

CREATE POLICY app_data_delete ON app_data
  FOR DELETE USING (collection <> 'employes');

-- 5. Corriger l'avertissement remonté par le linter Supabase.
--    (Si le contrôle avant a renvoyé 0 pour `update_updated_at`, supprimer
--    cette ligne : elle ferait échouer toute la transaction.)
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;

COMMIT;

-- ── CONTRÔLE APRÈS PHASE B — lecture seule ─────────────────────────────────
SELECT 'empreintes restantes dans app_data' AS controle,
       count(*) AS valeur, '0 attendu — la fuite est fermee' AS attendu
FROM app_data
WHERE collection = 'employes' AND (data ? 'password_hash' OR data ? 'password_salt')
UNION ALL
SELECT 'employes toujours presents', count(*), '13 — aucun compte perdu'
FROM app_data WHERE collection = 'employes'
UNION ALL
SELECT 'identifiants conserves', count(*), '13 — la connexion tient a cette ligne'
FROM auth_credentials
UNION ALL
SELECT 'policy allow_all_operations encore la',
       count(*), '0 attendu'
FROM pg_policies WHERE tablename = 'app_data' AND policyname = 'allow_all_operations'
UNION ALL
SELECT 'policies app_data', count(*), '4 attendu'
FROM pg_policies WHERE tablename = 'app_data';

-- Vérification finale, à faire depuis l'application et non ici :
-- se connecter avec un compte admin, un compte employé et un compte client.


-- ############################################################################
-- ## RETOUR EN ARRIÈRE
-- ##
-- ## Testé pas à pas ci-dessous. Les deux phases se défont dans l'ordre
-- ## INVERSE : B d'abord, A ensuite. Ne jamais défaire A sans avoir défait B.
-- ############################################################################

-- ── ROLLBACK DE LA PHASE B ─────────────────────────────────────────────────
-- À utiliser si la connexion casse ou si une écriture est refusée après la
-- PHASE B. Remet l'application dans l'état d'avant, en 2 secondes.
-- ⚠️ Rouvre la base en écriture au public : c'est un retour à la situation
--    dangereuse, à ne tenir que le temps de comprendre.
--
-- BEGIN;
--   -- 1. Recopier les empreintes depuis auth_credentials vers app_data.
--   --    C'est POSSIBLE parce que la PHASE B n'a pas touché à auth_credentials :
--   --    la source de vérité existe encore. Ne jamais supprimer cette table
--   --    tant que ce rollback peut être nécessaire.
--   UPDATE app_data a
--   SET data = a.data
--              || jsonb_build_object('password_hash', c.password_hash)
--              || jsonb_build_object('password_salt', c.password_salt)
--   FROM auth_credentials c
--   WHERE a.collection = 'employes' AND c.employe_id = a.data->>'id';
--
--   -- 2. Restaurer la policy unique d'origine.
--   DROP POLICY IF EXISTS app_data_select ON app_data;
--   DROP POLICY IF EXISTS app_data_insert ON app_data;
--   DROP POLICY IF EXISTS app_data_update ON app_data;
--   DROP POLICY IF EXISTS app_data_delete ON app_data;
--   CREATE POLICY allow_all_operations ON app_data FOR ALL USING (true) WITH CHECK (true);
-- COMMIT;
--
-- Contrôle du rollback B :
--   SELECT count(*) FROM app_data WHERE collection='employes' AND data ? 'password_hash';
--     -- doit valoir 13
--   SELECT policyname FROM pg_policies WHERE tablename='app_data';
--     -- doit renvoyer la seule ligne allow_all_operations
--
-- ⚠️ CE QUE CE ROLLBACK NE RATTRAPE PAS : un mot de passe changé APRÈS la
--    PHASE A n'existe que dans `auth_credentials` — donc il est bien recopié.
--    En revanche un compte CRÉÉ après la PHASE B par /api/employes existe dans
--    `app_data` et dans `auth_credentials` : il est recopié correctement lui
--    aussi. Aucun cas de perte identifié. Le seul risque est l'inverse : un
--    compte créé pendant la panne par un chemin non serveur, qui n'existe pas.
--
-- ── ROLLBACK DE LA PHASE A ─────────────────────────────────────────────────
-- Uniquement si la PHASE B a déjà été défaite (sinon les 13 mots de passe
-- disparaissent et plus personne ne se connecte).
--
--   DROP TABLE IF EXISTS auth_credentials;
--
-- ⚠️ Perte assumée : tout mot de passe changé depuis la PHASE A n'existe que
--    dans cette table. Le supprimer fait revenir l'ancien mot de passe, sans
--    avertissement pour l'utilisateur concerné. Vérifier d'abord :
--      SELECT count(*) FROM auth_credentials WHERE updated_at > '<date PHASE A>';
--    Si ce compte n'est pas 0, prévenir les personnes concernées avant.
