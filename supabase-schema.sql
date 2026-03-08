-- ============================================================
-- Imprimerie OGOOUÉ — Schéma Supabase
-- ============================================================
-- Exécuter ce script dans l'éditeur SQL de Supabase (SQL Editor)
-- AVANT de déployer l'application.
-- ============================================================

-- Table générique pour toutes les collections
CREATE TABLE IF NOT EXISTS app_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour accélérer les requêtes par collection
CREATE INDEX IF NOT EXISTS idx_app_data_collection ON app_data(collection);
CREATE INDEX IF NOT EXISTS idx_app_data_collection_created ON app_data(collection, created_at);

-- RLS (Row Level Security) — politique permissive pour l'app interne
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;

-- Politique : autoriser toutes les opérations via la clé anon
-- (l'authentification est gérée côté application)
CREATE POLICY "allow_all_operations" ON app_data
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_data_updated_at
  BEFORE UPDATE ON app_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
