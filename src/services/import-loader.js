/**
 * Charge les données importées d'Excel (/import-data.json) dans la base.
 * Appelée une fois au démarrage de l'application.
 *
 * ── MESURE DU 2026-09-17, avant de toucher quoi que ce soit ───────────────
 *
 * Ce fichier ne peut RIEN écrire en production aujourd'hui, pour deux raisons
 * cumulées, toutes deux vérifiées :
 *   - `public/import-data.json` n'existe pas dans le dépôt ;
 *   - `vercel.json` réécrit toute URL hors `/api/` vers `/index.html`, donc
 *     `/import-data.json` répond 200 avec du HTML, et `resp.json()` échoue.
 *
 * Le rejeu constaté sur les comptes et sur l'inventaire ne vient donc pas d'ici.
 * Mais le défaut de forme, lui, est le même — et le jour où quelqu'un dépose ce
 * fichier dans `public/`, il s'exprimerait : la déduplication par `date` et par
 * `nom` s'appuyait sur `list()`, qui rend `[]` sur une lecture ratée. Les 237
 * rapports de la base auraient alors été réécrits en double.
 *
 * Deux corrections, les mêmes que partout ailleurs :
 *   1. `listOuLeve()` : une lecture ratée lève, et rien n'est écrit ;
 *   2. l'échec est JOURNALISÉ. Le `catch {}` muet d'origine rendait un import
 *      raté indiscernable d'un import réussi.
 */
import { db } from './db';
import { estErreurLecture } from './erreur-lecture';
import { normaliserCle } from './amorcage-idempotent';

export async function loadImportedData() {
  let data;
  try {
    const resp = await fetch('/import-data.json');
    if (!resp.ok) return; // Le fichier n'existe pas — cas normal.
    data = await resp.json();
  } catch {
    // Fichier absent, ou réécrit en index.html par l'hébergeur : rien à importer.
    return;
  }

  try {
    if (data?.rapports?.length) {
      // Clé naturelle : la date du rapport. Un rapport déjà présent n'est jamais
      // réécrit ; un rapport manquant est ajouté, et lui seul.
      const existing = await db.rapports.listOuLeve();
      const datesPresentes = new Set(existing.map((r) => normaliserCle(r.date)).filter(Boolean));

      for (const r of data.rapports) {
        const cle = normaliserCle(r.date);
        if (!cle || datesPresentes.has(cle)) continue;
        await db.rapports.create(r);
        datesPresentes.add(cle);
      }
    }

    if (data?.produits?.length) {
      // Clé naturelle : le nom de l'article.
      const existing = await db.produits.listOuLeve();
      const nomsPresents = new Set(existing.map((p) => normaliserCle(p.nom)).filter(Boolean));

      for (const p of data.produits) {
        const cle = normaliserCle(p.nom);
        if (!cle || nomsPresents.has(cle)) continue;
        await db.produits.create(p);
        nomsPresents.add(cle);
      }
    }

    console.log('[import] Données Excel vérifiées');
  } catch (e) {
    // Une lecture ratée n'autorise AUCUNE écriture : on sort en le disant.
    console.error(
      estErreurLecture(e)
        ? `[import] import abandonné — ${e.collection} illisible : ${e.causeTexte || 'cause inconnue'}`
        : `[import] import abandonné : ${e?.message || e}`,
    );
  }
}
