/**
 * La sauvegarde complète — ce que la base CONTIENT, pas ce qu'une liste en dit.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE — mesuré le 26/09/2026
 * ════════════════════════════════════════════════════════════════════════════
 *
 * L'export de l'écran Paramètres parcourait une LISTE DE NOMS écrite à la main,
 * et appelait `db[nom].list()` dans un `try/catch` qui rendait `[]`. Trois
 * défauts empilés, tous silencieux :
 *
 *   1. La liste avait divergé de la base. Absents de la sauvegarde :
 *      `audit_logs` (3 438 lignes — le journal entier), `mouvements_stock`
 *      (le vrai stock ; la liste disait `stocks`, qui n'existe pas),
 *      `produits_catalogue`, `fidelite_clients`, `conversations`…
 *   2. `db.paiements_singpay` n'existe pas : l'appel plantait, le `catch`
 *      écrivait une liste vide. Les paiements étaient « sauvegardés » vides.
 *   3. `list()` avale les erreurs et rend `[]` — une coupure réseau pendant la
 *      sauvegarde aurait produit un fichier d'apparence complète, et vide.
 *
 * Et un quatrième, latent : PostgREST rend au plus 1 000 lignes par requête.
 * Une collection plus grande aurait été tronquée sans un mot.
 *
 * Une sauvegarde qui a l'air complète et qui ne l'est pas est pire que pas de
 * sauvegarde : on ne la refait pas, et on découvre le trou le jour où on en a
 * besoin.
 *
 * Ce module :
 *   - découvre les collections EN BASE, au lieu de faire confiance à une liste ;
 *   - lit chacune PAGE PAR PAGE, jusqu'au bout ;
 *   - ne transforme JAMAIS une erreur en liste vide : il la NOMME ;
 *   - écrit dans le fichier le nombre de lignes de chaque collection, pour que
 *     la sauvegarde se vérifie elle-même.
 */
import { supabase, USE_SUPABASE } from './supabase';

/** PostgREST plafonne une réponse ; on reste en dessous et on pagine. */
const TAILLE_PAGE = 1000;

/**
 * Lit toutes les lignes d'une requête, page par page.
 * @param {(de:number, a:number) => PromiseLike<{data:any[], error:any}>} requete
 */
async function toutLire(requete) {
  const lignes = [];
  for (let de = 0; ; de += TAILLE_PAGE) {
    const { data, error } = await requete(de, de + TAILLE_PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    lignes.push(...(data || []));
    if (!data || data.length < TAILLE_PAGE) return lignes;
  }
}

/**
 * Les collections réellement présentes en base, triées.
 * Lit seulement la colonne `collection`, page par page.
 */
export async function collectionsEnBase(client = supabase) {
  const lignes = await toutLire((de, a) => client
    .from('app_data').select('collection').order('id', { ascending: true }).range(de, a));
  return [...new Set(lignes.map((l) => l.collection))].sort();
}

/**
 * Exporte toute la base.
 *
 * @returns {Promise<{dump: object, erreurs: Record<string,string>, comptes: Record<string,number>}>}
 *   `erreurs` est VIDE seulement si tout a été lu. L'appelant doit le dire.
 */
export async function exporterToutesLesCollections({ client = supabase, maintenant = () => new Date() } = {}) {
  if (!USE_SUPABASE && client === supabase) {
    throw new Error('Sauvegarde impossible : la base distante n\'est pas configurée.');
  }
  const noms = await collectionsEnBase(client);
  const dump = {};
  const comptes = {};
  const erreurs = {};

  for (const nom of noms) {
    try {
      const lignes = await toutLire((de, a) => client
        .from('app_data').select('data')
        .eq('collection', nom)
        .order('id', { ascending: true })
        .range(de, a));
      dump[nom] = lignes.map((l) => l.data);
      comptes[nom] = dump[nom].length;
    } catch (e) {
      // ⛔ JAMAIS `dump[nom] = []` : une collection vide et une collection
      //    illisible ne doivent pas se ressembler dans le fichier.
      erreurs[nom] = e?.message || String(e);
    }
  }

  return {
    dump: {
      _app: 'imprimerie-ogooue',
      _exported_at: maintenant().toISOString(),
      _collections: noms,
      _comptes: comptes,
      _erreurs: erreurs,
      ...dump,
    },
    erreurs,
    comptes,
  };
}
