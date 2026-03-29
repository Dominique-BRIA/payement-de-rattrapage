// ============================================================
// services/campay.js — Service d'intégration CamPay
// ============================================================
// Doc API : https://documenter.getpostman.com/view/2391374/T1LV8PVA
// Endpoints :
//   POST /token/          → obtenir un token temporaire
//   POST /collect/        → initier un paiement (collect)
//   GET  /transaction/    → vérifier le statut
//   POST /payment-link/   → générer un lien de paiement
// ============================================================

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const CAMPAY_ENV    = process.env.CAMPAY_ENV || 'DEV'; // 'DEV' | 'PROD'
const BASE_URL      = CAMPAY_ENV === 'PROD'
  ? 'https://campay.net/api'
  : 'https://demo.campay.net/api';

// Cache du token temporaire (évite d'en demander un nouveau à chaque requête)
let _tokenCache = { value: null, expiresAt: 0 };

/**
 * Obtenir (ou renouveler) le token CamPay
 */
async function getToken() {
  if (_tokenCache.value && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.value;
  }

  const res = await fetch(`${BASE_URL}/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.CAMPAY_USERNAME,
      password: process.env.CAMPAY_PASSWORD,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CamPay auth failed: ${err}`);
  }

  const data = await res.json();
  _tokenCache = {
    value: data.token,
    expiresAt: Date.now() + 55 * 60 * 1000, // expire dans 55 min (marge)
  };
  return data.token;
}

/**
 * Initier un paiement Mobile Money (USSD push)
 * @param {object} params
 * @param {number|string} params.amount       - Montant entier en FCFA (XAF)
 * @param {string}        params.from         - Numéro du payeur ex: "237699000001"
 * @param {string}        params.description  - Description de la transaction
 * @param {string}        [params.external_reference] - Référence interne (optionnel)
 * @returns {object} { reference, ussd_code, operator }
 */
async function collect({ amount, from, description, external_reference }) {
  const token = await getToken();

  const body = {
    amount: Math.round(amount).toString(), // entier uniquement
    from,
    description,
  };
  if (external_reference) body.external_reference = external_reference;

  const res = await fetch(`${BASE_URL}/collect/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    const msg = data.message || data.error || `Erreur CamPay ${res.status}`;
    throw new Error(mapCampayError(msg));
  }

  return data; // { reference, ussd_code, operator }
}

/**
 * Vérifier le statut d'une transaction
 * @param {string} reference - référence retournée par collect()
 * @returns {object} { reference, status, amount, operator, ... }
 *   status: "SUCCESSFUL" | "FAILED" | "PENDING"
 */
async function getTransactionStatus(reference) {
  const token = await getToken();

  const res = await fetch(`${BASE_URL}/transaction/${reference}/`, {
    method: 'GET',
    headers: {
      Authorization: `Token ${token}`,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Erreur statut CamPay`);
  return data;
}

/**
 * Générer un lien de paiement (alternative sans USSD push)
 * Utile quand le numéro n'est pas connu à l'avance.
 */
async function getPaymentLink({
  amount, description, external_reference,
  from = '', first_name = '', last_name = '', email = '',
  redirect_url, failure_redirect_url,
}) {
  const token = await getToken();

  const res = await fetch(`${BASE_URL}/get-payment-link/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({
      amount: Math.round(amount).toString(),
      currency: 'XAF',
      description,
      external_reference,
      from,
      first_name,
      last_name,
      email,
      redirect_url: redirect_url || `${process.env.APP_URL}/paiement.html?status=success`,
      failure_redirect_url: failure_redirect_url || `${process.env.APP_URL}/paiement.html?status=failed`,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.message || 'Erreur lien CamPay');
  return data; // { link }
}

/**
 * Mapper les codes d'erreur CamPay en messages français lisibles
 */
function mapCampayError(msg) {
  if (!msg) return 'Erreur de paiement inconnue.';
  if (msg.includes('ER101')) return 'Numéro de téléphone invalide. Vérifiez le format (237XXXXXXXXX).';
  if (msg.includes('ER102')) return 'Opérateur non supporté. Seuls MTN et Orange sont acceptés.';
  if (msg.includes('ER201')) return 'Montant invalide.';
  if (msg.includes('ER301')) return 'Solde insuffisant sur le compte CamPay.';
  return msg;
}

module.exports = { collect, getTransactionStatus, getPaymentLink, getToken };
