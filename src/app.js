require('dotenv').config();
const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET) {
  console.warn('AVISO: JWT_SECRET não definida — logins falharão até que a variável seja configurada.');
}
if (!process.env.DATABASE_URL) {
  console.warn('AVISO: DATABASE_URL não definida — operações de usuário falharão.');
}

console.log('Diagnóstico de inicialização:', {
  node: process.version,
  jwt_secret_ok: !!process.env.JWT_SECRET,
  database_ok: !!process.env.DATABASE_URL,
  bcryptjs: require('bcryptjs/package.json').version,
});

const authRoutes = require('./routes/auth');
const editaisRoutes = require('./routes/editais');
const healthRoutes = require('./routes/health');
const clientesRoutes = require('./routes/clientes');
const boletimRoutes = require('./routes/boletim');
const calendarioRoutes = require('./routes/calendario');
const edsonRoutes = require('./routes/edson');
const autenticar = require('./middleware/autenticar');
const { executarMigracoes } = require('./database/migracoes');
const { iniciarAgendador } = require('./cron/agendador');

const path = require('path');

const app = express();

const origensPermitidas = [
  'http://localhost:3000',
  'https://web-production-18d79.up.railway.app',
  'https://hub.conlicit.com',
  'http://hub.conlicit.com',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || origensPermitidas.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida pelo CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/editais', autenticar, editaisRoutes);
app.use('/clientes', autenticar, clientesRoutes);
app.use('/boletim', autenticar, boletimRoutes);
app.use('/calendario', autenticar, calendarioRoutes);
app.use('/edson', autenticar, edsonRoutes);

// Captura erros lançados por route handlers async que não têm try/catch próprio
app.use((err, req, res, next) => {
  console.error('Erro não tratado na rota:', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// Impede que rejeições e exceções não capturadas derrubem o processo
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

const PORT = process.env.PORT || 3000;

// Sobe imediatamente para o healthcheck do Railway passar; migrações rodam em background
app.listen(PORT, () => {
  console.log(`ConlicitHub API rodando na porta ${PORT}`);

  executarMigracoes().catch((err) => {
    console.error('Falha nas migrações:', err.message);
  });

  iniciarAgendador();
});

module.exports = app;
