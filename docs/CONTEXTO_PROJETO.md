Estado atual do projeto Visage Barber
1. Funcionalidades implementadas
Já enviadas ao GitHub (branch main):

Commit	O que entrou
94b6c67	Painel do Barbeiro (resumo do dia + financeiro) e Agenda separada com os modos Por dia, Próximos e Histórico (site e app)
ecc7d7a	Meu desempenho do barbeiro: dias com mais cortes e origem do percentual (migration 20)
12c2bd6	O agendamento no app recomeça do início ao trocar de aba, como no site
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
Telas: Financeiro e Comissões para o admin (site); financeiro do barbeiro dentro do Painel do Barbeiro (site e app); tela de pagamento do cliente (site e app); aba Financeiro do admin no app, com visão geral, gráficos, pagamentos (reembolso e duplicidades) e comissões.
Pagamento em duplicidade (ex.: cliente pagou PIX e cartão) fica registrado e destacado para o admin devolver; nada é devolvido automaticamente.
O card "Receita do mês" do painel do admin usa os lançamentos do financeiro.
O aviso de privacidade informa o envio de dados ao Mercado Pago.
Painel e Agenda do barbeiro (commits ecc7d7a e 94b6c67), iguais no site e no app:

Painel do Barbeiro (site /dashboard, aba PAINEL do app): a tela principal do barbeiro. Resumo do dia (situação e atendimentos de hoje, com cancelar, registrar falta e chat) e o botão Abrir agenda; Meu desempenho (faturamento gerado, minha comissão, meu percentual), com os filtros Hoje, Esta semana, Este mês, Últimos 30 dias e Personalizado; gráfico de dias com mais cortes; comissões e recebimentos. O financeiro do barbeiro fica só aqui.
Agenda (site /barbeiro/agenda, aba AGENDA do app): o gerenciamento completo dos agendamentos. Modos Por dia (navegação por datas), Próximos (lista completa) e Histórico, com cancelar, registrar falta e chat com as mensagens não lidas. Não mostra nada do financeiro.
"Meu Financeiro" deixou de ser uma tela separada: o endereço antigo /barbeiro/financeiro leva ao Painel. O login do barbeiro abre o Painel.
Para concluir falta:

rodar as migrations 18, 19 e 20 (e a 17, se ainda não rodou) no Supabase;
confirmar a origem do token do Mercado Pago e atualizar a URL do webhook;
testar no sandbox e em um celular;
conferir o Painel e a Agenda do app em um celular (o app não tem testes automatizados de tela).
Notificações push (Android/APK), em implementação por etapas (plano aprovado em 09/11):

Etapa 1 (banco): migrations 21, 22 e 23, já executadas no Supabase e conferidas com a auditoria (supabase/verificacoes/notificacoes_auditoria.sql).
Etapa 2 (backend): pronta, testada e publicada no GitHub, mas ainda desligada (ativação pendente). Falta aprovar e rodar a migration 24 (proposta) e configurar as variáveis.
Próximas etapas: app (registro do aparelho, canais do Android, toque abrindo a tela certa, tela de preferências), configuração externa (Firebase, Expo, Render, EAS) e teste num celular Android.
Avisos: novo agendamento (para o barbeiro), cancelamento (para o outro lado), nova mensagem (para o outro participante, sem o texto) e lembrete 30 minutos antes (ligado para clientes; desligado por padrão para barbeiros).
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
Painel e Agenda:

Faturamento e comissão do Painel vêm só dos lançamentos oficiais (atendimentos concluídos e pagos, com descontos, reembolsos e estornos). Pagamento em duplicidade não entra.
O gráfico de dias com mais cortes conta os atendimentos concluídos, pagos ou não, de segunda a domingo, no horário de Brasília. Não é um valor financeiro.
O percentual exibido é o individual; sem ele, o padrão da barbearia; sem nenhum dos dois, aparece como pendente.
Cancelar e registrar falta seguem a mesma regra e a mesma confirmação no Painel e na Agenda: "Cliente faltou" aparece depois do horário ou quando o atendimento já foi concluído; cancelado não tem ação. Registrar falta num atendimento concluído e pago gera o estorno da comissão.
Cada barbeiro só vê os próprios dados: as funções do banco identificam o barbeiro pelo login.
Notificações:

Os avisos nascem no banco, por gatilho, na mesma transação do evento: operação desfeita não gera aviso, e o mesmo evento nunca gera dois avisos (chave única).
Quem fez a ação nunca é avisado dela. Cancelar depois do horário é falta (igual ao botão "Cliente faltou") e não avisa ninguém.
Na hora do envio, o banco confere de novo se o aviso ainda vale: agendamento cancelado ou com horário passado, mensagem já lida, preferência desligada ou aparelho de outra conta não recebem nada.
A notificação de mensagem nunca leva o texto, só "Você recebeu uma mensagem de <primeiro nome>". Várias mensagens seguidas da mesma conversa viram um aviso só, com a contagem.
Falha no envio nunca impede agendar, cancelar ou mandar mensagem.
4. Estrutura do banco (Supabase)
Tabelas que já existiam e foram usadas: agendamentos, servicos, barbeiros, profiles, user_roles, conversas e mensagens.

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

