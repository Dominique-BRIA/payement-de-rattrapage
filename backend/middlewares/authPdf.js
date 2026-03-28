const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware spécial pour les routes PDF
// Accepte le token depuis le header Authorization OU depuis ?token= dans l'URL
const authPdfMiddleware = (req, res, next) => {
  // 1. Essayer le header Authorization
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // 2. Sinon essayer le query param ?token=
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token manquant. Accès refusé.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Token invalide ou expiré.' });
  }
};

module.exports = authPdfMiddleware;
