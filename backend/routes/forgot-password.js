const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('../config/db');
require('dotenv').config();

// ─────────────────────────────────────────────────────────
// Configuration Gmail (Nodemailer)
// ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,     // votre adresse Gmail
    pass: process.env.GMAIL_APP_PASS  // mot de passe d'application Gmail
  }
});

// Vérifier la connexion email au démarrage
transporter.verify((err) => {
  if (err) console.error('❌ Erreur configuration email :', err.message);
  else console.log('✅ Service email Gmail prêt');
});

// ─────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// Envoie un email avec lien de réinitialisation
// ─────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email requis.' });
  }

  try {
    // Vérifier que l'utilisateur existe
    const [rows] = await db.query(
      'SELECT id, nom, prenom, email FROM utilisateurs WHERE email = ? AND actif = TRUE',
      [email]
    );

    // ⚠️ Toujours répondre la même chose (sécurité — évite de révéler si l'email existe)
    if (rows.length === 0) {
      return res.json({
        success: true,
        message: 'Si cet email existe, un lien de réinitialisation a été envoyé.'
      });
    }

    const user = rows[0];

    // Supprimer les anciens tokens non utilisés pour cet email
    await db.query(
      'DELETE FROM password_resets WHERE email = ? AND used = FALSE',
      [email]
    );

    // Générer un token sécurisé
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // expire dans 1 heure

    // Sauvegarder le token en base
    await db.query(
      'INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)',
      [email, token, expiresAt]
    );

    // Construire le lien de réinitialisation
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

    // Envoyer l'email
    await transporter.sendMail({
      from: `"PayRattrapage 🎓" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Réinitialisation de votre mot de passe — PayRattrapage',
      html: `
        <!DOCTYPE html>
        <html lang="fr">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:'Segoe UI',sans-serif;background:#f0f4ff;margin:0;padding:20px">
          <div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(10,36,99,0.1)">
            
            <!-- Header -->
            <div style="background:#0A2463;padding:32px;text-align:center">
              <h1 style="color:white;margin:0;font-size:1.4rem">🎓 PayRattrapage</h1>
              <p style="color:rgba(255,255,255,0.75);margin:8px 0 0;font-size:.9rem">
                Système de Paiement des Frais de Rattrapage
              </p>
            </div>

            <!-- Corps -->
            <div style="padding:32px">
              <h2 style="color:#0A2463;margin-top:0">Bonjour ${user.prenom} ${user.nom},</h2>
              <p style="color:#64748b;line-height:1.7">
                Vous avez demandé la réinitialisation de votre mot de passe. 
                Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.
              </p>

              <!-- Bouton -->
              <div style="text-align:center;margin:32px 0">
                <a href="${resetUrl}" 
                   style="background:#E85D04;color:white;padding:14px 32px;border-radius:8px;
                          text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
                  🔑 Réinitialiser mon mot de passe
                </a>
              </div>

              <!-- Avertissement -->
              <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:16px;margin-bottom:24px">
                <p style="margin:0;color:#92400E;font-size:.85rem">
                  ⚠️ Ce lien est valable pendant <strong>1 heure</strong> seulement.<br>
                  Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
                </p>
              </div>

              <!-- Lien alternatif -->
              <p style="color:#64748b;font-size:.8rem">
                Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
                <a href="${resetUrl}" style="color:#0A2463;word-break:break-all">${resetUrl}</a>
              </p>
            </div>

            <!-- Footer -->
            <div style="background:#f8f9fa;padding:16px;text-align:center;border-top:1px solid #e2e8f0">
              <p style="margin:0;color:#94a3b8;font-size:.75rem">
                © 2024 PayRattrapage — Cet email a été envoyé automatiquement, ne pas répondre.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    res.json({
      success: true,
      message: 'Si cet email existe, un lien de réinitialisation a été envoyé.'
    });

  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de l\'email.' });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// Valide le token et change le mot de passe
// ─────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password, confirmPassword } = req.body;

  if (!token || !password || !confirmPassword) {
    return res.status(400).json({ success: false, message: 'Tous les champs sont requis.' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Les mots de passe ne correspondent pas.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  try {
    // Vérifier le token
    const [rows] = await db.query(
      `SELECT * FROM password_resets 
       WHERE token = ? AND used = FALSE AND expires_at > NOW()`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Lien invalide ou expiré. Veuillez refaire une demande.'
      });
    }

    const reset = rows[0];

    // Hasher le nouveau mot de passe
    const password_hash = await bcrypt.hash(password, 10);

    // Mettre à jour le mot de passe
    await db.query(
      'UPDATE utilisateurs SET password_hash = ? WHERE email = ?',
      [password_hash, reset.email]
    );

    // Marquer le token comme utilisé
    await db.query(
      'UPDATE password_resets SET used = TRUE WHERE token = ?',
      [token]
    );

    // Envoyer email de confirmation
    await transporter.sendMail({
      from: `"PayRattrapage 🎓" <${process.env.GMAIL_USER}>`,
      to: reset.email,
      subject: 'Mot de passe modifié avec succès — PayRattrapage',
      html: `
        <div style="font-family:'Segoe UI',sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#0A2463;padding:24px;border-radius:12px 12px 0 0;text-align:center">
            <h1 style="color:white;margin:0;font-size:1.3rem">🎓 PayRattrapage</h1>
          </div>
          <div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
            <h2 style="color:#0D9E6E">✅ Mot de passe modifié !</h2>
            <p style="color:#64748b">
              Votre mot de passe a été réinitialisé avec succès le 
              <strong>${new Date().toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</strong>.
            </p>
            <p style="color:#64748b">
              Si vous n'êtes pas à l'origine de cette modification, contactez immédiatement l'administrateur.
            </p>
            <div style="background:#FEE2E2;border-radius:8px;padding:12px;margin-top:16px">
              <p style="margin:0;color:#991B1B;font-size:.85rem">
                🔒 Si ce n'est pas vous, changez immédiatement votre mot de passe.
              </p>
            </div>
          </div>
        </div>
      `
    });

    res.json({ success: true, message: 'Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.' });

  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la réinitialisation.' });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/auth/verify-token/:token
// Vérifier si un token est valide (appelé par le frontend)
// ─────────────────────────────────────────────────────────
router.get('/verify-token/:token', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT email FROM password_resets 
       WHERE token = ? AND used = FALSE AND expires_at > NOW()`,
      [req.params.token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Lien invalide ou expiré.' });
    }

    res.json({ success: true, email: rows[0].email });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;