Migration 20 (20261109000020_meu_desempenho.sql): função meu_desempenho, só de leitura (atendimentos concluídos por dia da semana e origem do percentual). Roda depois da 19.

Migration 21 (20261109000021_notificacoes.sql): tabelas dispositivos_push, notificacao_preferencias, notificacoes (fila e histórico) e notificacao_envios (resultado por aparelho), sem acesso direto do app ou do site; funções do app (registrar e remover o próprio aparelho, preferências) e do backend (reservar, concluir, recibos).

Migration 22 (20261109000022_notificacoes_eventos.sql): gatilhos de novo agendamento, cancelamento e mensagem; lembretes; job do pg_cron a cada minuto; chamada ao backend pelo pg_net; limpeza do histórico após 90 dias. Exige a 21.

Migration 23 (20261109000023_remover_push_token_antigo.sql): removeu as colunas antigas push_token de barbeiros e profiles.

Migration 24 (20261109000024_notificacoes_segredo.sql): PROPOSTA, ainda não executada. Faz o banco mandar o segredo (guardado no Supabase Vault) ao chamar o backend; sem ela, a rota de processamento recusa as chamadas do banco. Exige a 22.

Verificações somente leitura: supabase/verificacoes/notificacoes_pre_requisitos.sql e notificacoes_auditoria.sql.

