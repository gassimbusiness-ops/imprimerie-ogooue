/**
 * Export PDF — Génération de documents PDF côté client (sans dépendance externe).
 * Utilise une technique d'impression via iframe caché + window.print().
 * En-tête standardisé Imprimerie OGOOUÉ avec coordonnées complètes.
 */

/**
 * Génère un PDF à partir de HTML (via impression du navigateur).
 * @param {string} title - Titre du document
 * @param {string} htmlContent - Contenu HTML à imprimer
 * @param {Object} options - Options supplémentaires
 */
export function printHTML(title, htmlContent, options = {}) {
  const { orientation = 'portrait', companyName = 'IMPRIMERIE OGOOUÉ', raw = false } = options;

  const css = `
    <style>
      @page { size: A4 ${orientation}; margin: 15mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 11px; color: #1a1a2e; line-height: 1.5; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e40af; padding-bottom: 14px; margin-bottom: 18px; }
      .header-left h1 { font-size: 20px; font-weight: 800; color: #1e40af; letter-spacing: 0.5px; }
      .header-left .subtitle { font-size: 10px; color: #374151; margin-top: 3px; font-weight: 600; }
      .header-left .info { font-size: 9px; color: #6b7280; margin-top: 1px; line-height: 1.6; }
      .header-right { text-align: right; }
      .header-right .doc-title { font-size: 12px; font-weight: 700; color: #1e40af; }
      .header-right .doc-date { font-size: 9px; color: #6b7280; margin-top: 4px; }
      h2 { font-size: 14px; font-weight: 700; color: #1e40af; margin: 12px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      h3 { font-size: 12px; font-weight: 600; color: #374151; margin: 8px 0 4px; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
      th { background: #f3f4f6; font-weight: 600; text-align: left; padding: 6px 8px; border: 1px solid #e5e7eb; }
      td { padding: 5px 8px; border: 1px solid #e5e7eb; }
      tr:nth-child(even) { background: #fafafa; }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .font-bold { font-weight: 700; }
      .text-emerald { color: #059669; }
      .text-red { color: #dc2626; }
      .text-blue { color: #2563eb; }
      .text-amber { color: #d97706; }
      .total-row { background: #e0e7ff !important; font-weight: 700; }
      .kpi-row { display: flex; gap: 12px; margin: 8px 0 12px; flex-wrap: wrap; }
      .kpi-box { flex: 1; min-width: 100px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; text-align: center; }
      .kpi-box .label { font-size: 8px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
      .kpi-box .value { font-size: 16px; font-weight: 800; margin-top: 2px; }
      .section { margin-top: 14px; }
      .confidential { margin-top: 16px; padding: 6px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; font-size: 9px; color: #dc2626; font-weight: 600; text-align: center; }
      .footer { margin-top: 24px; padding-top: 10px; border-top: 2px solid #e5e7eb; font-size: 8px; color: #9ca3af; display: flex; justify-content: space-between; align-items: center; }
      .footer-left { }
      .footer-right { text-align: right; }
      .signature-block { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 7.5px; color: #9ca3af; font-style: italic; line-height: 1.8; }
      .page-break { page-break-before: always; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  `;

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Récupérer le nom de l'utilisateur connecté
  let auteur = 'Système';
  try {
    const saved = localStorage.getItem('io_current_user');
    if (saved) {
      const u = JSON.parse(saved);
      auteur = `${u.prenom || ''} ${u.nom || ''}`.trim() || 'Système';
    }
  } catch {}

  // Mode raw : on imprime exactement htmlContent sans le header/footer generique
  // (utilise pour la facture/devis qui ont leur propre mise en page complete)
  const bodyHTML = raw ? htmlContent : `
    <div class="header">
      <div class="header-left">
        <h1>${companyName}</h1>
        <p class="subtitle">Impression — Sérigraphie — Personnalisation</p>
        <p class="info">RCCM : RG/FCV 2023A0407 | NIF : 256598U</p>
        <p class="info">Carrefour Fina en face de Finam — Moanda, Gabon</p>
        <p class="info">Tél : 060 44 46 34 / 074 42 41 42</p>
        <p class="info">Email : imprimerieogooue@gmail.com</p>
      </div>
      <div class="header-right">
        <p class="doc-title">${title}</p>
        <p class="doc-date">Généré le ${dateStr} à ${timeStr}</p>
      </div>
    </div>
    ${htmlContent}
    <div class="footer">
      <div class="footer-left">
        Document généré le ${dateStr} à ${timeStr} | Par : ${auteur}
      </div>
      <div class="footer-right">
        ${companyName} — Moanda, Gabon
      </div>
    </div>
    <div class="signature-block">
      ${companyName} — Impression · Sérigraphie · Personnalisation<br/>
      RCCM : RG/FCV 2023A0407 · NIF : 256598U<br/>
      Carrefour Fina en face de Finam — Moanda, Haut-Ogooué, Gabon<br/>
      Tél : 060 44 46 34 / 074 42 41 42 · Email : imprimerieogooue@gmail.com
    </div>`;

  const fullHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${css}</head><body>${bodyHTML}</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-10000px';
  iframe.style.left = '-10000px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);

  iframe.contentDocument.open();
  iframe.contentDocument.write(fullHTML);
  iframe.contentDocument.close();

  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 300);
  };
}

/**
 * Échappe les caractères HTML dangereux pour empêcher l'injection XSS dans les
 * PDF (un nom client / description contenant <img onerror=...> exécuterait du JS).
 */
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formate un nombre en FCFA
 */
