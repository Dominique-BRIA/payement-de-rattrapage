const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware } = require('../middlewares/auth');
const authPdfMiddleware = require('../middlewares/authPdf');
const PDFDocument = require('pdfkit');

// GET /api/recus/:numero — Détail JSON
router.get('/:numero', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*,
              p.reference, p.montant_total, p.mode_paiement, p.transaction_id, p.created_at AS date_paiement,
              CONCAT(e.prenom, ' ', e.nom) AS etudiant_nom, e.matricule, e.telephone, e.email,
              f.nom AS filiere_nom,
              CONCAT(u.prenom, ' ', u.nom) AS agent_nom,
              STRING_AGG(m.libelle, '||' ORDER BY m.libelle) AS matieres_libelles,
              STRING_AGG(pm.frais::text, '||' ORDER BY m.libelle) AS matieres_frais
       FROM recus r
       JOIN paiements p ON r.paiement_id = p.id
       JOIN etudiants e ON p.etudiant_id = e.id
       LEFT JOIN filieres f ON e.filiere_id = f.id
       LEFT JOIN utilisateurs u ON r.agent_id = u.id
       LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
       LEFT JOIN matieres m ON pm.matiere_id = m.id
       WHERE r.numero_recu = $1
       GROUP BY r.id, p.reference, p.montant_total, p.mode_paiement, p.transaction_id, p.created_at,
                e.prenom, e.nom, e.matricule, e.telephone, e.email, f.nom, u.prenom, u.nom`,
      [req.params.numero]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Reçu introuvable.' });

    const recu = result.rows[0];
    const matieres = recu.matieres_libelles
      ? recu.matieres_libelles.split('||').map((lib, i) => ({
          libelle: lib, frais: parseFloat(recu.matieres_frais.split('||')[i])
        }))
      : [];

    res.json({ success: true, data: { ...recu, matieres } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/recus/:numero/pdf — PDF avec token dans URL
router.get('/:numero/pdf', authPdfMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*,
              p.reference, p.montant_total, p.mode_paiement, p.transaction_id, p.created_at AS date_paiement,
              CONCAT(e.prenom, ' ', e.nom) AS etudiant_nom, e.matricule, e.telephone,
              f.nom AS filiere_nom,
              CONCAT(u.prenom, ' ', u.nom) AS agent_nom,
              STRING_AGG(m.libelle, '||' ORDER BY m.libelle) AS matieres_libelles,
              STRING_AGG(pm.frais::text, '||' ORDER BY m.libelle) AS matieres_frais
       FROM recus r
       JOIN paiements p ON r.paiement_id = p.id
       JOIN etudiants e ON p.etudiant_id = e.id
       LEFT JOIN filieres f ON e.filiere_id = f.id
       LEFT JOIN utilisateurs u ON r.agent_id = u.id
       LEFT JOIN paiement_matieres pm ON pm.paiement_id = p.id
       LEFT JOIN matieres m ON pm.matiere_id = m.id
       WHERE r.numero_recu = $1
       GROUP BY r.id, p.reference, p.montant_total, p.mode_paiement, p.transaction_id, p.created_at,
                e.prenom, e.nom, e.matricule, e.telephone, f.nom, u.prenom, u.nom`,
      [req.params.numero]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Reçu introuvable.' });

    const d = result.rows[0];
    const matieres = d.matieres_libelles
      ? d.matieres_libelles.split('||').map((lib, i) => ({
          libelle: lib, frais: parseFloat(d.matieres_frais.split('||')[i])
        }))
      : [];

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recu-${d.numero_recu}.pdf"`);
    doc.pipe(res);

    const orange = '#E85D04', dark = '#1a1a2e', gray = '#6c757d';

    doc.rect(0, 0, 595, 120).fill(dark);
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
       .text('UNIVERSITÉ — FRAIS DE RATTRAPAGE', 50, 30);
    doc.fontSize(12).font('Helvetica').text('Reçu Officiel de Paiement', 50, 60);
    doc.fontSize(10)
       .text(`N° ${d.numero_recu}`, 50, 80)
       .text(`Date : ${new Date(d.date_emission).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })}`, 50, 95);

    doc.rect(0, 120, 595, 5).fill(orange);
    let y = 145;

    doc.fillColor(dark).fontSize(13).font('Helvetica-Bold').text('INFORMATIONS ÉTUDIANT', 50, y);
    y += 20;
    doc.rect(50, y, 495, 80).strokeColor('#e0e0e0').lineWidth(1).stroke();
    doc.fillColor(dark).fontSize(10).font('Helvetica');
    doc.text(`Nom complet : ${d.etudiant_nom}`, 65, y + 10);
    doc.text(`Matricule : ${d.matricule}`, 65, y + 25);
    doc.text(`Filière : ${d.filiere_nom || 'N/A'}`, 65, y + 40);
    doc.text(`Téléphone : ${d.telephone}`, 65, y + 55);
    y += 100;

    doc.fillColor(dark).fontSize(13).font('Helvetica-Bold').text('MATIÈRES RATTRAPÉES', 50, y);
    y += 20;
    doc.rect(50, y, 495, 25).fill('#f5f5f5');
    doc.fillColor(dark).fontSize(10).font('Helvetica-Bold');
    doc.text('Matière', 65, y + 7);
    doc.text('Frais (FCFA)', 430, y + 7);
    y += 25;

    for (const matiere of matieres) {
      doc.rect(50, y, 495, 22).strokeColor('#e0e0e0').lineWidth(0.5).stroke();
      doc.fillColor('#333').font('Helvetica').fontSize(10);
      doc.text(matiere.libelle, 65, y + 6, { width: 340 });
      doc.text(matiere.frais.toLocaleString('fr-FR'), 430, y + 6);
      y += 22;
    }

    y += 10;
    doc.rect(350, y, 195, 35).fill(orange);
    doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold');
    doc.text('TOTAL', 365, y + 10);
    doc.text(`${parseFloat(d.montant_total).toLocaleString('fr-FR')} FCFA`, 430, y + 10);
    y += 55;

    const modes = { cash: 'Espèces (Cash)', orange_money: 'Orange Money', mtn_money: 'MTN MoMo' };
    doc.fillColor(dark).fontSize(10).font('Helvetica');
    doc.text(`Mode de paiement : ${modes[d.mode_paiement] || d.mode_paiement}`, 50, y);
    if (d.transaction_id) doc.text(`ID Transaction : ${d.transaction_id}`, 50, y + 15);
    if (d.agent_nom) doc.text(`Agent financier : ${d.agent_nom}`, 50, y + 30);
    doc.text(`Référence : ${d.reference}`, 50, y + 45);

    doc.rect(0, 750, 595, 92).fill('#f8f9fa');
    doc.rect(0, 750, 595, 3).fill(orange);
    doc.fillColor(gray).fontSize(9).font('Helvetica');
    doc.text('Ce reçu est un document officiel. Conservez-le précieusement.', 50, 760, { align: 'center', width: 495 });
    doc.text("En cas de litige, contactez le service financier de l'établissement.", 50, 775, { align: 'center', width: 495 });
    doc.fillColor(orange).fontSize(8).text('Généré automatiquement par le Système de Paiement des Frais de Rattrapage', 50, 795, { align: 'center', width: 495 });

    await db.query('UPDATE recus SET imprime=TRUE WHERE numero_recu=$1', [d.numero_recu]);
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur génération PDF.' });
  }
});

module.exports = router;
