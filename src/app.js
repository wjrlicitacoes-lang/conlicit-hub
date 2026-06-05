require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

if (!process.env.JWT_SECRET)   console.warn('AVISO: JWT_SECRET não definida.');
if (!process.env.DATABASE_URL) console.warn('AVISO: DATABASE_URL não definida.');

console.log('Diagnóstico de inicialização:', {
  node: process.version,
  jwt_secret_ok: !!process.env.JWT_SECRET,
  database_ok:   !!process.env.DATABASE_URL,
});

const authRoutes         = require('./routes/auth');
const editaisRoutes      = require('./routes/editais');
const healthRoutes       = require('./routes/health');
const clientesRoutes     = require('./routes/clientes');
const boletimRoutes      = require('./routes/boletim');
const calendarioRoutes   = require('./routes/calendario');
const edsonRoutes        = require('./routes/edson');
const prospectsRoutes    = require('./routes/prospects');
const roboRoutes         = require('./routes/robo');
const captacaoRoutes     = require('./routes/captacao');
const propostasRoutes    = require('./routes/propostas');
const oportunidadesRoutes = require('./routes/oportunidades');
const posVitoriaRoutes    = require('./routes/posVitoria');
const { receber: receberFormulario } = require('./controllers/formularioController');
const { receberLanding, webhookBrevo } = require('./controllers/prospectsController');

const autenticar              = require('./middleware/autenticar');
const { verificarPermissao }  = require('./middleware/autenticar');
const { executarMigracoes }   = require('./database/migracoes');
const { iniciarAgendador }    = require('./cron/agendador');

const app = express();

const origensPermitidas = [
  'http://localhost:3000',
  'https://web-production-18d79.up.railway.app',
  'https://hub.conlicit.com',
  'http://hub.conlicit.com',
  'https://conlicit.com',
  'https://www.conlicit.com',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origensPermitidas.includes(origin)) cb(null, true);
    else cb(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/auth',          authRoutes);
app.post('/formulario/cliente',    receberFormulario);   // pública — onboarding
app.post('/api/prospects',         receberLanding);      // pública — landing page análise gratuita
app.post('/prospects/webhook-brevo', webhookBrevo);      // pública — eventos Brevo
app.use('/health',        healthRoutes);
app.use('/editais',       autenticar, verificarPermissao('editais'),    editaisRoutes);
app.use('/clientes',      autenticar, verificarPermissao('clientes'),   clientesRoutes);
app.use('/boletim',       autenticar, verificarPermissao('boletins'),   boletimRoutes);
app.use('/calendario',    autenticar, verificarPermissao('calendario'), calendarioRoutes);
app.use('/edson',         autenticar, verificarPermissao('edson'),      edsonRoutes);
app.use('/robo',          autenticar, verificarPermissao('monitor'),    roboRoutes);
app.use('/captacao',      captacaoRoutes);
app.use('/prospects',     autenticar, verificarPermissao('prospects'),  prospectsRoutes);
app.use('/propostas',     autenticar, propostasRoutes);
app.use('/oportunidades', autenticar, oportunidadesRoutes);
app.use('/api/pos-vitoria', autenticar, posVitoriaRoutes);

// Endpoint temporário para forçar migrations pontuais via API
app.post('/admin/migrar', autenticar, async (req, res) => {
  if (req.usuario?.role !== 'admin') return res.status(403).json({ erro: 'Apenas admin' });
  const db = require('./database/db');
  try {
    await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS itens_planilha_selecao  JSONB DEFAULT '[]'`);
    await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS itens_planilha_pesquisa JSONB DEFAULT '[]'`);
    return res.json({ ok: true, mensagem: 'Colunas garantidas' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

app.get('/cadastro', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cadastro.html'));
});

app.get('/proposta', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'proposta.html'));
});

app.use((err, req, res, next) => {
  console.error('Erro não tratado na rota:', err.message);
  if (err.message?.includes('CORS')) return res.status(403).json({ erro: err.message });
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason));
process.on('uncaughtException',  (err)    => console.error('uncaughtException:', err));

const PORT   = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`ConlicitHub API rodando na porta ${PORT}`);
  executarMigracoes().catch(err => console.error('Falha nas migrações:', err.message));
  iniciarAgendador();
});
server.timeout = 300000;

module.exports = app;