function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

/**
 * Exporte les rapports d'un mois en PDF
 */
export function exportRapportsMensuels(rapports, mois, stats = {}) {
  const monthLabel = new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  let html = `<h2>Rapports Journaliers — ${monthLabel}</h2>`;

  // KPIs
  html += `<div class="kpi-row">
    <div class="kpi-box"><div class="label">Rapports</div><div class="value">${stats.count || rapports.length}</div></div>
    <div class="kpi-box"><div class="label">Recettes</div><div class="value text-emerald">${fmt(stats.recettes || 0)} F</div></div>
    <div class="kpi-box"><div class="label">Dépenses</div><div class="value text-red">${fmt(stats.depenses || 0)} F</div></div>
    <div class="kpi-box"><div class="label">Solde</div><div class="value text-blue">${fmt(stats.solde || 0)} F</div></div>
  </div>`;

  // Table
  html += `<table>
    <thead><tr>
      <th>Date</th><th>Opérateur</th><th>Statut</th>
      <th class="text-right">COP</th><th class="text-right">MAR</th><th class="text-right">SCN</th>
      <th class="text-right">T/S</th><th class="text-right">B/P</th><th class="text-right">PHO</th>
      <th class="text-right">MNT</th><th class="text-right">IMP</th>
      <th class="text-right">Total</th>
    </tr></thead><tbody>`;

  const catKeys = ['copies', 'marchandises', 'scan', 'tirage_saisies', 'badges_plastification', 'demi_photos', 'maintenance', 'imprimerie'];

  rapports.forEach((r) => {
    const cats = r.categories || {};
    const total = catKeys.reduce((s, k) => s + (cats[k] || 0), 0);
    html += `<tr>
      <td>${r.date}</td>
      <td>${r.operateur_nom || '—'}</td>
      <td>${r.statut || 'brouillon'}</td>
      ${catKeys.map((k) => `<td class="text-right">${fmt(cats[k] || 0)}</td>`).join('')}
      <td class="text-right font-bold">${fmt(total)}</td>
    </tr>`;
  });

  html += '</tbody></table>';

  printHTML(`Rapports ${monthLabel}`, html, { orientation: 'landscape' });
}

/**
 * Convertit un nombre entier en toutes lettres (français).
 */
function nombreEnLettres(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (n === 0) return 'zéro';
  const unites = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const dizaines = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

  function centaines(num) {
    let s = '';
    const c = Math.floor(num / 100);
    const reste = num % 100;
    if (c > 0) s += (c > 1 ? unites[c] + ' cent' : 'cent') + (reste === 0 && c > 1 ? 's' : '') + (reste > 0 ? ' ' : '');
    if (reste > 0) {
      if (reste < 20) s += unites[reste];
      else {
        const d = Math.floor(reste / 10);
        const u = reste % 10;
        if (d === 7 || d === 9) {
          s += dizaines[d] + '-' + unites[10 + u];
        } else {
          s += dizaines[d];
          if (u === 1 && d !== 8) s += ' et un';
          else if (u > 0) s += '-' + unites[u];
          else if (d === 8) s += 's';
        }
      }
    }
    return s.trim();
  }

  let mots = '';
  const millions = Math.floor(n / 1000000);
  const milliers = Math.floor((n % 1000000) / 1000);
  const reste = n % 1000;
  if (millions > 0) mots += (millions > 1 ? centaines(millions) + ' millions ' : 'un million ');
  if (milliers > 0) mots += (milliers > 1 ? centaines(milliers) + ' mille ' : 'mille ');
  if (reste > 0) mots += centaines(reste);
  return mots.trim();
}

/**
 * Export facture / devis / bon de livraison en PDF — design fidele au modele
 * officiel Imprimerie Ogooué (logo, tagline, encadre client, tableau, montant
 * en lettres, cachet, pied de page legal).
 */
