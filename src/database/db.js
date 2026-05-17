const { Pool } = require('pg');

// Supabase exige SSL; rejectUnauthorized: false aceita o certificado self-signed deles
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;
