const db = require('../database/db');
const crypto = require('crypto');
const axios = require('axios');

// ── Supabase Storage via HTTP direto (sem WebSocket, sem @supabase/supabase-js) ──
function getStorageConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados');
  return { url, key };
}

async function supabaseUpload(fileBuffer, fileName, mimeType) {
  const { url, key } = getStorageConfig();
  const bucket = 'documentos-clientes';
  const uploadUrl = `${url}/storage/v1/object/${bucket}/${fileName}`;

  await axios.post(uploadUrl, fileBuffer, {
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': mimeType,
      'x-upsert': 'false',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000,
  });

  // URL pública padrão do Supabase Storage
  return `${url}/storage/v1/object/public/${bucket}/${fileName}`;
}

// ── Criptografia AES-256 para credenciais ──
const CIPHER_KEY = crypto
  .createHash('sha256')
  .update(process.env.JWT_SECRET || 'fallback-key-troque-isso')
  .digest();

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', CIPHER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data) {
  const [ivHex, encHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', CIPHER_KEY, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ─────────────────────────────────────────────────────────────
// GERAR TOKEN
// POST /onboarding/gerar
// ─────────────────────────────────────────────────────────────
async function gerarToken(req, res) {
  const { cliente_id } = req.body ?? {};
  const token = crypto.randomBytes(32).toString('hex');
  const expira_em = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS onboarding_tokens (
        id          SERIAL PRIMARY KEY,
        token       VARCHAR(64) UNIQUE NOT NULL,
        cliente_id  INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
        usado       BOOLEAN NOT NULL DEFAULT FALSE,
        expira_em   TIMESTAMPTZ NOT NULL,
        criado_em   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(
      `INSERT INTO onboarding_tokens (token, cliente_id, expira_em) VALUES ($1, $2, $3)`,
      [token, cliente_id || null, expira_em],
    );

    const baseUrl = process.env.APP_URL || 'https://web-production-18d79.up.railway.app';
    return res.json({ token, link: `${baseUrl}/onboarding/${token}`, expira_em });
  } catch (err) {
    console.error('[Onboarding] gerarToken:', err.message);
    return res.status(500).json({ erro: 'Erro ao gerar token' });
  }
}

// ─────────────────────────────────────────────────────────────
// VERIFICAR TOKEN (página pública)
// GET /onboarding/:token/info
// ─────────────────────────────────────────────────────────────
async function verificarToken(req, res) {
  const { token } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT ot.*, c.nome AS cliente_nome, c.email AS cliente_email
       FROM onboarding_tokens ot
       LEFT JOIN clientes c ON c.id = ot.cliente_id
       WHERE ot.token = $1`,
      [token],
    );

    if (rows.length === 0) return res.status(404).json({ erro: 'Link inválido' });
    const t = rows[0];
    if (t.usado) return res.status(410).json({ erro: 'Este link já foi utilizado' });
    if (new Date() > new Date(t.expira_em)) return res.status(410).json({ erro: 'Este link expirou' });

    return res.json({
      valido: true,
      cliente_id: t.cliente_id,
      cliente_nome: t.cliente_nome || null,
      cliente_email: t.cliente_email || null,
    });
  } catch (err) {
    console.error('[Onboarding] verificarToken:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ─────────────────────────────────────────────────────────────
// UPLOAD de documento para Supabase Storage
// POST /onboarding/:token/upload
// ─────────────────────────────────────────────────────────────
async function uploadDocumento(req, res) {
  const { token } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT * FROM onboarding_tokens WHERE token = $1 AND usado = FALSE AND expira_em > NOW()`,
      [token],
    );
    if (rows.length === 0) return res.status(403).json({ erro: 'Token inválido ou expirado' });
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo recebido' });

    const ext = req.file.originalname.split('.').pop();
    const fileName = `onboarding/${token}/${Date.now()}-${req.file.fieldname}.${ext}`;

    const publicUrl = await supabaseUpload(req.file.buffer, fileName, req.file.mimetype);

    return res.json({ url: publicUrl, nome: req.file.originalname });
  } catch (err) {
    console.error('[Onboarding] uploadDocumento:', err.message);
    return res.status(500).json({ erro: 'Erro ao fazer upload: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// SUBMETER onboarding completo
// POST /onboarding/:token/submeter
// ─────────────────────────────────────────────────────────────
async function submeter(req, res) {
  const { token } = req.params;

  try {
    const { rows: tkRows } = await db.query(
      `SELECT * FROM onboarding_tokens WHERE token = $1 AND usado = FALSE AND expira_em > NOW()`,
      [token],
    );
    if (tkRows.length === 0) return res.status(403).json({ erro: 'Token inválido ou expirado' });
    const tk = tkRows[0];

    const {
      nome, cnpj, email, whatsapp, uf, cidade,
      contato_nome, contato_cargo, contato_whatsapp,
      palavras_chave,
      documentos,
      credenciais,
    } = req.body;

    if (!nome || !email) return res.status(400).json({ erro: 'Nome e e-mail são obrigatórios' });

    let clienteId = tk.cliente_id;

    if (clienteId) {
      // Fluxo A: atualiza cliente existente
      await db.query(
        `UPDATE clientes SET
           nome = COALESCE($1, nome),
           whatsapp = COALESCE($2, whatsapp),
           uf = COALESCE($3, uf),
           cidade = COALESCE($4, cidade),
           cnpj = COALESCE($5, cnpj),
           palavras_chave = COALESCE($6, palavras_chave),
           contato_nome = COALESCE($7, contato_nome),
           contato_cargo = COALESCE($8, contato_cargo),
           contato_whatsapp = COALESCE($9, contato_whatsapp),
           onboarding_concluido = TRUE
         WHERE id = $10`,
        [
          nome?.trim() || null,
          whatsapp?.replace(/\D/g, '') || null,
          uf?.toUpperCase() || null,
          cidade?.trim() || null,
          cnpj?.replace(/\D/g, '') || null,
          palavras_chave && palavras_chave.length ? palavras_chave : null,
          contato_nome?.trim() || null,
          contato_cargo?.trim() || null,
          contato_whatsapp?.replace(/\D/g, '') || null,
          clienteId,
        ],
      );
    } else {
      // Fluxo B: cria cliente novo
      const { rows: newC } = await db.query(
        `INSERT INTO clientes
           (nome, email, whatsapp, uf, cidade, cnpj, palavras_chave,
            contato_nome, contato_cargo, contato_whatsapp, onboarding_concluido)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
         RETURNING id`,
        [
          nome.trim(),
          email.trim().toLowerCase(),
          whatsapp?.replace(/\D/g, '') || null,
          uf?.toUpperCase() || null,
          cidade?.trim() || null,
          cnpj?.replace(/\D/g, '') || null,
          palavras_chave || [],
          contato_nome?.trim() || null,
          contato_cargo?.trim() || null,
          contato_whatsapp?.replace(/\D/g, '') || null,
        ],
      );
      clienteId = newC[0].id;
    }

    // Salva documentos
    if (Array.isArray(documentos)) {
      for (const doc of documentos) {
        if (!doc.nome || !doc.url) continue;
        await db.query(
          `INSERT INTO documentos (cliente_id, nome, tipo, url, data_vencimento)
           VALUES ($1,$2,$3,$4,$5)`,
          [clienteId, doc.nome, doc.tipo || 'outro', doc.url, doc.data_vencimento || null],
        );
      }
    }

    // Salva credenciais criptografadas
    if (Array.isArray(credenciais)) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS credenciais_portais (
          id          SERIAL PRIMARY KEY,
          cliente_id  INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
          portal      VARCHAR(100) NOT NULL,
          login_enc   TEXT NOT NULL,
          senha_enc   TEXT NOT NULL,
          criado_em   TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(cliente_id, portal)
        )
      `);

      for (const cred of credenciais) {
        if (!cred.portal || !cred.login || !cred.senha) continue;
        await db.query(
          `INSERT INTO credenciais_portais (cliente_id, portal, login_enc, senha_enc)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (cliente_id, portal)
           DO UPDATE SET login_enc = $3, senha_enc = $4`,
          [clienteId, cred.portal, encrypt(cred.login), encrypt(cred.senha)],
        );
      }
    }

    // Marca token como usado
    await db.query(`UPDATE onboarding_tokens SET usado = TRUE WHERE token = $1`, [token]);

    // Notificação WhatsApp (fire-and-forget)
    notificarAdmin(clienteId, nome).catch(e =>
      console.error('[Onboarding] notificarAdmin:', e.message),
    );

    return res.json({ sucesso: true, cliente_id: clienteId });
  } catch (err) {
    console.error('[Onboarding] submeter:', err.message);
    return res.status(500).json({ erro: 'Erro ao processar onboarding: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// LISTAR tokens (admin)
// GET /onboarding/tokens
// ─────────────────────────────────────────────────────────────
async function listarTokens(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT ot.id, ot.token, ot.usado, ot.expira_em, ot.criado_em,
              c.nome AS cliente_nome, c.email AS cliente_email
       FROM onboarding_tokens ot
       LEFT JOIN clientes c ON c.id = ot.cliente_id
       ORDER BY ot.criado_em DESC LIMIT 100`,
    );

    const baseUrl = process.env.APP_URL || 'https://web-production-18d79.up.railway.app';
    return res.json({
      dados: rows.map(r => ({
        ...r,
        link: `${baseUrl}/onboarding/${r.token}`,
        expirado: new Date() > new Date(r.expira_em),
      })),
    });
  } catch (err) {
    console.error('[Onboarding] listarTokens:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ─────────────────────────────────────────────────────────────
// BUSCAR credenciais de um cliente (admin)
// GET /onboarding/credenciais/:cliente_id
// ─────────────────────────────────────────────────────────────
async function buscarCredenciais(req, res) {
  const { cliente_id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT id, portal, login_enc, senha_enc, criado_em
       FROM credenciais_portais WHERE cliente_id = $1 ORDER BY portal`,
      [cliente_id],
    );

    return res.json({
      dados: rows.map(r => ({
        id: r.id,
        portal: r.portal,
        login: decrypt(r.login_enc),
        senha: decrypt(r.senha_enc),
        criado_em: r.criado_em,
      })),
    });
  } catch (err) {
    console.error('[Onboarding] buscarCredenciais:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Notificação WhatsApp admin ──
async function notificarAdmin(clienteId, nomeCliente) {
  const adminWpp = process.env.ADMIN_WHATSAPP;
  const zapiInst = process.env.ZAPI_INSTANCE;
  const zapiTok  = process.env.ZAPI_TOKEN;
  if (!adminWpp || !zapiInst || !zapiTok) return;

  const msg = `✅ *Onboarding concluído — ConlicitHub*\n\n` +
    `👤 *Cliente:* ${nomeCliente}\n🆔 *ID:* ${clienteId}\n` +
    `📋 Documentos e credenciais registrados.\nAcesse o Hub para revisar o cadastro.`;

  await axios.post(
    `https://api.z-api.io/instances/${zapiInst}/token/${zapiTok}/send-text`,
    { phone: adminWpp, message: msg },
    { timeout: 10000 },
  );
}

module.exports = {
  gerarToken,
  verificarToken,
  uploadDocumento,
  submeter,
  listarTokens,
  buscarCredenciais,
};
