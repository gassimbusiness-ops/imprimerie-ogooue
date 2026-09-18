/**
 * Page d'import des donnees reelles — Admin uniquement.
 *
 * ⚠️ CE QUE CETTE PAGE DETRUIT
 *
 * `doDeleteTestData()` supprime, une ligne a la fois et sans retour possible :
 * TOUS les rapports journaliers, TOUS les articles de stock, TOUS les
 * mouvements de stock. Au 18/09/2026 la base de production en compte
 * respectivement 237, 45 et 44 : c'est trois mois de saisie du gerant.
 *
 * La route `/admin-import` est ACTIVE et ABSENTE DU MENU — donc invisible, et
 * non surveillee. Jusqu'a cette intervention, un seul clic sur « Lancer
 * l'import complet » suffisait : AUCUNE confirmation, aucun comptage prealable,
 * aucune trace dans le journal d'audit.
 *
 * Desormais, et dans cet ordre :
 *   1. un COMPTAGE en lecture seule dit, chiffre par chiffre, ce qui va
 *      disparaitre ;
 *   2. l'administrateur doit retaper le mot SUPPRIMER — un mot qu'on ne tape
 *      pas par accident ;
 *   3. la destruction est tracee dans le journal d'audit AVANT d'avoir lieu ;
 *   4. les trois conditions (role, comptage fait, mot retape) sont verifiees
 *      DANS `runFullImport`, pas seulement dans l'affichage : un bouton grise
 *      n'arrete pas un appel deja parti.
 *
 * Le code d'import lui-meme n'a pas ete touche : il servira peut-etre encore.
 */
import { useState, useRef } from 'react';
import { db } from '@/services/db';
import { useAuth } from '@/services/auth';
import { logAction } from '@/services/audit';
import { creerVerrouExecution } from '@/services/execution-unique';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, CheckCircle, AlertTriangle, Loader2, Database, ListChecks, ShieldAlert } from 'lucide-react';

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

/** Le mot a retaper. Volontairement en majuscules, sans accent, non traduit. */
const MOT_DE_CONFIRMATION = 'SUPPRIMER';

/**
 * Verrou d'execution — un seul import a la fois.
 * Le `disabled` du bouton protege l'utilisateur ; ce verrou protege la base.
 */
const verrouImport = creerVerrouExecution();

/* ══════════════════════════════════════════════
   MAIN IMPORT PAGE
   ══════════════════════════════════════════════ */
