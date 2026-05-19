const { Pool } = require('pg');

// IPv4 é garantido pela flag --dns-result-order=ipv4first no comando de start (package.json).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,                // conexões simultâneas — respeita o limite do Supabase free tier
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Sem esse handler o Node.js crasha com EADDRNOTAVAIL quando uma conexão idle cai
pool.on('error', (err) => {
  console.error('[DB] Erro em conexão idle do pool:', err.message);
});

module.exports = pool;
