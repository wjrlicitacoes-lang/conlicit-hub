const { Pool } = require('pg');

// IPv4 é garantido pela flag --dns-result-order=ipv4first no comando de start (package.json).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;
