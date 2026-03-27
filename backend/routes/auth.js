const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// ─────────────────────────────────────────
// POST /api/auth/etudiant — Connexion étudiant
// ─────────────────────────────────────────
router.post('/etudiant', async (req, res) => {
  const { matricule, telephone } = req.body;

  if (!matricule || !telephone) {
    return res.status(400).json({ success: false, message: 'Matricule et téléphone requis.' });
  }

  try {
    const [rows] = await db.query(
      `SELECT e.*, f.nom AS filiere_nom, f.code AS filiere_code
       FROM etudiants e
       LEFT JOIN filieres f ON e.filiere_id = f.id
       WHERE e.matricule = ? AND e.telephone = ?`,
      [matricule, telephone]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Matricule ou téléphone incorrect.' });
    }

    const etudiant = rows[0];
    const token = jwt.sign(
      { id: etudiant.id, matricule: etudiant.matricule, role: 'etudiant' },
      process.env.JWT_SECRET,
      { expiresIn: '4h' }
    );

    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      etudiant: {
        id: etudiant.id,
        matricule: etudiant.matricule,
        nom: etudiant.nom,
        prenom: etudiant.prenom,
        email: etudiant.email,
        telephone: etudiant.telephone,
        niveau: etudiant.niveau,
        filiere: { id: etudiant.filiere_id, nom: etudiant.filiere_nom, code: etudiant.filiere_code }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// ─────────────────────────────────────────
// POST /api/auth/staff — Connexion agent/admin
// ─────────────────────────────────────────
router.post('/staff', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email et mot de passe requis.' });
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM utilisateurs WHERE email = ? AND actif = TRUE',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects.' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Mot de passe incorrect.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

module.exports = router;