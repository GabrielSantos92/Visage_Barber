Estado atual do projeto Visage Barber
1. Funcionalidades implementadas
Já enviadas ao GitHub (branch main):

Commit	O que entrou
092b22e	Limite de 3 agendamentos por cliente por dia e bloqueio de serviços com componentes repetidos (banco, site e app)
8659b29	Visagismo personalizado (formal, despojado, sem barba, loiro etc.) mantendo o rosto original; não gera imagem quando a análise dá "não aplicável" para rosto feminino
ed150f5	O teclado não cobre mais as telas de login no Android
17596f6	Agendamentos do barbeiro em ordem de horário
67ac0de	Nomes de cortes e barbas em português brasileiro
Antes desses commits, também foram feitos:

mensagens e zoom do visagismo;
tradução dos textos do site;
pop-up de confirmação ao cancelar (cliente igual ao do barbeiro);
consentimento LGPD no visagismo, pedido de novo a cada acesso;
máscara de telefone.
Documentos do TCC (fora do repositório, sem alterar o anexo original):

C:\Users\lucas\AppData\Local\Temp\claude\c--vb\a22df9f6-501e-4e13-b565-316963dfbb8e\scratchpad\Divergencias-TCC-Visage-Barber.pdf
C:\Users\lucas\AppData\Local\Temp\claude\c--vb\a22df9f6-501e-4e13-b565-316963dfbb8e\scratchpad\Levantamento-TCC-Visage-Barber.docx
2. Funcionalidades em desenvolvimento
Sistema financeiro, comissões e pagamentos online. O código e os testes estão prontos, mas nada foi enviado ao GitHub e a integração ainda não foi validada.

O que já existe:

Pagamento por PIX e cartão pelo Mercado Pago (cartão pelo Checkout Pro), e registro de pagamento na barbearia.
Comissão por barbeiro, com um percentual padrão e percentuais individuais.
Fechamento semanal e registro dos pagamentos feitos aos barbeiros.
Telas: Financeiro e Comissões para o admin (site); Meu Financeiro para o barbeiro (site e app); tela de pagamento do cliente (site e app); aba Financeiro do admin no app.
Para concluir falta:

rodar a migration 18 (e a 17, se ainda não rodou) no Supabase;
configurar as credenciais de teste do Mercado Pago e o webhook;
testar no sandbox e em um celular.
3. Regras de negócio definidas
Agendamento:

No máximo 3 agendamentos por cliente por dia. A regra fica no banco; o site e o app só checam antes.
O mesmo cliente não pode marcar serviços com componentes repetidos. A comparação usa os componentes cadastrados, não o nome exibido.
As regras de disponibilidade, duração e conflito de horário não foram alteradas.
Pagamentos:

O preço vem sempre do banco e fica congelado no agendamento. Valores enviados pelo site ou pelo app são ignorados.
Um pagamento só é aprovado depois que o backend consulta o próprio Mercado Pago. A notificação precisa ter assinatura válida, e notificações repetidas não duplicam nada.
O cliente só vê os próprios pagamentos; o barbeiro só vê o próprio financeiro.
Os dados do cartão não passam pelo app nem pelo servidor.
Os registros financeiros não podem ser alterados. Correções entram como novos lançamentos.
Comissões:

A comissão é calculada sobre o valor efetivamente pago e só é gerada quando o serviço está concluído e pago.
A taxa do meio de pagamento é despesa da barbearia e não reduz a comissão.
Mudar o percentual não recalcula o que já foi lançado. Sem percentual configurado, o lançamento fica pendente; nenhum valor é inventado.
Reembolso estorna a comissão de forma proporcional. Atendimento cancelado depois de concluído é estornado.
A semana vai de segunda a domingo, no horário de Brasília.
O pagamento ao barbeiro pode ser parcial, mas nunca acima do saldo. O sistema só registra o pagamento; não transfere dinheiro.
4. Estrutura do banco (Supabase)
Tabelas que já existiam e foram usadas: agendamentos, servicos, barbeiros, profiles, user_roles.

Migration 17 (20261105000017_limite_diario_servicos.sql): validação no banco do limite diário e dos serviços repetidos.

Migration 18 (20261105000018_financeiro.sql):

