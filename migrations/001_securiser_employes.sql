-- ============================================================================
-- Migration 001 — sortir les identifiants de la table publique
--
-- ⚠️ NE PAS APPLIQUER AVANT D'AVOIR DEPLOYE LE CODE ET LES ENDPOINTS MANQUANTS.
--    Voir migrations/RUNBOOK.md — l'ordre compte, sinon la connexion casse.
--
-- CONSTAT A L'ORIGINE (verifie sur la base de production le 13/09/2026) :
--   policy `allow_all_operations` : FOR ALL, USING (true), WITH CHECK (true),
--   roles = public. La cle anon est compilee dans le bundle JavaScript public.
--   Consequence : lecture, ecriture et suppression de TOUTE la base par quiconque,
--   y compris la creation d'un compte `role: 'admin'`.
-- ============================================================================

-- 1. Table dediee aux identifiants. RLS activee, AUCUNE policy :
--    la cle anon n'a donc aucun droit. `service_role` contourne RLS et reste seule
--    capable de lire — c'est ce que fait /api/auth-login.
CREATE TABLE IF NOT EXISTS auth_credentials (
  employe_id      TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune CREATE POLICY ici. RLS sans policy = tout refuse.

-- 2. Recopier les identifiants existants. Aucun mot de passe n'est reinitialise :
--    l'algorithme reste SHA-256(sel + mot_de_passe), les empreintes sont deplacees
--    telles quelles.
INSERT INTO auth_credentials (employe_id, password_hash, password_salt)
SELECT
  data->>'id',
  data->>'password_hash',
  data->>'password_salt'
FROM app_data
WHERE collection = 'employes'
  AND data->>'password_hash' IS NOT NULL
  AND data->>'password_salt' IS NOT NULL
ON CONFLICT (employe_id) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      password_salt = EXCLUDED.password_salt,
      updated_at    = NOW();

-- 3. Retirer les identifiants de la table publique.
UPDATE app_data
SET data = data - 'password_hash' - 'password_salt'
WHERE collection = 'employes';

-- 4. Interdire a la cle anon de creer, modifier ou supprimer un employe.
--    C'est ce qui ferme la creation d'un compte administrateur depuis le navigateur.
--    La LECTURE reste autorisee pour l'instant : les ecrans Employes, Pointage et
--    Performance RH en dependent. Le verrou en lecture est l'etape 1b (voir RUNBOOK).
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

-- 5. Corriger l'avertissement remonte par le linter Supabase.
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
