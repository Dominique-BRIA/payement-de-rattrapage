const mysql = require('mysql2/promise');
require('dotenv').config();

let pool;

if (process.env.MYSQL_URL) {
  pool = mysql.createPool(process.env.MYSQL_URL);
} else {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rattrapage_db'
  });
}

// test connexion
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connexion MySQL OK');
    conn.release();
  } catch (err) {
    console.error('❌ Erreur :', err);
  }
})();

module.exports = pool;
