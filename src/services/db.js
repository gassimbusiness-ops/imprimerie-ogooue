/**
 * Couche de données — Supabase (centralisé) ou localStorage (fallback).
 * Le mode est déterminé automatiquement par les variables d'environnement.
 */
import { supabase, USE_SUPABASE } from './supabase';
import { apiFetch } from './api-client';
import { ErreurEcriture } from './erreur-ecriture';
import { ErreurLecture } from './erreur-lecture';
import { LIBELLES_COLLECTION } from './erreur-ecriture';
import { ligneAppData } from './ligne-app-data';

/** Le filtrage de `filter()` et de `filterOuLeve()` — ecrit une seule fois. */
function filtrerSur(items, criteria) {
  return items.filter((item) =>
    Object.entries(criteria).every(([key, value]) => item[key] === value),
  );
}

class Collection {
  constructor(name) {
    this.name = name;
    this.lsKey = `io_${name}`;
  }

  // ── READ ──

  /**
   * ⚠️ `list()` N'ECHOUE JAMAIS — et c'est un piege, pas une qualite.
   *
   * Sur une coupure reseau a Moanda ou sur un refus RLS, elle rend `[]`. L'ecran
   * affiche alors « Aucun rapport ce mois-ci » : la phrase d'une base vide, pour
   * une panne de connexion. Recensement du 17/09/2026 : 130 lectures d'ecran
   * sont dans ce cas, dont 86 au montage.
   *
   * On ne peut pas faire lever `list()` d'un coup sans risquer 40 ecrans a la
   * fois. Les ecrans repris appellent donc `listOuLeve()` ci-dessous, qui LEVE ;
   * `list()` reste le repli silencieux pour les appelants pas encore convertis,
   * au comportement strictement inchange.
   */
  async list() {
    try {
      return await this.listOuLeve();
    } catch (e) {
      console.error(`[db] list ${this.name}:`, e?.causeTexte || e?.message);
      return [];
    }
  }

  /**
   * Meme lecture que `list()`, mais un echec LEVE une `ErreurLecture`.
   * C'est la seule implementation de la requete : `list()` l'appelle.
   */
  async listOuLeve() {
    if (USE_SUPABASE) {
      const { data, error } = await supabase
        .from('app_data')
        .select('data')
        .eq('collection', this.name)
        .order('created_at', { ascending: true });
      if (error) {
        throw new ErreurLecture({
          collection: this.name,
          operation: 'list',
          libelle: LIBELLES_COLLECTION[this.name],
          cause: error,
        });
      }
      return (data || []).map((r) => r.data);
    }
    // Repli localStorage : un contenu illisible n'est pas une panne de reseau,
    // c'est un stockage vide. On garde `[]`, sans lever.
    try { return JSON.parse(localStorage.getItem(this.lsKey) || '[]'); } catch { return []; }
  }

  /**
   * COMPTE les lignes sans les telecharger, et LEVE si la lecture echoue.
   *
   * Ajoutee le 17/09/2026 pour les amorcages. `produits_catalogue` pese 20 Mo
   * (195 lignes, dont une a 3,2 Mo d'images en base64) : verifier « la
   * collection est-elle vide ? » avec `list()` faisait telecharger ces 20 Mo a
   * CHAQUE demarrage, sur la connexion de Moanda. C'est cette lecture-la qui
   * expirait, rendait `[]`, et faisait rejouer `seedInventaire()` — 45 lignes
   * de plus, donc une lecture encore plus lourde au demarrage suivant.
   *
   * `head: true` ne ramene que l'en-tete de comptage : quelques octets.
   */
  async compterOuLeve() {
    if (USE_SUPABASE) {
      const { count, error } = await supabase
        .from('app_data')
        .select('id', { count: 'exact', head: true })
        .eq('collection', this.name);
      if (error) {
        throw new ErreurLecture({
          collection: this.name,
          operation: 'count',
          libelle: LIBELLES_COLLECTION[this.name],
          cause: error,
        });
      }
      return count || 0;
    }
    return (await this.listOuLeve()).length;
  }

