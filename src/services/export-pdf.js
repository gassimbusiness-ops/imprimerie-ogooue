/**
 * Export PDF — Génération de documents PDF côté client (sans dépendance externe).
 * Utilise une technique d'impression via iframe caché + window.print().
 * Alternative : jsPDF si installé.
 */

/**
 * Génère un PDF à partir de HTML (via impression du navigateur).
 * @param {string} title - Titre du document
 * @param {string} htmlContent - Contenu HTML à imprimer
 * @param {Object} options - Options supplémentaires
 */
export function printHTML(title, htmlContent, options = {}) {
  const { orientation = 'portrait', companyName = 'Imprimerie OGOOUÉ' } = options;

  const css = `
    <style>
      @page { size: A4 ${orientation}; margin: 15mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 11px; color: #1a1a2e; line-height: 1.5; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e40af; padding-bottom: 12px; margin-bottom: 16px; }
      .header-left h1 { font-size: 18px; font-weight: 800; color: #1e40af; }
      .header-left p { font-size: 10px; color: #6b7280; margin-top: 2px; }
      .header-right { text-align: right; font-size: 9px; color: #6b7280; }
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
      .total-row { background: #e0e7ff !important; font-weight: 700; }
      .kpi-row { display: flex; gap: 12px; margin: 8px 0 12px; }
      .kpi-box { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; text-align: center; }
      .kpi-box .label { font-size: 8px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
      .kpi-box .value { font-size: 16px; font-weight: 800; margin-top: 2px; }
      .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8px; color: #9ca3af; text-align: center; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  `;

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const fullHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${css}</head><body>
    <div class="header">
      <div class="header-left">
        <h1>${companyName}</h1>
        <p>Moanda — Gabon | RCCM: RG/FCV 2023A0407 | NIF: 256598U</p>
      </div>
      <div class="header-right">
        <strong>${title}</strong><br/>
        Généré le ${dateStr} à ${timeStr}
      </div>
    </div>
    ${htmlContent}
    <div class="footer">${companyName} — Document généré automatiquement — ${dateStr}</div>
  </body></html>`;

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
 * Export facture / devis en PDF
 */
export function exportDocument(doc, lignes, type = 'facture') {
  const title = type === 'facture' ? `Facture N° ${doc.numero || doc.id?.slice(0, 8)}` : `Devis N° ${doc.numero || doc.id?.slice(0, 8)}`;
  const total = lignes.reduce((s, l) => s + ((l.quantite || 1) * (l.prix_unitaire || 0)), 0);

  let html = `<h2>${title}</h2>
    <table style="width:auto;border:none;margin-bottom:12px;">
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Client:</td><td style="border:none;padding:2px 0;">${doc.client_nom || '—'}</td></tr>
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Date:</td><td style="border:none;padding:2px 0;">${doc.date || doc.created_at?.slice(0, 10) || '—'}</td></tr>
      ${doc.echeance ? `<tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Échéance:</td><td style="border:none;padding:2px 0;">${doc.echeance}</td></tr>` : ''}
      <tr><td style="border:none;padding:2px 16px 2px 0;font-weight:600;">Statut:</td><td style="border:none;padding:2px 0;">${doc.statut || '—'}</td></tr>
    </table>

    <table>
      <thead><tr>
        <th>Désignation</th><th class="text-center">Qté</th><th class="text-right">P.U.</th><th class="text-right">Total</th>
      </tr></thead>
      <tbody>`;

  lignes.forEach((l) => {
    const lineTotal = (l.quantite || 1) * (l.prix_unitaire || 0);
    html += `<tr>
      <td>${l.designation || l.description || '—'}</td>
      <td class="text-center">${l.quantite || 1}</td>
      <td class="text-right">${fmt(l.prix_unitaire)} F</td>
      <td class="text-right font-bold">${fmt(lineTotal)} F</td>
    </tr>`;
  });

  html += `</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="3" class="text-right">TOTAL ${type === 'facture' ? 'TTC' : 'HT'}</td>
        <td class="text-right">${fmt(total)} F</td>
      </tr>
    </tfoot></table>

    <div style="margin-top:24px;">
      <h3>Conditions</h3>
      <p style="font-size:9px;color:#6b7280;">
        ${type === 'facture' ? 'Paiement à réception de la facture. Tout retard de paiement entraînera des pénalités.' : 'Devis valable 30 jours. TVA non applicable (régime de franchise).'}
      </p>
    </div>`;

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
 * Export liste clients en PDF
 */
export function exportClientsPDF(clients) {
  let html = `<h2>Liste des Clients</h2>
    <p style="margin-bottom:8px;">${clients.length} clients au total</p>
    <table><thead><tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Ville</th><th class="text-right">Commandes</th></tr></thead><tbody>`;

  clients.forEach((c) => {
    html += `<tr>
      <td class="font-bold">${c.nom || '—'}</td>
      <td>${c.email || '—'}</td>
      <td>${c.telephone || '—'}</td>
      <td>${c.ville || '—'}</td>
      <td class="text-right">${c.nb_commandes || 0}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  printHTML('Liste Clients', html);
}
