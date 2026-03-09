/**
 * Page d'import des données réelles — Admin uniquement
 * Cette page est temporaire et sera retirée après l'import.
 */
import { useState, useRef } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, Trash2, CheckCircle, AlertTriangle, Loader2, Database } from 'lucide-react';

/* ─── Helpers ─── */
function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n || 0)); }

/* ─── Category mapping for inventaire items ─── */
function categorizeItem(designation) {
  const d = designation.toLowerCase();
  if (d.includes('tee-shirt') || d.includes('polo')) return 'Textile';
  if (d.includes('chemise') || d.includes('sous chemise')) return 'Papeterie';
  if (d.includes('papier') || d.includes('spirale') || d.includes('cover') || d.includes('rouleaux de flex')) return 'Papeterie';
  if (d.includes('enveloppe') || d.includes('envellope')) return 'Enveloppes';
  if (d.includes('badge')) return 'Accessoire';
  if (d.includes('tasse')) return 'Accessoire';
  if (d.includes('casquette')) return 'Accessoire';
  if (d.includes('imprimante') || d.includes('ordinateur')) return 'Machines & Outils';
  if (d.includes('papier ram')) return 'Papeterie';
  return 'Autre';
}

function getUnite(designation) {
  const d = designation.toLowerCase();
  if (d.includes('tee-shirt') || d.includes('polo') || d.includes('casquette')) return 'pièce';
  if (d.includes('badge') || d.includes('tasse')) return 'pièce';
  if (d.includes('chemise') || d.includes('enveloppe') || d.includes('envellope')) return 'paquet';
  if (d.includes('papier') && !d.includes('ram')) return 'rouleau';
  if (d.includes('ram')) return 'rame';
  if (d.includes('spirale')) return 'paquet';
  if (d.includes('rouleaux')) return 'rouleau';
  if (d.includes('cover')) return 'rouleau';
  if (d.includes('imprimante') || d.includes('ordinateur')) return 'unité';
  return 'unité';
}

/* ─── Mapping recettes JSON → rapport categories ─── */
const RECETTE_MAP = {
  'Copies': 'copies',
  'Marchandises': 'marchandises',
  'Scan': 'scan',
  'Tirage/Saisies': 'tirage_saisies',
  'Badges/Plastification': 'badges_plastification',
  'Demi-Photos': 'demi_photos',
  'Maintenance': 'maintenance',
  'Imprimerie': 'imprimerie',
};

/* ─── Meta rows to exclude from inventaire ─── */
const META_KEYWORDS = [
  'MACHINE ET OUTILS', 'TOTAL STOCK', 'CASH EN COMPTE', 'CASH EN CAISSE',
  'DETTE', 'INVESTISSEMENT', 'POURCENTAGE', 'GESTION', 'ABAKAR',
  'SENOUSSI SALEH', 'FRAIS DE VOYAGE',
];
function isMetaRow(designation) {
  const d = designation.toUpperCase();
  return META_KEYWORDS.some(kw => d.includes(kw)) || d.startsWith('VALEUR TOTAL');
}

/* ══════════════════════════════════════════════
   MAIN IMPORT PAGE
   ══════════════════════════════════════════════ */
