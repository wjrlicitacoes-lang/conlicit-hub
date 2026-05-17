const { Pool } = require('pg');
const dns = require('dns');

// Railway expõe IPv6 mas o Supabase rejeita conexões nessa família (ENETUNREACH).
// Passar lookup com family:4 força resolução exclusivamente IPv4 para este pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  lookup: (hostname, options, callback) =>
    dns.lookup(hostname, { ...options, family: 4 }, callback),
});

module.exports = pool;
