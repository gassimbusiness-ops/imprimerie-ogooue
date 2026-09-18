import { db } from './db';
import { todayISO } from '@/lib/dates';

/**
 * Sync client record from commande data.
 * Creates a new client if none found, or updates existing contact info.
 * Returns the client record.
 */
export async function syncClientFromCommande({ client_id, client_nom, client_email, client_tel, client_adresse, source }) {
  if (!client_nom && !client_email) return null;

  const clients = await db.clients.list();
  const nom = (client_nom || '').trim().toLowerCase();
  const email = (client_email || '').trim().toLowerCase();

  // Try to find existing client by id, email, or name
  let existing = null;
  if (client_id) existing = clients.find((c) => c.id === client_id);
  if (!existing && email) existing = clients.find((c) => (c.email || '').toLowerCase() === email);
  if (!existing && nom) existing = clients.find((c) => (c.nom || '').toLowerCase() === nom);

  if (existing) {
    // Update with any new info
    const updates = {};
    if (client_tel && !existing.telephone) updates.telephone = client_tel;
    if (client_email && !existing.email) updates.email = client_email;
    if (client_adresse && !existing.adresse) updates.adresse = client_adresse;
    // ⚠️ `todayISO()` et jamais `.toISOString().slice(0, 10)` : Moanda est a
    // UTC+1 toute l'annee, et la seconde forme rend LA VEILLE entre 00 h et
    // 01 h heure locale. Une commande passee a 00 h 30 datait le client du
    // jour precedent. Regle du projet : src/lib/dates.js.
    updates.derniere_commande = todayISO();
    await db.clients.update(existing.id, updates);
    return { ...existing, ...updates };
  }

  // Create new client
  const newClient = await db.clients.create({
    nom: client_nom || '',
    email: client_email || '',
    telephone: client_tel || '',
    adresse: client_adresse || '',
    type: 'particulier',
    source: source || 'commande',
    date_creation: todayISO(),
    derniere_commande: todayISO(),
    notes: `Client ajouté automatiquement depuis ${source || 'une commande'}`,
  });
  return newClient;
}
