/**
 * Auto-poster — le dépôt Supabase : la file, l'interrupteur et le journal.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⛔ POURQUOI UNE TABLE DÉDIÉE, ET PAS `app_data`
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `app_data` n'a AUCUNE contrainte d'unicité : deux insertions de la même clé
 * y réussissent toutes les deux, en silence. Et la policy `allow_all_operations`
 * la rend modifiable par quiconque présente la clé `anon` — laquelle est dans
 * le bundle public. Écrire l'état d'une file de publication là-dedans, ce
 * serait offrir à un inconnu le droit de marquer une publication comme prête à
 * partir.
 *
 * La file vit donc dans `autopost_file`, avec :
 *   - une clé d'idempotence UNIQUE, tenue par PostgreSQL et non par du code ;
 *   - une policy qui n'autorise que le rôle de service (donc le serveur) ;
 *   - une transition d'état par UPDATE conditionnel, seul mécanisme sûr entre
 *     deux instances serverless qui ne partagent aucune mémoire.
 *
 * Voir `migrations/008_autopost_file_publication.sql`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI `instant_utc` EST DU TEXTE ET NON UN `timestamptz`
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un `timestamptz` relu par le pilote revient avec le fuseau de la session, et
 * la comparaison redevient une question de configuration. Le manifeste porte
 * déjà l'instant sous une forme non ambiguë (`2026-09-21T16:30:00Z`) ; on le
 * range tel quel, on le compare tel quel. Une chaîne qui finit par `Z` ne se
 * fait pas réinterpréter.
 *
 * C'est le même raisonnement que `src/lib/dates.js` : les 55 300 F d'écart
 * venaient d'une conversion automatique que personne n'avait demandée.
 */

import { ETATS_MODIFIABLES } from './autopost-alimentation.js';
import { formaterInstantUtc } from '../../src/lib/dates.js';

export const TABLE_FILE = 'autopost_file';
export const TABLE_CONTROLE = 'autopost_controle';
export const TABLE_JOURNAL = 'autopost_journal';

/** Colonnes lues pour un travail : tout ce dont la sélection a besoin. */
const COLONNES = 'cle_idempotence, publication_id, version_contenu, canal, compte_cible_id, '
  + 'surface, instant_utc, date_locale, tolerance_minutes, etat, tentatives, tentatives_max, '
  + 'id_distant, id_conteneur, legende, url_media, publication, approbation, resultat, derniere_erreur';

/**
 * Dépôt Supabase. Le client passé doit être celui du rôle de service
 * (`supabaseAdmin()`), jamais le client navigateur.
 * @param {object} supabase
 */
