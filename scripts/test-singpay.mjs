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
  callback: () => setCallback(args[0] || process.env.SINGPAY_CALLBACK_URL),
};

if (!map[cmd]) {
  console.log(`Usage:
  node scripts/test-singpay.mjs portefeuille
  node scripts/test-singpay.mjs airtel <montant> <msisdn>
  node scripts/test-singpay.mjs moov   <montant> <msisdn>
  node scripts/test-singpay.mjs ext    <montant>
  node scripts/test-singpay.mjs status <reference>
  node scripts/test-singpay.mjs callback [url]`);
  process.exit(0);
}
await map[cmd]();