Coluna nova: agendamentos.preco, preenchida por gatilho. A migration também preenche os agendamentos antigos.
Tabelas novas:
Tabela	O que guarda
pagamentos	Cada cobrança
pagamento_reembolsos	Cada reembolso
pagamento_eventos	Notificações já processadas, para não repetir
comissao_alteracoes	Histórico de percentuais
lancamentos_financeiros	Fotografia financeira de cada serviço, mais os ajustes
pagamentos_comissao	Pagamentos feitos aos barbeiros
Proteções: gatilho que bloqueia alterações nos registros financeiros, índices únicos contra duplicidade, permissões por usuário (RLS) e funções SQL para cada operação (iniciar pagamento, aplicar estado, registrar pagamento na barbearia, reembolso, configurar comissão, pagar comissão, resumos e fechamento semanal).
5. Arquitetura
Monorepo C:\vb: backend (Express), cut-advisor-pro (site React/Vite), barber-mobile (app Expo 57) e supabase/migrations.
Backend: usa a chave de serviço do Supabase e a API REST do Mercado Pago, sem SDK. As rotas novas ficam em /api/pagamentos: criar, sincronizar, reembolsar e webhook.
Site e app: leem os dados direto do Supabase, sempre limitados pelas permissões do banco. As bibliotecas de pagamento e financeiro são iguais nas duas plataformas, e um teste confere isso.
Testes: o backend roda as migrations reais em um banco embutido (PGlite); o site usa Vitest com Testing Library.
6. Arquivos modificados (ainda fora do GitHub)
Alterados (16):

Backend: backend/.env.example, src/app.js, test/helpers/bancoAgenda.js
App: package.json, package-lock.json (dependência expo-clipboard), os três navegadores (AdminNavigator.tsx, BarbeiroNavigator.tsx, ClienteNavigator.tsx), cliente/AgendamentosScreen.tsx, cliente/BookingScreen.tsx
Site: App.tsx, Navbar.tsx, admin/AdminNav.tsx, Booking.tsx, MeusAgendamentos.tsx, test/booking-regra-diaria.test.tsx
Novos (20):

Backend: routes/pagamentos.js, services/mercadoPago.js, services/pagamentos.js, test/financeiro.sql.test.js, test/pagamentos.test.js
App: lib/financeiro.ts, lib/pagamentos.ts, screens/admin/FinanceiroAdminScreen.tsx, screens/barbeiro/FinanceiroScreen.tsx, screens/cliente/PagamentoScreen.tsx
Site: lib/financeiro.ts, lib/pagamentos.ts, pages/BarbeiroFinanceiro.tsx, pages/Pagamento.tsx, pages/admin/AdminComissoes.tsx, pages/admin/AdminFinanceiro.tsx, e os testes financeiro-paridade.test.ts, financeiro-telas.test.tsx, pagamento.test.tsx
Banco: supabase/migrations/20261105000018_financeiro.sql
7. Problemas conhecidos
Mercado Pago: nunca testado no sandbox real, porque não há credenciais. O webhook precisa de um endereço https público.
Checagem de tipos do app: acusa um erro em src/contexts/ThemeContext.tsx que já existia antes destas mudanças.
Avisos de lint antigos: 9 em MeusAgendamentos.tsx e 1 em Booking.tsx.
Tipos do Supabase: não foram regenerados. As tabelas e funções novas são acessadas com tipos escritos à mão.
Painel antigo: o card "Receita do mês" do dashboard ainda usa o cálculo antigo.
Notificações push: continuam sem funcionar.
App do admin: não tem configuração de percentuais, gráficos nem reembolsos; isso fica só no site.
Reembolsos: a taxa no reembolso é registrada como zero. Se o cliente pagar PIX e cartão ao mesmo tempo, a comissão não duplica, mas o reembolso de um deles é manual.
Privacidade: o aviso não menciona que o e-mail do cliente é enviado ao Mercado Pago.
8. Próximas tarefas
Rodar as migrations 17 (se pendente) e 18 no SQL Editor do Supabase.
Configurar as variáveis do backend: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET, MERCADOPAGO_NOTIFICATION_URL, MERCADOPAGO_AMBIENTE, PAGAMENTO_RETORNO_URL, PAGAMENTO_PIX_MINUTOS.
Cadastrar o webhook no painel do Mercado Pago (evento "Pagamentos", apontando para /api/pagamentos/webhook) e testar com usuários de teste.
Configurar em Admin → Comissões o percentual padrão e o de cada barbeiro.
Gerar um novo build pelo EAS, porque o expo-clipboard entrou no app, e testar em um celular.
Enviar as mudanças ao GitHub. Ainda não enviei; só faço quando você pedir.