export default function AdminImport() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [stats, setStats] = useState(null);
  // Comptage prealable : `null` tant qu'il n'a pas ete fait. C'est LUI qui
  // autorise l'import — pas l'affichage.
  const [aDetruire, setADetruire] = useState(null);
  const [comptageEnCours, setComptageEnCours] = useState(false);
  const [motSaisi, setMotSaisi] = useState('');
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

  /* ─── Comptage prealable — LECTURE SEULE ───
     Rien n'est ecrit ici. On va chercher, en base, le nombre exact de lignes
     que l'import detruira, pour pouvoir le NOMMER dans la confirmation. Une
     confirmation qui dit « etes-vous sur ? » sans dire de quoi ne protege
     personne. */
  const compterCeQuiSeraDetruit = async () => {
    setComptageEnCours(true);
    try {
      const [rapports, produits, mouvements] = await Promise.all([
        db.rapports.list(),
        db.produits.list(),
        db.mouvements_stock.list(),
      ]);
      const dates = rapports.map((r) => r.date).filter(Boolean).sort();
      const compte = {
        rapports: rapports.length,
        produits: produits.length,
        mouvements_stock: mouvements.length,
        total: rapports.length + produits.length + mouvements.length,
        premiere_date: dates[0] || null,
        derniere_date: dates[dates.length - 1] || null,
      };
      setADetruire(compte);
      setMotSaisi('');
      return compte;
    } finally {
      setComptageEnCours(false);
    }
  };

  /* ─── Run all steps ─── */
  const runFullImport = () => verrouImport.executerUneSeuleFois('import-admin', async () => {
    // ── LES TROIS GARDES, DANS LA FONCTION ──
    // Un bouton grise n'arrete pas un appel deja parti, et une page ouverte
    // dans un second onglet n'a pas le meme etat d'affichage.
    if (user?.role !== 'admin') {
      log('⛔ Import refusé : réservé aux administrateurs.', 'error');
      return;
    }
    if (!aDetruire) {
      log('⛔ Import refusé : le comptage de ce qui sera supprimé n’a pas été fait.', 'error');
      return;
    }
    if (motSaisi.trim() !== MOT_DE_CONFIRMATION) {
      log(`⛔ Import refusé : le mot « ${MOT_DE_CONFIRMATION} » n’a pas été retapé.`, 'error');
      return;
    }

    setRunning(true);
    setLogs([]);
    setStats(null);

    // Trace AVANT la destruction : si l'import echoue au milieu, on saura
    // quand meme qui l'a lance, et sur quel volume.
    await logAction('import_massif', 'admin_import', {
      entityLabel: 'Import administrateur — suppression puis réimport',
      details: `${aDetruire.rapports} rapports, ${aDetruire.produits} articles de stock, `
        + `${aDetruire.mouvements_stock} mouvements de stock supprimés `
        + `(rapports du ${aDetruire.premiere_date || '?'} au ${aDetruire.derniere_date || '?'})`,
      metadata: aDetruire,
    });
    log(`⚠️ Suppression confirmée par ${user?.prenom || ''} ${user?.nom || ''} : `
      + `${aDetruire.total} lignes vont être détruites.`, 'warn');

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
      // Le mot doit etre retape pour toute execution suivante.
      setMotSaisi('');
      setADetruire(null);
    }
  });

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

      {/* Action — en deux temps : compter, puis confirmer en toutes lettres */}
      <div className="flex gap-3">
        <Button
          size="lg"
          variant="outline"
          className="gap-2"
          onClick={compterCeQuiSeraDetruit}
          disabled={running || comptageEnCours}
        >
          {comptageEnCours ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Comptage…</>
          ) : (
            <><ListChecks className="h-4 w-4" /> Compter ce qui sera supprimé</>
          )}
        </Button>
      </div>

      {/* Confirmation — nomme ce qui va etre detruit, et combien de lignes */}
      {aDetruire && (
        <Card className="border-red-400 bg-red-50">
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-red-800 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Cet import va supprimer définitivement {fmt(aDetruire.total)} lignes
            </h3>
            <ul className="text-sm text-red-700 space-y-0.5">
              <li>
                • <strong>{fmt(aDetruire.rapports)} rapports journaliers</strong>
                {aDetruire.premiere_date
                  ? ` — du ${aDetruire.premiere_date} au ${aDetruire.derniere_date}`
                  : ''}
              </li>
              <li>• <strong>{fmt(aDetruire.produits)} articles de stock</strong></li>
              <li>• <strong>{fmt(aDetruire.mouvements_stock)} mouvements de stock</strong> (tout l’historique)</li>
            </ul>
            <p className="text-sm text-red-800">
              Cette suppression est <strong>irréversible</strong> et il n’existe aucune annulation.
              Pour continuer, retapez le mot <strong>{MOT_DE_CONFIRMATION}</strong> ci-dessous.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                className="max-w-[220px] bg-white"
                value={motSaisi}
                onChange={(e) => setMotSaisi(e.target.value)}
                placeholder={MOT_DE_CONFIRMATION}
                aria-label={`Retapez ${MOT_DE_CONFIRMATION} pour confirmer`}
              />
              <Button
                size="lg"
                variant="destructive"
                className="gap-2"
                onClick={runFullImport}
                disabled={running || motSaisi.trim() !== MOT_DE_CONFIRMATION}
              >
                {running ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {step}</>
                ) : (
                  <><Upload className="h-4 w-4" /> Supprimer et lancer l&apos;import</>
                )}
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={() => { setADetruire(null); setMotSaisi(''); }}
                disabled={running}
              >
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
