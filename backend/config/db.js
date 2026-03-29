const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // requis sur Render
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME     || 'rattrapage_db'
      }
);

// Test de connexion au démarrage
pool.connect()
  .then(client => {
    console.log('✅ Connexion PostgreSQL établie avec succès');
    client.release();
  })
  .catch(err => {
    console.error('❌ Erreur connexion PostgreSQL :', err.message);
  });

module.exports = pool;
