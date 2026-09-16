#!/usr/bin/env node
/**
 * Script de test local de l'integration SingPay.
 *
 * Charge les credentials depuis .env.local et :
 *  1. Verifie qu'on peut recuperer les infos du portefeuille (auth OK)
 *  2. Permet de lancer un paiement Airtel ou Moov (USSD push)
 *  3. Permet de generer un lien de paiement externe (ext)
 *  4. Permet de checker le statut d'une transaction
 *
 * Usage :
 *   node scripts/test-singpay.mjs portefeuille
 *   node scripts/test-singpay.mjs airtel 1000 077000000
 *   node scripts/test-singpay.mjs moov 1000 062000000
 *   node scripts/test-singpay.mjs ext 1000
 *   node scripts/test-singpay.mjs status OGO-xxx-xxx
 */
import { readFileSync } from 'node:fs';

// ── Charge .env.local manuellement (pas de dotenv)
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch (e) {
  console.error('Erreur lecture .env.local:', e.message);
}

const BASE = process.env.SINGPAY_BASE_URL || 'https://gateway.singpay.ga/v1';
const HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-client-id': process.env.SINGPAY_CLIENT_ID,
  'x-client-secret': process.env.SINGPAY_CLIENT_SECRET,
  'x-wallet': process.env.SINGPAY_WALLET_ID,
});

function check() {
  for (const k of ['SINGPAY_CLIENT_ID', 'SINGPAY_CLIENT_SECRET', 'SINGPAY_WALLET_ID']) {
    if (!process.env[k]) {
      console.error(`❌ ${k} manquant dans .env.local`);
      process.exit(1);
    }
  }
}

async function portefeuille() {
  const url = `${BASE}/portefeuille/api/${process.env.SINGPAY_WALLET_ID}`;
  console.log('GET', url);
  const r = await fetch(url, { headers: HEADERS() });
  const data = await r.json().catch(() => null);
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(data, null, 2));
  return r.ok;
}

async function paiement(operateur, amount, msisdn) {
  const code = operateur === 'airtel' ? '74' : '62';
  const url = `${BASE}/${code}/paiement`;
  const reference = `TEST-${Date.now()}`;
  const body = {
    amount: Number(amount),
    reference,
    client_msisdn: msisdn,
    portefeuille: process.env.SINGPAY_WALLET_ID,
    isTransfer: false,
  };
  console.log('POST', url);
  console.log('Body:', body);
  const r = await fetch(url, {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(data, null, 2));
  console.log('\n🔑 Reference a noter pour suivi:', reference);
}

async function ext(amount) {
  const url = `${BASE}/ext`;
  const reference = `TEST-EXT-${Date.now()}`;
  const body = {
    portefeuille: process.env.SINGPAY_WALLET_ID,
    reference,
    amount: Number(amount),
    redirect_success: 'https://imprimerie-ogooue-app.vercel.app/client/commandes?paiement=success',
    redirect_error: 'https://imprimerie-ogooue-app.vercel.app/client/commandes?paiement=error',
    isTransfer: false,
  };
  console.log('POST', url);
  console.log('Body:', body);
  const r = await fetch(url, {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(data, null, 2));
  if (data?.link) console.log('\n🔗 Ouvre ce lien pour payer:', data.link);
}

async function status(reference) {
  const url = `${BASE}/transaction/api/search/by-reference/${encodeURIComponent(reference)}`;
  console.log('GET', url);
  const r = await fetch(url, { headers: HEADERS() });
  const data = await r.json().catch(() => null);
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(data, null, 2));
}

/**
 * LECTURE SEULE — compare l'adresse de rappel réellement enregistrée dans le
 * portefeuille SingPay à celle attendue (SINGPAY_CALLBACK_URL).
 *
 * C'est le seul contrôle qui dit si le webhook peut fonctionner : l'adresse ne
 * se transmet pas dans la requête de paiement, elle vit dans le portefeuille.
 * Le champ s'appelle `callbackURL` — nom relevé dans la réponse de la
 * passerelle elle-même, pas déduit.
 */
async function verifier() {
  const url = `${BASE}/portefeuille/api/${process.env.SINGPAY_WALLET_ID}`;
  const r = await fetch(url, { headers: HEADERS() });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    console.error(`❌ Lecture du portefeuille impossible (HTTP ${r.status})`);
    return;
  }
  const p = data?.portefeuille || data?.data || data || {};
  const enregistree = p.callbackURL || p.callback_url || null;
  const attendue = process.env.SINGPAY_CALLBACK_URL
    || 'https://imprimerie-ogooue-app.vercel.app/api/singpay-callback';

  console.log('Portefeuille   :', p.nom || '(sans nom)');
  console.log('goLive         :', p.goLive, p.goLive === 'Wait' ? '  ⚠️  PORTEFEUILLE DE TEST — aucun encaissement réel' : '');
  console.log('Airtel         :', p.airtel_status, p.airtel_marchant_code);
  console.log('Moov           :', p.moov_money_merchant_code);
  console.log('callbackURL    :', enregistree || '(vide)');
  console.log('attendue       :', attendue);

  if (!enregistree) {
    console.log('\n❌ Aucune adresse de rappel enregistrée : le webhook ne sera JAMAIS appelé.');
    console.log('   Corriger avec : node scripts/test-singpay.mjs callback');
  } else if (enregistree.split('?')[0] !== attendue.split('?')[0]) {
    console.log('\n❌ ÉCART : le rappel part ailleurs que sur cette application.');
  } else if (process.env.SINGPAY_CALLBACK_SECRET && !enregistree.includes('token=')) {
    console.log('\n⚠️  SINGPAY_CALLBACK_SECRET est posé mais l\'URL enregistrée ne porte pas de `?token=`.');
    console.log('   Les rappels seront REJETÉS en 401. Régler l\'URL avec le jeton AVANT de poser la variable.');
  } else {
    console.log('\n✅ Adresse de rappel cohérente.');
  }
}

async function setCallback(url) {
  const endpoint = `${BASE}/portefeuille/api/${process.env.SINGPAY_WALLET_ID}`;
  console.log('PUT', endpoint);
  console.log('Body:', { callbackURL: url });
  const r = await fetch(endpoint, {
    method: 'PUT',
    headers: HEADERS(),
    body: JSON.stringify({ callbackURL: url }),
  });
  const data = await r.json().catch(() => null);
  console.log('Status:', r.status);
  console.log('Body:', JSON.stringify(data, null, 2));
}

// ── CLI
check();
const [cmd, ...args] = process.argv.slice(2);
const map = {
  portefeuille: () => portefeuille(),
  airtel: () => paiement('airtel', args[0], args[1]),
  moov: () => paiement('moov', args[0], args[1]),
  ext: () => ext(args[0]),
  status: () => status(args[0]),
  verifier: () => verifier(),
  callback: () => setCallback(args[0] || process.env.SINGPAY_CALLBACK_URL),
};

if (!map[cmd]) {
  console.log(`Usage:
  node scripts/test-singpay.mjs portefeuille
  node scripts/test-singpay.mjs airtel <montant> <msisdn>
  node scripts/test-singpay.mjs moov   <montant> <msisdn>
  node scripts/test-singpay.mjs ext    <montant>
  node scripts/test-singpay.mjs status <reference>
  node scripts/test-singpay.mjs verifier            (lecture seule : adresse de rappel + état du portefeuille)
  node scripts/test-singpay.mjs callback [url]      (ÉCRITURE : règle l'adresse de rappel du portefeuille)`);
  process.exit(0);
}
await map[cmd]();
