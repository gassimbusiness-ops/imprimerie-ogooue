-- ════════════════════════════════════════════════════════════════════════════
-- 013 — Le bot Messenger et Instagram : interrupteur + idempotence des réponses
--
--        ✅ APPLIQUÉE le 2026-09-19 vers 00 h 50 (heure de Moanda) sur le projet
--        bcwkrrqmjpaohmafcncw, pendant que le dirigeant était absent et avait
--        confié la main.
--
--        Contrôle après application :
--          index `idx_bot_journal_*` ......... 2 posés
--          bot_controle → actif ............. false   ⛔ le bot est ÉTEINT
--          bot_controle → mode .............. dry_run ⛔ et en simulation
--
--        Rien d'existant n'a été modifié : deux index créés, une ligne insérée.
--        Le bot ne répondra à personne tant que `actif` vaut false ET que
--        BOT_META_MODE n'est pas posée dans Vercel. Deux verrous, pas un.
--
--        (texte d'origine : 🔴 NON APPLIQUÉE. À exécuter par Gassim dans
--         l'éditeur SQL Supabase, bloc par bloc, dans l'ordre.)
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw
-- Rédigé le       : 2026-09-19
-- Code associé    : api/_lib/bot-depot.js · api/_lib/bot-executeur.js
--                   api/_lib/bot-envoi.js · api/meta-webhook.js
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QUE CETTE MIGRATION CHANGE, ET CE QU'ELLE NE CHANGE PAS
--
-- ⛔ Elle n'allume PAS le bot. La ligne créée par le BLOC 2 porte
--    `actif: false` et `mode: 'dry_run'`. Et même passée à `true`, elle ne
--    suffit pas : `BOT_META_MODE=live` doit AUSSI être posée dans Vercel. Deux
--    verrous, et aucun n'ouvre seul — même patron que l'auto-poster.
--
-- ✅ Elle rend la RÉSERVATION réellement exclusive. Sans l'index du BLOC 1,
--    `reserver()` réussit toujours : deux exécutions serverless réveillées par
--    la même relivraison Meta partiraient toutes les deux, et le client
--    recevrait DEUX FOIS la même phrase. Un doublon de rangement ne se voyait
--    pas ; un doublon de réponse se lit.
--
--    « Une clé d'idempotence sans index unique n'est pas une clé, c'est un
--    commentaire. » (tasks/lessons.md, 18/09)
--
-- ── POURQUOI `app_data` ET PAS UNE TABLE DÉDIÉE ────────────────────────────
--
-- La migration 008 a mis l'auto-poster dans ses propres tables, réservées au
-- rôle de service, parce que `app_data` est modifiable avec la clé `anon` du
-- bundle public. L'arbitrage est différent ici, et il est assumé :
--
--   - l'écran doit LIRE le journal du bot, et le plan Vercel Hobby est à
--     12 fonctions sur 12 : aucune fonction serverless ne peut être ajoutée
--     pour servir une table réservée. Un journal illisible ne remplit pas la
--     règle « on doit savoir ce que le bot a raconté aux clients » ;
--   - rien de neuf n'est exposé : `messages_meta`, qui contient le CONTENU des
--     messages clients, vit déjà dans `app_data` ;
--   - l'interrupteur n'ouvre rien seul (voir plus haut).
--
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- BLOC 1 — L'index qui rend la prise exclusive
-- ════════════════════════════════════════════════════════════════════════════
--
-- L'unicité ne porte QUE sur les lignes qui représentent une tentative d'envoi.
-- Les lignes « examiné, rien envoyé » (`ignore`, `simule`, `refuse`) doivent
-- pouvoir se répéter : un même message peut être examiné plusieurs fois — bot
-- éteint puis rallumé, jeton absent puis posé — et chaque examen mérite sa
-- trace. Un index total les écraserait en silence, et le journal mentirait.

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_journal_message_entrant
  ON app_data ((data->>'message_id_entrant'))
  WHERE collection = 'bot_journal'
    AND (data->>'action') IN ('en_cours', 'repondu', 'passer_la_main', 'echec');

-- Lecture du journal par l'écran : par date, la plus récente d'abord.
CREATE INDEX IF NOT EXISTS idx_bot_journal_recu
  ON app_data ((data->>'recu_le'))
  WHERE collection = 'bot_journal';


