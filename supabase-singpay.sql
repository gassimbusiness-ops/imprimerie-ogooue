-- ============================================================
-- SingPay Paiements — Table dédiée (optionnel, complément à app_data)
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Note : L'app utilise la table `app_data` avec collection='paiements_singpay'.
-- Cette table dédiée est créée pour performance et indexation si besoin de migration future.

CREATE TABLE IF NOT EXISTS paiements_singpay (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  commande_id VARCHAR(200),
  singpay_transaction_id VARCHAR(200),
  payment_reference VARCHAR(200) UNIQUE NOT NULL,
  wallet_id VARCHAR(200),
  phone_number VARCHAR(20),
  operateur VARCHAR(20),        -- 'airtel' | 'moov'
  amount DECIMAL(12, 0),
  status VARCHAR(20) DEFAULT 'pending',  -- pending | paid | failed | expired | cancelled
  nom_client VARCHAR(200),
  raw_response JSONB,
  raw_callback JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour accélérer les recherches
CREATE INDEX IF NOT EXISTS idx_paiements_reference ON paiements_singpay(payment_reference);
CREATE INDEX IF NOT EXISTS idx_paiements_commande ON paiements_singpay(commande_id);
CREATE INDEX IF NOT EXISTS idx_paiements_transaction ON paiements_singpay(singpay_transaction_id);
CREATE INDEX IF NOT EXISTS idx_paiements_status ON paiements_singpay(status);

-- RLS — lecture autorisée, écriture par service role uniquement
ALTER TABLE paiements_singpay ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lecture autorisee" ON paiements_singpay FOR SELECT USING (true);

-- ============================================================
-- Colonnes additionnelles sur app_data pour commandes (si besoin index)
-- ============================================================
-- Note : les données paiement sont stockées dans le champ JSONB `data` de app_data.
-- Pas besoin d'ALTER TABLE car on utilise le pattern app_data/collection.
