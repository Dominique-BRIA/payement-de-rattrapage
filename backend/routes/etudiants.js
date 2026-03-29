const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');

router.get('/', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { search, filiere_id } = req.query;
  try {
    let conditions = [], params = [];
    if (search) {
      conditions.push(`(e.matricule ILIKE $${params.length+1} OR e.nom ILIKE $${params.length+1} OR e.prenom ILIKE $${params.length+1})`);
      params.push(`%${search}%`);
    }
    if (filiere_id) { conditions.push(`e.filiere_id = $${params.length+1}`); params.push(filiere_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await db.query(
      `SELECT e.*, f.nom AS filiere_nom FROM etudiants e
       LEFT JOIN filieres f ON e.filiere_id = f.id ${where} ORDER BY e.nom LIMIT 100`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, f.nom AS filiere_nom, f.code AS filiere_code
       FROM etudiants e LEFT JOIN filieres f ON e.filiere_id = f.id WHERE e.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { matricule, nom, prenom, email, telephone, filiere_id, niveau } = req.body;
  if (!matricule || !nom || !prenom || !telephone)
    return res.status(400).json({ success: false, message: 'Champs obligatoires manquants.' });
  try {
    const result = await db.query(
      'INSERT INTO etudiants (matricule, nom, prenom, email, telephone, filiere_id, niveau) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [matricule, nom, prenom, email || null, telephone, filiere_id || null, niveau || 'L1']
    );
    res.status(201).json({ success: true, message: 'Étudiant créé.', id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Ce matricule ou email existe déjà.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nom, prenom, email, telephone, filiere_id, niveau } = req.body;
  try {
    await db.query(
      'UPDATE etudiants SET nom=$1, prenom=$2, email=$3, telephone=$4, filiere_id=$5, niveau=$6 WHERE id=$7',
      [nom, prenom, email, telephone, filiere_id, niveau, req.params.id]
    );
    res.json({ success: true, message: 'Étudiant mis à jour.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
