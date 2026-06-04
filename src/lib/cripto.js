// src/lib/cripto.js
// Criptografia AES-256-GCM para dados sensíveis (senhas, credenciais)
// Usa apenas o módulo nativo 'crypto' do Node.js — zero dependências externas

'use strict';
const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const KEY_LENGTH = 32;   // 256 bits
const IV_LENGTH  = 16;   // 128 bits
const TAG_LENGTH = 16;   // 128 bits
const ENCODING   = 'hex';

// Deriva uma chave de 32 bytes a partir da variável de ambiente
function getChave() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY não definida no .env');
  if (raw.length < 32) throw new Error('ENCRYPTION_KEY muito curta — mínimo 32 caracteres');
  // Deriva sempre 32 bytes independente do tamanho da chave fornecida
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Criptografa um texto.
 * Retorna string no formato: iv:tag:dados (tudo em hex)
 * Seguro para salvar em coluna VARCHAR do banco.
 */
function criptografar(texto) {
  if (texto === null || texto === undefined) return null;
  const chave = getChave();
  const iv    = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, chave, iv, {
    authTagLength: TAG_LENGTH,
  });
  const criptografado = Buffer.concat([
    cipher.update(String(texto), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Formato: iv:authTag:dadosCriptografados
  return [
    iv.toString(ENCODING),
    tag.toString(ENCODING),
    criptografado.toString(ENCODING),
  ].join(':');
}

/**
 * Descriptografa um valor previamente criptografado com criptografar().
 * Retorna null se o valor for nulo ou inválido.
 */
function descriptografar(valor) {
  if (!valor) return null;
  try {
    const partes = valor.split(':');
    if (partes.length !== 3) return null; // não é um valor criptografado
    const [ivHex, tagHex, dadosHex] = partes;
    const chave  = getChave();
    const iv     = Buffer.from(ivHex,   ENCODING);
    const tag    = Buffer.from(tagHex,  ENCODING);
    const dados  = Buffer.from(dadosHex, ENCODING);
    const decipher = crypto.createDecipheriv(ALGORITHM, chave, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(dados),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null; // tag inválida ou dados corrompidos
  }
}

/**
 * Verifica se um valor já está criptografado pelo nosso sistema.
 * Útil para migração de dados existentes.
 */
function estaCriptografado(valor) {
  if (!valor || typeof valor !== 'string') return false;
  const partes = valor.split(':');
  return partes.length === 3 &&
    partes[0].length === IV_LENGTH  * 2 &&
    partes[1].length === TAG_LENGTH * 2;
}

/**
 * Gera uma ENCRYPTION_KEY aleatória segura.
 * Use no terminal para criar a chave do .env:
 *   node -e "require('./src/lib/cripto').gerarChave()"
 */
function gerarChave() {
  const chave = crypto.randomBytes(32).toString('hex');
  console.log('ENCRYPTION_KEY=' + chave);
  return chave;
}

module.exports = { criptografar, descriptografar, estaCriptografado, gerarChave };
