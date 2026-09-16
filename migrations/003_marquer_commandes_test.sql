-- ════════════════════════════════════════════════════════════════════════════
-- 003 — Marquer les 5 commandes d'essai, pour qu'un clic sur « Livrée »
--       ne déclenche pas six écritures d'argent sur des données de test
--
--        ⚠️  CE FICHIER N'A PAS ÉTÉ APPLIQUÉ. AUCUN `UPDATE` N'A ÉTÉ EXÉCUTÉ.
--        Il attend la validation de Gassim, commande par commande.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Rédigé le       : 2026-09-16
-- Correctif de code associé :
--   src/services/livraison-commande.js  (estCommandeTest / commandesPurgeables)
--   src/features/commandes/page.jsx     (handlePurgeTests, handleDelete)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QUE LE MARQUAGE CHANGE
--
-- Gassim a confirmé que les 5 commandes actuellement en base sont des essais du
-- portail client. Tant qu'elles ne sont pas marquées, elles sont indiscernables
-- de vraies commandes : un clic sur « Livrée » sur l'une d'elles écrirait, pour
-- de bon, une facture, un encaissement en trésorerie, une sortie de stock et
-- des points de fidélité.
--
-- Le drapeau `est_test` est lu par `estCommandeTest()`. Il ne supprime rien : il
-- autorise seulement la purge à les prendre en compte, ET UNIQUEMENT si elles
-- ne sont ni livrées ni porteuses d'argent non annulé (`suppressionAutorisee()`).
--
-- POURQUOI UN DRAPEAU EXPLICITE, ET PAS UNE HEURISTIQUE
--
-- L'ancien `handlePurgeTests` supprimait en lot toute commande dont la
-- description contenait « test ». Or « test couleur » et « test daltonien » sont
-- deux prestations RÉELLES d'imprimerie : de vraies commandes livrées et
-- encaissées tombaient dans le filet — en emportant leur référence
-- d'idempotence `commande:<id>`, si bien qu'une re-saisie les ré-encaissait.
--
-- ÉTAT MESURÉ LE 2026-09-16 (lecture seule)
--
--   collection `commandes` : 5 lignes, toutes `source = 'portail_client'`
--   aucune ne porte `est_test`, aucune ne porte `livraison_traitee`
--
--   id                                     client              statut                     montant
--   ────────────────────────────────────── ─────────────────── ────────────────────────── ───────
--   a0dba831-7fe0-4a7f-9217-6d068cf1bb2e   Client test         en_production                4 500
--   958236b1-d390-4695-8d80-e50c875e8c2f   Ibrahim Abakar      validee_attente_paiement     4 500
--   fe560e2f-2e9c-4b79-88cb-21f808e20f43   Opérateur Acceuil   validee_attente_paiement     4 500
--   93d2470f-c29d-466c-bf5c-4848f1041dd6   Client test         validee_attente_paiement     7 000
--   a4f8532c-1db0-419c-8564-4939701faac2   Client test         annulee                      2 000
--
--   ⚠️ La deuxième porte le nom du gérant (« Ibrahim Abakar ») et la troisième
--   celui d'un compte de l'équipe. À confirmer avant marquage : ce sont
--   vraisemblablement des essais faits depuis leurs propres comptes, mais c'est
--   à Gassim de le dire, pas au code de le deviner.
--
-- ════════════════════════════════════════════════════════════════════════════
-- AVANT — vérification (lecture seule, sans effet)
-- ════════════════════════════════════════════════════════════════════════════

SELECT id,
       data->>'client_nom'        AS client,
       data->>'statut'            AS statut,
       data->>'montant_total'     AS montant,
       data->>'source'            AS source,
       data->>'est_test'          AS est_test,
       data->>'livraison_traitee' AS livraison_traitee,
       created_at
FROM app_data
WHERE collection = 'commandes'
ORDER BY created_at;

-- ════════════════════════════════════════════════════════════════════════════
-- MARQUAGE — à décommenter ligne par ligne, après validation
-- ════════════════════════════════════════════════════════════════════════════
--
-- La garde `data->>'livraison_traitee' IS DISTINCT FROM 'true'` empêche de
-- marquer par erreur une commande dont la livraison aurait été enregistrée
-- entre la rédaction de ce fichier et son exécution.

-- UPDATE app_data
-- SET data = jsonb_set(data, '{est_test}', 'true'::jsonb, true),
--     updated_at = now()
-- WHERE collection = 'commandes'
--   AND id IN (
--     'a0dba831-7fe0-4a7f-9217-6d068cf1bb2e',   -- « Client test », 4 500 F
--     '93d2470f-c29d-466c-bf5c-4848f1041dd6',   -- « Client test », 7 000 F
--     'a4f8532c-1db0-419c-8564-4939701faac2'    -- « Client test », 2 000 F, déjà annulée
--   )
--   AND data->>'livraison_traitee' IS DISTINCT FROM 'true';

-- Les deux suivantes portent le nom de personnes réelles : à marquer seulement
-- après confirmation explicite qu'il s'agit bien d'essais.
--
-- UPDATE app_data
-- SET data = jsonb_set(data, '{est_test}', 'true'::jsonb, true),
--     updated_at = now()
-- WHERE collection = 'commandes'
--   AND id IN (
--     '958236b1-d390-4695-8d80-e50c875e8c2f',   -- « Ibrahim Abakar », 4 500 F
--     'fe560e2f-2e9c-4b79-88cb-21f808e20f43'    -- « Opérateur Acceuil », 4 500 F
--   )
--   AND data->>'livraison_traitee' IS DISTINCT FROM 'true';

-- ════════════════════════════════════════════════════════════════════════════
-- APRÈS — contrôle
-- ════════════════════════════════════════════════════════════════════════════

-- SELECT count(*) FILTER (WHERE data->>'est_test' = 'true')  AS marquees,
--        count(*)                                            AS total
-- FROM app_data WHERE collection = 'commandes';

-- ════════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Le marquage n'efface rien et se retire en une requête :
--
-- UPDATE app_data
-- SET data = data - 'est_test', updated_at = now()
-- WHERE collection = 'commandes' AND data ? 'est_test';
