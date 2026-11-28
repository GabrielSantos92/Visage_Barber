// O .env so e lido quando o servidor e executado (node src/app.js); os testes
// carregam o app sem ele, para nunca pegar credenciais reais da maquina
if (require.main === module) require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Antes de qualquer rota: o cliente Supabase unico e a guarda do ambiente
// (services/ambienteServidor.js). Nada de /api passa antes de ela liberar.
const { guarda } = require('./services/supabaseServico');

const recommendationRoutes = require('./routes/recommendation');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const visagismoRoutes = require('./routes/visagismo');
const { router: privacidadeRoutes } = require('./routes/privacidade');
const { router: pagamentosRoutes } = require('./routes/pagamentos');
const { router: notificacoesRoutes, iniciarNotificacoes } = require('./routes/notificacoes');
const { router: whatsappRoutes } = require('./routes/whatsapp');
const { opcoesCors } = require('./services/cors');

const app = express();

// Atras de proxy/load balancer, informe quantos saltos confiar (ex.: TRUST_PROXY=1)
// para que req.ip seja o IP real do cliente nos limites de requisicao
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

// Sem CORS_ORIGENS, qualquer origem (como antes); ver services/cors.js
app.use(cors(opcoesCors(process.env)));
// O webhook do WhatsApp confere a assinatura sobre o corpo exato recebido:
// guarda os bytes so para essa rota
app.use(express.json({
  limit: '20mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl.startsWith('/api/whatsapp/webhook')) req.rawBody = buf;
  },
}));

// 200 so com o ambiente liberado (banco conferido); 503 enquanto confere ou
// bloqueado. Nunca mostra URL, chave ou o motivo do bloqueio (esse vai so ao log).
app.get('/health', (_req, res) => {
  const { estado, ambiente } = guarda.estado();
  res.status(estado === 'liberado' ? 200 : 503)
    .json({ status: estado === 'liberado' ? 'ok' : estado, servico: 'BarberPro API', ambiente });
});

// Todas as rotas: agendamentos, pagamentos, consentimento, admin, clientes,
// barbeiros, notificacoes e webhooks (Mercado Pago e Meta)
app.use('/api', guarda.middleware);

app.use('/api/auth', authRoutes);
app.use('/api/recommendation', recommendationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/visagismo', visagismoRoutes);
app.use('/api/privacidade', privacidadeRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api/notificacoes', notificacoesRoutes);
app.use('/api/whatsapp', whatsappRoutes);

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`BarberPro API rodando na porta ${PORT}`);
    // Filas de avisos (tarefas automaticas): so depois de conferido o banco
    guarda.aoLiberar(() => iniciarNotificacoes());
    guarda.conferir().catch(() => {});
  });
}

module.exports = { app, guarda, iniciarNotificacoes };
