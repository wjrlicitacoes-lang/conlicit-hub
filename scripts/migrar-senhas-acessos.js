// scripts/migrar-senhas-acessos.js
// Criptografa senhas em texto puro da tabela acessos_portais
require('dotenv').config();
const { Pool } = require('pg');
const { criptografar, estaCriptografado } = require('../src/lib/cripto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrar() {
  const { rows } = await pool.query('SELECT id, senha FROM acessos_portais WHERE senha IS NOT NULL');
  let migrados = 0;
  let ignorados = 0;
  for (const row of rows) {
    if (!estaCriptografado(row.senha)) {
      await pool.query('UPDATE acessos_portais SET senha = $1 WHERE id = $2', [criptografar(row.senha), row.id]);
      migrados++;
    } else {
      ignorados++;
    }
  }
  console.log(`✅ ${migrados} senha(s) criptografada(s) | ${ignorados} já estavam criptografadas`);
  await pool.end();
}

migrar().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
