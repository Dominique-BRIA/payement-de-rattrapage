const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares globaux ──────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Fichiers statiques (frontend) ──────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Routes API ──────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/auth',      require('./routes/forgot-password'));
app.use('/api/paiements', require('./routes/paiements'));
app.use('/api/recus',     require('./routes/recus'));
app.use('/api/etudiants', require('./routes/etudiants'));
app.use('/api',           require('./routes/catalogue'));

// ── Route de santé ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Serveur opérationnel ✅', timestamp: new Date() });
});

// ── Fallback vers index.html (SPA) ─────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Démarrage ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📁 Frontend servi sur http://localhost:${PORT}`);
  console.log(`🔌 API disponible sur http://localhost:${PORT}/api\n`);
});

module.exports = app;
