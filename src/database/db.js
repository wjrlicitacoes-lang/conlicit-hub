const { Pool } = require('pg');
const dns = require('dns');

// Railway roteia IPv6 por padrão, mas o Supabase retorna ENETUNREACH nessa família.
// Forçar ipv4first garante que o dns.lookup() resolva apenas endereços IPv4.
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;
