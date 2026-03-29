const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('../config/db');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASS }
});

transporter.verify((err) => {
  if (err) console.error('❌ Erreur email :', err.message);
  else console.log('✅ Service email Gmail prêt');
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email requis.' });

  try {
    const result = await db.query(
      'SELECT id, nom, prenom FROM utilisateurs WHERE email = $1 AND actif = TRUE', [email]
    );

    if (!result.rows.length)
      return res.json({ success: true, message: 'Si cet email existe, un lien a été envoyé.' });

    const user = result.rows[0];
    await db.query('DELETE FROM password_resets WHERE email = $1 AND used = FALSE', [email]);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.query(
      'INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)',
      [email, token, expiresAt]
    );

    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

    await transporter.sendMail({
      from: `"PayRattrapage 🎓" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Réinitialisation de votre mot de passe — PayRattrapage',
      html: `
        <div style="font-family:'Segoe UI',sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#0A2463;padding:32px;border-radius:12px 12px 0 0;text-align:center">
            <h1 style="color:white;margin:0">🎓 PayRattrapage</h1>
          </div>
          <div style="background:white;padding:32px;border:1px solid #e2e8f0;border-top:none">
            <h2 style="color:#0A2463">Bonjour ${user.prenom} ${user.nom},</h2>
            <p style="color:#64748b">Vous avez demandé la réinitialisation de votre mot de passe.</p>
            <div style="text-align:center;margin:32px 0">
              <a href="${resetUrl}" style="background:#E85D04;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700">
                🔑 Réinitialiser mon mot de passe
              </a>
            </div>
            <div style="background:#FEF3C7;border-radius:8px;padding:12px">
              <p style="margin:0;color:#92400E;font-size:.85rem">⚠️ Ce lien expire dans <strong>1 heure</strong>.</p>
            </div>
          </div>
        </div>`
    });

    res.json({ success: true, message: 'Si cet email existe, un lien a été envoyé.' });
  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ success: false, message: "Erreur lors de l'envoi de l'email." });
  }
});

// GET /api/auth/verify-token/:token
router.get('/verify-token/:token', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT email FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [req.params.token]
    );
    if (!result.rows.length)
      return res.status(400).json({ success: false, message: 'Lien invalide ou expiré.' });
    res.json({ success: true, email: result.rows[0].email });
  } catch (err) { res.status(500).json({ success: false, message: 'Erreur serveur.' }); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password, confirmPassword } = req.body;
  if (!token || !password || !confirmPassword)
    return res.status(400).json({ success: false, message: 'Tous les champs sont requis.' });
  if (password !== confirmPassword)
    return res.status(400).json({ success: false, message: 'Les mots de passe ne correspondent pas.' });
  if (password.length < 8)
    return res.status(400).json({ success: false, message: 'Minimum 8 caractères.' });

  try {
    const result = await db.query(
      'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length)
      return res.status(400).json({ success: false, message: 'Lien invalide ou expiré.' });

    const reset = result.rows[0];
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE utilisateurs SET password_hash = $1 WHERE email = $2', [hash, reset.email]);
    await db.query('UPDATE password_resets SET used = TRUE WHERE token = $1', [token]);

    res.json({ success: true, message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ success: false, message: 'Erreur réinitialisation.' });
  }
});

module.exports = router;
