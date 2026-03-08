/**
 * Couche de données — Supabase (centralisé) ou localStorage (fallback).
 * Le mode est déterminé automatiquement par les variables d'environnement.
 */
import { supabase, USE_SUPABASE } from './supabase';

class Collection {
  constructor(name) {
    this.name = name;
    this.lsKey = `io_${name}`;
  }

  // ── READ ──

  async list() {
    if (USE_SUPABASE) {
      const { data, error } = await supabase
        .from('app_data')
        .select('data')
        .eq('collection', this.name)
        .order('created_at', { ascending: true });
      if (error) { console.error(`[db] list ${this.name}:`, error.message); return []; }
      return (data || []).map((r) => r.data);
    }
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
    const items = await this.list();
    return items.filter((item) =>
      Object.entries(criteria).every(([key, value]) => item[key] === value),
    );
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

  async update(id, updates) {
    if (USE_SUPABASE) {
      const existing = await this.getById(id);
      if (!existing) return null;
      const merged = { ...existing, ...updates, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from('app_data')
        .update({ data: merged, updated_at: merged.updated_at })
        .eq('id', id)
        .eq('collection', this.name);
      if (error) { console.error(`[db] update ${this.name}:`, error.message); return null; }
      return merged;
    }
    const items = this._lsRead();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...updates, updated_at: new Date().toISOString() };
    this._lsWrite(items);
    return items[idx];
  }

  async delete(id) {
    if (USE_SUPABASE) {
      const { error } = await supabase
        .from('app_data')
        .delete()
        .eq('id', id)
        .eq('collection', this.name);
      if (error) { console.error(`[db] delete ${this.name}:`, error.message); return false; }
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
  employes: new Collection('employes'),
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
