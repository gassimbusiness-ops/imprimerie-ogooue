-- ════════════════════════════════════════════════════════════════════════════
-- 004 — Le rapport du 2026-03-16 contient probablement 4 500 F comptés deux fois
--
--        ⚠️  CE FICHIER N'A PAS ÉTÉ APPLIQUÉ. AUCUN `UPDATE` N'A ÉTÉ EXÉCUTÉ.
--        Il demande une vérification humaine avant toute correction.
--
-- Projet Supabase : bcwkrrqmjpaohmafcncw     Table unique : app_data
-- Rédigé le       : 2026-09-16
-- Correctif de code associé :
--   src/services/reprise-rapport.js       (REPRISE_AUTO_RAPPORT = false + trace)
--   src/services/sync-commande-rapport.js (todayISO + décision externalisée)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QUI A ÉTÉ MESURÉ
--
-- `syncCommandeToRapport()` ajoutait le montant d'une commande livrée dans
-- `categories.imprimerie` du rapport journalier du jour. Or Gassim a confirmé
-- que le rapport est saisi À LA MAIN par Ibrahim : le même argent était donc
-- compté deux fois.
--
-- Ce n'est pas une hypothèse. Requête exécutée en lecture seule le 2026-09-16 :
--
--     SELECT id, data->>'date', data->'categories'->>'imprimerie', data->>'notes'
--     FROM app_data
--     WHERE collection = 'rapports' AND data->>'notes' ILIKE '%Commande%livr%';
--
--   id       : f4599794-4da1-4435-a766-5dce97e1a5dd
--   date     : 2026-03-16
--   opérateur: Opérateur Acceuil
--   imprimerie : 5000
--   notes    : "\n+ Commande  livrée (4500 F)"
--
-- La note commence par un saut de ligne et un « + » : la fonction a donc
-- AJOUTÉ à un rapport qui existait déjà, elle ne l'a pas créé. C'est 1 rapport
-- sur les 236 de la base.
--
-- POURQUOI ON NE CORRIGE PAS AUTOMATIQUEMENT
--
-- Trois inconnues, et aucune ne se lève depuis la base :
--
--   1. La commande qui a déclenché la reprise N'EXISTE PLUS (la note ne porte
--      même pas son numéro : « Commande  livrée », deux espaces). Sa suppression
--      a emporté toute trace de son origine — c'est le constat 8b.2 de l'audit.
--   2. On ne sait donc pas si Ibrahim avait AUSSI saisi ces 4 500 F à la main.
--      Si oui, `imprimerie` devrait valoir 500 F et non 5 000 F ; si non, la
--      valeur actuelle est correcte et il ne faut rien changer.
--   3. `imprimerie = 5000` et le montant repris `4500` sont très proches : un
--      retrait aveugle laisserait 500 F, un chiffre invraisemblable pour une
--      journée d'imprimerie. C'est un indice — pas une preuve — que la saisie
--      manuelle n'a PAS eu lieu ce jour-là, et donc qu'il ne faut rien retirer.
--
-- CE QU'IL FAUT FAIRE : demander à Ibrahim ce qu'il a encaissé en imprimerie le
-- lundi 16 mars 2026, et saisir cette valeur. Personne d'autre ne le sait.
--
-- ════════════════════════════════════════════════════════════════════════════
-- AVANT — la ligne concernée, et ses voisines pour donner l'échelle
-- ════════════════════════════════════════════════════════════════════════════

SELECT data->>'date'                        AS date,
       data->>'operateur_nom'               AS operateur,
       data->'categories'->>'imprimerie'    AS imprimerie,
       data->>'notes'                       AS notes
FROM app_data
WHERE collection = 'rapports'
  AND data->>'date' BETWEEN '2026-03-13' AND '2026-03-19'
ORDER BY data->>'date';

-- Aucun autre rapport n'est concerné — contrôle :
SELECT count(*) AS rapports_touches_par_la_reprise_auto
FROM app_data
WHERE collection = 'rapports'
  AND (data->>'notes' ILIKE '%Commande%livr%' OR data->>'operateur_id' = 'system');

-- ════════════════════════════════════════════════════════════════════════════
-- CORRECTION — à n'exécuter QU'APRÈS avoir demandé le chiffre réel à Ibrahim
-- ════════════════════════════════════════════════════════════════════════════
--
-- Remplacer <MONTANT_REEL> par la valeur qu'il confirme. La note existante est
-- conservée et complétée : on n'efface pas l'historique d'une correction.

-- UPDATE app_data
-- SET data = jsonb_set(
--       jsonb_set(data, '{categories,imprimerie}', to_jsonb(<MONTANT_REEL>::numeric), true),
--       '{notes}',
--       to_jsonb((data->>'notes') || E'\n[correction 2026-09-16] montant imprimerie corrigé à <MONTANT_REEL> F '
--                || '— la reprise automatique avait ajouté 4 500 F en double.'),
--       true)
-- WHERE collection = 'rapports'
--   AND id = 'f4599794-4da1-4435-a766-5dce97e1a5dd'
--   AND data->'categories'->>'imprimerie' = '5000';   -- garde : n'agit que si rien n'a bougé depuis

-- ════════════════════════════════════════════════════════════════════════════
-- RETOUR ARRIÈRE
-- ════════════════════════════════════════════════════════════════════════════
--
-- La valeur d'origine est 5000. Pour revenir en arrière :
--
-- UPDATE app_data
-- SET data = jsonb_set(data, '{categories,imprimerie}', '5000'::jsonb, true)
-- WHERE collection = 'rapports' AND id = 'f4599794-4da1-4435-a766-5dce97e1a5dd';
