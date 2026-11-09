Estado atual do projeto Visage Barber
1. Funcionalidades implementadas
Já enviadas ao GitHub (branch main):

Commit	O que entrou
e34f257	Financeiro, comissões e pagamentos online com Mercado Pago (backend, site, app e migrations 18 e 19)
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
docs/Respostas-Questionario-TCC.docx (na pasta do projeto, mas fora do Git de propósito)
2. Funcionalidades em desenvolvimento
Sistema financeiro, comissões e pagamentos online. O código e os testes estão prontos e já estão no GitHub (commit e34f257), mas a integração com o Mercado Pago ainda não foi validada no sandbox.

O que já existe:

Pagamento por PIX e cartão pelo Mercado Pago (cartão pelo Checkout Pro), e registro de pagamento na barbearia.
Comissão por barbeiro, com um percentual padrão e percentuais individuais.
Fechamento semanal e registro dos pagamentos feitos aos barbeiros.
Telas: Financeiro e Comissões para o admin (site); Meu Financeiro para o barbeiro (site e app); tela de pagamento do cliente (site e app); aba Financeiro do admin no app, com visão geral, gráficos, pagamentos (reembolso e duplicidades) e comissões.
Pagamento em duplicidade (ex.: cliente pagou PIX e cartão) fica registrado e destacado para o admin devolver; nada é devolvido automaticamente.
O card "Receita do mês" do dashboard usa os lançamentos do financeiro.
O aviso de privacidade informa o envio de dados ao Mercado Pago.
Para concluir falta:

rodar as migrations 18 e 19 (e a 17, se ainda não rodou) no Supabase;
confirmar a origem do token do Mercado Pago e atualizar a URL do webhook;
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
Um segundo pagamento aprovado para o mesmo agendamento é marcado como duplicidade: entra no total recebido, não gera comissão e precisa ser devolvido antes de reembolsar o pagamento que quitou o atendimento.
Cobrança online cancelada no sistema fica marcada até o backend confirmar o cancelamento no Mercado Pago.
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
Migration 19 (20261105000019_pagamentos_duplicidade_auditoria.sql): pagamentos em duplicidade, cancelamento de cobranças no Mercado Pago e histórico auditável. Roda depois da 18.

Proteções (18 e 19): gatilho que bloqueia alterações nos registros financeiros, índices únicos contra duplicidade, permissões por usuário (RLS) e funções SQL para cada operação (iniciar pagamento, aplicar estado, registrar pagamento na barbearia, reembolso, configurar comissão, pagar comissão, resumos e fechamento semanal).
5. Arquitetura
Monorepo C:\vb: backend (Express), cut-advisor-pro (site React/Vite), barber-mobile (app Expo 57) e supabase/migrations.
Backend: usa a chave de serviço do Supabase e a API REST do Mercado Pago, sem SDK. As rotas novas ficam em /api/pagamentos: criar, sincronizar, reembolsar, cancelar cobranças abertas e webhook.
Site e app: leem os dados direto do Supabase, sempre limitados pelas permissões do banco. As bibliotecas de pagamento e financeiro são iguais nas duas plataformas, e um teste confere isso.
Testes: o backend roda as migrations reais em um banco embutido (PGlite); o site usa Vitest com Testing Library.
6. Situação no GitHub
Tudo foi enviado para a main no commit e34f257 (51 arquivos), depois de passar nos testes: 159 no backend e 206 no site.
Ficou fora do Git: docs/Respostas-Questionario-TCC.docx e os arquivos .env.
7. Problemas conhecidos
Mercado Pago: nunca testado no sandbox real.
As variáveis do backend/.env já foram preenchidas (06/11). O token começa com APP_USR-, e falta confirmar se é da conta vendedora de teste. Se for da conta real da barbearia, cobra dinheiro de verdade.
As contas de teste já foram criadas no painel: Buyer Test User, Conta de Teste (outro comprador) e Seller Test User.
O webhook usa um túnel temporário do Cloudflare (trycloudflare.com). A URL muda a cada reinício do cloudflared e precisa ser atualizada no .env e no painel.
Checagem de tipos do app: acusa um erro em src/contexts/ThemeContext.tsx que já existia antes destas mudanças.
Avisos de lint antigos: 9 em MeusAgendamentos.tsx e 1 em Booking.tsx.
Tipos do Supabase: não foram regenerados. As tabelas e funções novas são acessadas com tipos escritos à mão.
Notificações push: continuam sem funcionar.
Reembolsos: a taxa no reembolso é registrada como zero. A devolução de um pagamento em duplicidade é feita manualmente pelo admin.
8. Próximas tarefas
Rodar as migrations 17 (se pendente), 18 e 19, nessa ordem, no SQL Editor do Supabase.
Na conta Seller Test User, criar uma aplicação e usar o Access Token e a assinatura secreta dela em MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_WEBHOOK_SECRET.
Subir o backend e o túnel (cloudflared tunnel --url http://localhost:3001) e atualizar MERCADOPAGO_NOTIFICATION_URL e o webhook no painel (evento "Pagamentos", em /api/pagamentos/webhook).
Testar o cartão com o Buyer Test User numa janela anônima: cartão 5031 4332 1540 6351, CVV 123, validade 11/30, CPF 12345678909. O nome do titular define o resultado: APRO aprova, OTHE recusa, CONT fica pendente.
Testar o PIX: gerar o QR Code e ver a expiração. No sandbox, a aprovação costuma não ser possível; ela só se valida em produção, com uma cobrança pequena.
Configurar em Admin → Comissões o percentual padrão e o de cada barbeiro.
Gerar um novo build pelo EAS, porque o expo-clipboard entrou no app, e testar em um celular.