export function exportDocument(doc, lignes, type = 'facture') {
  const numero = doc.numero || doc.id?.slice(0, 8) || '';
  const title = type === 'facture' ? `Facture ${numero}` : type === 'bon_livraison' ? `Bon de livraison ${numero}` : `Devis ${numero}`;
  const total = lignes.reduce((s, l) => s + ((l.quantite || 1) * (l.prix_unitaire || 0)), 0);
  const dateDoc = doc.date || doc.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dateFr = (() => { try { return new Date(dateDoc + 'T00:00:00').toLocaleDateString('fr-FR'); } catch { return dateDoc; } })();
  const docLabelGauche = type === 'facture' ? 'BON DE LIVRAISON' : type === 'devis' ? 'DEVIS' : 'BON DE LIVRAISON';
  const numFacture = `FACTURE N°${numero}/GA/${new Date(dateDoc).getFullYear() || new Date().getFullYear()}`;
  const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : '';

  let rows = '';
  lignes.forEach((l) => {
    const lineTotal = (l.quantite || 1) * (l.prix_unitaire || 0);
    rows += `<tr>
      <td style="padding:7px 10px;border:1px solid #94a3b8;">${esc(l.designation || l.description || '—')}</td>
      <td style="padding:7px 10px;border:1px solid #94a3b8;text-align:center;">${l.quantite || 1}</td>
      <td style="padding:7px 10px;border:1px solid #94a3b8;text-align:right;">${fmt(l.prix_unitaire)}</td>
      <td style="padding:7px 10px;border:1px solid #94a3b8;text-align:right;">${fmt(lineTotal)}</td>
    </tr>`;
  });

  const html = `
    <div style="font-family:'Segoe UI',system-ui,sans-serif;color:#1a1a2e;">
      <!-- En-tete : logo + tagline -->
      <div style="display:flex;align-items:center;gap:18px;margin-bottom:6px;">
        <img src="${origin}/logo.png" alt="Logo" style="height:78px;width:auto;object-fit:contain;" onerror="this.style.display='none'"/>
        <div style="flex:1;text-align:center;">
          <p style="font-weight:800;font-size:13px;color:#1e3a5f;margin:0;">Conception graphique &bull; Supports de communication multiformats</p>
          <p style="font-weight:800;font-size:13px;color:#1e3a5f;margin:2px 0;">Objets publicitaires &bull; personnalisation sur mesure</p>
          <p style="font-size:9.5px;color:#374151;margin:2px 0;">Adresse : Carrefour Fina, Moanda, Gabon &nbsp; Tél : (+241) 60 44 46 34</p>
        </div>
      </div>
      <div style="border-bottom:2px solid #1e3a5f;margin-bottom:22px;"></div>

      <!-- Titre document -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <p style="font-weight:700;font-size:12px;">${docLabelGauche}</p>
        <p style="font-weight:700;font-size:12px;">${numFacture}</p>
      </div>
      <p style="font-size:11px;margin-bottom:14px;">Livré le ${dateFr}</p>

      <!-- Client encadre -->
      <div style="border:1.5px solid #2563eb;border-radius:4px;padding:8px 12px;display:inline-block;margin-bottom:12px;">
        <span style="font-weight:700;font-size:12px;">CLIENT : ${esc((doc.client_nom || '—').toUpperCase())}</span>
      </div>
      ${doc.client_adresse ? `<p style="font-size:10px;color:#374151;margin-bottom:6px;">${esc(doc.client_adresse)}</p>` : ''}

      <!-- Objet -->
      <p style="font-size:11px;margin-bottom:14px;"><span style="text-decoration:underline;">Objet</span> : ${esc(doc.objet || 'Impression support publicitaire')}</p>

      <!-- Tableau -->
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:7px 10px;border:1px solid #94a3b8;text-align:center;font-weight:700;">DESIGNATION</th>
            <th style="padding:7px 10px;border:1px solid #94a3b8;text-align:center;font-weight:700;width:60px;">QTE</th>
            <th style="padding:7px 10px;border:1px solid #94a3b8;text-align:center;font-weight:700;width:90px;">P. U</th>
            <th style="padding:7px 10px;border:1px solid #94a3b8;text-align:center;font-weight:700;width:110px;">P. TOTAL</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:8px 10px;border:1px solid #94a3b8;text-align:center;font-weight:700;">TOTAL GENERAL</td>
            <td style="padding:8px 10px;border:1px solid #94a3b8;text-align:right;font-weight:800;">${fmt(total)} FCFA</td>
          </tr>
        </tfoot>
      </table>

      <!-- Montant en lettres -->
      <p style="font-size:11px;margin:14px 0 28px;">Arrêté la présente ${type === 'devis' ? 'proforma' : 'facture'} à la somme de <span style="text-transform:capitalize;">${nombreEnLettres(total)}</span> Francs CFA.</p>

      <!-- Signatures -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:20px;">
        <div style="text-decoration:underline;font-weight:700;font-size:12px;">Reçu par :</div>
        <div style="text-align:center;">
          <p style="text-decoration:underline;font-weight:700;font-size:12px;margin-bottom:50px;">Le Responsable</p>
        </div>
      </div>

      <!-- Pied de page legal -->
      <div style="margin-top:36px;border-top:1px solid #cbd5e1;padding-top:8px;text-align:center;font-size:8.5px;color:#475569;line-height:1.6;">
        <p style="font-weight:700;">RCCM : RG/FCV 2023A0407 &nbsp; NIF : 256598U</p>
        <p>Compte BGFI : 40003 04500 31113254001 66 &nbsp; Compte Finam : 40003 04100 41001779011 12</p>
        <p>Siège social : Carrefour Fina en face de Finam Moanda – Gabon</p>
        <p>Tél : 060 44 46 34 / 074 42 41 42 &nbsp; Email : imprimerieogooue@gmail.com</p>
      </div>
    </div>`;

  printHTML(title, html, { raw: true });
}

/**
 * Bon de travail atelier (pour la production d'une commande)
 * @param {Object} cmd - commande { numero, client_nom, client_tel, date_echeance, lignes/produits, description, note_interne, assignee_nom }
 */
