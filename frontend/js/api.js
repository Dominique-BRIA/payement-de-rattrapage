// =============================================
// api.js — Utilitaires API & Auth
// =============================================

const API_BASE = window.location.origin + '/api';
// ── Stockage Token ──────────────────────────
const Auth = {
  setToken: (token) => localStorage.setItem('rp_token', token),
  getToken: () => localStorage.getItem('rp_token'),
  setUser: (user) => localStorage.setItem('rp_user', JSON.stringify(user)),
  getUser: () => JSON.parse(localStorage.getItem('rp_user') || 'null'),
  setRole: (role) => localStorage.setItem('rp_role', role),
  getRole: () => localStorage.getItem('rp_role'),
  logout: () => {
    localStorage.removeItem('rp_token');
    localStorage.removeItem('rp_user');
    localStorage.removeItem('rp_role');
    window.location.href = '/index.html';
  },
  requireAuth: (allowedRoles = []) => {
    const token = Auth.getToken();
    const role = Auth.getRole();
    if (!token) { window.location.href = '/index.html'; return false; }
    if (allowedRoles.length && !allowedRoles.includes(role)) {
      window.location.href = '/index.html';
      return false;
    }
    return true;
  }
};

// ── Requête HTTP ─────────────────────────────
async function apiRequest(endpoint, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const resp = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || `Erreur ${resp.status}`);
    return data;
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('403')) Auth.logout();
    throw err;
  }
}

const api = {
  get:    (ep) => apiRequest(ep),
  post:   (ep, body) => apiRequest(ep, { method: 'POST', body: JSON.stringify(body) }),
  put:    (ep, body) => apiRequest(ep, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (ep) => apiRequest(ep, { method: 'DELETE' }),
};

// ── Toast Notifications ──────────────────────
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`;
  toast.innerHTML = `${icons[type] || '✅'} ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ── Loading overlay ──────────────────────────
function showLoading(msg = 'Traitement en cours...') {
  const el = document.createElement('div');
  el.className = 'loading-overlay';
  el.id = 'globalLoader';
  el.innerHTML = `<div style="text-align:center;color:white"><div class="spinner" style="margin:0 auto 16px"></div><p style="font-size:.9rem;opacity:.85">${msg}</p></div>`;
  document.body.appendChild(el);
}
function hideLoading() {
  document.getElementById('globalLoader')?.remove();
}

// ── Formater montant FCFA ────────────────────
function formatFCFA(amount) {
  return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
}

// ── Formater date ────────────────────────────
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── Libellé mode paiement ────────────────────
function modePaiement(mode) {
  const m = { cash: '💵 Cash', orange_money: '🟠 Orange Money', mtn_money: '🟡 MTN MoMo' };
  return m[mode] || mode;
}

// ── Badge statut ─────────────────────────────
function badgeStatut(statut) {
  const b = {
    valide: '<span class="badge badge-success">Validé</span>',
    en_attente: '<span class="badge badge-warning">En attente</span>',
    echoue: '<span class="badge badge-danger">Échoué</span>',
    annule: '<span class="badge badge-gray">Annulé</span>',
  };
  return b[statut] || statut;
}

// ── Initialiser avatar/nom dans topbar ───────
function initTopbarUser() {
  const user = Auth.getUser();
  if (!user) return;
  const avatarEl = document.getElementById('userAvatar');
  const nameEl = document.getElementById('userName');
  if (avatarEl) avatarEl.textContent = (user.prenom?.[0] || '') + (user.nom?.[0] || user.matricule?.[0] || '');
  if (nameEl) nameEl.textContent = user.prenom ? `${user.prenom} ${user.nom}` : user.matricule;
}
