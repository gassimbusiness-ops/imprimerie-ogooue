-- ════════════════════════════════════════════════════════════════════════════
-- 005 — Rendre l'idempotence des encaissements RÉELLE
--
--        ⚠️  CE FICHIER N'A PAS ÉTÉ APPLIQUÉ. Aucune écriture n'a été faite
--        en production. Il attend la validation de Gassim, et l'exécution du
--        bloc de contrôle (section A) AVANT le bloc de création (section C).
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Rédigé le       : 2026-09-16
-- Code associé    : api/_lib/singpay-encaissement.js
--                   api/singpay-callback.js, api/singpay-status.js
-- ════════════════════════════════════════════════════════════════════════════
--
-- LE PROBLÈME, EN UNE PHRASE
--
-- Toute l'application se protège des doubles écritures d'argent en LISANT la
-- liste des mouvements avant d'en ÉCRIRE un :
--
--     const mouvements = await db.mouvements_financiers.list();   -- (1) LIRE
--     if (!mouvements.some(m => m.reference === ref))             -- (2) TESTER
--       await db.mouvements_financiers.create({ reference, ... }); -- (3) ÉCRIRE
--
-- Entre (1) et (3) il y a un aller-retour réseau. Deux appels concurrents font
-- tous les deux leur (1) avant que l'un ait fait son (3) : ils concluent tous
-- les deux « pas encore encaissé », et écrivent tous les deux. La référence est
-- unique DANS LE CODE, pas DANS LA BASE. Rien ne rejette le doublon.
--
-- `src/services/execution-unique.js` le dit déjà, mot pour mot : « La seule
-- protection durable est une contrainte d'unicité côté base sur
-- mouvements_financiers.reference ». `tests/prelevements.test.mjs` contient même
-- un test qui DÉMONTRE la course. Ce fichier pose enfin cette contrainte.
--
-- POURQUOI C'EST DEVENU URGENT AVEC LE MOBILE MONEY
--
-- Un prélèvement automatique se déclenche depuis un écran ouvert par une
-- personne. Un rappel de paiement, lui, est envoyé par SingPay — qui le REJOUE
-- s'il ne reçoit pas de 200 assez vite — et peut tomber en même temps que le
-- sondage du navigateur du client, sur deux instances serverless différentes.
-- Deux processus, deux machines : aucun verrou en mémoire ne les couvre. Ici,
-- la course n'est plus théorique, elle est le mode de fonctionnement normal du
-- protocole.
--
-- ════════════════════════════════════════════════════════════════════════════
-- A. AVANT — contrôle, lecture seule, sans effet
-- ════════════════════════════════════════════════════════════════════════════
--
-- L'index unique ÉCHOUERA si des doublons existent déjà. Les chercher d'abord.
--
-- ÉTAT MESURÉ LE 2026-09-16 (lecture seule, projet bcwkrrqmjpaohmafcncw) :
--   mouvements_financiers ................ 32 lignes
--   dont porteuses d'une `reference` ..... 20
--   références en double ................. 0   ← l'index peut être créé tel quel
--
-- Les 12 mouvements sans référence sont des saisies manuelles : l'index partiel
-- les ignore volontairement, il ne les rendra pas impossibles.

SELECT data->>'reference' AS reference,
       count(*)           AS occurrences,
       sum((data->>'montant')::numeric) AS total_ecrit
FROM app_data
WHERE collection = 'mouvements_financiers'
  AND data->>'reference' IS NOT NULL
  AND data->>'reference' <> ''
GROUP BY data->>'reference'
HAVING count(*) > 1
ORDER BY occurrences DESC;

-- Combien de mouvements portent une référence (donc seront couverts) :

SELECT count(*) FILTER (WHERE data->>'reference' IS NOT NULL AND data->>'reference' <> '') AS avec_reference,
       count(*)                                                                            AS total
FROM app_data
WHERE collection = 'mouvements_financiers';

-- ════════════════════════════════════════════════════════════════════════════
-- B. S'IL Y A DES DOUBLONS — à traiter à la main, pas en lot
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un doublon de mouvement, c'est de l'argent compté deux fois dans un solde.
-- Le supprimer ne suffit pas : il faut aussi corriger le solde du compte
-- concerné. C'est une décision comptable, pas un nettoyage technique. Lister,
-- montrer à Gassim, décider ligne par ligne.
--
-- SELECT id, data->>'reference', data->>'montant', data->>'compte_id', created_at
-- FROM app_data
-- WHERE collection = 'mouvements_financiers'
--   AND data->>'reference' IN ('...');

