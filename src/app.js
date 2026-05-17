require('dotenv').config();
const express = require('express');

if (!process.env.JWT_SECRET) {
  console.error('ERRO: variável JWT_SECRET não definida. Configure-a antes de iniciar o servidor.');
  process.exit(1);
}

const authRoutes = require('./routes/auth');
const editaisRoutes = require('./routes/editais');
const healthRoutes = require('./routes/health');
const autenticar = require('./middleware/autenticar');

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

app.listen(PORT, () => {
  console.log(`ConlicitHub API rodando na porta ${PORT}`);
});

module.exports = app;
