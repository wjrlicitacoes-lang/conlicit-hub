require('dotenv').config();
const express = require('express');

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
const autenticar = require('./middleware/autenticar');
const { executarMigracoes } = require('./database/migracoes');

const app = express();

app.use(express.json());

app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/editais', autenticar, editaisRoutes);

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

executarMigracoes()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ConlicitHub API rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao executar migrações — servidor não iniciado:', err.message);
    process.exit(1);
  });

module.exports = app;