export function depotSupabaseAutopost(supabase) {
  return {
    /**
     * L'interrupteur, lu à CHAQUE passage. Absent → on considère la chaîne
     * ARRÊTÉE : un auto-poster dont on ne trouve pas l'interrupteur ne publie
     * pas « par défaut », il se tait.
     */
    async lireArretGlobal() {
      const { data, error } = await supabase
        .from(TABLE_CONTROLE)
        .select('actif, mode, plafond_journalier')
        .eq('id', 'global')
        .limit(1);
      if (error) throw new Error(`lecture ${TABLE_CONTROLE} : ${error.message}`);
      const ligne = (data || [])[0];
      if (!ligne) return { actif: false, mode: 'dry_run', plafond: 0 };
      return {
        actif: ligne.actif === true,
        mode: ligne.mode === 'live' ? 'live' : 'dry_run',
        plafond: typeof ligne.plafond_journalier === 'number' ? ligne.plafond_journalier : 4,
      };
    },

    async lireFile({ limite = 50 } = {}) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .select(COLONNES)
        .eq('etat', 'scheduled')
        .order('instant_utc', { ascending: true })
        .limit(limite);
      if (error) throw new Error(`lecture ${TABLE_FILE} : ${error.message}`);
      return data || [];
    },

    async lireAReconcilier() {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .select(COLONNES)
        .eq('etat', 'reconciling')
        .is('id_distant', null)
        .limit(20);
      if (error) throw new Error(`lecture ${TABLE_FILE} (réconciliation) : ${error.message}`);
      return data || [];
    },

    async compterPubliesLe(dateLocale) {
      const { count, error } = await supabase
        .from(TABLE_FILE)
        .select('cle_idempotence', { count: 'exact', head: true })
        .eq('etat', 'published')
        .eq('date_locale', dateLocale);
      if (error) throw new Error(`comptage ${TABLE_FILE} : ${error.message}`);
      return count || 0;
    },

    /* ═══════════════════════════════════════════════════════════════════════
       L'ALIMENTATION DEPUIS LE DRIVE — trois écritures, et pas une de plus
       ═══════════════════════════════════════════════════════════════════════

       `autopost-alimentation.js` lit le Drive et décide. Il a besoin de trois
       gestes, et de rien d'autre : regarder ce qui existe pour une publication,
       insérer, et — sous conditions strictes — réécrire ou annuler une ligne
       qui n'est pas encore partie.

       ⚠️ Les deux écritures conditionnelles le sont DANS L'INSTRUCTION SQL, pas
       dans le code appelant. Entre la lecture et l'écriture d'un appelant il y
       a toujours une fenêtre, et une autre exécution peut avoir pris la ligne
       dedans. Seul un UPDATE qui porte ses propres conditions ferme la fenêtre. */

    /**
     * Toutes les lignes portant l'un de ces identifiants de publication —
     * TOUTES versions, TOUS états, y compris `published`. C'est ce qui permet
     * de répondre à « est-ce que ce couple (publication, canal) est déjà
     * parti ? », question à laquelle la seule clé d'idempotence ne répond pas :
     * elle change quand la version change.
     */
    async lireLignesDePublications(ids) {
      const liste = [...new Set(ids || [])].filter(Boolean);
      if (liste.length === 0) return [];
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .select(COLONNES)
        .in('publication_id', liste);
      if (error) throw new Error(`lecture ${TABLE_FILE} (par publication) : ${error.message}`);
      return data || [];
    },

    /**
     * Insère une ligne de file.
     *
     * Un refus pour clé déjà présente (`23505`) N'EST PAS UNE PANNE : c'est
     * l'index unique de la migration 008 qui fait son travail parce qu'une
     * autre exécution a inséré la même ligne entre-temps. On le dit, on ne lève
     * pas — le passage doit continuer avec les publications suivantes.
     */
    async inserer(ligne) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .insert(ligne)
        .select('cle_idempotence');
      if (error) {
        if (error.code === '23505') return { insere: false, conflit: true };
        throw new Error(`insertion ${TABLE_FILE} : ${error.message}`);
      }
      return { insere: (data || []).length === 1, conflit: false };
    },

    /**
     * Réécrit une ligne à partir du dépôt relu dans le Drive.
     *
     * ⛔ NE MORD QUE si la ligne est encore modifiable ET n'a pas de témoin.
     * Réécrire une ligne en `executing`, c'est changer le contenu d'une
     * publication pendant qu'elle part.
     */
    async mettreAJourDepuisDepot(cle, champs) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .update({ ...champs, updated_at: formaterInstantUtc(new Date()) })
        .eq('cle_idempotence', cle)
        .in('etat', [...ETATS_MODIFIABLES])
        .is('id_distant', null)
        .select('cle_idempotence');
      if (error) throw new Error(`mise à jour ${TABLE_FILE} : ${error.message}`);
      return (data || []).length === 1;
    },

    /**
     * Annule une ligne remplacée par un dépôt plus récent. Mêmes conditions :
     * on n'annule jamais ce qui est parti, ni ce qui est en train de partir.
     */
    async annulerLigne(cle, details) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .update({
          etat: 'cancelled',
          derniere_erreur: details ?? null,
          updated_at: formaterInstantUtc(new Date()),
        })
        .eq('cle_idempotence', cle)
        .in('etat', [...ETATS_MODIFIABLES])
        .is('id_distant', null)
        .select('cle_idempotence');
      if (error) throw new Error(`annulation ${TABLE_FILE} : ${error.message}`);
      return (data || []).length === 1;
    },

    /* ═══════════════════════════════════════════════════════════════════════
       L'APPROBATION — deux gestes, et aucun d'eux ne publie
       ═══════════════════════════════════════════════════════════════════════

       ⚠️ `lireEtatComplet()` ne rend PAS la colonne `publication` : l'écran n'en
       a pas besoin, et un manifeste complet par ligne × 200 lignes est un
       transfert inutile. Or l'approbation porte l'empreinte du manifeste : elle
       ne peut donc pas être calculée à partir de ce que l'écran affiche.

       C'est une propriété, pas une gêne. Le navigateur envoie une CLÉ, et rien
       d'autre ; le serveur relit le manifeste qu'il a lui-même rangé et calcule
       l'empreinte dessus. Un navigateur ne peut pas faire approuver un contenu
       qu'il aurait composé lui-même. */

    /** Tout ce qu'il faut pour fabriquer une approbation — manifeste compris. */
    async lirePourApprobation(cle) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .select('cle_idempotence, publication_id, version_contenu, canal, surface, '
          + 'instant_utc, etat, id_distant, publication, approbation')
        .eq('cle_idempotence', cle)
        .limit(1);
      if (error) throw new Error(`lecture ${TABLE_FILE} (approbation) : ${error.message}`);
      return (data || [])[0] || null;
    },

    /**
     * Écrit (ou retire) l'approbation d'une ligne.
     *
     * ⛔ MÊMES CONDITIONS QUE `mettreAJourDepuisDepot` : la ligne doit être
     * encore modifiable et n'avoir AUCUN témoin de publication. Approuver ou
     * désapprouver ce qui est déjà parti ne changerait rien au monde réel — ça
     * ne ferait que mentir sur l'état de la ligne. Et les conditions sont DANS
     * l'instruction SQL : entre une lecture et une écriture de l'appelant, un
     * passage horaire a le temps de prendre la ligne.
     */
    async ecrireApprobation(cle, approbation) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .update({ approbation, updated_at: formaterInstantUtc(new Date()) })
        .eq('cle_idempotence', cle)
        .in('etat', [...ETATS_MODIFIABLES])
        .is('id_distant', null)
        .select('cle_idempotence');
      if (error) throw new Error(`approbation ${TABLE_FILE} : ${error.message}`);
      return (data || []).length === 1;
    },

    /**
     * ⛔ LE COMPARE-AND-SWAP. La seule chose qui empêche deux instances
     * serverless simultanées de publier deux fois le même post.
     *
     * L'UPDATE ne mord que si la ligne est ENCORE `scheduled`. Si une autre
     * exécution l'a prise entre-temps, zéro ligne est modifiée et on rend
     * `false`. Il n'y a pas de fenêtre entre le test et l'écriture : c'est
     * PostgreSQL qui tranche, dans une seule instruction.
     */
    async prendre(cle, { instant }) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        .update({ etat: 'executing', envoi_tente_a_utc: instant })
        .eq('cle_idempotence', cle)
        .eq('etat', 'scheduled')
        .select('cle_idempotence');
      if (error) throw new Error(`prise ${TABLE_FILE} : ${error.message}`);
      return (data || []).length === 1;
    },

    async relacher(cle, { etat, tentatives, erreur = null }) {
      const { error } = await supabase
        .from(TABLE_FILE)
        .update({ etat, tentatives, derniere_erreur: erreur })
        .eq('cle_idempotence', cle);
      if (error) throw new Error(`relâche ${TABLE_FILE} : ${error.message}`);
    },

    /** L'ancre Instagram, écrite AVANT `media_publish`. */
    async noterConteneur(cle, idConteneur) {
      const { error } = await supabase
        .from(TABLE_FILE)
        .update({ id_conteneur: idConteneur })
        .eq('cle_idempotence', cle);
      if (error) throw new Error(`conteneur ${TABLE_FILE} : ${error.message}`);
    },

    /** Le témoin. C'est cette écriture-là qui rend la publication définitive. */
    async enregistrerPublication(cle, resultat) {
      const { error } = await supabase
        .from(TABLE_FILE)
        .update({
          etat: 'published',
          id_distant: resultat.id_distant,
          id_conteneur: resultat.id_conteneur ?? null,
          tentatives: resultat.tentatives ?? undefined,
          resultat,
          derniere_erreur: null,
        })
        .eq('cle_idempotence', cle);
      if (error) throw new Error(`publication ${TABLE_FILE} : ${error.message}`);
    },

    /**
     * Le journal. Il n'a pas d'unicité et c'est voulu : une ligne de journal en
     * double est un désagrément, une publication en double est un incident.
     */
    async journaliser(entree) {
      const { error } = await supabase.from(TABLE_JOURNAL).insert({
        instant_utc: entree.instant_utc,
        cle_idempotence: entree.cle_idempotence ?? null,
        publication_id: entree.publication_id ?? null,
        canal: entree.canal ?? null,
        evenement: entree.evenement,
        resume: entree.resume ?? null,
        piste: entree.piste ?? null,
        bilan: entree.bilan ?? null,
      });
      // Un journal qui tombe ne doit pas faire tomber la publication : on le
      // dit, on ne lève pas.
      if (error) console.error('[autopost] journal indisponible :', error.message);
    },

    /** Lecture du journal pour l'écran du gérant. */
    async lireJournal({ limite = 100 } = {}) {
      const { data, error } = await supabase
        .from(TABLE_JOURNAL)
        .select('instant_utc, cle_idempotence, publication_id, canal, evenement, resume, piste')
        .order('instant_utc', { ascending: false })
        .limit(limite);
      if (error) throw new Error(`lecture ${TABLE_JOURNAL} : ${error.message}`);
      return data || [];
    },

    /** Lecture de toute la file pour l'écran — prévu, parti, échoué. */
    async lireEtatComplet({ limite = 200 } = {}) {
      const { data, error } = await supabase
        .from(TABLE_FILE)
        // ⚠️ `url_media` en fait partie DEPUIS le 18/09/2026 : sans elle, l'écran
        //    affiche une file pleine sans pouvoir dire qu'aucune de ces lignes
        //    ne peut partir, faute de média joignable par Meta. Une file qui a
        //    l'air prête et qui ne l'est pas est un faux témoin de plus.
        .select('cle_idempotence, publication_id, version_contenu, canal, surface, instant_utc, '
          + 'date_locale, tolerance_minutes, etat, tentatives, tentatives_max, id_distant, '
          + 'url_media, resultat, derniere_erreur, approbation')
        .order('instant_utc', { ascending: true })
        .limit(limite);
      if (error) throw new Error(`lecture ${TABLE_FILE} : ${error.message}`);
      return data || [];
    },
  };
}
