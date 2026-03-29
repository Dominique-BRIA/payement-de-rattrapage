const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');
require('dotenv').config();

const genRef = () => 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();

// ─────────────────────────────────────────────────────────
// POST /api/paiements/mobile-callback — CamPay SDK callback
// ─────────────────────────────────────────────────────────
router.post('/mobile-callback', authMiddleware, async (req, res) => {
  const { etudiant_id, matieres_ids, mode_paiement, reference_campay } = req.body;
  if (!etudiant_id || !matieres_ids?.length || !reference_campay)
    return res.status(400).json({ success: false, message: 'Données incomplètes.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const placeholders = matieres_ids.map((_, i) => `$${i+1}`).join(',');
    const matResult = await client.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );
    const matieres = matResult.rows;
    const total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);

    const pResult = await client.query(
      `INSERT INTO paiements (reference, etudiant_id, montant_total, mode_paiement, statut, transaction_id)
       VALUES ($1,$2,$3,$4,'valide',$5) RETURNING id`,
      [reference_campay, etudiant_id, total, mode_paiement || 'orange_money', reference_campay]
    );
    const paiement_id = pResult.rows[0].id;

    for (const m of matieres) {
      await client.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES ($1,$2,$3)',
        [paiement_id, m.id, m.frais]
      );
    }

    const numero_recu = 'REC-' + Date.now();
    await client.query(
      'INSERT INTO recus (numero_recu, paiement_id, libelle) VALUES ($1,$2,$3)',
      [numero_recu, paiement_id, `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Paiement enregistré.', data: { reference: reference_campay, numero_recu, montant_total: total } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[mobile-callback]', err);
    res.status(500).json({ success: false, message: 'Erreur enregistrement paiement.' });
  } finally { client.release(); }
});

// ─────────────────────────────────────────────────────────
// POST /api/paiements/cash — Paiement Cash agent
// ─────────────────────────────────────────────────────────
router.post('/cash', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { etudiant_id, matieres_ids, remarque } = req.body;
  const agent_id = req.user.id;
  if (!etudiant_id || !matieres_ids?.length)
    return res.status(400).json({ success: false, message: 'Étudiant et matières requis.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const placeholders = matieres_ids.map((_, i) => `$${i+1}`).join(',');
    const matResult = await client.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );
    const matieres = matResult.rows;
    const total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);
    const reference = genRef();

    const pResult = await client.query(
      `INSERT INTO paiements (reference, etudiant_id, montant_total, mode_paiement, statut, agent_id, remarque)
       VALUES ($1,$2,$3,'cash','valide',$4,$5) RETURNING id`,
      [reference, etudiant_id, total, agent_id, remarque || null]
    );
    const paiement_id = pResult.rows[0].id;

    for (const m of matieres) {
      await client.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES ($1,$2,$3)',
        [paiement_id, m.id, m.frais]
      );
    }

    const etudResult = await client.query(
      `SELECT e.*, f.nom AS filiere_nom FROM etudiants e
       LEFT JOIN filieres f ON e.filiere_id = f.id WHERE e.id = $1`,
      [etudiant_id]
    );
    const etudiant = etudResult.rows[0];

    const numero_recu = 'REC-' + Date.now();
    await client.query(
      'INSERT INTO recus (numero_recu, paiement_id, agent_id, libelle) VALUES ($1,$2,$3,$4)',
      [numero_recu, paiement_id, agent_id, `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true, message: 'Paiement cash enregistré.',
      data: {
        reference, montant_total: total, numero_recu,
        etudiant: { nom: etudiant.nom, prenom: etudiant.prenom, matricule: etudiant.matricule, telephone: etudiant.telephone, filiere: etudiant.filiere_nom },
        matieres: matieres.map(m => ({ id: m.id, libelle: m.libelle, frais: m.frais }))
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /cash]', err);
    res.status(500).json({ success: false, message: 'Erreur enregistrement.' });
  } finally { client.release(); }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements — Liste des paiements
// ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { statut, mode, etudiant_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const conditions = [], params = [];
    if (statut)      { params.push(statut);      conditions.push(`p.statut = $${params.length}`); }
    if (mode)        { params.push(mode);         conditions.push(`p.mode_paiement = $${params.length}`); }
    if (etudiant_id) { params.push(etudiant_id);  conditions.push(`p.etudiant_id = $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const result = await db.query(
      `SELECT p.*, CONCAT(e.prenom, ' ', e.nom) AS etudiant_nom, e.matricule,
              CONCAT(u.prenom, ' ', u.nom) AS agent_nom, r.numero_recu
       FROM paiements p
       LEFT JOIN etudiants e    ON p.etudiant_id = e.id
       LEFT JOIN utilisateurs u ON p.agent_id    = u.id
       LEFT JOIN recus r        ON r.paiement_id = p.id
       ${where} ORDER BY p.created_at DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await db.query(`SELECT COUNT(*) FROM paiements p ${where}`, countParams);

    res.json({ success: true, data: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements/etudiant/:id — Historique étudiant
// ─────────────────────────────────────────────────────────
router.get('/etudiant/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, r.numero_recu,
              STRING_AGG(m.libelle, ', ') AS matieres
       FROM paiements p
       LEFT JOIN recus r              ON r.paiement_id  = p.id
       LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
       LEFT JOIN matieres m           ON pm.matiere_id  = m.id
       WHERE p.etudiant_id = $1
       GROUP BY p.id, r.numero_recu
       ORDER BY p.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements/stats — Statistiques
// ─────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  try {
    const totaux = await db.query(`
      SELECT
        COUNT(*) AS total_paiements,
        SUM(CASE WHEN statut='valide' THEN montant_total ELSE 0 END) AS montant_total_valide,
        SUM(CASE WHEN statut='valide' AND mode_paiement='cash'         THEN montant_total ELSE 0 END) AS montant_cash,
        SUM(CASE WHEN statut='valide' AND mode_paiement='orange_money' THEN montant_total ELSE 0 END) AS montant_orange,
        SUM(CASE WHEN statut='valide' AND mode_paiement='mtn_money'    THEN montant_total ELSE 0 END) AS montant_mtn,
        COUNT(DISTINCT etudiant_id) AS nb_etudiants
      FROM paiements WHERE statut='valide'
    `);
    const parJour = await db.query(`
      SELECT DATE(created_at) AS jour, SUM(montant_total) AS total
      FROM paiements
      WHERE statut='valide' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at) ORDER BY jour
    `);
    res.json({ success: true, data: { totaux: totaux.rows[0], parJour: parJour.rows } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