export function exportBonTravail(cmd = {}) {
  const title = `Bon de travail — ${cmd.numero || cmd.id?.slice(0, 8) || ''}`;
  const lignes = cmd.lignes || cmd.produits || [];
  let rows = '';
  lignes.forEach((l) => {
    rows += `<tr>
      <td>${esc(l.description || l.nom || l.designation || '—')}</td>
      <td class="text-center" style="font-size:16px;font-weight:700;">${l.quantite || 1}</td>
      <td style="min-width:120px;">&nbsp;</td>
    </tr>`;
  });
  const html = `
    <div style="margin-bottom:12px;">
      <h2 style="margin-bottom:2px;">BON DE TRAVAIL</h2>
      <p style="font-size:11px;color:#6b7280;">Commande ${cmd.numero || ''} — usage interne atelier</p>
    </div>
    <table style="width:auto;border:none;margin-bottom:12px;">
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Client:</td><td style="border:none;padding:2px 0;">${esc(cmd.client_nom || '—')}</td></tr>
      ${cmd.client_tel ? `<tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Téléphone:</td><td style="border:none;padding:2px 0;">${esc(cmd.client_tel)}</td></tr>` : ''}
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Échéance:</td><td style="border:none;padding:2px 0;font-weight:700;color:#dc2626;">${cmd.date_echeance || 'Non définie'}</td></tr>
      ${cmd.assignee_nom ? `<tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Opérateur:</td><td style="border:none;padding:2px 0;">${esc(cmd.assignee_nom)}</td></tr>` : ''}
    </table>
    <table>
      <thead><tr><th>Produit / Travail</th><th class="text-center">Qté</th><th>Fait ✓</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${cmd.description ? `<div style="margin-top:12px;"><h3>Description</h3><p style="font-size:11px;">${esc(cmd.description)}</p></div>` : ''}
    ${cmd.note_interne ? `<div style="margin-top:8px;"><h3>Note interne</h3><p style="font-size:11px;">${esc(cmd.note_interne)}</p></div>` : ''}
    <div style="margin-top:32px;display:flex;justify-content:space-between;">
      <div style="font-size:10px;">Démarré le : _______________</div>
      <div style="font-size:10px;">Terminé le : _______________</div>
      <div style="font-size:10px;">Visa : _______________</div>
    </div>`;
  printHTML(title, html);
}

/**
 * Reçu de paiement (apres confirmation Mobile Money / SingPay)
 * @param {Object} info - { reference, client_nom, montant, operateur, date, commande_numero, telephone }
 */
export function exportRecuPaiement(info = {}) {
  const title = `Reçu de paiement N° ${info.reference || ''}`;
  const html = `
    <div style="text-align:center;margin-bottom:16px;">
      <h2 style="margin-bottom:4px;">REÇU DE PAIEMENT</h2>
      <p style="font-size:11px;color:#16a34a;font-weight:600;">✓ Paiement confirmé</p>
    </div>
    <table style="width:auto;border:none;margin:0 auto 16px;">
      <tr><td style="border:none;padding:3px 16px 3px 0;font-weight:600;">Référence:</td><td style="border:none;padding:3px 0;">${esc(info.reference || '—')}</td></tr>
      <tr><td style="border:none;padding:3px 16px 3px 0;font-weight:600;">Client:</td><td style="border:none;padding:3px 0;">${esc(info.client_nom || '—')}</td></tr>
      ${info.commande_numero ? `<tr><td style="border:none;padding:3px 16px 3px 0;font-weight:600;">Commande:</td><td style="border:none;padding:3px 0;">${esc(info.commande_numero)}</td></tr>` : ''}
      <tr><td style="border:none;padding:3px 16px 3px 0;font-weight:600;">Moyen:</td><td style="border:none;padding:3px 0;">${esc(info.operateur || 'Mobile Money')}</td></tr>
      ${info.telephone ? `<tr><td style="border:none;padding:3px 16px 3px 0;font-weight:600;">Téléphone:</td><td style="border:none;padding:3px 0;">${esc(info.telephone)}</td></tr>` : ''}
      <tr><td style="border:none;padding:3px 16px 3px 0;font-weight:600;">Date:</td><td style="border:none;padding:3px 0;">${info.date || new Date().toISOString().slice(0, 10)}</td></tr>
    </table>
    <div style="text-align:center;border:2px solid #16a34a;border-radius:8px;padding:16px;margin:0 auto;max-width:300px;">
      <p style="font-size:11px;color:#6b7280;margin-bottom:4px;">Montant payé</p>
      <p style="font-size:28px;font-weight:800;color:#16a34a;">${fmt(info.montant)} FCFA</p>
    </div>
    <p style="text-align:center;font-size:9px;color:#6b7280;margin-top:24px;">
      Merci de votre confiance — Imprimerie Ogooué.<br/>
      Ce reçu atteste du paiement effectué via ${info.operateur || 'Mobile Money'}.
    </p>`;
  printHTML(title, html);
}

/**
 * Export bilan financier en PDF
 */
export function exportBilanPDF(data, periode) {
  let html = `<h2>Bilan Financier — ${periode}</h2>`;

  html += `<div class="kpi-row">
    <div class="kpi-box"><div class="label">Chiffre d'affaires</div><div class="value text-emerald">${fmt(data.totalCA)} F</div></div>
    <div class="kpi-box"><div class="label">Dépenses</div><div class="value text-red">${fmt(data.totalDepenses)} F</div></div>
    <div class="kpi-box"><div class="label">Bénéfice</div><div class="value text-blue">${fmt(data.benefice)} F</div></div>
    <div class="kpi-box"><div class="label">Marge</div><div class="value">${data.marge?.toFixed(1)}%</div></div>
  </div>`;

  if (data.serviceData?.length) {
    html += `<h3>Détail par service</h3>
    <table><thead><tr><th>Service</th><th class="text-right">Recettes</th><th class="text-right">Dépenses</th><th class="text-right">Bénéfice</th><th class="text-right">Marge</th></tr></thead><tbody>`;
    data.serviceData.forEach((s) => {
      const m = s.recettes > 0 ? ((s.benefice / s.recettes) * 100).toFixed(1) : '0.0';
      html += `<tr><td>${s.name}</td><td class="text-right">${fmt(s.recettes)} F</td><td class="text-right">${fmt(s.depenses)} F</td><td class="text-right">${fmt(s.benefice)} F</td><td class="text-right">${m}%</td></tr>`;
    });
    html += `<tr class="total-row"><td>TOTAL</td><td class="text-right">${fmt(data.totalCA)} F</td><td class="text-right">${fmt(data.totalDepenses)} F</td><td class="text-right">${fmt(data.benefice)} F</td><td class="text-right">${data.marge?.toFixed(1)}%</td></tr>`;
    html += '</tbody></table>';
  }

  printHTML(`Bilan ${periode}`, html);
}

