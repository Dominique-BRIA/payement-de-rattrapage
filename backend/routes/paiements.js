// ============================================================
// routes/paiements.js — Paiements (CamPay + Cash)
// ============================================================
const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const campay   = require('../services/campay');
const { authMiddleware, requireRole } = require('../middlewares/auth');
require('dotenv').config();

const genRef = () =>
  'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();

// ─────────────────────────────────────────────────────────────
// POST /api/paiements/mobile
// Initie un paiement Mobile Money via CamPay (USSD push)
// Body: { etudiant_id, matieres_ids, mode_paiement, numero_mobile }
// ─────────────────────────────────────────────────────────────
router.post('/mobile', authMiddleware, async (req, res) => {
  const { etudiant_id, matieres_ids, mode_paiement, numero_mobile } = req.body;

  if (!etudiant_id || !matieres_ids?.length || !mode_paiement || !numero_mobile) {
    return res.status(400).json({
      success: false,
      message: 'Champs requis : etudiant_id, matieres_ids, mode_paiement, numero_mobile.',
    });
  }

  // Validation opérateur
  if (!['orange_money', 'mtn_money'].includes(mode_paiement)) {
    return res.status(400).json({ success: false, message: 'Mode de paiement invalide.' });
  }

  // Validation numéro (doit commencer par 237)
  const numero = numero_mobile.startsWith('237')
    ? numero_mobile
    : '237' + numero_mobile;

  const client = await db.connect();
  try {
    // 1. Charger les matières et calculer le total
    const placeholders = matieres_ids.map((_, i) => `$${i + 1}`).join(',');
    const matResult = await client.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );
    const matieres = matResult.rows;
    if (!matieres.length) {
      return res.status(400).json({ success: false, message: 'Aucune matière valide trouvée.' });
    }
    const total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);

    // 2. Récupérer les infos de l'étudiant
    const etudResult = await client.query(
      `SELECT nom, prenom, matricule FROM etudiants WHERE id = $1`, [etudiant_id]
    );
    if (!etudResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Étudiant introuvable.' });
    }
    const etudiant = etudResult.rows[0];

    const reference = genRef();
    const description = `Frais rattrapage ${etudiant.matricule} — ${matieres.map(m => m.libelle).join(', ')}`;

    // 3. Initier la transaction CamPay
    let campayResult;
    try {
      campayResult = await campay.collect({
        amount: total,
        from: numero,
        description,
        external_reference: reference,
      });
    } catch (campayErr) {
      console.error('[CamPay collect error]', campayErr.message);
      return res.status(502).json({ success: false, message: campayErr.message });
    }

    // 4. Enregistrer le paiement EN ATTENTE en base
    await client.query('BEGIN');

    const pResult = await client.query(
      `INSERT INTO paiements
         (reference, etudiant_id, montant_total, mode_paiement, statut,
          numero_mobile, transaction_id)
       VALUES ($1,$2,$3,$4,'en_attente',$5,$6) RETURNING id`,
      [reference, etudiant_id, total, mode_paiement, numero, campayResult.reference]
    );
    const paiement_id = pResult.rows[0].id;

    for (const m of matieres) {
      await client.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES ($1,$2,$3)',
        [paiement_id, m.id, m.frais]
      );
    }

    await client.query('COMMIT');

    res.status(202).json({
      success: true,
      message: 'Paiement initié. En attente de confirmation sur le téléphone.',
      data: {
        reference,
        campay_reference: campayResult.reference,
        ussd_code: campayResult.ussd_code,
        operator: campayResult.operator,
        montant_total: total,
        statut: 'en_attente',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /mobile]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/paiements/verify/:reference
// Vérifie le statut CamPay et met à jour la DB si nécessaire
// ─────────────────────────────────────────────────────────────
router.get('/verify/:reference', authMiddleware, async (req, res) => {
  const { reference } = req.params;
  const client = await db.connect();
  try {
    // Charger le paiement en base
    const pResult = await client.query(
      `SELECT p.*, r.numero_recu
       FROM paiements p
       LEFT JOIN recus r ON r.paiement_id = p.id
       WHERE p.reference = $1`,
      [reference]
    );

    if (!pResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable.' });
    }

    const paiement = pResult.rows[0];

    // Déjà validé → retourner directement
    if (paiement.statut === 'valide') {
      return res.json({
        success: true,
        statut: 'valide',
        numero_recu: paiement.numero_recu,
        montant_total: paiement.montant_total,
      });
    }

    // Interroger CamPay pour le statut
    let campayStatus;
    try {
      campayStatus = await campay.getTransactionStatus(paiement.transaction_id);
    } catch (campayErr) {
      console.error('[CamPay status error]', campayErr.message);
      return res.status(502).json({ success: false, message: 'Impossible de vérifier avec CamPay.' });
    }

    // Mapper le statut CamPay vers notre statut interne
    const statutMap = {
      SUCCESSFUL: 'valide',
      FAILED: 'echoue',
      PENDING: 'en_attente',
    };
    const newStatut = statutMap[campayStatus.status] || 'en_attente';

    if (newStatut === paiement.statut) {
      // Pas de changement
      return res.json({
        success: true,
        statut: newStatut,
        numero_recu: paiement.numero_recu || null,
      });
    }

    // Mettre à jour le statut en base
    await client.query('BEGIN');
    await client.query(
      `UPDATE paiements SET statut=$1, updated_at=NOW() WHERE reference=$2`,
      [newStatut, reference]
    );

    let numero_recu = paiement.numero_recu;

    // Si validé : créer le reçu
    if (newStatut === 'valide' && !numero_recu) {
      numero_recu = 'REC-' + Date.now();

      // Charger les matières pour le libellé du reçu
      const matRes = await client.query(
        `SELECT m.libelle FROM paiement_matieres pm
         JOIN matieres m ON pm.matiere_id = m.id
         WHERE pm.paiement_id = $1`,
        [paiement.id]
      );
      const libellesMatieres = matRes.rows.map(r => r.libelle).join(', ');

      await client.query(
        `INSERT INTO recus (numero_recu, paiement_id, libelle)
         VALUES ($1,$2,$3)`,
        [numero_recu, paiement.id, `Frais de rattrapage — ${libellesMatieres}`]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      statut: newStatut,
      numero_recu: numero_recu || null,
      montant_total: paiement.montant_total,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[GET /verify]', err);
    res.status(500).json({ success: false, message: 'Erreur vérification.' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/paiements/webhook
// Webhook CamPay (notifications automatiques)
// ─────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  // Sécurité basique : vérifier le token de webhook si configuré
  const webhookToken = process.env.CAMPAY_WEBHOOK_TOKEN;
  if (webhookToken) {
    const provided = req.headers['x-campay-token'] || req.query.token;
    if (provided !== webhookToken) {
      console.warn('[Webhook] Token invalide :', provided);
      return res.status(401).json({ success: false });
    }
  }

  const { reference, status, external_reference } = req.body;
  console.log('[Webhook CamPay]', { reference, status, external_reference });

  // Répondre immédiatement à CamPay
  res.json({ success: true });

  // Traitement asynchrone
  const internalRef = external_reference;
  if (!internalRef || !status) return;

  const statutMap = { SUCCESSFUL: 'valide', FAILED: 'echoue', PENDING: 'en_attente' };
  const newStatut = statutMap[status];
  if (!newStatut || newStatut === 'en_attente') return;

  const client = await db.connect();
  try {
    const pResult = await client.query(
      `SELECT p.id, p.statut FROM paiements p
       WHERE p.reference = $1`,
      [internalRef]
    );
    if (!pResult.rows.length) return;
    const paiement = pResult.rows[0];
    if (paiement.statut === 'valide') return; // déjà traité

    await client.query('BEGIN');
    await client.query(
      `UPDATE paiements SET statut=$1, updated_at=NOW() WHERE reference=$2`,
      [newStatut, internalRef]
    );

    if (newStatut === 'valide') {
      const matRes = await client.query(
        `SELECT m.libelle FROM paiement_matieres pm
         JOIN matieres m ON pm.matiere_id = m.id
         WHERE pm.paiement_id = $1`,
        [paiement.id]
      );
      const libelle = `Frais de rattrapage — ${matRes.rows.map(r => r.libelle).join(', ')}`;
      const numero_recu = 'REC-' + Date.now();
      await client.query(
        `INSERT INTO recus (numero_recu, paiement_id, libelle) VALUES ($1,$2,$3)`,
        [numero_recu, paiement.id, libelle]
      );
      console.log(`[Webhook] Paiement ${internalRef} validé → reçu ${numero_recu}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Webhook error]', err);
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/paiements/payment-link
// Génère un lien de paiement CamPay (sans USSD push)
// ─────────────────────────────────────────────────────────────
router.post('/payment-link', authMiddleware, async (req, res) => {
  const { etudiant_id, matieres_ids, mode_paiement } = req.body;
  if (!etudiant_id || !matieres_ids?.length) {
    return res.status(400).json({ success: false, message: 'Données incomplètes.' });
  }

  const client = await db.connect();
  try {
    const placeholders = matieres_ids.map((_, i) => `$${i + 1}`).join(',');
    const matResult = await client.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );
    const matieres = matResult.rows;
    if (!matieres.length) {
      return res.status(400).json({ success: false, message: 'Aucune matière valide.' });
    }
    const total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);

    const etudResult = await client.query(
      `SELECT nom, prenom, matricule, email, telephone FROM etudiants WHERE id = $1`,
      [etudiant_id]
    );
    const etudiant = etudResult.rows[0];
    const reference = genRef();

    const linkData = await campay.getPaymentLink({
      amount: total,
      description: `Frais rattrapage ${etudiant.matricule}`,
      external_reference: reference,
      from: '237' + etudiant.telephone,
      first_name: etudiant.prenom,
      last_name: etudiant.nom,
      email: etudiant.email || '',
    });

    // Enregistrer en attente
    await client.query('BEGIN');
    const pResult = await client.query(
      `INSERT INTO paiements
         (reference, etudiant_id, montant_total, mode_paiement, statut, numero_mobile)
       VALUES ($1,$2,$3,$4,'en_attente',$5) RETURNING id`,
      [reference, etudiant_id, total, mode_paiement || 'orange_money', etudiant.telephone]
    );
    const paiement_id = pResult.rows[0].id;
    for (const m of matieres) {
      await client.query(
        'INSERT INTO paiement_matieres (paiement_id, matiere_id, frais) VALUES ($1,$2,$3)',
        [paiement_id, m.id, m.frais]
      );
    }
    await client.query('COMMIT');

    res.json({
      success: true,
      data: {
        reference,
        payment_url: linkData.link,
        montant_total: total,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /payment-link]', err);
    const msg = err.message?.includes('CamPay') ? err.message : 'Erreur serveur.';
    res.status(500).json({ success: false, message: msg });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/paiements/cash — Paiement Cash agent (inchangé)
// ─────────────────────────────────────────────────────────────
router.post('/cash', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { etudiant_id, matieres_ids, remarque } = req.body;
  const agent_id = req.user.id;
  if (!etudiant_id || !matieres_ids?.length) {
    return res.status(400).json({ success: false, message: 'Étudiant et matières requis.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const placeholders = matieres_ids.map((_, i) => `$${i + 1}`).join(',');
    const matResult = await client.query(
      `SELECT id, libelle, frais FROM matieres WHERE id IN (${placeholders}) AND actif = TRUE`,
      matieres_ids
    );
    const matieres = matResult.rows;
    const total = matieres.reduce((sum, m) => sum + parseFloat(m.frais), 0);
    const reference = genRef();

    const pResult = await client.query(
      `INSERT INTO paiements
         (reference, etudiant_id, montant_total, mode_paiement, statut, agent_id, remarque)
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
      [numero_recu, paiement_id, agent_id,
       `Frais de rattrapage — ${matieres.map(m => m.libelle).join(', ')}`]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Paiement cash enregistré.',
      data: {
        reference, montant_total: total, numero_recu,
        etudiant: {
          nom: etudiant.nom, prenom: etudiant.prenom,
          matricule: etudiant.matricule, telephone: etudiant.telephone,
          filiere: etudiant.filiere_nom,
        },
        matieres: matieres.map(m => ({ id: m.id, libelle: m.libelle, frais: m.frais })),
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /cash]', err);
    res.status(500).json({ success: false, message: 'Erreur enregistrement.' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/paiements — Liste paginée (agent/admin)
// ─────────────────────────────────────────────────────────────
router.get('/', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  const { statut, mode, etudiant_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const conditions = [], params = [];
    if (statut)      { params.push(statut);     conditions.push(`p.statut = $${params.length}`); }
    if (mode)        { params.push(mode);        conditions.push(`p.mode_paiement = $${params.length}`); }
    if (etudiant_id) { params.push(etudiant_id); conditions.push(`p.etudiant_id = $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const result = await db.query(
      `SELECT p.*,
              CONCAT(e.prenom, ' ', e.nom) AS etudiant_nom, e.matricule,
              CONCAT(u.prenom, ' ', u.nom) AS agent_nom,
              r.numero_recu
       FROM paiements p
       LEFT JOIN etudiants e    ON p.etudiant_id = e.id
       LEFT JOIN utilisateurs u ON p.agent_id    = u.id
       LEFT JOIN recus r        ON r.paiement_id = p.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM paiements p ${where}`,
      params.slice(0, params.length - 2)
    );

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/paiements/etudiant/:id — Historique étudiant
// ─────────────────────────────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/paiements/stats — Statistiques
// ─────────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, requireRole('agent', 'admin'), async (req, res) => {
  try {
    const totaux = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE statut='valide')      AS total_paiements,
        COUNT(*) FILTER (WHERE statut='en_attente')  AS total_en_attente,
        COUNT(*) FILTER (WHERE statut='echoue')      AS total_echoues,
        SUM(montant_total) FILTER (WHERE statut='valide')
          AS montant_total_valide,
        SUM(montant_total) FILTER (WHERE statut='valide' AND mode_paiement='cash')
          AS montant_cash,
        SUM(montant_total) FILTER (WHERE statut='valide' AND mode_paiement='orange_money')
          AS montant_orange,
        SUM(montant_total) FILTER (WHERE statut='valide' AND mode_paiement='mtn_money')
          AS montant_mtn,
        COUNT(DISTINCT etudiant_id) FILTER (WHERE statut='valide')
          AS nb_etudiants
      FROM paiements
    `);
    const parJour = await db.query(`
      SELECT DATE(created_at) AS jour, SUM(montant_total) AS total
      FROM paiements
      WHERE statut='valide' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at) ORDER BY jour
    `);
    res.json({
      success: true,
      data: { totaux: totaux.rows[0], parJour: parJour.rows },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
