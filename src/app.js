require('dotenv').config();
const express = require('express');

const authRoutes = require('./routes/auth');
const editaisRoutes = require('./routes/editais');
const healthRoutes = require('./routes/health');
const autenticar = require('./middleware/autenticar');

const app = express();

app.use(express.json());

app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/editais', autenticar, editaisRoutes);

if (!process.env.JWT_SECRET) {
  console.error('ERRO: variável JWT_SECRET não definida. Configure-a antes de iniciar o servidor.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ConlicitHub API rodando na porta ${PORT}`);
});

module.exports = app;