/**
 * Export rapport tableur (grille complète d'un jour) en PDF paysage
 */
export function exportRapportTableur({ date, operateur_nom, lignes, columnTotals, totalEntrees, totalSorties, caisse, statut, observations }) {
  const COLS = [
    { key: 'copies', label: 'COPIES' },
    { key: 'marchandises', label: 'MARCH.' },
    { key: 'scan', label: 'SCAN' },
    { key: 'tirage_saisies', label: 'TIR/SAIS' },
    { key: 'badges_plastification', label: 'BAD/PLAST' },
    { key: 'demi_photos', label: 'D-PHOTOS' },
    { key: 'maintenance', label: 'MAINT.' },
    { key: 'imprimerie', label: 'IMPRIM.' },
    { key: 'sorties', label: 'SORTIES', isSortie: true },
    { key: 'description', label: 'DESCRIPTION', isText: true },
  ];

  const dateLabel = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  let html = `
    <h2>Rapport journalier — ${dateLabel}</h2>
    <table style="width:auto;border:none;margin-bottom:12px;">
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Opérateur:</td><td style="border:none;padding:2px 0;">${operateur_nom || '—'}</td></tr>
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Statut:</td><td style="border:none;padding:2px 0;">${statut === 'verrouille' ? 'Verrouillé (validé)' : 'Ouvert'}</td></tr>
    </table>
    <div class="kpi-row">
      <div class="kpi-box"><div class="label">Total Recettes</div><div class="value text-emerald">${fmt(totalEntrees)} F</div></div>
      <div class="kpi-box"><div class="label">Total Dépenses</div><div class="value text-red">${fmt(totalSorties)} F</div></div>
      <div class="kpi-box"><div class="label">Caisse Journée</div><div class="value text-blue">${fmt(caisse)} F</div></div>
    </div>
    <table>
      <thead><tr>
        <th style="width:30px;text-align:center;">#</th>
        ${COLS.map((c) => `<th class="${c.isText ? 'text-left' : 'text-right'}" style="${c.isSortie ? 'background:#fee2e2;color:#dc2626;' : ''}">${c.label}</th>`).join('')}
      </tr></thead>
      <tbody>`;

  const rows = lignes || [];
  rows.forEach((row, i) => {
    const hasData = COLS.some((c) => c.isText ? (row[c.key] || '').trim() : (row[c.key] || 0) > 0);
    if (!hasData && i >= 5) return;
    html += `<tr>
      <td class="text-center" style="color:#9ca3af;font-weight:600;">${i + 1}</td>
      ${COLS.map((c) => {
        if (c.isText) return `<td>${row[c.key] || ''}</td>`;
        const val = row[c.key] || 0;
        return `<td class="text-right" style="${c.isSortie && val > 0 ? 'color:#dc2626;font-weight:600;' : ''}">${val > 0 ? fmt(val) : '—'}</td>`;
      }).join('')}
    </tr>`;
  });

  html += `<tr class="total-row">
    <td class="text-center font-bold">TOT</td>
    ${COLS.map((c) => {
      if (c.isText) return '<td></td>';
      const val = columnTotals?.[c.key] || 0;
      return `<td class="text-right font-bold" style="${c.isSortie ? 'color:#dc2626;' : ''}">${fmt(val)} F</td>`;
    }).join('')}
  </tr>`;

  html += '</tbody></table>';

  if (observations) {
    html += `<div class="section"><h3>Observations</h3><p style="font-size:10px;color:#374151;">${observations}</p></div>`;
  }

  if (statut === 'verrouille') {
    html += `<div style="margin-top:16px;text-align:right;font-size:10px;color:#059669;font-weight:600;">✓ Rapport validé et verrouillé</div>`;
  }

  printHTML(`Rapport ${dateLabel}`, html, { orientation: 'landscape' });
}

/**
 * Export liste clients en PDF
 */
export function exportClientsPDF(clients) {
  let html = `<h2>Liste des Clients</h2>
    <p style="margin-bottom:8px;">${clients.length} clients au total</p>
    <table><thead><tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Ville</th><th>Type</th><th class="text-right">Commandes</th><th class="text-right">CA Total</th></tr></thead><tbody>`;

  clients.forEach((c) => {
    html += `<tr>
      <td class="font-bold">${c.nom || '—'}</td>
      <td>${c.email || '—'}</td>
      <td>${c.telephone || '—'}</td>
      <td>${c.ville || '—'}</td>
      <td>${c.type === 'entreprise' ? 'Entreprise' : 'Particulier'}</td>
      <td class="text-right">${c.nb_commandes || 0}</td>
      <td class="text-right font-bold">${fmt(c.ca_total || 0)} F</td>
    </tr>`;
  });

  html += '</tbody></table>';
  printHTML('Liste Clients', html);
}

