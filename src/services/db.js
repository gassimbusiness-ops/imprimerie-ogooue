/**
 * Couche de données — Supabase (centralisé) ou localStorage (fallback).
 * Le mode est déterminé automatiquement par les variables d'environnement.
 */
import { supabase, USE_SUPABASE } from './supabase';
import { apiFetch } from './api-client';
import { ErreurEcriture } from './erreur-ecriture';
import { ErreurLecture } from './erreur-lecture';
import { LIBELLES_COLLECTION } from './erreur-ecriture';

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

  async getById(id) {
    if (USE_SUPABASE) {
      const { data, error } = await supabase
        .from('app_data')
        .select('data')
        .eq('id', id)
        .eq('collection', this.name)
        .maybeSingle();
      if (error || !data) return null;
      return data.data;
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
      const { error } = await supabase.from('app_data').insert({
        id,
        collection: this.name,
        data: newItem,
        created_at: newItem.created_at,
        updated_at: now,
      });
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
   */
  async update(id, updates) {
    if (USE_SUPABASE) {
      const existing = await this.getById(id);
      if (!existing) {
        throw new ErreurEcriture({
          collection: this.name, operation: 'update', id,
          cause: 'ligne introuvable',
        });
      }
      const merged = { ...existing, ...updates, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from('app_data')
        .update({ data: merged, updated_at: merged.updated_at })
        .eq('id', id)
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

  /** ⚠️ `delete()` LEVE en cas d'echec — voir le commentaire de `update()`. */
  async delete(id) {
    if (USE_SUPABASE) {
      const { error } = await supabase
        .from('app_data')
        .delete()
        .eq('id', id)
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
};

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
      await supabase.from('app_data').insert({
        id: crypto.randomUUID(),
        collection: '_settings',
        data: settings,
      });
    }
  } else {
    localStorage.setItem('io_settings', JSON.stringify(settings));
  }

  window.dispatchEvent(new CustomEvent('settings-updated', { detail: settings }));
}

export function clearSettingsCache() {
  _settingsCache = null;
}