-- ════════════════════════════════════════════════════════════════════════════
-- BLOC 2 — L'interrupteur, créé À L'ARRÊT
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ `data->>'id'` DOIT valoir la même valeur que la colonne `id`. C'est ce que
--    `src/services/db.js` suppose pour pouvoir mettre une ligne à jour depuis
--    l'écran — et c'est ce qui rend le bouton « Couper le bot » possible sans
--    passer par la console Supabase.
--    La ligne se reconnaît donc à `cle = 'global'`, pas à son identifiant.

-- ⚠️ Corrigé le 2026-09-26 : la version d'origine ne posait PAS `id` dans
--    `data`, contrairement à ce que dit le paragraphe ci-dessus. Un seul
--    `gen_random_uuid()`, tiré UNE fois dans `nouvel`, sert aux deux.
WITH nouvel AS (SELECT gen_random_uuid() AS id)
INSERT INTO app_data (id, collection, data, created_at, updated_at)
SELECT
  nouvel.id,
  'bot_controle',
  jsonb_build_object(
    'id',     nouvel.id::text,
    'cle',    'global',
    'actif',  false,             -- ⛔ le bot démarre ÉTEINT
    'mode',   'dry_run',         -- ⛔ et en simulation
    'note',   'Créé par la migration 013 le 2026-09-19. Passer actif à true ET poser BOT_META_MODE=live dans Vercel pour que le bot réponde.'
  ),
  NOW(),
  NOW()
FROM nouvel
WHERE NOT EXISTS (
  SELECT 1 FROM app_data
  WHERE collection = 'bot_controle' AND data->>'cle' = 'global'
);

-- La colonne `id` et `data->>'id'` doivent coïncider : on recopie.
UPDATE app_data
SET data = data || jsonb_build_object('id', id::text)
WHERE collection = 'bot_controle'
  AND data->>'cle' = 'global'
  AND (data->>'id') IS DISTINCT FROM id::text;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOC 3 — VÉRIFICATION (lecture seule ; à lire, pas à croire)
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 — L'interrupteur existe, et il est à l'arrêt.
--       Attendu : une ligne, actif = false, mode = dry_run, id = data->>'id'.
SELECT id, data->>'id' AS id_dans_data, data->>'actif' AS actif, data->>'mode' AS mode
FROM app_data
WHERE collection = 'bot_controle' AND data->>'cle' = 'global';

-- 3.2 — L'index de prise existe.
--       Attendu : une ligne nommée idx_bot_journal_message_entrant.
SELECT indexname FROM pg_indexes
WHERE tablename = 'app_data' AND indexname LIKE 'idx_bot_journal%';

-- 3.3 — Aucun doublon de réponse dans le journal existant.
--       Attendu : zéro ligne. Si ce n'est pas zéro, le BLOC 1 a échoué et il
--       faut lire pourquoi AVANT d'allumer le bot.
SELECT data->>'message_id_entrant' AS message, COUNT(*) AS n
FROM app_data
WHERE collection = 'bot_journal'
  AND (data->>'action') IN ('en_cours', 'repondu', 'passer_la_main', 'echec')
GROUP BY 1
HAVING COUNT(*) > 1;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
--
-- Couper le bot ne demande PAS de rollback : c'est une mise à jour d'une ligne,
-- et elle prend dix secondes.
--
--   UPDATE app_data SET data = data || '{"actif": false}'::jsonb
--   WHERE collection = 'bot_controle' AND data->>'cle' = 'global';
--
-- Défaire la migration elle-même (à ne faire que si elle a créé un problème) :
--
--   DROP INDEX IF EXISTS idx_bot_journal_message_entrant;
--   DROP INDEX IF EXISTS idx_bot_journal_recu;
--   DELETE FROM app_data WHERE collection = 'bot_controle' AND data->>'cle' = 'global';
--
-- ⚠️ Supprimer la ligne d'interrupteur ÉTEINT le bot (absent = arrêté). Elle ne
--    peut donc pas produire d'envoi involontaire.
-- ⛔ Le journal (`bot_journal`) n'est JAMAIS supprimé par ce rollback : c'est la
--    seule preuve de ce qui a été dit aux clients.