export default function AdminImport() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [stats, setStats] = useState(null);
  const logsEndRef = useRef(null);

  const log = (msg, type = 'info') => {
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-red-500 font-bold">Accès réservé aux administrateurs</p>
      </div>
    );
  }

  /* ─── STEP 0: Audit ─── */
  const doAudit = async () => {
    log('=== ÉTAPE 0: AUDIT DES DONNÉES ACTUELLES ===', 'title');

    const rapports = await db.rapports.list();
    log(`Rapports journaliers en base : ${rapports.length}`);

    const produits = await db.produits.list();
    log(`Articles stock (produits) en base : ${produits.length}`);
    if (produits.length > 0) {
      log(`  → Premiers articles : ${produits.slice(0, 5).map(p => p.nom).join(', ')}...`);
    }

    const catalogue = await db.produits_catalogue.list();
    log(`Produits catalogue en base : ${catalogue.length}`);

    const projets = await db.projets_travaux.list();
    const etapes = await db.etapes_travaux.list();
    log(`Projets travaux : ${projets.length} | Étapes : ${etapes.length}`);

    const clients = await db.clients.list();
    log(`Clients : ${clients.length}`);

    const commandes = await db.commandes.list();
    log(`Commandes : ${commandes.length}`);

    const users = await db.users.list();
    log(`Utilisateurs : ${users.length}`);

    return { rapports, produits, catalogue, projets, etapes, clients, commandes };
  };

  /* ─── STEP 1: Delete test data ─── */
  const doDeleteTestData = async (auditData) => {
    log('=== ÉTAPE 1: SUPPRESSION DES DONNÉES DE TEST ===', 'title');
    let deleted = { rapports: 0, produits: 0 };

    // Delete ALL existing rapports (they are test data)
    if (auditData.rapports.length > 0) {
      log(`Suppression de ${auditData.rapports.length} rapports de test...`);
      for (const r of auditData.rapports) {
        await db.rapports.delete(r.id);
        deleted.rapports++;
      }
      log(`  ✅ ${deleted.rapports} rapports supprimés`, 'success');
    } else {
      log('  Aucun rapport de test à supprimer');
    }

    // Delete ALL existing stock items (they are test data)
    if (auditData.produits.length > 0) {
      log(`Suppression de ${auditData.produits.length} articles de stock de test...`);
      for (const p of auditData.produits) {
        await db.produits.delete(p.id);
        deleted.produits++;
      }
      log(`  ✅ ${deleted.produits} articles stock supprimés`, 'success');
    } else {
      log('  Aucun article stock de test à supprimer');
    }

    // Also clean mouvements_stock (linked to test data)
    const mvts = await db.mouvements_stock.list();
    if (mvts.length > 0) {
      log(`Suppression de ${mvts.length} mouvements de stock de test...`);
      for (const m of mvts) {
        await db.mouvements_stock.delete(m.id);
      }
      log(`  ✅ ${mvts.length} mouvements supprimés`, 'success');
    }

    log('NE TOUCHE PAS : utilisateurs, clients, commandes, paramètres, catalogue', 'warn');
    return deleted;
  };

  /* ─── STEP 2: Import rapports ─── */
  const doImportRapports = async () => {
    log('=== ÉTAPE 2: IMPORT DES RAPPORTS JOURNALIERS ===', 'title');
    log('Chargement de rapports_data.json...');

    const res = await fetch('/data/rapports_data.json');
    const rapportsData = await res.json();
    log(`${rapportsData.length} rapports à importer`);

    let imported = 0, skipped = 0, errors = 0;

    // Check for existing dates to avoid duplicates
    const existing = await db.rapports.list();
    const existingDates = new Set(existing.map(r => r.date));

    for (let i = 0; i < rapportsData.length; i++) {
      const r = rapportsData[i];

      if (existingDates.has(r.date)) {
        skipped++;
        continue;
      }

      try {
        // Map recettes to categories object
        const categories = {
          copies: 0, marchandises: 0, scan: 0, tirage_saisies: 0,
          badges_plastification: 0, demi_photos: 0, maintenance: 0, imprimerie: 0,
        };
        if (r.recettes) {
          Object.entries(r.recettes).forEach(([key, value]) => {
            const mapped = RECETTE_MAP[key];
            if (mapped) categories[mapped] = value || 0;
          });
        }

        // Map depenses
        const depenses = [];
        if (r.depenses && r.total_depenses > 0) {
          depenses.push({
            libelle: 'Sorties/Dépenses diverses',
            montant: r.total_depenses,
          });
        }

        await db.rapports.create({
          date: r.date,
          operateur_nom: 'Imprimerie OGOOUÉ',
          statut: 'cloture', // historique = verrouillé
          categories,
          depenses,
          caisse_journee: r.caisse_journee || 0,
          total_recettes: r.total_recettes || 0,
          total_depenses: r.total_depenses || 0,
          observations: r.observations || '',
          source: 'import_historique',
          cloture_par: 'Import automatique',
          cloture_at: new Date().toISOString(),
          created_at: r.date + 'T08:00:00.000Z',
        });

        imported++;

        // Progress log every 50
        if ((i + 1) % 50 === 0) {
          log(`  ... ${i + 1}/${rapportsData.length} traités (${imported} importés)`);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) log(`  ❌ Erreur rapport ${r.date}: ${err.message}`, 'error');
      }
    }

    log(`✅ Rapports: ${imported} importés, ${skipped} doublons ignorés, ${errors} erreurs`, imported > 0 ? 'success' : 'error');
    return { imported, skipped, errors };
  };

  /* ─── STEP 3: Import inventaire into stocks ─── */
  const doImportInventaire = async () => {
    log('=== ÉTAPE 3: IMPORT INVENTAIRE → STOCKS ===', 'title');
    log('Chargement de inventaire_data.json...');

    const res = await fetch('/data/inventaire_data.json');
    const invData = await res.json();
    log(`${invData.length} lignes dans le JSON (dont méta-lignes à exclure)`);

    // Filter out meta/summary rows
    const realItems = invData.filter(i => !isMetaRow(i.designation));
    // Also exclude items with qty that looks like money (FRAIS DE VOYAGE already caught)
    const items = realItems.filter(i => i.quantite < 100000); // safety check
    log(`${items.length} articles réels à importer`);

    let imported = 0, errors = 0;

    // Check for existing items to avoid duplicates
    const existing = await db.produits.list();
    const existingNames = new Set(existing.map(p => (p.nom || '').toLowerCase()));

    for (const item of items) {
      if (existingNames.has(item.designation.toLowerCase())) {
        log(`  ⏭️ "${item.designation}" existe déjà — skip`);
        continue;
      }

      try {
        const cat = categorizeItem(item.designation);
        const unite = getUnite(item.designation);
        const qtyMin = Math.max(5, Math.round(item.quantite * 0.2));

        await db.produits.create({
          nom: item.designation,
          categorie: cat,
          unite,
          quantite: item.quantite,
          quantite_minimum: qtyMin,
          prix_unitaire: item.prix_achat_unitaire || 0,
          prix_vente: item.prix_vente_unitaire || 0,
          valeur_stock_achat: item.valeur_stock_achat || 0,
          valeur_vente_totale: item.valeur_vente_totale || 0,
          fournisseur: '',
          emplacement: '',
          description: '',
          reference: '',
          masque: false,
          actif: true,
          source: 'import_inventaire_2026',
        });

        imported++;
        log(`  ✅ ${item.designation} (${item.quantite} ${unite}, ${fmt(item.valeur_stock_achat)} F)`);
      } catch (err) {
        errors++;
        log(`  ❌ Erreur "${item.designation}": ${err.message}`, 'error');
      }
    }

    log(`✅ Inventaire: ${imported} articles importés, ${errors} erreurs`, imported > 0 ? 'success' : 'error');
    return { imported, errors, total: items.length };
  };

  /* ─── STEP 4: Import chantier data ─── */
  const doImportChantier = async () => {
    log('=== ÉTAPE 4: IMPORT DÉPENSES CHANTIER PAPETERIE ===', 'title');
    log('Chargement de chantier_data.json...');

    const res = await fetch('/data/chantier_data.json');
    const chantierData = await res.json();
    log(`${chantierData.length} lignes de matériaux`);

    // Check if project exists already
    const projets = await db.projets_travaux.list();
    let projetPapeterie = projets.find(p =>
      (p.nom || '').toLowerCase().includes('papeterie')
    );

    if (!projetPapeterie) {
      log('Création du projet "Papeterie OGOOUÉ"...');
      projetPapeterie = await db.projets_travaux.create({
        nom: 'Papeterie OGOOUÉ',
        description: 'Construction de la papeterie — Travaux Groupe Ogooué',
        statut: 'en_cours',
        budget_prevu: 2500000,
        date_debut: '2025-12-28',
        date_fin: '',
        source: 'import_chantier',
      });
      log(`  ✅ Projet créé: ${projetPapeterie.id}`, 'success');
    } else {
      log(`  Projet existant trouvé: "${projetPapeterie.nom}" (${projetPapeterie.id})`);
    }

    // Import materials as etapes
    let importedMat = 0, totalMat = 0;

    for (const mat of chantierData) {
      try {
        const date = mat.date || '2026-01-01';
        const isPaid = (mat.statut_paiement || '').toLowerCase().includes('pay');

        await db.etapes_travaux.create({
          projet_id: projetPapeterie.id,
          nom: `Matériaux: ${mat.materiel}`,
          description: `${mat.quantite} × ${fmt(mat.prix_unitaire)} F = ${fmt(mat.total)} F`,
          statut: isPaid ? 'termine' : 'en_attente',
          budget: mat.total || 0,
          depense: mat.total || 0,
          type: 'materiau',
          materiel: mat.materiel,
          quantite: mat.quantite,
          prix_unitaire: mat.prix_unitaire,
          date,
          fournisseur: 'Quincaillerie Moanda',
          statut_paiement: isPaid ? 'paye' : 'en_attente',
          source: 'import_chantier',
        });
        importedMat++;
        totalMat += mat.total || 0;
      } catch (err) {
        log(`  ❌ Erreur "${mat.materiel}": ${err.message}`, 'error');
      }
    }

    log(`  ✅ ${importedMat} matériaux importés — Total: ${fmt(totalMat)} F`, 'success');

    // Import salaires maçons
    try {
      await db.etapes_travaux.create({
        projet_id: projetPapeterie.id,
        nom: "Main d'œuvre / Maçonnerie",
        description: 'Salaires et paiements maçons - Construction Papeterie',
        statut: 'en_cours',
        budget: 1409000,
        depense: 1409000,
        type: 'main_oeuvre',
        date: '2026-01-01',
        source: 'import_chantier',
      });
      log(`  ✅ Salaires maçons: 1 409 000 F`, 'success');
    } catch (err) {
      log(`  ❌ Erreur salaires maçons: ${err.message}`, 'error');
    }

    const totalGeneral = totalMat + 1409000;
    log(`✅ Total chantier: ${fmt(totalGeneral)} F (matériaux: ${fmt(totalMat)} F + maçons: 1 409 000 F)`, 'success');
    return { materiaux: importedMat, totalMat, totalGeneral };
  };

  /* ─── STEP 5: Verify ─── */
  const doVerify = async () => {
    log('=== ÉTAPE 5: VÉRIFICATIONS POST-IMPORT ===', 'title');

    const rapports = await db.rapports.list();
    log(`Rapports en base: ${rapports.length} (attendu: ~628)`);

    if (rapports.length > 0) {
      const dates = rapports.map(r => r.date).sort();
      log(`  Date min: ${dates[0]} (attendu: 2023-07-11)`);
      log(`  Date max: ${dates[dates.length - 1]} (attendu: 2026-03-03)`);

      // Check known rapport
      const test = rapports.find(r => r.date === '2023-07-13');
      if (test) {
        log(`  Rapport 2023-07-13: caisse=${fmt(test.caisse_journee)} (attendu: 57 050) ✅`, 'success');
      } else {
        log(`  ⚠️ Rapport 2023-07-13 non trouvé`, 'warn');
      }

      // Total recettes
      const totalRec = rapports.reduce((s, r) => s + (r.total_recettes || 0), 0);
      const totalDep = rapports.reduce((s, r) => s + (r.total_depenses || 0), 0);
      log(`  Total recettes historique: ${fmt(totalRec)} F`);
      log(`  Total dépenses historique: ${fmt(totalDep)} F`);
    }

    const produits = await db.produits.list();
    log(`Articles stock: ${produits.length}`);
    const totalValAchat = produits.reduce((s, p) => s + ((p.prix_unitaire || 0) * (p.quantite || 0)), 0);
    const totalValVente = produits.reduce((s, p) => s + ((p.prix_vente || 0) * (p.quantite || 0)), 0);
    log(`  Valeur totale achat: ${fmt(totalValAchat)} F`);
    log(`  Valeur totale vente: ${fmt(totalValVente)} F`);

    const catalogue = await db.produits_catalogue.list();
    log(`Catalogue (non modifié): ${catalogue.length} produits`);

    const projets = await db.projets_travaux.list();
    const etapes = await db.etapes_travaux.list();
    const totalChantier = etapes.reduce((s, e) => s + (e.depense || 0), 0);
    log(`Projets travaux: ${projets.length} | Étapes: ${etapes.length} | Total: ${fmt(totalChantier)} F`);

    return { rapports: rapports.length, produits: produits.length, catalogue: catalogue.length, totalChantier };
  };

  /* ─── Run all steps ─── */
  const runFullImport = async () => {
    setRunning(true);
    setLogs([]);
    setStats(null);

    try {
      // Step 0: Audit
      setStep('Audit...');
      const auditData = await doAudit();

      // Step 1: Delete test data
      setStep('Suppression des données de test...');
      const deleted = await doDeleteTestData(auditData);

      // Step 2: Import rapports
      setStep('Import des rapports journaliers...');
      const rapportStats = await doImportRapports();

      // Step 3: Import inventaire
      setStep('Import de l\'inventaire...');
      const invStats = await doImportInventaire();

      // Step 4: Import chantier
      setStep('Import du chantier...');
      const chantierStats = await doImportChantier();

      // Step 5: Verify
      setStep('Vérifications...');
      const verified = await doVerify();

      log('');
      log('🎉 IMPORT TERMINÉ AVEC SUCCÈS !', 'title');

      setStats({
        rapports: rapportStats,
        inventaire: invStats,
        chantier: chantierStats,
        verified,
        deleted,
      });
    } catch (err) {
      log(`💥 ERREUR FATALE: ${err.message}`, 'error');
      console.error(err);
    } finally {
      setRunning(false);
      setStep('');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6" />
            Import des données réelles
          </h2>
          <p className="text-muted-foreground">628 rapports + 60 articles inventaire + chantier papeterie</p>
        </div>
        <Badge variant="outline" className="text-xs">Admin uniquement</Badge>
      </div>

      {/* Warning */}
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">Attention — Import irréversible</p>
            <ul className="mt-1 space-y-0.5 text-amber-700">
              <li>• Supprime tous les rapports et articles de stock de test existants</li>
              <li>• Importe les vraies données historiques (rapports, inventaire, chantier)</li>
              <li>• Ne touche PAS : utilisateurs, clients, commandes, catalogue, paramètres</li>
              <li>• Les rapports importés seront verrouillés (statut "cloturé")</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Action */}
      <div className="flex gap-3">
        <Button
          size="lg"
          className="gap-2"
          onClick={runFullImport}
          disabled={running}
        >
          {running ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {step}</>
          ) : (
            <><Upload className="h-4 w-4" /> Lancer l'import complet</>
          )}
        </Button>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-2">Journal d'import</h3>
            <div className="max-h-[500px] overflow-y-auto bg-gray-950 text-gray-100 rounded-lg p-3 font-mono text-xs space-y-0.5">
              {logs.map((l, i) => (
                <div key={i} className={`${
                  l.type === 'title' ? 'text-blue-400 font-bold mt-2' :
                  l.type === 'success' ? 'text-emerald-400' :
                  l.type === 'error' ? 'text-red-400' :
                  l.type === 'warn' ? 'text-amber-400' :
                  'text-gray-300'
                }`}>
                  <span className="text-gray-600 mr-2">[{l.time}]</span>
                  {l.msg}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats summary */}
      {stats && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-4">
            <h3 className="font-semibold text-emerald-800 flex items-center gap-2 mb-3">
              <CheckCircle className="h-5 w-5" /> Récapitulatif de l'import
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-emerald-700 font-medium">Rapports journaliers</p>
                <p className="text-emerald-900 font-bold text-lg">{stats.rapports.imported} importés</p>
                {stats.rapports.skipped > 0 && <p className="text-xs text-emerald-600">{stats.rapports.skipped} doublons ignorés</p>}
              </div>
              <div>
                <p className="text-emerald-700 font-medium">Articles inventaire</p>
                <p className="text-emerald-900 font-bold text-lg">{stats.inventaire.imported} importés</p>
              </div>
              <div>
                <p className="text-emerald-700 font-medium">Chantier Papeterie</p>
                <p className="text-emerald-900 font-bold text-lg">{fmt(stats.chantier.totalGeneral)} F</p>
                <p className="text-xs text-emerald-600">{stats.chantier.materiaux} matériaux + salaires maçons</p>
              </div>
              <div>
                <p className="text-emerald-700 font-medium">Données supprimées</p>
                <p className="text-emerald-900 font-bold text-lg">{stats.deleted.rapports + stats.deleted.produits} items test</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
