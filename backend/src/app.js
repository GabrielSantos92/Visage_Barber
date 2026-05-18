require('dotenv').config();
const express = require('express');
const cors = require('cors');

const recommendationRoutes = require('./routes/recommendation');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', servico: 'BarberPro API' }));

app.use('/api/auth', authRoutes);
app.use('/api/recommendation', recommendationRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`BarberPro API rodando na porta ${PORT}`);
});