  /**
   * Retrouve LA ligne qu'un écran désigne par `id`.
   *
   * Les écrans ne connaissent que `data.id` (`listOuLeve()` ne lit que `data`).
   * Normalement il égale la colonne `id` — mais des écrivains hors de
   * `create()` en ont posé deux différents (voir `ligne-app-data.js`). Une telle
   * ligne était devenue impossible à modifier : « ligne introuvable ».
   *
   * Donc : la colonne `id` d'abord (le cas normal, une requête), puis
   * `data->>'id'` dans la même collection. On rend l'identifiant de COLONNE de
   * la ligne trouvée : c'est par lui, et lui seul, qu'on écrit ensuite.
   *
   * Rend `{ ligne: {idLigne, data} | null, erreur }`. Ne lève pas : chaque
   * appelant décide. Deux lignes portant le même `data.id` → aucune n'est
   * choisie (`erreur` le dit) : écrire sur la mauvaise serait pire qu'échouer.
   */
  async _trouverLigne(id) {
    let erreur = null;
    const parColonne = await supabase
      .from('app_data')
      .select('id, data')
      .eq('id', id)
      .eq('collection', this.name)
      .maybeSingle();
    if (parColonne.data) {
      return { ligne: { idLigne: parColonne.data.id, data: parColonne.data.data }, erreur: null };
    }
    // 22P02 : `id` n'a pas la forme d'un UUID — la colonne ne peut pas le
    // porter, mais `data.id` le peut. Ce n'est pas une panne.
    if (parColonne.error && parColonne.error.code !== '22P02') erreur = parColonne.error;

    const parData = await supabase
      .from('app_data')
      .select('id, data')
      .eq('collection', this.name)
      .eq('data->>id', String(id))
      .limit(2);
    if (parData.error) return { ligne: null, erreur: erreur || parData.error };
    const trouvees = parData.data || [];
    if (trouvees.length > 1) {
      return { ligne: null, erreur: `${trouvees.length} lignes portent l'identifiant ${id}` };
    }
    if (trouvees.length === 1) {
      return { ligne: { idLigne: trouvees[0].id, data: trouvees[0].data }, erreur: null };
    }
    return { ligne: null, erreur };
  }

  async getById(id) {
    if (USE_SUPABASE) {
      const { ligne } = await this._trouverLigne(id);
      return ligne ? ligne.data : null;
    }
    try {
      return JSON.parse(localStorage.getItem(this.lsKey) || '[]').find((i) => i.id === id) || null;
    } catch { return null; }
  }

  async filter(criteria) {
    return filtrerSur(await this.list(), criteria);
  }

  /** `filter()` qui LEVE au lieu de rendre une liste vide. Voir `listOuLeve()`. */
  async filterOuLeve(criteria) {
    return filtrerSur(await this.listOuLeve(), criteria);
  }

  // ── WRITE ──

  async create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const newItem = { ...data, id, created_at: data.created_at || now, updated_at: now };