-- ════════════════════════════════════════════════════════════════════════════
-- C. L'INDEX UNIQUE — le cœur de la migration
-- ════════════════════════════════════════════════════════════════════════════
--
-- Index PARTIEL, pour trois raisons :
--   - il ne porte que sur `mouvements_financiers`, et `app_data` héberge toutes
--     les collections de l'application ;
--   - il ignore les mouvements sans référence (saisies manuelles du gérant :
--     plusieurs entrées de caisse le même jour sont parfaitement légitimes) ;
--   - `CONCURRENTLY` évite de verrouiller la table pendant la création.
--
-- ⚠️ `CREATE INDEX CONCURRENTLY` ne peut PAS tourner dans une transaction.
--    Dans l'éditeur SQL de Supabase, exécuter cette instruction SEULE.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_mouvements_reference_unique
  ON app_data ((data->>'reference'))
  WHERE collection = 'mouvements_financiers'
    AND data->>'reference' IS NOT NULL
    AND data->>'reference' <> '';

-- À partir de cet instant, le second INSERT d'une même référence est rejeté par
-- PostgreSQL avec le code 23505. `depotSupabase().insererMouvement()` le
-- reconnaît, renvoie `{ insere: false }`, et le solde n'est PAS crédité une
-- seconde fois. Le code fonctionne déjà sans l'index (il fait sa lecture
-- préalable) : la migration le rend sûr, elle ne le rend pas fonctionnel.

-- ════════════════════════════════════════════════════════════════════════════
-- D. CRÉDIT ATOMIQUE DU SOLDE
-- ════════════════════════════════════════════════════════════════════════════
--
-- L'index protège la LIGNE de mouvement. Il ne protège pas le SOLDE, qui est
-- mis à jour en lire-modifier-écrire :
--
--     solde = (solde_lu) + montant
--
-- Deux crédits simultanés lisent le même `solde_lu` : le second écrase le
-- premier, et un encaissement disparaît du solde (« lost update »). La fonction
-- ci-dessous fait l'addition DANS PostgreSQL, sur la ligne verrouillée par
-- l'UPDATE lui-même. `depotSupabase().crediterCompte()` l'appelle en priorité
-- et retombe sur l'ancien comportement si elle n'existe pas — le code peut donc
-- être déployé avant cette migration sans rien casser.

CREATE OR REPLACE FUNCTION crediter_compte(p_compte_id uuid, p_montant numeric)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE app_data
  SET data = jsonb_set(
        data,
        '{solde}',
        to_jsonb(COALESCE((data->>'solde')::numeric, 0) + p_montant),
        true
      ),
      updated_at = now()
  WHERE id = p_compte_id
    AND collection = 'comptes_bancaires';
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- E. APRÈS — contrôle
-- ════════════════════════════════════════════════════════════════════════════

-- L'index existe et est valide (`indisvalid` = true) :
--
-- SELECT i.relname AS index, idx.indisvalid, idx.indisunique
-- FROM pg_index idx
-- JOIN pg_class i ON i.oid = idx.indexrelid
-- WHERE i.relname = 'idx_mouvements_reference_unique';
--
-- Une création CONCURRENTLY interrompue laisse un index INVALIDE qui ne protège
-- rien tout en occupant de la place : si `indisvalid` est false, le supprimer
-- (`DROP INDEX idx_mouvements_reference_unique;`) et recommencer.

-- La fonction répond :
--
-- SELECT proname FROM pg_proc WHERE proname = 'crediter_compte';

-- ════════════════════════════════════════════════════════════════════════════
-- F. RETOUR ARRIÈRE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Immédiat, sans perte de données — rien n'est modifié par cette migration,
-- seules des protections sont ajoutées :
--
--   DROP INDEX CONCURRENTLY IF EXISTS idx_mouvements_reference_unique;
--   DROP FUNCTION IF EXISTS crediter_compte(uuid, numeric);
--
-- Le code applicatif continue de fonctionner après le retrait : il retombe sur
-- la lecture préalable et le lire-modifier-écrire, c'est-à-dire exactement le
-- comportement d'avant cette intervention.