Proteções (18 e 19): gatilho que bloqueia alterações nos registros financeiros, índices únicos contra duplicidade, permissões por usuário (RLS) e funções SQL para cada operação (iniciar pagamento, aplicar estado, registrar pagamento na barbearia, reembolso, configurar comissão, pagar comissão, resumos e fechamento semanal).
5. Arquitetura
Monorepo C:\vb: backend (Express), cut-advisor-pro (site React/Vite), barber-mobile (app Expo 57) e supabase/migrations.
Backend: usa a chave de serviço do Supabase e a API REST do Mercado Pago, sem SDK. As rotas novas ficam em /api/pagamentos: criar, sincronizar, reembolsar, cancelar cobranças abertas e webhook.
Site e app: leem os dados direto do Supabase, sempre limitados pelas permissões do banco. As bibliotecas de pagamento e financeiro são iguais nas duas plataformas, e um teste confere isso.
Painel e Agenda do barbeiro: consultas, regras de cancelamento e falta, textos e períodos ficam em lib/painelBarbeiro.ts, igual no site e no app (o teste de paridade confere). Componentes: cut-advisor-pro/src/components/barbeiro/ e barber-mobile/src/components/barbeiro/.
Notificações (backend): services/expoPush.js (cliente da Expo: lotes de 100 mensagens, recibos em lotes de 1000, timeout, erros classificados sem guardar o texto da Expo, que pode conter o token), services/notificacoes.js (textos, envio, gravação do resultado e recibos) e routes/notificacoes.js.
Rotas: POST /api/notificacoes/processar é chamada pelo banco com o cabeçalho X-Notificacoes-Segredo (comparado em tempo constante; sem segredo configurado, a rota fica fechada), responde 202 e só faz o backend ler a fila; quem chama não escolhe destinatário nem texto. POST /api/notificacoes/teste é para o usuário logado: envia um aviso de teste aos próprios aparelhos, sem gravar nada na fila e sem devolver tokens. Limites: em /processar, o segredo é conferido antes de qualquer limite; as chamadas autenticadas (só o banco tem o segredo) têm um limite próprio de 120 por minuto, e as tentativas sem segredo ou com segredo errado têm outro, de 20 por minuto por IP, que nunca bloqueia as chamadas do banco. /teste: 3 testes a cada 10 minutos por usuário. No Render, TRUST_PROXY=1 faz o Express usar o IP real que o proxy do Render acrescenta ao X-Forwarded-For; o IP só freia tentativas inválidas, nunca autentica.
Fila: o backend reserva os avisos no banco (sem duplicar, mesmo com dois servidores), envia pela Expo e grava o resultado por aparelho. Falha temporária volta para a fila com espera (30 s, 2, 8 e 32 minutos; desiste na 5ª). DeviceNotRegistered desativa o aparelho. Se o envio der certo e a gravação falhar, o resultado fica guardado e o aviso não é reenviado. Os recibos são conferidos depois de 15 minutos. "Enviada" no banco quer dizer aceita pela Expo; a entrega é confirmada pelo recibo. Enquanto o servidor está acordado, a fila também é lida a cada 20 segundos.
Variáveis do backend: NOTIFICACOES_ATIVAS (sem "true", nada é enviado), NOTIFICACOES_SEGREDO (mínimo de 32 caracteres; o mesmo valor vai para o Vault), EXPO_ACCESS_TOKEN, NOTIFICACOES_INTERVALO_SEGUNDOS (padrão 20) e NOTIFICACOES_TIMEOUT_SEGUNDOS (padrão 10).
Testes: o backend roda as migrations reais em um banco embutido (PGlite) e testa as notificações com uma Expo falsa (nenhum envio real); o site usa Vitest com Testing Library; o app não tem testes automatizados (é validado com tsc e com o pacote do Expo).
6. Situação no GitHub
Tudo foi enviado para a main. Último commit de código: 94b6c67, depois de passar nos testes: 170 no backend e 228 no site.
As notificações (etapas 1 e 2) já estão versionadas no repositório, mas ainda não foram ativadas em produção. Com elas, o backend tem 245 testes, todos passando.
Ficou fora do Git: docs/Respostas-Questionario-TCC.docx e os arquivos .env.
7. Problemas conhecidos
Mercado Pago: nunca testado no sandbox real.
As variáveis do backend/.env já foram preenchidas (06/11). O token começa com APP_USR-, e falta confirmar se é da conta vendedora de teste. Se for da conta real da barbearia, cobra dinheiro de verdade.
As contas de teste já foram criadas no painel: Buyer Test User, Conta de Teste (outro comprador) e Seller Test User.
O webhook usa um túnel temporário do Cloudflare (trycloudflare.com). A URL muda a cada reinício do cloudflared e precisa ser atualizada no .env e no painel.
Checagem de tipos do app: acusa um erro em src/contexts/ThemeContext.tsx que já existia antes destas mudanças.
Avisos de lint antigos: 9 em MeusAgendamentos.tsx e 1 em Booking.tsx.
Tipos do Supabase: não foram regenerados. As tabelas e funções novas são acessadas com tipos escritos à mão.
Notificações push: o banco já gera os avisos (migrations 21 a 23), mas nada é enviado ainda: o backend está desligado e o app não registra aparelhos. Até lá, os avisos ficam na fila e vencem sozinhos.
A função pedir_notificacao_teste (migration 22) grava o teste na fila e ficou sem uso: o teste agora é feito pela rota do backend, que não grava nada.
Reembolsos: a taxa no reembolso é registrada como zero. A devolução de um pagamento em duplicidade é feita manualmente pelo admin.
Sem a migration 20, o gráfico de dias com mais cortes mostra um erro; o resto do Painel funciona.
No app, a aba HORÁRIOS (disponibilidade) ainda tem o título "Minha Agenda", o que pode confundir com a aba AGENDA.
8. Próximas tarefas
Rodar as migrations 17 (se pendente), 18, 19 e 20, nessa ordem, no SQL Editor do Supabase.
Na conta Seller Test User, criar uma aplicação e usar o Access Token e a assinatura secreta dela em MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_WEBHOOK_SECRET.
Subir o backend e o túnel (cloudflared tunnel --url http://localhost:3001) e atualizar MERCADOPAGO_NOTIFICATION_URL e o webhook no painel (evento "Pagamentos", em /api/pagamentos/webhook).
Testar o cartão com o Buyer Test User numa janela anônima: cartão 5031 4332 1540 6351, CVV 123, validade 11/30, CPF 12345678909. O nome do titular define o resultado: APRO aprova, OTHE recusa, CONT fica pendente.
Testar o PIX: gerar o QR Code e ver a expiração. No sandbox, a aprovação costuma não ser possível; ela só se valida em produção, com uma cobrança pequena.
Configurar em Admin → Comissões o percentual padrão e o de cada barbeiro.
Gerar um novo build pelo EAS (entraram o expo-clipboard, o Painel e a Agenda) e testar em um celular.
Testar o Painel e a Agenda no site e no celular: resumo do dia, cancelar e registrar falta, chat, filtros e gráfico no Painel; Por dia (setas e voltar para hoje), Próximos e Histórico na Agenda.
Notificações, para ativar o envio real:
aprovar e rodar a migration 24;
gerar o segredo e guardá-lo no Render (NOTIFICACOES_SEGREDO) e no Supabase Vault (nome notificacoes_segredo_backend);
criar o token de acesso da Expo e ligar a segurança de push (EXPO_ACCESS_TOKEN no Render);
configurar o FCM: projeto no Firebase, google-services.json no app e chave FCM V1 enviada ao EAS;
publicar o backend com NOTIFICACOES_ATIVAS=true;
gravar a URL do backend no Supabase (UPDATE public.notificacao_config SET url_backend = 'https://...');
implementar a etapa do app e testar num celular Android com contas de teste.
