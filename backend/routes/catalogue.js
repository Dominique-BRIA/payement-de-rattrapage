const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');

// ─────────────────────────────────────
// FILIÈRES
// ─────────────────────────────────────

// GET /api/filieres — Toutes les filières
router.get('/filieres', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM filieres ORDER BY nom');
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/filieres — Créer une filière (admin)
router.post('/filieres', authMiddleware, requireRole('admin'), async (req, res) => {
  const { code, nom, niveau } = req.body;
  if (!code || !nom) return res.status(400).json({ success: false, message: 'Code et nom requis.' });

  try {
    const [result] = await db.query(
      'INSERT INTO filieres (code, nom, niveau) VALUES (?, ?, ?)',
      [code, nom, niveau || 'Licence']
    );
    res.status(201).json({ success: true, message: 'Filière créée.', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'Ce code de filière existe déjà.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/filieres/:id — Modifier une filière (admin)
router.put('/filieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nom, niveau } = req.body;
  try {
    await db.query('UPDATE filieres SET nom=?, niveau=? WHERE id=?', [nom, niveau, req.params.id]);
    res.json({ success: true, message: 'Filière mise à jour.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/filieres/:id — Supprimer une filière (admin)
router.delete('/filieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM filieres WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Filière supprimée.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────
// MATIÈRES
// ─────────────────────────────────────

// GET /api/matieres — Toutes les matières (avec filtre filière)
router.get('/matieres', async (req, res) => {
  const { filiere_id } = req.query;
  try {
    let query = `
      SELECT m.*, f.nom AS filiere_nom
      FROM matieres m
      LEFT JOIN filieres f ON m.filiere_id = f.id
      WHERE m.actif = TRUE
    `;
    const params = [];
    if (filiere_id) {
      query += ' AND m.filiere_id = ?';
      params.push(filiere_id);
    }
    query += ' ORDER BY m.libelle';
    const [rows] = await db.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/matieres — Créer une matière (admin)
router.post('/matieres', authMiddleware, requireRole('admin'), async (req, res) => {
  const { code, libelle, credits, frais, filiere_id, semestre } = req.body;
  if (!code || !libelle || !frais)
    return res.status(400).json({ success: false, message: 'Code, libellé et frais requis.' });

  try {
    const [result] = await db.query(
      'INSERT INTO matieres (code, libelle, credits, frais, filiere_id, semestre) VALUES (?,?,?,?,?,?)',
      [code, libelle, credits || 3, frais, filiere_id || null, semestre || 'S1']
    );
    res.status(201).json({ success: true, message: 'Matière créée.', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'Ce code de matière existe déjà.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/matieres/:id — Modifier une matière (admin)
router.put('/matieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { libelle, credits, frais, filiere_id, semestre, actif } = req.body;
  try {
    await db.query(
      'UPDATE matieres SET libelle=?, credits=?, frais=?, filiere_id=?, semestre=?, actif=? WHERE id=?',
      [libelle, credits, frais, filiere_id, semestre, actif !== undefined ? actif : true, req.params.id]
    );
    res.json({ success: true, message: 'Matière mise à jour.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/matieres/:id — Désactiver une matière (admin)
router.delete('/matieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.query('UPDATE matieres SET actif=FALSE WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Matière désactivée.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;