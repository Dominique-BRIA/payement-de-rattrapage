const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { v4: uuidv4 } = require('uuid');

// Génère une référence unique
const genRef = () => 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();

// ─────────────────────────────────────────────────────────
// POST /api/paiements/mobile — Paiement Mobile Money (étudiant)
// ─────────────────────────────────────────────────────────
router.post('/mobile', authMiddleware, async (req, res) => {
  const { etudiant_id, matieres_ids, mode_paiement, numero_mobile } = req.body;

  if (!etudiant_id || !matieres_ids?.length || !mode_paiement || !numero_mobile) {
    return res.status(400).json({ success: false, message: 'Données incomplètes.' });
  }

  if (!['orange_money', 'mtn_money'].includes(mode_paiement)) {
    return res.status(400).json({ success: false, message: 'Mode de paiement invalide.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Récupérer les frais des matières sélectionnées
    const placeholders = matieres_ids.map(() => '?').join(',');
    const [matieres] = await conn.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );

    if (matieres.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Aucune matière valide trouvée.' });
    }

    const montant_total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);
    const reference = genRef();

    // Simuler l'appel API Mobile Money
    const transactionSimulee = await simulerPaiementMobileMoney(mode_paiement, numero_mobile, montant_total);

    if (!transactionSimulee.success) {
      await conn.rollback();
      return res.status(402).json({ success: false, message: transactionSimulee.message });
    }

    // Enregistrer le paiement
    const [paiementResult] = await conn.query(
      `INSERT INTO paiements (reference, etudiant_id, montant_total, mode_paiement, statut, numero_mobile, transaction_id)
       VALUES (?, ?, ?, ?, 'valide', ?, ?)`,
      [reference, etudiant_id, montant_total, mode_paiement, numero_mobile, transactionSimulee.transaction_id]
    );

    const paiement_id = paiementResult.insertId;

    // Lier les matières au paiement
    for (const matiere of matieres) {
      await conn.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES (?, ?, ?)',
        [paiement_id, matiere.id, matiere.frais]
      );
    }

    // Générer le reçu automatiquement
    const numero_recu = 'REC-' + Date.now();
    const libelle = `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`;
    await conn.query(
      'INSERT INTO recus (numero_recu, paiement_id, libelle) VALUES (?, ?, ?)',
      [numero_recu, paiement_id, libelle]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'Paiement effectué avec succès.',
      data: {
        reference,
        montant_total,
        transaction_id: transactionSimulee.transaction_id,
        numero_recu,
        matieres: matieres.map(m => ({ id: m.id, libelle: m.libelle, frais: m.frais }))
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur lors du paiement.' });
  } finally {
    conn.release();
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/paiements/cash — Paiement Cash par agent
// ─────────────────────────────────────────────────────────
router.post('/cash', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { etudiant_id, matieres_ids, remarque } = req.body;
  const agent_id = req.user.id;

  if (!etudiant_id || !matieres_ids?.length) {
    return res.status(400).json({ success: false, message: 'Étudiant et matières requis.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const placeholders = matieres_ids.map(() => '?').join(',');
    const [matieres] = await conn.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );

    const montant_total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);
    const reference = genRef();

    const [paiementResult] = await conn.query(
      `INSERT INTO paiements (reference, etudiant_id, montant_total, mode_paiement, statut, agent_id, remarque)
       VALUES (?, ?, ?, 'cash', 'valide', ?, ?)`,
      [reference, etudiant_id, montant_total, agent_id, remarque || null]
    );

    const paiement_id = paiementResult.insertId;

    for (const matiere of matieres) {
      await conn.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES (?, ?, ?)',
        [paiement_id, matiere.id, matiere.frais]
      );
    }

    // Récupérer infos étudiant pour le reçu
    const [etudiantRows] = await conn.query(
      `SELECT e.*, f.nom AS filiere_nom FROM etudiants e
       LEFT JOIN filieres f ON e.filiere_id = f.id WHERE e.id = ?`,
      [etudiant_id]
    );
    const etudiant = etudiantRows[0];

    const numero_recu = 'REC-' + Date.now();
    const libelle = `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`;
    await conn.query(
      'INSERT INTO recus (numero_recu, paiement_id, agent_id, libelle) VALUES (?, ?, ?, ?)',
      [numero_recu, paiement_id, agent_id, libelle]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'Paiement cash enregistré.',
      data: {
        reference,
        montant_total,
        numero_recu,
        etudiant: {
          nom: etudiant.nom,
          prenom: etudiant.prenom,
          matricule: etudiant.matricule,
          filiere: etudiant.filiere_nom
        },
        matieres: matieres.map(m => ({ id: m.id, libelle: m.libelle, frais: m.frais }))
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement.' });
  } finally {
    conn.release();
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements — Liste des paiements (agent/admin)
// ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { statut, mode, etudiant_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let where = [];
    let params = [];

    if (statut) { where.push('p.statut = ?'); params.push(statut); }
    if (mode) { where.push('p.mode_paiement = ?'); params.push(mode); }
    if (etudiant_id) { where.push('p.etudiant_id = ?'); params.push(etudiant_id); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT p.*, 
              CONCAT(e.prenom, ' ', e.nom) AS etudiant_nom, e.matricule,
              CONCAT(u.prenom, ' ', u.nom) AS agent_nom,
              r.numero_recu
       FROM paiements p
       LEFT JOIN etudiants e ON p.etudiant_id = e.id
       LEFT JOIN utilisateurs u ON p.agent_id = u.id
       LEFT JOIN recus r ON r.paiement_id = p.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM paiements p ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements/etudiant/:id — Historique d'un étudiant
// ─────────────────────────────────────────────────────────
router.get('/etudiant/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, r.numero_recu,
              GROUP_CONCAT(m.libelle SEPARATOR ', ') AS matieres
       FROM paiements p
       LEFT JOIN recus r ON r.paiement_id = p.id
       LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
       LEFT JOIN matieres m ON pm.matiere_id = m.id
       WHERE p.etudiant_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements/stats — Statistiques dashboard
// ─────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  try {
    const [[totaux]] = await db.query(`
      SELECT 
        COUNT(*) AS total_paiements,
        SUM(CASE WHEN statut='valide' THEN montant_total ELSE 0 END) AS montant_total_valide,
        SUM(CASE WHEN statut='valide' AND mode_paiement='cash' THEN montant_total ELSE 0 END) AS montant_cash,
        SUM(CASE WHEN statut='valide' AND mode_paiement='orange_money' THEN montant_total ELSE 0 END) AS montant_orange,
        SUM(CASE WHEN statut='valide' AND mode_paiement='mtn_money' THEN montant_total ELSE 0 END) AS montant_mtn,
        COUNT(DISTINCT etudiant_id) AS nb_etudiants
      FROM paiements WHERE statut='valide'
    `);

    const [parJour] = await db.query(`
      SELECT DATE(created_at) AS jour, SUM(montant_total) AS total
      FROM paiements WHERE statut='valide' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at) ORDER BY jour
    `);

    res.json({ success: true, data: { totaux, parJour } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// SIMULATION API Mobile Money
// ─────────────────────────────────────────────────────────
async function simulerPaiementMobileMoney(operateur, numero, montant) {
  // En production, remplacer par les vrais appels API Orange/MTN
  await new Promise(resolve => setTimeout(resolve, 1200)); // Simulation délai réseau

  // Simuler 90% de succès
  if (Math.random() > 0.10) {
    return {
      success: true,
      transaction_id: 'TXN-' + uuidv4().split('-')[0].toUpperCase(),
      message: 'Paiement accepté'
    };
  } else {
    return {
      success: false,
      message: `Solde insuffisant sur le compte ${operateur === 'orange_money' ? 'Orange Money' : 'MTN MoMo'}.`
    };
  }
}

module.exports = router;
