const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middlewares/auth');
require('dotenv').config();

// ─────────────────────────────────────────────────────────
// NOTCHPAY — Initialiser un paiement Mobile Money
// Docs : https://developer.notchpay.co
// ─────────────────────────────────────────────────────────
async function initierPaiementNotchPay({ reference, montant, email, telephone, nom, prenom, description }) {
  const response = await fetch('https://api.notchpay.co/payments/initialize', {
    method: 'POST',
    headers: {
      'Authorization': process.env.NOTCHPAY_PUBLIC_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      currency: 'XAF',
      amount: montant,
      reference: reference,
      description: description,
      customer: {
        name: `${prenom} ${nom}`,
        email: email || `${reference}@rattrapage.cm`,
        phone: telephone
      },
      callback: process.env.NOTCHPAY_CALLBACK_URL || 'http://localhost:3000/api/paiements/webhook'
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Erreur NotchPay (${response.status})`);
  }
  // Retourne : { status, message, transaction: { reference, authorization_url, ... } }
  return data;
}

// ─────────────────────────────────────────────────────────
// NOTCHPAY — Vérifier le statut d'une transaction
// ─────────────────────────────────────────────────────────
async function verifierTransactionNotchPay(reference) {
  const response = await fetch(`https://api.notchpay.co/payments/${reference}`, {
    method: 'GET',
    headers: {
      'Authorization': process.env.NOTCHPAY_PUBLIC_KEY,
      'Accept': 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Erreur vérification NotchPay');
  return data;
}

// Génère une référence unique
const genRef = () => 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();

// ─────────────────────────────────────────────────────────
// POST /api/paiements/mobile
// Initier un paiement Mobile Money via NotchPay (étudiant)
// Retourne une authorization_url vers laquelle rediriger l'étudiant
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
    if (!matieres.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Aucune matière valide trouvée.' });
    }

    // Récupérer les infos de l'étudiant
    const [[etudiant]] = await conn.query('SELECT * FROM etudiants WHERE id = ?', [etudiant_id]);
    if (!etudiant) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }

    const montant_total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);
    const reference = genRef();
    const description = `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`;

    // ── Appel API NotchPay ──────────────────────────
    let notchPayResponse;
    try {
      notchPayResponse = await initierPaiementNotchPay({
        reference,
        montant: montant_total,
        email: etudiant.email,
        telephone: numero_mobile,
        nom: etudiant.nom,
        prenom: etudiant.prenom,
        description
      });
    } catch (notchErr) {
      await conn.rollback();
      return res.status(502).json({
        success: false,
        message: `Erreur passerelle de paiement : ${notchErr.message}`
      });
    }

    const authorization_url = notchPayResponse.transaction?.authorization_url;
    const transaction_id    = notchPayResponse.transaction?.reference || reference;

    // Enregistrer le paiement en statut "en_attente"
    // (il sera mis à jour à "valide" par le webhook ou par /verify)
    const [paiementResult] = await conn.query(
      `INSERT INTO paiements
         (reference, etudiant_id, montant_total, mode_paiement, statut, numero_mobile, transaction_id)
       VALUES (?, ?, ?, ?, 'en_attente', ?, ?)`,
      [reference, etudiant_id, montant_total, mode_paiement, numero_mobile, transaction_id]
    );
    const paiement_id = paiementResult.insertId;

    // Lier les matières au paiement
    for (const matiere of matieres) {
      await conn.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES (?, ?, ?)',
        [paiement_id, matiere.id, matiere.frais]
      );
    }

    await conn.commit();

    // Le frontend doit rediriger l'étudiant vers authorization_url
    res.status(201).json({
      success: true,
      message: 'Paiement initié. Redirigez l\'étudiant vers l\'URL de paiement NotchPay.',
      data: {
        reference,
        transaction_id,
        montant_total,
        authorization_url,
        matieres: matieres.map(m => ({ id: m.id, libelle: m.libelle, frais: m.frais }))
      }
    });

  } catch (err) {
    await conn.rollback();
    console.error('[POST /mobile]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'initiation du paiement.' });
  } finally {
    conn.release();
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/paiements/verify/:reference
// Vérification manuelle après retour de la page NotchPay
// Le frontend appelle cette route quand l'étudiant revient sur le site
// ─────────────────────────────────────────────────────────
router.get('/verify/:reference', authMiddleware, async (req, res) => {
  const { reference } = req.params;

  try {
    // Interroger NotchPay pour avoir le vrai statut
    const notchData = await verifierTransactionNotchPay(reference);
    const statut_notchpay = notchData.transaction?.status;

    const statutMap = {
      complete: 'valide',
      failed:   'echoue',
      canceled: 'annule',
      pending:  'en_attente'
    };
    const nouveau_statut = statutMap[statut_notchpay] || 'en_attente';

    // Mettre à jour le statut en base
    const [updateResult] = await db.query(
      'UPDATE paiements SET statut = ? WHERE reference = ?',
      [nouveau_statut, reference]
    );
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable.' });
    }

    // Si validé → créer le reçu (si pas encore existant)
    if (nouveau_statut === 'valide') {
      const [[paiement]] = await db.query(
        `SELECT p.id, GROUP_CONCAT(m.libelle SEPARATOR ', ') AS libelles
         FROM paiements p
         LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
         LEFT JOIN matieres m ON pm.matiere_id = m.id
         WHERE p.reference = ? GROUP BY p.id`,
        [reference]
      );

      if (paiement) {
        const [[existingRecu]] = await db.query(
          'SELECT numero_recu FROM recus WHERE paiement_id = ?', [paiement.id]
        );
        if (!existingRecu) {
          const numero_recu = 'REC-' + Date.now();
          await db.query(
            'INSERT INTO recus (numero_recu, paiement_id, libelle) VALUES (?, ?, ?)',
            [numero_recu, paiement.id, `Frais de rattrapage — ${paiement.libelles}`]
          );
          return res.json({ success: true, statut: nouveau_statut, numero_recu, reference });
        }
        return res.json({ success: true, statut: nouveau_statut, numero_recu: existingRecu.numero_recu, reference });
      }
    }

    res.json({ success: true, statut: nouveau_statut, reference });

  } catch (err) {
    console.error('[GET /verify]', err);
    res.status(500).json({ success: false, message: 'Erreur vérification : ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/paiements/webhook
// NotchPay appelle cette URL automatiquement après chaque transaction
// Configurer dans le dashboard NotchPay > Settings > Webhooks
// ─────────────────────────────────────────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  const event = req.body;

  // Vérifier la signature NotchPay (sécurité en production)
  const notchpayHash = req.headers['x-notch-signature'];
  if (process.env.NOTCHPAY_HASH && notchpayHash !== process.env.NOTCHPAY_HASH) {
    console.warn('[WEBHOOK] Signature invalide');
    return res.status(401).json({ message: 'Signature invalide' });
  }

  console.log(`[WEBHOOK NotchPay] ${event?.event} | Ref: ${event?.data?.reference}`);

  try {
    const eventType   = event?.event;    // 'payment.complete' | 'payment.failed' | ...
    const transaction = event?.data;

    if (!transaction?.reference) {
      return res.status(400).json({ message: 'Référence manquante.' });
    }

    const statutMap = {
      'payment.complete': 'valide',
      'payment.failed':   'echoue',
      'payment.canceled': 'annule'
    };
    const nouveau_statut = statutMap[eventType];

    if (!nouveau_statut) {
      return res.status(200).json({ message: 'Événement ignoré.' });
    }

    // Mettre à jour le statut en base
    const [updateResult] = await db.query(
      'UPDATE paiements SET statut = ? WHERE reference = ?',
      [nouveau_statut, transaction.reference]
    );

    if (updateResult.affectedRows === 0) {
      console.warn('[WEBHOOK] Paiement non trouvé :', transaction.reference);
      return res.status(404).json({ message: 'Paiement introuvable.' });
    }

    // Si validé → générer le reçu automatiquement
    if (nouveau_statut === 'valide') {
      const [[paiement]] = await db.query(
        `SELECT p.id, GROUP_CONCAT(m.libelle SEPARATOR ', ') AS libelles
         FROM paiements p
         LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
         LEFT JOIN matieres m ON pm.matiere_id = m.id
         WHERE p.reference = ? GROUP BY p.id`,
        [transaction.reference]
      );

      if (paiement) {
        const [[existingRecu]] = await db.query(
          'SELECT id FROM recus WHERE paiement_id = ?', [paiement.id]
        );
        if (!existingRecu) {
          const numero_recu = 'REC-' + Date.now();
          await db.query(
            'INSERT INTO recus (numero_recu, paiement_id, libelle) VALUES (?, ?, ?)',
            [numero_recu, paiement.id, `Frais de rattrapage — ${paiement.libelles}`]
          );
          console.log(`[WEBHOOK] Reçu généré : ${numero_recu}`);
        }
      }
    }

    // NotchPay exige une réponse 200 rapide
    res.status(200).json({ message: 'OK' });

  } catch (err) {
    console.error('[WEBHOOK] Erreur :', err.message);
    res.status(500).json({ message: 'Erreur traitement webhook.' });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/paiements/cash — Paiement Cash par agent financier
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

    // Infos étudiant pour le reçu
    const [[etudiant]] = await conn.query(
      `SELECT e.*, f.nom AS filiere_nom FROM etudiants e
       LEFT JOIN filieres f ON e.filiere_id = f.id WHERE e.id = ?`,
      [etudiant_id]
    );

    const numero_recu = 'REC-' + Date.now();
    const libelle = `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`;
    await conn.query(
      'INSERT INTO recus (numero_recu, paiement_id, agent_id, libelle) VALUES (?, ?, ?, ?)',
      [numero_recu, paiement_id, agent_id, libelle]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'Paiement cash enregistré avec succès.',
      data: {
        reference,
        montant_total,
        numero_recu,
        etudiant: {
          nom: etudiant.nom,
          prenom: etudiant.prenom,
          matricule: etudiant.matricule,
          telephone: etudiant.telephone,
          filiere: etudiant.filiere_nom
        },
        matieres: matieres.map(m => ({ id: m.id, libelle: m.libelle, frais: m.frais }))
      }
    });

  } catch (err) {
    await conn.rollback();
    console.error('[POST /cash]', err);
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
    const where = [], params = [];
    if (statut)      { where.push('p.statut = ?');        params.push(statut); }
    if (mode)        { where.push('p.mode_paiement = ?'); params.push(mode); }
    if (etudiant_id) { where.push('p.etudiant_id = ?');   params.push(etudiant_id); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(e.prenom, ' ', e.nom) AS etudiant_nom, e.matricule,
              CONCAT(u.prenom, ' ', u.nom) AS agent_nom,
              r.numero_recu
       FROM paiements p
       LEFT JOIN etudiants e   ON p.etudiant_id = e.id
       LEFT JOIN utilisateurs u ON p.agent_id   = u.id
       LEFT JOIN recus r        ON r.paiement_id = p.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM paiements p ${whereClause}`, params
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
       LEFT JOIN recus r              ON r.paiement_id  = p.id
       LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
       LEFT JOIN matieres m           ON pm.matiere_id  = m.id
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
        SUM(CASE WHEN statut='valide' AND mode_paiement='cash'         THEN montant_total ELSE 0 END) AS montant_cash,
        SUM(CASE WHEN statut='valide' AND mode_paiement='orange_money' THEN montant_total ELSE 0 END) AS montant_orange,
        SUM(CASE WHEN statut='valide' AND mode_paiement='mtn_money'    THEN montant_total ELSE 0 END) AS montant_mtn,
        COUNT(DISTINCT etudiant_id) AS nb_etudiants
      FROM paiements WHERE statut='valide'
    `);
    const [parJour] = await db.query(`
      SELECT DATE(created_at) AS jour, SUM(montant_total) AS total
      FROM paiements
      WHERE statut='valide' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at) ORDER BY jour
    `);
    res.json({ success: true, data: { totaux, parJour } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
