-- ════════════════════════════════════════════════════════════════════════════
-- 014 — LE RÉGLAGE « APPROBATION AUTOMATIQUE »
-- ════════════════════════════════════════════════════════════════════════════
--
-- Date : 19/09/2026
-- État : ✅ APPLIQUÉE le 19/09/2026 vers 03 h 10 (heure de Paris), pendant que le
--        dirigeant suivait en direct. Contrôle relu APRÈS, dans le même geste :
--          id = global · actif = false · mode = dry_run
--          approbation_automatique = true · plafond_journalier = 4
--        `actif` et `mode` n'ont PAS bougé : approuver n'est pas publier.
--
--        Un fichier de migration qui dit encore « non appliquée » après coup est
--        un mensonge — trois agents s'y sont trompés le 18/09, et ils avaient
--        raison de croire le fichier. La vérité et sa trace se mettent à jour
--        dans le même geste que l'écriture.
--
-- ── POURQUOI ────────────────────────────────────────────────────────────────
--
-- Décision de Gassim, mot pour mot : « non automatique, pas d'interrupteur (si
-- tu veux mets dans l'app pour le décor mais on va pas utiliser je crois pas) /
-- automatique tout de suite ». Sa raison : ChatGPT vérifie déjà le manifeste
-- avant de déposer, et l'objectif est de tout automatiser. La réserve lui a été
-- exposée — ChatGPT vérifie le FORMAT, pas le JUGEMENT — et il a tranché.
--
-- Il ne veut PAS d'interrupteur à l'écran. Mais un réglage qui ne peut se
-- renverser qu'en redéployant n'est pas un réglage : c'est le raisonnement déjà
-- écrit dans la migration 008 pour `actif` (« un arrêt d'urgence qui exige un
-- déploiement n'est pas un arrêt d'urgence »). D'où une COLONNE, pas une
-- variable d'environnement, et pas de bouton.
--
-- ── CE QUE ÇA CHANGE ────────────────────────────────────────────────────────
--
-- `true`  (défaut) : l'alimentation pose une approbation à l'entrée en file,
--                    avec `origine: 'automatique'` et l'empreinte du contenu.
-- `false`          : l'alimentation n'approuve rien ; seul le bouton de l'écran
--                    approuve, comme avant le 19/09/2026.
--
-- ⛔ Dans les DEUX cas :
--    · l'empreinte du contenu reste calculée et portée par l'approbation ;
--    · une décision HUMAINE (approbation ou retrait) n'est jamais réécrite par
--      un passage suivant ;
--    · approuver n'est pas publier. `actif` et `mode` ne bougent pas ici.
--
-- ⚠️ TANT QUE CETTE MIGRATION N'EST PAS APPLIQUÉE, le code lit le défaut
--    `true` (`APPROBATION_AUTOMATIQUE_PAR_DEFAUT` dans `autopost-depot.js`) et
--    l'écran affiche « colonne absente, défaut appliqué ». Le seul retour
--    arrière disponible est alors l'interrupteur global, qui arrête TOUTE la
--    chaîne :  UPDATE autopost_controle SET actif = false WHERE id = 'global';
--
-- ── RETOUR ARRIÈRE ──────────────────────────────────────────────────────────
--
--   -- désactiver l'approbation automatique, sans rien redéployer :
--   UPDATE autopost_controle SET approbation_automatique = false WHERE id = 'global';
--
--   -- retirer complètement la colonne (le code retombe sur son défaut) :
--   ALTER TABLE autopost_controle DROP COLUMN IF EXISTS approbation_automatique;
--
-- ⚠️ Désactiver n'annule PAS les approbations déjà posées : elles restent sur
--    leurs lignes, avec `origine: 'automatique'`, et se retirent une par une au
--    bouton « Retirer l'approbation ». Pour tout retirer d'un coup, voir la
--    dernière section de ce fichier.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE autopost_controle
  ADD COLUMN IF NOT EXISTS approbation_automatique boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN autopost_controle.approbation_automatique IS
  'true : l''alimentation approuve à l''entrée en file (origine = automatique, '
  'empreinte du contenu portée). false : seul l''écran approuve. Une décision '
  'humaine n''est jamais réécrite dans les deux cas. Décision Gassim 19/09/2026.';

-- La ligne 'global' existe depuis la 008 ; le DEFAULT ci-dessus la remplit.
-- Cette instruction n'est là que pour le cas où la colonne existait déjà à NULL
-- (impossible avec NOT NULL, gardée par prudence de relecture).
UPDATE autopost_controle
   SET approbation_automatique = true
 WHERE id = 'global' AND approbation_automatique IS NULL;

-- ── VÉRIFICATION APRÈS APPLICATION ──────────────────────────────────────────
--
--   SELECT actif, mode, plafond_journalier, approbation_automatique
--     FROM autopost_controle WHERE id = 'global';
--
--   Attendu le 19/09/2026 : actif = false, mode = 'dry_run',
--   approbation_automatique = true. Approuver n'est pas publier.

-- ── RETRAIT EN MASSE DES APPROBATIONS AUTOMATIQUES (à n'exécuter que si
--    Gassim le demande — ce n'est PAS une étape de cette migration) ──────────
--
--   UPDATE autopost_file
--      SET approbation = NULL
--    WHERE approbation ->> 'origine' = 'automatique'
--      AND id_distant IS NULL
--      AND etat IN ('draft','scheduled','failed','expired','suspended');
--
--   ⛔ Les conditions sur `id_distant` et `etat` ne sont pas décoratives : on ne
--      touche pas à une ligne déjà partie ni à une ligne en vol. Et la clause
--      sur `origine` protège les approbations humaines.
