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
        .select('cle_idempotence, publication_id, canal, surface, instant_utc, date_locale, '
          + 'tolerance_minutes, etat, tentatives, tentatives_max, id_distant, resultat, derniere_erreur, approbation')
        .order('instant_utc', { ascending: true })
        .limit(limite);
      if (error) throw new Error(`lecture ${TABLE_FILE} : ${error.message}`);
      return data || [];
    },
  };
}
