const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');

// GET /api/etudiants — Liste (agent/admin)
router.get('/', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { search, filiere_id } = req.query;
  try {
    let where = [];
    let params = [];
    if (search) {
      where.push('(e.matricule LIKE ? OR e.nom LIKE ? OR e.prenom LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filiere_id) { where.push('e.filiere_id = ?'); params.push(filiere_id); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT e.*, f.nom AS filiere_nom
       FROM etudiants e LEFT JOIN filieres f ON e.filiere_id = f.id
       ${whereClause} ORDER BY e.nom LIMIT 100`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/etudiants/:id — Détail étudiant
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*, f.nom AS filiere_nom, f.code AS filiere_code
       FROM etudiants e LEFT JOIN filieres f ON e.filiere_id = f.id WHERE e.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/etudiants — Créer un étudiant (admin)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { matricule, nom, prenom, email, telephone, filiere_id, niveau } = req.body;
  if (!matricule || !nom || !prenom || !telephone)
    return res.status(400).json({ success: false, message: 'Champs obligatoires manquants.' });
  try {
    const [result] = await db.query(
      'INSERT INTO etudiants (matricule, nom, prenom, email, telephone, filiere_id, niveau) VALUES (?,?,?,?,?,?,?)',
      [matricule, nom, prenom, email || null, telephone, filiere_id || null, niveau || 'L1']
    );
    res.status(201).json({ success: true, message: 'Étudiant créé.', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'Ce matricule ou email existe déjà.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/etudiants/:id — Modifier un étudiant (admin)
router.put('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nom, prenom, email, telephone, filiere_id, niveau } = req.body;
  try {
    await db.query(
      'UPDATE etudiants SET nom=?, prenom=?, email=?, telephone=?, filiere_id=?, niveau=? WHERE id=?',
      [nom, prenom, email, telephone, filiere_id, niveau, req.params.id]
    );
    res.json({ success: true, message: 'Étudiant mis à jour.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;