const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');

// ── FILIÈRES ──────────────────────────────────────────────

router.get('/filieres', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM filieres ORDER BY nom');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/filieres', authMiddleware, requireRole('admin'), async (req, res) => {
  const { code, nom, niveau } = req.body;
  if (!code || !nom) return res.status(400).json({ success: false, message: 'Code et nom requis.' });
  try {
    const result = await db.query(
      'INSERT INTO filieres (code, nom, niveau) VALUES ($1, $2, $3) RETURNING id',
      [code, nom, niveau || 'Licence']
    );
    res.status(201).json({ success: true, message: 'Filière créée.', id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Ce code existe déjà.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/filieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nom, niveau } = req.body;
  try {
    await db.query('UPDATE filieres SET nom=$1, niveau=$2 WHERE id=$3', [nom, niveau, req.params.id]);
    res.json({ success: true, message: 'Filière mise à jour.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/filieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM filieres WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Filière supprimée.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── MATIÈRES ──────────────────────────────────────────────

router.get('/matieres', async (req, res) => {
  const { filiere_id } = req.query;
  try {
    let query = `SELECT m.*, f.nom AS filiere_nom FROM matieres m
                 LEFT JOIN filieres f ON m.filiere_id = f.id WHERE m.actif = TRUE`;
    const params = [];
    if (filiere_id) { query += ` AND m.filiere_id = $1`; params.push(filiere_id); }
    query += ' ORDER BY m.libelle';
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/matieres', authMiddleware, requireRole('admin'), async (req, res) => {
  const { code, libelle, credits, frais, filiere_id, semestre } = req.body;
  if (!code || !libelle || !frais)
    return res.status(400).json({ success: false, message: 'Code, libellé et frais requis.' });
  try {
    const result = await db.query(
      'INSERT INTO matieres (code, libelle, credits, frais, filiere_id, semestre) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [code, libelle, credits || 3, frais, filiere_id || null, semestre || 'S1']
    );
    res.status(201).json({ success: true, message: 'Matière créée.', id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Ce code existe déjà.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/matieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { libelle, credits, frais, filiere_id, semestre, actif } = req.body;
  try {
    await db.query(
      'UPDATE matieres SET libelle=$1, credits=$2, frais=$3, filiere_id=$4, semestre=$5, actif=$6 WHERE id=$7',
      [libelle, credits, frais, filiere_id, semestre, actif !== undefined ? actif : true, req.params.id]
    );
    res.json({ success: true, message: 'Matière mise à jour.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/matieres/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.query('UPDATE matieres SET actif=FALSE WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Matière désactivée.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
