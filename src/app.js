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
const propostasRoutes    = require('./routes/propostas');
const oportunidadesRoutes = require('./routes/oportunidades');
const { receber: receberFormulario } = require('./controllers/formularioController');

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

app.use('/auth',          authRoutes);
app.post('/formulario/cliente', receberFormulario);  // rota pública — sem autenticação
app.use('/health',        healthRoutes);
app.use('/editais',       autenticar, verificarPermissao('editais'),    editaisRoutes);
app.use('/clientes',      autenticar, verificarPermissao('clientes'),   clientesRoutes);
app.use('/boletim',       autenticar, verificarPermissao('boletins'),   boletimRoutes);
app.use('/calendario',    autenticar, verificarPermissao('calendario'), calendarioRoutes);
app.use('/edson',         autenticar, verificarPermissao('edson'),      edsonRoutes);
app.use('/prospects',     autenticar, verificarPermissao('prospects'),  prospectsRoutes);
app.use('/propostas',     autenticar, propostasRoutes);
app.use('/oportunidades', autenticar, oportunidadesRoutes);

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