/**
 * Export fiche client individuelle en PDF
 */
export function exportFicheClientPDF(client, commandes = [], devis = []) {
  let html = `<h2>Fiche Client — ${client.nom || '—'}</h2>`;

  // Infos client
  html += `<table style="width:auto;border:none;margin-bottom:16px;">
    <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Nom:</td><td style="border:none;padding:2px 0;">${client.nom || '—'}</td></tr>
    <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Email:</td><td style="border:none;padding:2px 0;">${client.email || '—'}</td></tr>
    <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Téléphone:</td><td style="border:none;padding:2px 0;">${client.telephone || '—'}</td></tr>
    <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Ville:</td><td style="border:none;padding:2px 0;">${client.ville || '—'}</td></tr>
    <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Type:</td><td style="border:none;padding:2px 0;">${client.type === 'entreprise' ? 'Entreprise' : 'Particulier'}</td></tr>
    <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Client depuis:</td><td style="border:none;padding:2px 0;">${client.created_at?.slice(0, 10) || '—'}</td></tr>
  </table>`;

  const caTotal = commandes.reduce((s, c) => s + (c.montant_total || c.total || 0), 0);
  html += `<div class="kpi-row">
    <div class="kpi-box"><div class="label">Commandes</div><div class="value">${commandes.length}</div></div>
    <div class="kpi-box"><div class="label">Devis</div><div class="value">${devis.length}</div></div>
    <div class="kpi-box"><div class="label">CA Total</div><div class="value text-emerald">${fmt(caTotal)} F</div></div>
  </div>`;

  // Commandes
  if (commandes.length > 0) {
    html += `<h3>Historique des commandes</h3>
    <table><thead><tr><th>Date</th><th>Référence</th><th>Statut</th><th class="text-right">Montant</th></tr></thead><tbody>`;
    commandes.forEach((c) => {
      html += `<tr>
        <td>${c.date || c.created_at?.slice(0, 10) || '—'}</td>
        <td>${c.numero || c.id?.slice(0, 8) || '—'}</td>
        <td>${c.statut || '—'}</td>
        <td class="text-right font-bold">${fmt(c.montant_total || c.total || 0)} F</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  // Devis
  if (devis.length > 0) {
    html += `<h3>Devis émis</h3>
    <table><thead><tr><th>Date</th><th>Numéro</th><th>Statut</th><th class="text-right">Montant</th></tr></thead><tbody>`;
    devis.forEach((d) => {
      html += `<tr>
        <td>${d.date || d.created_at?.slice(0, 10) || '—'}</td>
        <td>${d.numero || d.id?.slice(0, 8) || '—'}</td>
        <td>${d.statut || '—'}</td>
        <td class="text-right font-bold">${fmt(d.montant_total || d.total || 0)} F</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  printHTML(`Fiche Client — ${client.nom}`, html);
}

/**
 * Export inventaire stock complet en PDF
 */
export function exportInventairePDF(articles, options = {}) {
  const { titre = 'Inventaire Stock Complet', filtre = '' } = options;

  let html = `<h2>${titre}</h2>`;
  if (filtre) html += `<p style="font-size:10px;color:#6b7280;margin-bottom:8px;">Filtre : ${filtre}</p>`;
  html += `<p style="font-size:10px;color:#6b7280;margin-bottom:12px;">${articles.length} article(s)</p>`;

  const totalValeur = articles.reduce((s, a) => {
    const prix = a.prix_unitaire || a.prix_achat || 0;
    const qte = a.quantite ?? a.stock ?? 0;
    return s + (prix * qte);
  }, 0);

  const enAlerte = articles.filter((a) => {
    const qte = a.quantite ?? a.stock ?? 0;
    const min = a.quantite_minimum ?? a.stock_min ?? 0;
    return qte <= min && qte > 0;
  }).length;

  const enRupture = articles.filter((a) => (a.quantite ?? a.stock ?? 0) <= 0).length;

  html += `<div class="kpi-row">
    <div class="kpi-box"><div class="label">Articles</div><div class="value">${articles.length}</div></div>
    <div class="kpi-box"><div class="label">En alerte</div><div class="value text-amber">${enAlerte}</div></div>
    <div class="kpi-box"><div class="label">En rupture</div><div class="value text-red">${enRupture}</div></div>
    <div class="kpi-box"><div class="label">Valeur totale</div><div class="value text-blue">${fmt(totalValeur)} F</div></div>
  </div>`;

  html += `<table>
    <thead><tr>
      <th>Nom</th>
      <th>Catégorie</th>
      <th>Référence</th>
      <th class="text-center">Quantité</th>
      <th>Unité</th>
      <th class="text-right">P.U.</th>
      <th class="text-right">Valeur</th>
      <th>Statut</th>
    </tr></thead><tbody>`;

  articles.forEach((a) => {
    const qte = a.quantite ?? a.stock ?? 0;
    const min = a.quantite_minimum ?? a.stock_min ?? 0;
    const prix = a.prix_unitaire || a.prix_achat || 0;
    const valeur = prix * qte;
    let statut = 'OK';
    let statutClass = 'text-emerald';
    if (qte <= 0) { statut = 'Rupture'; statutClass = 'text-red'; }
    else if (qte <= min) { statut = 'Bas'; statutClass = 'text-amber'; }

    html += `<tr>
      <td class="font-bold">${a.nom || '—'}</td>
      <td>${a.categorie || '—'}</td>
      <td>${a.reference || a.sku || '—'}</td>
      <td class="text-center">${qte} ${min > 0 ? `<span style="font-size:8px;color:#9ca3af;">(min: ${min})</span>` : ''}</td>
      <td>${a.unite || 'unité'}</td>
      <td class="text-right">${fmt(prix)} F</td>
      <td class="text-right font-bold">${fmt(valeur)} F</td>
      <td class="font-bold ${statutClass}">${statut}</td>
    </tr>`;
  });

  html += `<tr class="total-row">
    <td colspan="6" class="text-right">VALEUR TOTALE DU STOCK</td>
    <td class="text-right">${fmt(totalValeur)} F</td>
    <td></td>
  </tr>`;
  html += '</tbody></table>';

  printHTML(titre, html, { orientation: 'landscape' });
}

/**
 * Export journal d'audit investisseurs en PDF
 */
export function exportAuditInvestisseursPDF(modifications, periode = '') {
  let html = `<h2>Journal d'Audit — Investisseurs</h2>
    <p style="font-size:10px;color:#6b7280;margin-bottom:4px;">Période : ${periode || 'Toutes les modifications'}</p>
    <p style="font-size:10px;color:#6b7280;margin-bottom:12px;">${modifications.length} modification(s) enregistrée(s)</p>`;

  if (modifications.length === 0) {
    html += '<p style="text-align:center;color:#9ca3af;padding:20px;">Aucune modification enregistrée</p>';
  } else {
    html += `<table>
      <thead><tr>
        <th>Date / Heure</th>
        <th>Investisseur</th>
        <th>Type</th>
        <th class="text-right">Ancien montant</th>
        <th class="text-right">Nouveau montant</th>
        <th class="text-right">Différence</th>
        <th>Motif</th>
        <th>Admin auteur</th>
      </tr></thead><tbody>`;

    const typeLabels = {
      ajout_capital: 'Ajout capital',
      retrait: 'Retrait',
      correction: 'Correction',
      ajustement: 'Ajustement',
    };

    modifications.forEach((m) => {
      const diff = m.difference || 0;
      const diffClass = diff >= 0 ? 'text-emerald' : 'text-red';
      const d = m.dateHeure ? new Date(m.dateHeure) : new Date(m.created_at);
      const dateStr = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      html += `<tr>
        <td style="white-space:nowrap;">${dateStr}</td>
        <td>${m.investisseurNom || '—'}</td>
        <td>${typeLabels[m.typeOperation] || m.typeOperation}</td>
        <td class="text-right">${fmt(m.ancienMontant)} F</td>
        <td class="text-right font-bold">${fmt(m.nouveauMontant)} F</td>
        <td class="text-right ${diffClass}">${diff >= 0 ? '+' : ''}${fmt(diff)} F</td>
        <td>${m.motif || '—'}</td>
        <td>${m.auteur || '—'}</td>
      </tr>`;
    });

    html += '</tbody></table>';
  }

  html += '<div class="confidential">Document confidentiel — Réservé à l\'administration</div>';

  printHTML('Journal Audit Investisseurs', html, { orientation: 'landscape' });
}

/**
 * Export rapport complet mensuel en PDF (multi-sections)
 */
export function exportRapportCompletPDF({ mois, ventes = {}, topProduits = [], finance = {}, stock = {}, topClients = [] }) {
  const monthLabel = mois
    ? new Date(mois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  let html = `
    <div style="text-align:center;margin:40px 0 30px;">
      <h1 style="font-size:24px;color:#1e40af;margin-bottom:6px;">Rapport Mensuel Complet</h1>
      <p style="font-size:14px;color:#374151;font-weight:600;">${monthLabel}</p>
      <p style="font-size:10px;color:#6b7280;margin-top:8px;">Imprimerie OGOOUÉ — Moanda, Gabon</p>
    </div>`;

  // Section 1: Ventes & CA
  html += `<div class="section">
    <h2>1. Ventes & Chiffre d'Affaires</h2>
    <div class="kpi-row">
      <div class="kpi-box"><div class="label">Chiffre d'affaires</div><div class="value text-emerald">${fmt(ventes.ca || 0)} F</div></div>
      <div class="kpi-box"><div class="label">Commandes</div><div class="value">${ventes.nbCommandes || 0}</div></div>
      <div class="kpi-box"><div class="label">Panier moyen</div><div class="value text-blue">${fmt(ventes.panierMoyen || 0)} F</div></div>
    </div>
  </div>`;

  // Section 2: Top produits
  if (topProduits.length > 0) {
    html += `<div class="section">
      <h2>2. Top Produits</h2>
      <table><thead><tr><th>#</th><th>Produit</th><th class="text-right">Qté vendue</th><th class="text-right">CA généré</th></tr></thead><tbody>`;
    topProduits.slice(0, 10).forEach((p, i) => {
      html += `<tr><td class="text-center">${i + 1}</td><td class="font-bold">${p.nom || '—'}</td><td class="text-right">${p.qte || 0}</td><td class="text-right">${fmt(p.ca || 0)} F</td></tr>`;
    });
    html += '</tbody></table></div>';
  }

  // Section 3: Finance
  html += `<div class="section">
    <h2>3. Finance (Recettes / Dépenses / Marge)</h2>
    <div class="kpi-row">
      <div class="kpi-box"><div class="label">Recettes</div><div class="value text-emerald">${fmt(finance.recettes || 0)} F</div></div>
      <div class="kpi-box"><div class="label">Dépenses</div><div class="value text-red">${fmt(finance.depenses || 0)} F</div></div>
      <div class="kpi-box"><div class="label">Marge brute</div><div class="value text-blue">${fmt(finance.marge || 0)} F</div></div>
    </div>
  </div>`;

  // Section 4: Stock
  html += `<div class="section">
    <h2>4. État du Stock</h2>
    <div class="kpi-row">
      <div class="kpi-box"><div class="label">Articles</div><div class="value">${stock.totalArticles || 0}</div></div>
      <div class="kpi-box"><div class="label">En alerte</div><div class="value text-amber">${stock.enAlerte || 0}</div></div>
      <div class="kpi-box"><div class="label">En rupture</div><div class="value text-red">${stock.enRupture || 0}</div></div>
      <div class="kpi-box"><div class="label">Valeur stock</div><div class="value text-blue">${fmt(stock.valeurTotale || 0)} F</div></div>
    </div>
  </div>`;

  // Section 5: Top clients
  if (topClients.length > 0) {
    html += `<div class="section">
      <h2>5. Top Clients</h2>
      <table><thead><tr><th>#</th><th>Client</th><th class="text-right">Commandes</th><th class="text-right">CA total</th></tr></thead><tbody>`;
    topClients.slice(0, 10).forEach((c, i) => {
      html += `<tr><td class="text-center">${i + 1}</td><td class="font-bold">${c.nom || '—'}</td><td class="text-right">${c.nbCommandes || 0}</td><td class="text-right">${fmt(c.ca || 0)} F</td></tr>`;
    });
    html += '</tbody></table></div>';
  }

  printHTML(`Rapport Complet — ${monthLabel}`, html);
}

/**
 * Grand livre comptable : journal des mouvements d'un compte (ou tous) sur une periode.
 * @param {Object} opts - { mouvements, comptes, compteId|null, dateFrom, dateTo, soldeInitial }
 */
export function exportGrandLivrePDF({ mouvements = [], comptes = [], compteId = null, dateFrom = '', dateTo = '', soldeInitial = 0 }) {
  const compteNom = (id) => comptes.find((c) => c.id === id)?.nom || '—';
  const filtres = mouvements
    .filter((m) => !compteId || m.compte_id === compteId)
    .filter((m) => {
      const d = (m.date || m.created_at || '').slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    })
    .sort((a, b) => (a.date || a.created_at || '').localeCompare(b.date || b.created_at || ''));

  const titreCompte = compteId ? compteNom(compteId) : 'Tous les comptes';
  let solde = Number(soldeInitial) || 0;
  let totalEntrees = 0;
  let totalSorties = 0;
  let rows = '';
  filtres.forEach((m) => {
    const montant = Number(m.montant) || 0;
    const estEntree = m.type === 'entree' || m.type === 'depot_hebdo' || (m.type === 'transfert' && m.compte_dest_id === compteId);
    if (estEntree) { solde += montant; totalEntrees += montant; }
    else { solde -= montant; totalSorties += montant; }
    rows += `<tr>
      <td>${(m.date || m.created_at || '').slice(0, 10)}</td>
      <td>${m.description || m.categorie || '—'}</td>
      <td>${m.reference || ''}</td>
      <td class="text-right" style="color:#16a34a;">${estEntree ? fmt(montant) + ' F' : ''}</td>
      <td class="text-right" style="color:#dc2626;">${!estEntree ? fmt(montant) + ' F' : ''}</td>
      <td class="text-right font-bold">${fmt(solde)} F</td>
    </tr>`;
  });

  const periodeLabel = `${dateFrom || 'début'} → ${dateTo || "aujourd'hui"}`;
  const html = `
    <div style="margin-bottom:12px;">
      <h2 style="margin-bottom:2px;">GRAND LIVRE — ${titreCompte}</h2>
      <p style="font-size:11px;color:#6b7280;">Période : ${periodeLabel}</p>
    </div>
    <table>
      <thead><tr>
        <th>Date</th><th>Libellé</th><th>Réf.</th>
        <th class="text-right">Entrée</th><th class="text-right">Sortie</th><th class="text-right">Solde</th>
      </tr></thead>
      <tbody>
        <tr><td colspan="5" style="font-weight:600;">Solde initial</td><td class="text-right font-bold">${fmt(soldeInitial)} F</td></tr>
        ${rows}
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="3" class="text-right">TOTAUX</td>
          <td class="text-right" style="color:#16a34a;">${fmt(totalEntrees)} F</td>
          <td class="text-right" style="color:#dc2626;">${fmt(totalSorties)} F</td>
          <td class="text-right">${fmt(solde)} F</td>
        </tr>
      </tfoot>
    </table>
    <p style="font-size:9px;color:#6b7280;margin-top:16px;">${filtres.length} mouvement(s) — Imprimerie Ogooué</p>`;
  printHTML(`Grand livre — ${titreCompte}`, html);
}

/**
 * Export CSV générique
 */
export function exportCSV(data, columns, filename = 'export.csv') {
  const header = columns.map((c) => c.label).join(';');
  const rows = data.map((row) =>
    columns.map((c) => {
      const val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.accessor] || '';
      // Escape semicolons and quotes for CSV
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(';')
  );

  const csv = '\uFEFF' + [header, ...rows].join('\n'); // BOM for Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
