/**
 * Couche de données locale (localStorage).
 * Interface identique pour chaque collection — facile à remplacer par Supabase/Firebase.
 */

class Collection {
  constructor(name) {
    this.name = `io_${name}`;
  }

  _read() {
    try {
      return JSON.parse(localStorage.getItem(this.name) || '[]');
    } catch {
      return [];
    }
  }

  _write(items) {
    localStorage.setItem(this.name, JSON.stringify(items));
  }

  list() {
    return Promise.resolve(this._read());
  }

  getById(id) {
    return Promise.resolve(this._read().find((item) => item.id === id) || null);
  }

  create(data) {
    const items = this._read();
    const newItem = {
      ...data,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    items.push(newItem);
    this._write(items);
    return Promise.resolve(newItem);
  }

  update(id, data) {
    const items = this._read();
    const idx = items.findIndex((item) => item.id === id);
    if (idx === -1) return Promise.resolve(null);
    items[idx] = { ...items[idx], ...data, updated_at: new Date().toISOString() };
    this._write(items);
    return Promise.resolve(items[idx]);
  }

  delete(id) {
    const items = this._read().filter((item) => item.id !== id);
    this._write(items);
    return Promise.resolve(true);
  }

  filter(criteria) {
    const items = this._read().filter((item) =>
      Object.entries(criteria).every(([key, value]) => item[key] === value),
    );
    return Promise.resolve(items);
  }
}

// Collections
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
  // Phase 3+ modules
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
  // Phase 5: Gouvernance
  apports_associes: new Collection('apports_associes'),
  dettes_associes: new Collection('dettes_associes'),
  remboursements_associes: new Collection('remboursements_associes'),
};