    if (USE_SUPABASE) {
      const { error } = await supabase.from('app_data').insert(ligneAppData({
        collection: this.name,
        data: newItem,
        created_at: newItem.created_at,
        updated_at: now,
      }));
      if (error) { console.error(`[db] create ${this.name}:`, error.message); throw error; }
    } else {
      const items = this._lsRead();
      items.push(newItem);
      this._lsWrite(items);
    }
    return newItem;
  }

  /**
   * ⚠️ `update()` LEVE en cas d'echec — ne jamais revenir a `return null`.
   *
   * Avant le 16/09/2026, cette methode renvoyait `null` sur une erreur Supabase
   * et sur une ligne introuvable. Aucun des 99 appelants ne testait ce retour :
   * tous affichaient leur toast vert. Un refus RLS ou une coupure reseau a
   * Moanda passait donc pour un succes (constat C6 de l'audit VAGUE 2).
   *
   * Une ligne introuvable leve aussi : « je voulais modifier une ligne, elle
   * n'existe pas » est un echec, pas un non-evenement.
   *
   * Tout rejet non rattrape est montre au gerant par le filet global pose dans
   * src/main.jsx (src/services/filet-ecriture.js).
   *
   * Depuis le 26/09/2026, une ligne dont `data.id` differe de la colonne `id`
   * se modifie quand meme : `_trouverLigne()` la retrouve par `data.id`, et
   * l'ecriture vise la COLONNE `id` de la ligne trouvee. `data.id` n'est pas
   * reecrit : c'est l'identifiant que les ecrans (et d'autres lignes) portent.
   */
  async update(id, updates) {
    if (USE_SUPABASE) {
      const { ligne, erreur } = await this._trouverLigne(id);
      if (!ligne) {
        throw new ErreurEcriture({
          collection: this.name, operation: 'update', id,
          cause: erreur || 'ligne introuvable',
        });
      }
      const merged = { ...ligne.data, ...updates, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from('app_data')
        .update({ data: merged, updated_at: merged.updated_at })
        .eq('id', ligne.idLigne)
        .eq('collection', this.name);
      if (error) {
        console.error(`[db] update ${this.name}:`, error.message);
        throw new ErreurEcriture({ collection: this.name, operation: 'update', id, cause: error });
      }
      return merged;
    }
    const items = this._lsRead();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) {
      throw new ErreurEcriture({
        collection: this.name, operation: 'update', id, cause: 'ligne introuvable',
      });
    }
    items[idx] = { ...items[idx], ...updates, updated_at: new Date().toISOString() };
    this._lsWrite(items);
    return items[idx];
  }

  /**
   * ⚠️ `delete()` LEVE en cas d'echec — voir le commentaire de `update()`.
   *
   * Une ligne a deux identifiants etait « supprimee » sans que rien ne parte :
   * zero ligne ne portait ce `id` en colonne, et Supabase ne s'en plaint pas.
   * On vise donc la colonne `id` de la ligne retrouvee. Si la recherche ne
   * trouve rien, on supprime par `id` comme avant (comportement inchange).
   */
  async delete(id) {
    if (USE_SUPABASE) {
      const { ligne } = await this._trouverLigne(id);
      const { error } = await supabase
        .from('app_data')
        .delete()
        .eq('id', ligne ? ligne.idLigne : id)
        .eq('collection', this.name);
      if (error) {
        console.error(`[db] delete ${this.name}:`, error.message);
        throw new ErreurEcriture({ collection: this.name, operation: 'delete', id, cause: error });
      }
      return true;
    }
    const items = this._lsRead().filter((i) => i.id !== id);
    this._lsWrite(items);
    return true;
  }

  // ── localStorage helpers (fallback) ──

  _lsRead() {
    try { return JSON.parse(localStorage.getItem(this.lsKey) || '[]'); } catch { return []; }
  }
  _lsWrite(items) {
    localStorage.setItem(this.lsKey, JSON.stringify(items));
  }
}

// ── Collections ──


/**
 * Collection `employes` — routee par /api/employes.
 *
 * POURQUOI UNE SOUS-CLASSE
 * 13 ecrans appellent `db.employes.list()`. Plutot que de modifier 13 fichiers (et d'en
 * oublier un), on intercepte ici : les appelants ne changent pas, mais la requete part
 * vers un endpoint qui filtre selon le role AVANT d'envoyer. Les salaires ne quittent
 * plus le serveur pour un non-administrateur.
 *
 * En mode localStorage (sans Supabase), on garde le comportement d'origine.
 */
class CollectionEmployes extends Collection {
  /**
   * Seule la variante qui LEVE est redefinie : `list()` est heritee, et son
   * repli silencieux (log + `[]`) vaut donc aussi pour les employes. Redefinir
   * les deux aurait ecrit deux fois la meme regle de repli.
   */
  async listOuLeve() {
    if (!USE_SUPABASE) return super.listOuLeve();
    let res;
    try {
      res = await apiFetch('/api/employes', { method: 'GET' });
    } catch (e) {
      throw new ErreurLecture({
        collection: this.name, operation: 'list',
        libelle: 'les fiches employés', cause: e,
      });
    }
    if (!res.ok) {
      throw new ErreurLecture({
        collection: this.name, operation: 'list',
        libelle: 'les fiches employés', cause: `HTTP ${res.status}`,
      });
    }
    const json = await res.json();
    return json.employes || [];
  }

