require('dotenv').config();
const express = require('express');
const cors = require('cors');

const recommendationRoutes = require('./routes/recommendation');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const visagismoRoutes = require('./routes/visagismo');

const app = express();

// Atras de proxy/load balancer, informe quantos saltos confiar (ex.: TRUST_PROXY=1)
// para que req.ip seja o IP real do cliente nos limites de requisicao
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', servico: 'BarberPro API' }));

app.use('/api/auth', authRoutes);
app.use('/api/recommendation', recommendationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/visagismo', visagismoRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`BarberPro API rodando na porta ${PORT}`);
});
