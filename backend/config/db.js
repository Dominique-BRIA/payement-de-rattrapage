const mysql = require('mysql2/promise');
require('dotenv').config();

let pool;

if (process.env.MYSQL_URL) {
  // ✅ Railway (important: SSL + URL)
  pool = mysql.createPool({
    host: process.env.MYSQL_URL.split('@')[1].split(':')[0],
    port: process.env.MYSQL_URL.split(':')[3].split('/')[0],
    user: process.env.MYSQL_URL.split('//')[1].split(':')[0],
    password: process.env.MYSQL_URL.split(':')[2].split('@')[0],
    database: process.env.MYSQL_URL.split('/')[3],
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  // ✅ Local
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rattrapage_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
  });
}

// ✅ Test connexion au démarrage
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connexion MySQL OK');
    conn.release();
  } catch (err) {
    console.error('❌ Erreur connexion MySQL :', err);
  }
})();

module.exports = pool;