  /**
   * Les employes ne sont PAS lisibles directement dans `app_data` par le
   * navigateur : ils passent par /api/employes, qui filtre selon le role. Le
   * comptage `head: true` de la classe mere court-circuiterait ce filtre, donc
   * on compte ce que l'endpoint a bien voulu rendre. La lecture leve toujours.
   */
  async compterOuLeve() {
    return (await this.listOuLeve()).length;
  }

  async getById(id) {
    const tous = await this.list();
    return tous.find((e) => e.id === id) || null;
  }

  async create(data) {
    if (!USE_SUPABASE) return super.create(data);
    const res = await apiFetch('/api/employes', { method: 'POST', body: JSON.stringify({ data }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Creation refusee');
    const { id } = await res.json();
    return { ...data, id };
  }

  async update(id, data) {
    if (!USE_SUPABASE) return super.update(id, data);
    const res = await apiFetch('/api/employes', { method: 'PATCH', body: JSON.stringify({ id, data }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Modification refusee');
    return true;
  }

  async delete(id) {
    if (!USE_SUPABASE) return super.delete(id);
    const res = await apiFetch(`/api/employes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Suppression refusee');
    return true;
  }
}

export const db = {
  users: new Collection('users'),
  rapports: new Collection('rapports'),
  rapportLignes: new Collection('rapport_lignes'),
  clients: new Collection('clients'),
  commandes: new Collection('commandes'),
  devis: new Collection('devis'),
  factures: new Collection('factures'),
  produits: new Collection('produits'),
  pointages: new Collection('pointages'),
  employes: new CollectionEmployes('employes'),
  mouvements_stock: new Collection('mouvements_stock'),
  parametres: new Collection('parametres'),
  clotures_caisse: new Collection('clotures_caisse'),
  audit_logs: new Collection('audit_logs'),
  paiements_mobile: new Collection('paiements_mobile'),
  sms_notifications: new Collection('sms_notifications'),
  taches: new Collection('taches'),
  produits_catalogue: new Collection('produits_catalogue'),
  prospects: new Collection('prospects'),
  charges_fixes: new Collection('charges_fixes'),
  dettes: new Collection('dettes'),
  actionnaires: new Collection('actionnaires'),
  investissements: new Collection('investissements'),
  objectifs: new Collection('objectifs'),
  demandes_rh: new Collection('demandes_rh'),
  projets_travaux: new Collection('projets_travaux'),
  etapes_travaux: new Collection('etapes_travaux'),
  evenements: new Collection('evenements'),
  conversations: new Collection('conversations'),
  messages_conv: new Collection('messages_conv'),
  tarifs_clients: new Collection('tarifs_clients'),
  apports_associes: new Collection('apports_associes'),
  dettes_associes: new Collection('dettes_associes'),
  remboursements_associes: new Collection('remboursements_associes'),
  investisseurs: new Collection('investisseurs'),
  modifications_investisseurs: new Collection('modifications_investisseurs'),
  performances_employes: new Collection('performances_employes'),
  comptes_bancaires: new Collection('comptes_bancaires'),
  mouvements_financiers: new Collection('mouvements_financiers'),
  depots_hebdo: new Collection('depots_hebdo'),
  campagnes_prospection: new Collection('campagnes_prospection'),
  actions_marketing: new Collection('actions_marketing'),
  notifications_app: new Collection('notifications_app'),
  fidelite_clients: new Collection('fidelite_clients'),
  mockups: new Collection('mockups'),
  gouvernance_parametres: new Collection('gouvernance_parametres'),

  // ── Bot Messenger / Instagram ──────────────────────────────────────────
  // `messages_meta` est REMPLI par api/meta-webhook.js ; `bot_journal` et
  // `bot_controle` par api/_lib/bot-depot.js. L'ecran de messagerie les LIT.
  // ⚠️ Le seul ecrit depuis le navigateur est `bot_controle`, et dans un seul
  // sens : COUPER le bot. Le rallumer demande aussi BOT_META_MODE=live dans
  // Vercel, ce qu'aucun ecran ne peut faire.
  messages_meta: new Collection('messages_meta'),
  bot_journal: new Collection('bot_journal'),
  bot_controle: new Collection('bot_controle'),
};

/**
 * Lecture PROJETEE des lignes portant un marqueur, sur plusieurs collections.
 *
 * ── Pourquoi elle existe ──────────────────────────────────────────────────
 *
 * L'ecran « Ce que ChatGPT a ecrit » doit lister les ecritures du pont, qui
 * peuvent vivre dans dix-sept collections. `list()` rapatrie le `data` COMPLET
 * de chaque ligne : sur `produits_catalogue`, c'est 20 Mo pour 195 lignes, dont
 * une seule a 3,2 Mo d'images en base64. Depuis que le pont sait corriger un
 * prix, une de ces lignes peut porter le marqueur — et ouvrir l'ecran ferait
 * telecharger ces megaoctets sur la connexion de Moanda, pour afficher un
 * libelle et un montant.
 *
 * On ne demande donc que les champs necessaires. `id` vient de la COLONNE, pas
 * de `data.id` : c'est lui qui sert ensuite a relire la ligne entiere au moment
 * d'annuler.
 *
 * LEVE en cas d'echec, comme `listOuLeve()` : une liste vide apres une lecture
 * ratee dirait « ChatGPT n'a rien ecrit », et le gerant conclurait qu'il n'y a
 * rien a verifier.
 *
 * @param {object} arg
 * @param {string[]} arg.collections
 * @param {string} arg.marqueur  nom du champ booleen a plat (ex. `via_chatgpt`)
 * @param {string[]} arg.champs  champs de `data` a rapatrier
 * @returns {Promise<Array<{collection: string, data: object}>>}
 */
export async function lireLignesMarquees({ collections, marqueur, champs }) {
  const sortie = [];

  if (!USE_SUPABASE) {
    for (const collection of collections) {
      let lignes = [];
      try { lignes = JSON.parse(localStorage.getItem(`io_${collection}`) || '[]'); } catch { lignes = []; }
      for (const l of lignes) {
        if (!l?.[marqueur]) continue;
        const projete = { id: l.id };
        for (const c of champs) projete[c] = l[c];
        sortie.push({ collection, data: projete });
      }
    }
    return sortie;
  }

  const projection = ['id', ...champs.map((c) => `${c}:data->${c}`)].join(', ');
  for (const collection of collections) {
    const { data, error } = await supabase
      .from('app_data')
      .select(projection)
      .eq('collection', collection)
      .eq(`data->>${marqueur}`, 'true')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      throw new ErreurLecture({
        collection,
        operation: 'list',
        libelle: LIBELLES_COLLECTION[collection],
        cause: error,
      });
    }
    for (const r of data || []) sortie.push({ collection, data: r });
  }
  return sortie;
}

// ── Settings helpers (shared across the app) ──

let _settingsCache = null;

export async function getSettings() {
  if (_settingsCache) return { ..._settingsCache };

  if (USE_SUPABASE) {
    const { data } = await supabase
      .from('app_data')
      .select('id, data')
      .eq('collection', '_settings')
      .limit(1);
    _settingsCache = data?.[0]?.data || {};
  } else {
    try { _settingsCache = JSON.parse(localStorage.getItem('io_settings') || '{}'); } catch { _settingsCache = {}; }
  }
  return { ..._settingsCache };
}

export async function saveSettings(settings) {
  _settingsCache = { ...settings };

  if (USE_SUPABASE) {
    const { data: existing } = await supabase
      .from('app_data')
      .select('id')
      .eq('collection', '_settings')
      .limit(1);

    if (existing?.length) {
      await supabase.from('app_data')
        .update({ data: settings, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
    } else {
      await supabase.from('app_data').insert(ligneAppData({
        collection: '_settings',
        data: settings,
      }));
    }
  } else {
    localStorage.setItem('io_settings', JSON.stringify(settings));
  }

  window.dispatchEvent(new CustomEvent('settings-updated', { detail: settings }));
}

export function clearSettingsCache() {
  _settingsCache = null;
}
