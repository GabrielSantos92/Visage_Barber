Estado atual do projeto Visage Barber
Atualizado em 13/11/2026.

0. Regras obrigatórias (valem para qualquer conversa)
Sem autorização explícita do usuário: não executar SQL no Supabase, não aplicar migrations, não fazer commit, push nem deploy e não gravar a URL do backend no Supabase (notificacao_config.url_backend).
Não alterar o Render nem a Meta. Não criar nem modificar variáveis de ambiente (Render, Environment Groups, Secret Files, .env local).
Nunca configurar NOTIFICACOES_ATIVAS em lugar nenhum, nem com o valor false: Render, Environment Groups, Secret Files, .env, testes, piloto e rollbacks. No código do commit 83d45a6, "true" liga o envio pela Expo, e um rollback no Render restaura as variáveis do deploy de destino.
Não ativar push nem WhatsApp. No código de 13/11 (ainda sem commit), cada canal tem a sua chave (NOTIFICACOES_WHATSAPP_ATIVO e NOTIFICACOES_PUSH_ATIVO) e NOTIFICACOES_ATIVAS preenchida faz nenhum canal ligar; nenhuma dessas variáveis deve ser criada sem autorização.
Antes de rodar qualquer migration, mostrar o conteúdo, as dependências e a ordem. Usar só contas de teste. Parar ao fim de cada etapa e relatar arquivos, testes e resultados.
Nunca ler nem mostrar valores de segredos; só os nomes das variáveis. Ler o valor decifrado do Vault, mesmo só para conferir o formato (devolvendo verdadeiro ou falso), exige autorização explícita.
Nunca consultar os cabeçalhos de net.http_request_queue (nem SELECT *): com a migration 24 antiga aplicada em produção, eles levam o segredo.
O trabalho atual das notificações (migration 24 revisada, auditorias, consulta de dono e testes) está só nos scratchpads (seções 9.10 e 9.13), não no projeto. Não alterar arquivos do projeto sem pedido explícito.
1. Funcionalidades implementadas
Já enviadas ao GitHub (branch main):

Commit	O que entrou
83d45a6	Notificações push: banco (migrations 21 a 23) e backend, desligados. O canal foi trocado pelo WhatsApp em 11/11 (seção 9)
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
Notificações: o canal mudou de push para WhatsApp (decisão do grupo em 11/11/2026). O push não será ativado, e a etapa do app (registro do aparelho, Firebase, FCM) foi cancelada. Em 13/11 a confirmação de presença pelo WhatsApp foi implementada no projeto (seção 9.15), ainda sem commit, sem deploy e sem nada aplicado no Supabase; a migration 24 revisada e a auditoria continuam em revisão. Em 12/11 o usuário aplicou em produção a migration 24 ANTIGA, criou o segredo no Vault e configurou a URL do backend (seção 9.11). O diagnóstico de 12/11 está na seção 9.14. Estado completo na seção 9.
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
Notificações (regras já implementadas no banco e no envio por push; valem para a fila, qualquer que seja o canal. As regras do WhatsApp estão na seção 9.1):

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

Migration 24 (20261109000024_notificacoes_segredo.sql): o arquivo do repositório (commit 83d45a6) é a versão ANTIGA, que manda um segredo fixo no cabeçalho X-Notificacoes-Segredo. Foi executada em produção pelo usuário em 12/11 (seção 9.11; ainda não confirmado por consulta). A versão revisada (assinatura HMAC e proteção contra repetição) está só no scratchpad, aguardando aprovação (seções 9.3 e 9.11). Depois de aplicar a revisada, nunca rodar de novo a antiga: isso desfaria a revisada.

Migration 25 (20261113000025_whatsapp_confirmacao_presenca.sql): confirmação de presença pelo WhatsApp 2 horas antes. Criada em 13/11, sem commit e NÃO executada no Supabase (seção 9.15). Exige a 16 (consentimentos), a 21 e a 22.

Verificações somente leitura: supabase/verificacoes/notificacoes_pre_requisitos.sql e notificacoes_auditoria.sql (no Git; as linhas 197 a 201 da notificacoes_auditoria.sql reconhecem a 24 pelo cabeçalho antigo e, depois da revisada, dirão erradamente que a 24 não foi aplicada; hoje, com a 24 antiga e a URL configurada, ela dá OK para "envia o segredo" e para a URL (linha 181), enquanto a auditoria revisada dá PROBLEMA na C.7 e ATENÇÃO na D.14 para o mesmo estado: vale a leitura da revisada); supabase/verificacoes/notificacoes_pre_ativacao.sql (fora do Git, versão antiga e nunca executada; a revisada está no scratchpad, seção 9.7); confirmar_dono.sql (scratchpad, seções 9.12 e 9.13).

Proteções (18 e 19): gatilho que bloqueia alterações nos registros financeiros, índices únicos contra duplicidade, permissões por usuário (RLS) e funções SQL para cada operação (iniciar pagamento, aplicar estado, registrar pagamento na barbearia, reembolso, configurar comissão, pagar comissão, resumos e fechamento semanal).
5. Arquitetura
Monorepo C:\vb: backend (Express), cut-advisor-pro (site React/Vite), barber-mobile (app Expo 57) e supabase/migrations.
Backend: usa a chave de serviço do Supabase e a API REST do Mercado Pago, sem SDK. As rotas novas ficam em /api/pagamentos: criar, sincronizar, reembolsar, cancelar cobranças abertas e webhook. Publicado no Render; a URL está em barber-mobile/eas.json.
Site e app: leem os dados direto do Supabase, sempre limitados pelas permissões do banco. As bibliotecas de pagamento e financeiro são iguais nas duas plataformas, e um teste confere isso.
Painel e Agenda do barbeiro: consultas, regras de cancelamento e falta, textos e períodos ficam em lib/painelBarbeiro.ts, igual no site e no app (o teste de paridade confere). Componentes: cut-advisor-pro/src/components/barbeiro/ e barber-mobile/src/components/barbeiro/.
Notificações (backend), código do commit 83d45a6, feito para push pela Expo e desligado: services/expoPush.js (cliente da Expo: lotes de 100 mensagens, recibos em lotes de 1000, timeout, erros classificados sem guardar o texto da Expo, que pode conter o token), services/notificacoes.js (textos, envio, gravação do resultado e recibos) e routes/notificacoes.js.
Rotas: POST /api/notificacoes/processar é chamada pelo banco com o cabeçalho X-Notificacoes-Segredo (comparado em tempo constante; sem segredo configurado, a rota fica fechada), responde 202 e só faz o backend ler a fila; quem chama não escolhe destinatário nem texto. Esse cabeçalho é o formato antigo: será trocado pela verificação da assinatura HMAC, ainda não implementada (seção 9.4). Com o backend desligado, a rota responde 503 antes de olhar o cabeçalho (exigirAtivo vem primeiro: routes/notificacoes.js:45-48 e 68); ela é montada em app.js:30. POST /api/notificacoes/teste é para o usuário logado: envia um aviso de teste aos próprios aparelhos, sem gravar nada na fila e sem devolver tokens. Limites: em /processar, o segredo é conferido antes de qualquer limite; as chamadas autenticadas (só o banco tem o segredo) têm um limite próprio de 120 por minuto, e as tentativas sem segredo ou com segredo errado têm outro, de 20 por minuto por IP, que nunca bloqueia as chamadas do banco. /teste: 3 testes a cada 10 minutos por usuário. No Render, TRUST_PROXY=1 faz o Express usar o IP real que o proxy do Render acrescenta ao X-Forwarded-For; o IP só freia tentativas inválidas, nunca autentica.
Fila: o backend reserva os avisos no banco (sem duplicar, mesmo com dois servidores), envia pela Expo e grava o resultado por aparelho. Falha temporária volta para a fila com espera (30 s, 2, 8 e 32 minutos; desiste na 5ª). DeviceNotRegistered desativa o aparelho. Se o envio der certo e a gravação falhar, o resultado fica guardado e o aviso não é reenviado. Os recibos são conferidos depois de 15 minutos. "Enviada" no banco quer dizer aceita pela Expo; a entrega é confirmada pelo recibo. Enquanto o servidor está acordado, a fila também é lida a cada 20 segundos.
Variáveis do backend no código do 83d45a6: NOTIFICACOES_ATIVAS (NUNCA configurar: "true" liga o envio pela Expo; ver a seção 0), NOTIFICACOES_SEGREDO (mínimo de 32 caracteres; o mesmo valor vai para o Vault; já configurada no Render, e em 12/11 o usuário conferiu por SHA-256 que é igual à do Vault), EXPO_ACCESS_TOKEN (nunca será configurado), NOTIFICACOES_INTERVALO_SEGUNDOS (padrão 20) e NOTIFICACOES_TIMEOUT_SEGUNDOS (padrão 10). As variáveis planejadas para o WhatsApp ainda não existem no código (seção 9.2).
WhatsApp (código de 13/11, sem commit, desligado; seção 9.15): services/whatsapp.js (cliente da Cloud API e assinatura do webhook), services/confirmacaoPresenca.js (envio e respostas), services/notificacoesConfig.js (chaves por canal) e routes/whatsapp.js (webhook em /api/whatsapp/webhook).
Testes: o backend roda as migrations reais em um banco embutido (PGlite) e testa as notificações com uma Expo falsa e uma Meta falsa (nenhum envio real); o site usa Vitest com Testing Library; o app não tem testes automatizados (é validado com tsc e com o pacote do Expo).
6. Situação no GitHub
Tudo foi enviado para a main. Último commit: 83d45a6 (notificações push, banco e backend desligados). Com ele, o backend tem 245 testes, todos passando (registrado em 10/11). Antes, o commit 94b6c67 (Painel e Agenda) passou com 170 testes no backend e 228 no site.
Ficou fora do Git de propósito: docs/Respostas-Questionario-TCC.docx e os arquivos .env.
Alterações locais ainda sem commit: barber-mobile/app.json (android.versionCode 2, usado no build do APK de 10/11), supabase/verificacoes/notificacoes_pre_ativacao.sql (auditoria antiga, nunca executada), este docs/CONTEXTO_PROJETO.md e toda a implementação da confirmação de presença pelo WhatsApp de 13/11 (lista de arquivos na seção 9.15). Com ela, em 13/11: backend 289 testes e site 235, todos passando; o app passa no tsc só com o erro antigo do ThemeContext.
A migration 24 revisada, a auditoria revisada e a consulta de dono (confirmar_dono.sql) não estão no projeto: estão nos scratchpads (seções 9.10 e 9.13).
7. Problemas conhecidos
Mercado Pago: nunca testado no sandbox real.
As variáveis do backend/.env já foram preenchidas (06/11). O token começa com APP_USR-, e falta confirmar se é da conta vendedora de teste. Se for da conta real da barbearia, cobra dinheiro de verdade.
As contas de teste já foram criadas no painel: Buyer Test User, Conta de Teste (outro comprador) e Seller Test User.
O webhook usa um túnel temporário do Cloudflare (trycloudflare.com). A URL muda a cada reinício do cloudflared e precisa ser atualizada no .env e no painel.
Checagem de tipos do app: acusa um erro em src/contexts/ThemeContext.tsx que já existia antes destas mudanças.
Avisos de lint antigos: 9 em MeusAgendamentos.tsx e 1 em Booking.tsx.
Tipos do Supabase: não foram regenerados. As tabelas e funções novas são acessadas com tipos escritos à mão.
Notificações: o banco gera os avisos na fila (migrations 21 a 23), mas nada é enviado: o backend está desligado e o app não registra aparelhos (o push foi cancelado). Os avisos vencem sozinhos. Desde 12/11, com a 24 antiga e a URL configurada, o banco chama o backend a cada aviso novo e a cada minuto enquanto houver aviso pendente: cada chamada leva o segredo fixo no cabeçalho, acorda o Render e recebe 503 sem processar nada (seção 9.11).
A função pedir_notificacao_teste (migration 22) grava o teste na fila e ficou sem uso: o teste agora é feito pela rota do backend, que não grava nada.
Reembolsos: a taxa no reembolso é registrada como zero. A devolução de um pagamento em duplicidade é feita manualmente pelo admin.
Sem a migration 20, o gráfico de dias com mais cortes mostra um erro; o resto do Painel funciona.
No app, a aba HORÁRIOS (disponibilidade) ainda tem o título "Minha Agenda", o que pode confundir com a aba AGENDA.
APK de 10/11 (build EAS 238b6929, preview, versionCode 2, commit 83d45a6): não tem notificações, e o link do artefato expira em 24/11/2026.
8. Próximas tarefas
Rodar as migrations 17 (se pendente), 18, 19 e 20, nessa ordem, no SQL Editor do Supabase.
Na conta Seller Test User, criar uma aplicação e usar o Access Token e a assinatura secreta dela em MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_WEBHOOK_SECRET.
Subir o backend e o túnel (cloudflared tunnel --url http://localhost:3001) e atualizar MERCADOPAGO_NOTIFICATION_URL e o webhook no painel (evento "Pagamentos", em /api/pagamentos/webhook).
Testar o cartão com o Buyer Test User numa janela anônima: cartão 5031 4332 1540 6351, CVV 123, validade 11/30, CPF 12345678909. O nome do titular define o resultado: APRO aprova, OTHE recusa, CONT fica pendente.
Testar o PIX: gerar o QR Code e ver a expiração. No sandbox, a aprovação costuma não ser possível; ela só se valida em produção, com uma cobrança pequena.
Configurar em Admin → Comissões o percentual padrão e o de cada barbeiro.
Testar num celular o APK de 10/11 (já gerado pelo EAS, com o expo-clipboard, o Painel e a Agenda).
Testar o Painel e a Agenda no site e no celular: resumo do dia, cancelar e registrar falta, chat, filtros e gráfico no Painel; Por dia (setas e voltar para hoje), Próximos e Histórico na Agenda.
Notificações: a lista antiga de ativação do push foi cancelada e não deve ser seguida. O próximo passo está nas seções 9.9 e 9.11.
9. Notificações por WhatsApp: estado em 12/11/2026
9.1 Decisões aprovadas pelo grupo (11/11)

O WhatsApp Cloud API (Meta) é o único canal, para clientes e barbeiros, com um número oficial da Visage (nenhum número por barbeiro). O push não será ativado; o código do push só será removido depois que o WhatsApp for validado em produção (última etapa).
Cinco avisos: novo agendamento (cliente e barbeiro); cancelamento (para o outro lado, dizendo quem cancelou); lembrete 30 minutos antes (cliente); confirmação de presença 2 horas antes, com SIM ou NÃO; aviso genérico de mensagem no chat (nunca o conteúdo).
A primeira resposta válida é a definitiva; respostas depois não a revertem. NÃO cancela (depois de reconferir o agendamento), libera o horário e registra a origem "resposta negativa pelo WhatsApp". Sem resposta, o agendamento continua e o barbeiro vê "Sem resposta".
Barbeiros não recebem lembretes pelo WhatsApp. Cancelamento nunca gera reembolso automático; a lógica de pagamento não muda.
Em 12/11 o usuário pediu, como primeira entrega, um lembrete simples ao cliente 2 horas antes (seção 9.14). Falta ele confirmar se isso substitui o lembrete de 30 minutos e a confirmação de presença com SIM ou NÃO desta lista, ou se é só a primeira parte.
9.2 Plano aprovado como base (nada implementado)

Reaproveita a fila public.notificacoes (com uma coluna canal), os gatilhos da migration 22, o job notificacoes-rotina do pg_cron, notificacao_preferencias e consentimentos (nova finalidade).
Tabelas novas: whatsapp_contatos, whatsapp_mensagens, whatsapp_eventos e confirmacoes_presenca (onde fica o estado da confirmação; o token é guardado como hash). agendamentos ganha só cancelamento_origem, cancelado_em, cancelado_por e horario_definido_em; o enum de status não muda.
Respostas: botão exige payload, token, context.id e remetente; texto digitado só vale como "sim", "não" ou "nao" exatos, quando o remetente tem exatamente uma confirmação aberta. "Primeira resposta válida" é a primeira gravada no banco; as respostas candidatas esperam cerca de 10 s e são ordenadas pelo timestamp da Meta; SIM e NÃO no mesmo segundo são ambíguos. Ordem das travas: primeiro o agendamento, depois a confirmação.
O webhook precisa do corpo bruto da requisição, mas o app.js aplica express.json a todas as rotas: ajustar na implementação.
Consentimento: duplo opt-in (caixa no app e depois "ATIVAR <código>" pelo link wa.me). PARAR, SAIR e STOP descadastram (nunca CANCELAR); voltar só pelo app. O CHECK de consentimentos.revogado_origem precisa aceitar 'whatsapp', e o aviso de privacidade ganha uma seção própria, com versão, como a dos pagamentos.
Variáveis planejadas (ainda não existem no código): sem chave geral; o WhatsApp liga só com NOTIFICACOES_WHATSAPP_ATIVO=true e todas as credenciais da Meta; o push, só com NOTIFICACOES_PUSH_ATIVO=true e EXPO_ACCESS_TOKEN (que nunca será configurado). No código novo, NOTIFICACOES_ATIVAS faz nenhum canal ligar, mas isso não protege rollbacks: nunca configurá-la (seção 0). WHATSAPP_PILOTO_USUARIOS guarda os ids dos usuários do piloto. NOTIFICACOES_SEGREDO_ANTERIOR (opcional) serve para trocar o segredo. O filtro canal = 'push' em reservar_notificacoes fica para uma migration 25.
Rollback no Render: preferir um deploy que já tenha o WhatsApp; conferir no log a linha "[notificacoes] desligadas"; rollback pelo painel desliga o auto-deploy; voltar para frente com deploy manual, não com outro rollback.
Começar pelo número de teste gratuito da Meta (até 5 destinatários). O armazenamento local da Cloud API (Brasil) só pode ser escolhido antes de registrar o número oficial.
Fatos da Meta conferidos em 11/11: desde 01/10/2026, templates de utilidade são cobrados mesmo dentro da janela de 24 h; mensagens de serviço são gratuitas até 1.000 por mês por número; os webhooks trazem o BSUID desde abril de 2026; portfólios novos têm limite de 250 usuários por 24 h; templates de utilidade aceitam validade (TTL) de 30 s a 12 h; a Cloud API não tem chave de idempotência documentada para envio; o contexto de resposta em texto não é documentado.
9.3 Migration 24 revisada (no scratchpad; não aplicada; não está no projeto)

Arquivo: migration24\20261109000024_notificacoes_segredo.sql (seção 9.10). Se aprovada, substituirá o arquivo antigo de mesmo nome no repositório.
Tudo numa única transação (BEGIN ... COMMIT): qualquer falha desfaz tudo. Logo depois do BEGIN, SET LOCAL search_path = pg_catalog, pg_temp (vale só até o COMMIT).
Precondições: migration 22 aplicada; pgcrypto no schema extensions; nenhuma outra public.registrar_despertar com outros parâmetros. Precisa rodar como o dono de despertar_backend (provavelmente postgres; confirmar com o confirmar_dono.sql, seção 9.12). A migration não confere isso: um membro do papel dono consegue aplicá-la e deixa donos diferentes.
Tabela de nonces: criada se não existir. Se já existir, ou logo depois de criada, é conferida por inteiro: estrutura (com índices), dono, RLS ligado e não forçado, sem policies, triggers e regras, sem permissões para PUBLIC, anon e authenticated. Qualquer diferença para a migration com mensagem clara; uma tabela existente nunca é adaptada.
registrar_despertar é criada, com REVOKE de PUBLIC, anon e authenticated e GRANT só para a service_role, na mesma transação: nenhuma outra sessão a vê antes do COMMIT.
despertar_backend é trocada pela versão assinada (seção 9.4). As duas funções são SECURITY DEFINER com SET search_path = pg_catalog, pg_temp. search_path = '' foi avaliado e recusado: sem pg_temp na lista, o schema temporário é procurado primeiro para nomes de tabela e de tipo (num teste, um domínio temporário chamado "text" capturou o segredo do Vault).
Conferência final antes do COMMIT: as duas funções são SECURITY DEFINER, com o search_path exato e sem EXECUTE para PUBLIC, anon e authenticated, e a service_role executa registrar_despertar.
Pode ser executada de novo: com tudo já instalado, não muda nada. O segredo nunca fica no arquivo nem no Git; os comandos do Vault estão no cabeçalho do arquivo. O segredo já existe no Vault desde 12/11: não rodar o vault.create_secret do cabeçalho.
9.4 HMAC (assinatura da chamada do banco ao backend)

Cabeçalho X-Notificacoes-Assinatura: t=<segundos>,n=<nonce de 32 hexadecimais>,v1=<64 hexadecimais>, com HMAC-SHA256(segredo, 'v1:<t>:<n>:POST:/api/notificacoes/processar'). O segredo nunca viaja.
Segredo: 32 ou mais caracteres, só letras, dígitos, _ e -. O mesmo valor fica em NOTIFICACOES_SEGREDO (Render) e no Vault (notificacoes_segredo_backend). Em 12/11 o usuário configurou os dois com o mesmo valor (conferido por SHA-256); falta confirmar se está nesse formato (consulta 3c da seção 9.11).
O banco só chama por https. Sem URL, sem pg_net ou sem segredo válido, despertar_backend devolve false e não chama ninguém.
Backend (não implementado): conferir a assinatura e a janela (de agora - 300 s a agora + 60 s) antes de chamar registrar_despertar, e tratar qualquer resposta diferente de true (inclusive erro ou timeout da chamada) como recusa. O código atual (83d45a6) ainda confere o cabeçalho antigo X-Notificacoes-Segredo.
9.5 Nonces (proteção contra repetição)

Tabela public.notificacoes_despertares: nonce text PRIMARY KEY, com CHECK de 32 hexadecimais minúsculos; t bigint NOT NULL; registrado_em timestamptz NOT NULL DEFAULT now(); índice em t; RLS ligado, sem policies; sem permissões para PUBLIC, anon e authenticated.
registrar_despertar(p_nonce text, p_t bigint) devolve boolean. Um único INSERT ... ON CONFLICT (nonce) DO NOTHING decide: em chamadas simultâneas com o mesmo nonce, a segunda espera a primeira terminar.
Regras de tempo: aceita t de agora - 300 s a agora + 60 s; se a gravação terminar mais de 60 s depois da checagem, devolve false e o nonce fica consumido; apaga nonces com t mais velho que 900 s (até 100 por chamada, sem esperar travas). Como 900 >= 300 + 60, um nonce nunca é apagado enquanto ainda puder ser aceito.
Commit e rollback: pelo PostgREST, cada chamada é confirmada quando a função retorna, mesmo com false. Se a transação for desfeita (erro, timeout ou rollback de quem chamou), nada fica gravado e a chamada também não é aceita; uma repetição dentro da janela pode então ser aceita uma vez, e o único efeito é processar a fila mais uma vez. A função não limita o tempo de espera: o limite vem do statement_timeout e do timeout do backend.
9.6 Vault e pg_net

Vault: o segredo notificacoes_segredo_backend foi criado em 12/11 pelo usuário, com o mesmo valor de NOTIFICACOES_SEGREDO do Render (conferido por SHA-256). despertar_backend o lê como o dono, por vault.decrypted_secrets. A auditoria só confere se existe um segredo com esse nome; nunca lê o valor. Falta saber se está no formato da 24 revisada (consulta 3c da seção 9.11).
pg_net: despertar_backend chama net.http_post(<url_backend>/api/notificacoes/processar), com timeout de 5 s. A fila net.http_request_queue guarda os cabeçalhos (inclusive a assinatura) até o envio; a revisão de 11/11 apontou que as tabelas do pg_net podem estar legíveis por anon e authenticated no nível do objeto (sem exposição pela API), e a auditoria (seção B) confere isso. A documentação do Supabase confirma: o schema net dá USAGE a PUBLIC, então anon e authenticated têm SELECT nessas tabelas (são papéis sem login e o net não é exposto pela API); as respostas ficam 6 horas em net._http_response. Com a 24 antiga, o que fica na fila é o próprio segredo.
notificacao_config.url_backend foi configurada em 12/11 pelo usuário (https://visage-backend-vnfg.onrender.com): o banco já chama o backend (seção 9.11). Esvaziá-la (UPDATE public.notificacao_config SET url_backend = NULL) para todas as chamadas na hora e é o primeiro passo de qualquer rollback.
Nos testes locais, pg_net e Vault foram imitações. Os reais do Supabase ainda não foram testados com o novo search_path.
9.7 Auditoria somente leitura (no scratchpad; não executada no Supabase)

Arquivo: pre_ativacao_proposto.sql (seção 9.10). Substitui supabase/verificacoes/notificacoes_pre_ativacao.sql (versão antiga, fora do Git).
Duas linhas no início (SET TRANSACTION READ ONLY e SET LOCAL search_path = pg_catalog, pg_temp) e depois uma única consulta. Deve ser rodada inteira de uma vez; a linha "0. Esta consulta" mostra se as duas linhas valeram.
Seções: A (dispositivos_push e acesso de usuários comuns); B (fila do pg_net); C (Vault, com C.7 = versão de despertar_backend pela impressão digital e C.8 = search_path de despertar_backend); D (funções, com D.15 a D.24 para a proteção contra repetição: D.21 = corpo de registrar_despertar, D.22 = regras de tempo, D.23 = search_path, D.24 = estrutura da tabela de nonces, com índices, triggers e regras, D.25 = dono da tabela de nonces, D.26 = search_path das outras funções SECURITY DEFINER das notificações); E (pgcrypto e o vetor de teste do RFC 4231). Problemas achados em 12/11 (correção proposta, não aplicada; seção 9.12): a D.25 só confere se os donos são iguais entre si, e a D.12 aceita quem é só membro do papel dono.
Impressão digital: md5 do código-fonte exato da função, só com as quebras de linha normalizadas: md5(regexp_replace(prosrc, '\r\n?', E'\n', 'g')). Valores atuais:
Função	Impressão
registrar_despertar (24 revisada)	08a29f1f7ed99666cf79339af2489b77
despertar_backend (24 revisada)	c01f482b09f84eba3ccf314c9adad40a
despertar_backend (migration 22)	df29e1e6419d1f85ebcd1a3ea9db660b
despertar_backend (24 antiga)	0414bab6c5b71bf7bfafc682a9550d9a
Qualquer mudança no corpo das funções, até num comentário, muda a impressão: recalcular com word\impressoes.mjs e atualizar a CTE proposta da auditoria. A impressão antiga, que ignorava comentários (c925240887ae...), foi aposentada: num teste, uma alteração que copiava o segredo do Vault passava por ela sem mudar o valor.
Estados que a auditoria distingue (iguais no PGlite e no PostgreSQL real):
Estado	C.7	C.8	D.15	D.21	D.23	D.24
Ausente (sem despertar_backend)	PROBLEMA	ATENÇÃO	PENDENTE	PENDENTE	PENDENTE	PENDENTE
24 não aplicada (só a 22)	PENDENTE	PENDENTE	PENDENTE	PENDENTE	PENDENTE	PENDENTE
24 antiga	PROBLEMA	PENDENTE	PENDENTE	PENDENTE	PENDENTE	PENDENTE
Tabela incompatível já existente	PENDENTE	PENDENTE	PENDENTE	PENDENTE	PENDENTE	ATENÇÃO
24 revisada	OK	OK	OK	OK	OK	OK
Revisada, com tabela e search_path incompatíveis	OK	ATENÇÃO	OK	OK	ATENÇÃO	ATENÇÃO
Revisada, com as duas funções alteradas	ATENÇÃO	OK	OK	ATENÇÃO	OK	OK
9.8 Testes mais recentes (11/11/2026, 5ª rodada; substituem os números das rodadas anteriores)

Só testes locais; nada foi testado no Supabase.
Bateria	Ambiente	Resultado
validar_auditoria.mjs	PGlite 0.5.8 (PostgreSQL 18.3, uma conexão)	618 verificações, 0 falhas (65,5 s)
testes-pg-real\testes_pg_real.mjs	PostgreSQL 17.9 real (embedded-postgres no Windows, várias conexões, como superusuário)	170 verificações, 0 falhas (103,3 s)
O que cobrem:
Aplicação da migration: precondições; falha injetada em 5 pontos e na conferência final (nada fica, e outra sessão não vê nada antes nem depois do ROLLBACK); outra sessão durante a aplicação (não vê tabela nem função, service_role e anon recebem 42883, e a despertar_backend anterior continua valendo); duas aplicações ao mesmo tempo (a segunda espera e falha sem deixar nada); tabela correta já existente (segue, dado preservado) e incompatível (17 variantes no PGlite e 9 no PostgreSQL real: para com mensagem e nada muda); aplicada duas vezes sem mudar nada; objetos maliciosos no public e no schema temporário de quem instala (com o SET LOCAL, a instalação fica idêntica à de um banco limpo; sem ele, a migration falha).
Nonces (PostgreSQL real): mesmo nonce em conexões independentes (só uma chamada aceita; 50 rodadas com 20 conexões); INSERT contra a limpeza; espera real de 61 s (devolve false e o nonce fica consumido; ROLLBACK de quem chamou ou statement_timeout não deixam nada).
search_path: matriz de 7 ataques por 4 valores (public, "public, pg_catalog", '' e "pg_catalog, pg_temp"); só pg_catalog, pg_temp bloqueou todos.
Auditoria: os estados acima; corpo de despertar_backend alterado (inclusive a cópia do segredo) dá ATENÇÃO ou PROBLEMA, nunca OK; rodada inteira, resiste a um operador malicioso no public, e a linha 0 avisa quando as duas primeiras linhas não valeram.
Os testes do próprio backend (245, commit 83d45a6) não foram alterados nem rodados nestas rodadas.
9.9 Situação

Concluído:
Decisão pelo WhatsApp e regras aprovadas pelo grupo (9.1); plano aprovado como base (9.2).
Migrations 21, 22 e 23 executadas no Supabase (10/11) e auditadas; backend do push no GitHub (83d45a6), desligado.
Migration 24 revisada e auditoria revisada redigidas e testadas no scratchpad (5ª rodada, entregue em 11/11). Ainda não aprovadas.
Em 12/11, pelo usuário, em produção: migration 24 ANTIGA executada, segredo no Vault igual ao do Render (SHA-256) e url_backend configurada; NOTIFICACOES_ATIVAS continua sem configurar e não houve deploy (9.11).
Em 12/11, no chat e só com leitura: análise do dono esperado, revisão da D.25, consulta confirmar_dono.sql validada localmente (365 verificações, 0 falhas, inclusive no PostgreSQL 15.19), análise de segurança do segredo fixo contra HMAC com nonce e diagnóstico da transição (9.11 e 9.12).
Em 12/11, só com leitura: Consulta A revisada (9.11), pronta para o usuário rodar; diagnóstico e plano do lembrete por WhatsApp 2 horas antes (9.14).
Testado: só localmente (9.8 e 9.12). A Consulta A nunca foi executada.
Ainda precisa ser corrigido ou implementado:
Depois da aprovação, substituir no projeto supabase/migrations/20261109000024_notificacoes_segredo.sql (versão antiga) e supabase/verificacoes/notificacoes_pre_ativacao.sql (auditoria antiga).
Ajustar supabase/verificacoes/notificacoes_auditoria.sql (as linhas 197 a 201 reconhecem a 24 pelo cabeçalho antigo) e backend/test/notificacoesMigracoes.sql.test.js (as linhas 228 a 239 testam a 24 antiga); o helper backend/test/helpers/bancoAgenda.js não carrega o pgcrypto.
Backend: verificar a assinatura HMAC e chamar registrar_despertar em /api/notificacoes/processar, conferindo a assinatura ANTES do "desligado" (assim dá para testar o caminho inteiro sem ligar canal); do WhatsApp, já foram feitos em 13/11 as chaves por canal, as tabelas, o webhook, o envio e o consentimento (9.15); faltam o duplo opt-in, os demais avisos da 9.1 e o HMAC.
Auditoria revisada: aplicar a correção proposta da D.25 e fazer a D.12 exigir que quem roda seja o dono (9.12). Migration 24 revisada: falta a precondição que o cabeçalho promete (quem roda = dono de despertar_backend).
As outras funções SECURITY DEFINER do projeto continuam com search_path = public: revisar à parte.
O documento Word do scratchpad (Visage_Barber_nonces_auditoria_D15-D22.docx) está desatualizado.
Copiar os arquivos dos scratchpads (9.10 e 9.13) para um local permanente, se o usuário autorizar (o scratchpad é temporário).
Atualizar este arquivo quando o estado de produção for confirmado pelas consultas da 9.11.
Aguardando validação:
Revisão do usuário da 5ª rodada (migration 24 e auditoria) e das propostas de 12/11 (9.12). Nada foi aprovado ainda.
No Supabase, só com autorização: as consultas da 9.11; confirmar que o SQL Editor manda o arquivo inteiro numa mensagem só (se a transação ficar abortada depois de um erro, rodar ROLLBACK); versão do PostgreSQL e o papel postgres, que lá não é superusuário; pg_net e Vault reais com o novo search_path (na primeira chamada real do piloto); se a migration 22 aplicada é igual à do repositório (se não for, a C.7 dá ATENÇÃO); statement_timeout da service_role; event triggers que mexam em tabelas novas; PostgREST e o pooler não foram testados.
No painel: os schemas expostos na Data API (devem ser só public e graphql_public) e os logs do Render.
Em 13/11: confirmação de presença pelo WhatsApp implementada no projeto (migration 25, backend, site e app), testada só localmente, sem commit, sem deploy e sem nada aplicado no Supabase (9.15).
Próximo passo exato: o usuário revisa a implementação de 13/11 (9.15) e autoriza o commit; em paralelo, prepara a conta da Meta e manda os dois templates para aprovação (textos na 9.15). Depois, na ordem e cada um com autorização: executar a migration 25 no Supabase, deploy do backend ainda desligado, cadastrar as variáveis no Render, cadastrar o webhook na Meta e ligar NOTIFICACOES_WHATSAPP_ATIVO com o piloto. A Consulta A (9.11) continua pendente de execução pelo usuário. Nada é aplicado sem aprovação.
9.10 Arquivos no scratchpad (sessão 37f24b98)

Pasta: C:\Users\lucas\AppData\Local\Temp\claude\e37e3206a826157a\37f24b98-e2c3-404a-a528-d252b047d9e7\scratchpad\
É uma pasta temporária: uma conversa nova usa outro scratchpad, e esta pasta pode ser apagada pelo sistema.
Arquivo	O que é
migration24\20261109000024_notificacoes_segredo.sql	Migration 24 revisada (proposta para revisão)
pre_ativacao_proposto.sql	Auditoria revisada (somente leitura)
prototipo\prototipo_24_teste.sql	Só para os testes: não é migration e não deve ser aplicado
validar_auditoria.mjs e validar.log	Bateria PGlite e o resultado
testes-pg-real\testes_pg_real.mjs e testes_pg_real.log	Bateria PostgreSQL real e o resultado (testes_pg_real_rapido.log é uma rodada sem a espera de 61 s)
word\impressoes.mjs e word\gerar_prototipo.cjs	Cálculo das impressões digitais e geração do protótipo
pg-real\	Pacotes npm de terceiros: embedded-postgres 17.9.0-beta.17 e pg 8.11.3
Visage_Barber_nonces_auditoria_D15-D22.docx	Documento Word de uma rodada anterior (desatualizado)
9.11 Produção em 12/11 e transição para a 24 revisada

Estado informado pelo usuário em 12/11 (feito por ele; ainda não confirmado por consulta):
- migration 24 ANTIGA executada: despertar_backend lê vault.decrypted_secrets e envia X-Notificacoes-Segredo;
- segredo notificacoes_segredo_backend criado no Vault e atualizado com o mesmo valor de NOTIFICACOES_SEGREDO do Render (conferido por SHA-256);
- notificacao_config.url_backend = https://visage-backend-vnfg.onrender.com;
- NOTIFICACOES_ATIVAS não configurada; nenhum deploy novo (o backend continua no 83d45a6, desligado).
O que isso faz: o banco chama POST /api/notificacoes/processar a cada aviso gravado na fila (gatilho despertar_backend da migration 22) e a cada minuto, pelo pg_cron, enquanto houver aviso pendente. Cada chamada leva o segredo fixo (que fica em net.http_request_queue até o envio), acorda o Render e recebe 503 antes de o backend olhar o cabeçalho. Nada é processado nem enviado; os avisos ficam pendentes até vencer.

Consultas para confirmar (somente leitura; rodar no SQL Editor, arquivo inteiro, papel padrão; todas exigem autorização):
1. confirmar_dono.sql (9.13): quem roda (linha 1), dono de cada objeto (linha 2), usuário dos jobs (linha 3), membros do papel dono (linhas 4 e 5).
2. Auditoria revisada (pre_ativacao_proposto.sql, 9.10). Esperado agora: C.7 "antiga aplicada" (PROBLEMA, mas esperado: código idêntico ao arquivo do repositório; "antiga_alterada" quer dizer que o que rodou difere do arquivo); C.6 "existe"; C.8 e D.1 PENDENTE; D.2 a D.10 ATENÇÃO (search_path = public); D.14 ATENÇÃO (URL configurada); D.15 a D.25 PENDENTE; D.26 ATENÇÃO nas 12 funções (o código da D.26 nunca dá PENDENTE; seria PROBLEMA se usuários comuns pudessem criar objetos no public); B.2 e B.3 provavelmente PROBLEMA (a fonte do pg_net dá acesso às tabelas dele a PUBLIC; com a 24 antiga é o item que mais pesa, porque a fila guarda o segredo até o envio); E com o pgcrypto no schema extensions.
3a. Definição atual da função (não contém o segredo), guardar para o rollback:
    SELECT pg_get_functiondef('public.despertar_backend()'::regprocedure);
3b. Contagens, sem cabeçalhos e sem dados pessoais (versão simples; foi SUBSTITUÍDA pela Consulta A, no fim desta seção, que deve ser rodada primeiro):
    BEGIN READ ONLY;
    SELECT 'pedidos na fila do pg_net' AS item, count(*)::text AS valor FROM net.http_request_queue
    UNION ALL
    SELECT 'respostas guardadas do pg_net, por status', coalesce(string_agg(s.status || ': ' || s.n, ', ' ORDER BY s.status), 'nenhuma')
      FROM (SELECT coalesce(status_code::text, CASE WHEN timed_out THEN 'timeout' ELSE 'erro' END) AS status, count(*) AS n
              FROM net._http_response GROUP BY 1) s
    UNION ALL
    SELECT 'avisos em public.notificacoes, por status', coalesce(string_agg(s.status || ': ' || s.n, ', ' ORDER BY s.status), 'nenhum')
      FROM (SELECT status::text AS status, count(*) AS n FROM public.notificacoes GROUP BY 1) s;
    COMMIT;
3c. Formato do segredo, só verdadeiro ou falso (lê o valor decifrado dentro do banco: exige autorização explícita):
    BEGIN READ ONLY;
    SELECT count(*) AS segredos_com_esse_nome,
           bool_and(length(decrypted_secret) >= 32) AS tem_32_ou_mais,
           bool_and(decrypted_secret ~ '^[A-Za-z0-9_-]{32,}$') AS formato_da_assinatura
      FROM vault.decrypted_secrets
     WHERE name = 'notificacoes_segredo_backend';
    COMMIT;

A 24 revisada pode substituir a função atual enquanto o backend estiver desligado, se:
- o pgcrypto estiver no schema extensions (E.1 e E.2); sem ele, a migration para sem mudar nada;
- quem roda for o dono de despertar_backend (linha 1 igual ao dono da linha 2 no confirmar_dono);
- o segredo estiver no formato (base64 comum, com + / =, não passa; hex ou base64url passam); fora dele, a nova função não chama ninguém;
- o Vault e o pg_net reais funcionarem com search_path = pg_catalog, pg_temp (nunca testado no Supabase; se falharem, a função devolve false e não chama ninguém).
Aproveita a mesma URL e o mesmo nome do segredo; gatilhos, jobs e fila não mudam. Depois dela, o banco manda só X-Notificacoes-Assinatura, que o backend 83d45a6 não reconhece (hoje sem efeito: ele responde 503 antes de olhar o cabeçalho).
Objetos da revisada que ainda não existem: tabela public.notificacoes_despertares (chave primária em nonce, CHECK do formato, índice notificacoes_despertares_t_idx, RLS ligado, sem permissões para PUBLIC, anon e authenticated); função public.registrar_despertar(text, bigint) (só service_role); a nova versão de despertar_backend; e, fora do banco, o código do backend que confere a assinatura. Dependências: extensions.hmac(text,text,text) e extensions.gen_random_bytes(integer).
Riscos de aplicar agora: backend incompatível se for ligado sem atualizar (401, falha fechada); segredo fora do formato ou Vault e pg_net reais falhando com o novo search_path (o banco para de chamar, só com WARNING no log); quem roda diferente do dono (donos diferentes, ver D.25); event triggers do Supabase podem abortar a migration (sem mudar nada); a 24 antiga continua no repositório (rodá-la de novo desfaz a revisada); a auditoria antiga passa a dizer, erradamente, que a 24 não foi aplicada. Chamadas no meio da aplicação não são risco: é uma única transação.

Sequência (A = exige autorização do usuário):
1. (A) Consulta A (revisada, no fim desta seção), depois a 3a, a 1 e a 2; guardar a saída da 3a. Nesta etapa não chamar despertar_backend() nem rodar a 3c.
2. (A, explícita) Consulta 3c.
3. (A) Copiar os scripts dos scratchpads para um local permanente.
4. (A) Recomendado: esvaziar url_backend até o backend novo estar no ar (hoje ela só manda o segredo a um backend que responde 503 e acorda o Render). Se preferir manter, fazer logo a etapa 6, que tira o segredo das chamadas.
5. (A) Se a 3c der falso: trocar o segredo por um no formato (vault.update_secret e NOTIFICACOES_SEGREDO no Render, que redeploya o mesmo commit; conferir antes que NOTIFICACOES_ATIVAS não existe) e confirmar de novo por SHA-256.
6. (A) Aplicar a 24 revisada (arquivo inteiro, papel padrão, rodando como o dono).
7. (A) Auditoria revisada de novo: C.7 "revisada", C.8, D.15 a D.26 e E OK.
8. (A) Se a URL estiver ativa: SELECT public.despertar_backend(); deve dar true, e a última resposta do pg_net deve ser 503 (prova Vault, pgcrypto e pg_net reais sem processar nada; acorda o Render).
9. (A, arquivos) Backend local: assinatura e nonce, conferindo a assinatura antes do "desligado" (válida recebe 503, inválida 401); parar de aceitar o cabeçalho antigo; separar as chaves de ativação; testes e regressão.
10. (A) Repositório: substituir a 24 antiga e a auditoria antiga, corrigir a notificacoes_auditoria.sql e o teste das migrations, atualizar este arquivo; commit e push.
11. (A) Deploy do backend com tudo desligado; conferir o 503 e "[notificacoes] desligadas" no log.
12. (A) Restaurar a URL, se tiver sido esvaziada. Teste ponta a ponta: a chamada do banco recebe 503 "DESATIVADO" e grava o nonce; uma chamada manual inválida recebe 401.
13. (A, etapa separada) Ativação, só do WhatsApp quando ele existir; NOTIFICACOES_ATIVAS nunca.

Preservar: a URL é pública (também em barber-mobile/eas.json) e volta com um UPDATE; o segredo fica com o mesmo nome no Vault (trocar só com vault.update_secret e o Render ao mesmo tempo; não recriar); a função atual fica na saída da 3a (se a C.7 der "antiga", o arquivo da 24 no repositório é idêntico); donos e permissões: comparar o confirmar_dono e a auditoria antes e depois.
Rollback (cada passo com autorização), do mais rápido ao mais completo:
1. UPDATE public.notificacao_config SET url_backend = NULL; (para as chamadas na hora).
2. Rodar de novo a 24 antiga do repositório (se a C.7 for "antiga") ou a definição guardada na 3a; o dono e as permissões se mantêm.
3. Opcional: remover registrar_despertar e a tabela de nonces (não atrapalham se ficarem).
4. Backend: redeploy do commit anterior, sem NOTIFICACOES_ATIVAS (preferir corrigir para a frente).
Em qualquer combinação desencontrada entre banco e backend, a chamada é recusada (401 ou 503) e nada é processado.

Consulta A (estado atual; versão revisada em 12/11; só existe aqui e no chat; nunca executada, nem localmente, só revisada por leitura). Somente leitura: BEGIN READ ONLY, um SELECT e COMMIT; só funções internas do PostgreSQL; não chama despertar_backend() nem envia requisição; não lê o segredo, a view decifrada do Vault nem cabeçalhos. Rodar o bloco inteiro no SQL Editor, sem trecho selecionado, com o papel padrão; se a transação ficar abortada, ROLLBACK. Colunas conferidas na fonte do pg_net, do supabase_vault 0.3.0 e do pg_cron 1.3 (as versões instaladas no projeto não são conhecidas); as impressões da linha 1 foram recalculadas dos arquivos do repositório.
    BEGIN READ ONLY;
    SET LOCAL search_path = pg_catalog, pg_temp;
    SELECT x.n, x.item, x.valor
      FROM (
        SELECT 0 AS n, 'esta consulta'::text AS item,
               'somente leitura: ' || current_setting('transaction_read_only')
                 || '; quem roda: ' || current_user
                 || '; agora (Brasilia): ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS valor
        UNION ALL
        SELECT 1, 'despertar_backend(): versao instalada',
               coalesce((SELECT CASE f.impressao
                                  WHEN '0414bab6c5b71bf7bfafc682a9550d9a' THEN '24 ANTIGA, identica ao arquivo do repositorio'
                                  WHEN 'df29e1e6419d1f85ebcd1a3ea9db660b' THEN 'migration 22: a 24 NAO esta aplicada'
                                  WHEN 'c01f482b09f84eba3ccf314c9adad40a' THEN '24 revisada'
                                  ELSE 'NAO reconhecida' END
                                || '; impressao ' || f.impressao
                                || '; monta o cabecalho X-Notificacoes-Segredo: '
                                || CASE WHEN f.prosrc ILIKE '%X-Notificacoes-Segredo%' THEN 'sim' ELSE 'nao' END
                                || '; ' || coalesce(array_to_string(f.proconfig, ', '), 'sem search_path')
                           FROM (SELECT p.prosrc, p.proconfig,
                                        md5(regexp_replace(p.prosrc, '\r\n?', E'\n', 'g')) AS impressao
                                   FROM pg_proc p
                                  WHERE p.oid = to_regprocedure('public.despertar_backend()')) f),
                        'a funcao NAO existe')
        UNION ALL
        SELECT 2, 'gatilho despertar_backend em public.notificacoes',
               coalesce((SELECT CASE t.tgenabled
                                  WHEN 'O' THEN 'ativo'
                                  WHEN 'A' THEN 'ativo (sempre, inclusive em modo replica)'
                                  WHEN 'R' THEN 'so em modo replica: NAO dispara em uso normal'
                                  WHEN 'D' THEN 'DESLIGADO'
                                  ELSE 'estado nao reconhecido: ' || t.tgenabled::text END
                           FROM pg_trigger t
                          WHERE t.tgrelid = to_regclass('public.notificacoes')
                            AND t.tgname = 'despertar_backend'
                            AND NOT t.tgisinternal),
                        'NAO existe')
        UNION ALL
        SELECT 3, 'Vault: segredo notificacoes_segredo_backend (so nome e datas)',
               count(*)::text || ' com esse nome'
                 || coalesce('; criado em ' || to_char(min(s.created_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                             || '; alterado em ' || to_char(max(s.updated_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '')
          FROM vault.secrets s
         WHERE s.name = 'notificacoes_segredo_backend'
        UNION ALL
        SELECT 4, 'notificacao_config.url_backend',
               CASE WHEN count(*) = 0 THEN 'nenhuma linha visivel'
                    WHEN count(*) > 1 THEN count(*)::text || ' linhas (esperado 1)'
                    WHEN max(c.url_backend) IS NULL THEN 'vazia: o banco nao chama ninguem'
                    WHEN max(c.url_backend) = 'https://visage-backend-vnfg.onrender.com'
                      THEN 'igual a informada (o banco ja chama o backend)'
                    ELSE 'DIFERENTE da informada: ' || max(c.url_backend) END
          FROM public.notificacao_config c
        UNION ALL
        SELECT 5, 'pg_cron: jobs das notificacoes',
               coalesce((SELECT string_agg(j.jobname::text || ': ' || j.schedule::text
                                             || '; ativo: ' || CASE WHEN j.active THEN 'sim' ELSE 'NAO' END
                                             || '; usuario: ' || j.username::text
                                             || '; comando: '
                                             || CASE WHEN (j.jobname = 'notificacoes-rotina'
                                                           AND j.command::text = 'SELECT public.rotina_notificacoes();')
                                                       OR (j.jobname = 'notificacoes-limpeza'
                                                           AND j.command::text = 'SELECT public.limpar_notificacoes_antigas();')
                                                     THEN 'o da migration 22 para este job'
                                                     ELSE 'DIFERENTE do esperado para este job' END,
                                           ' | ' ORDER BY j.jobname::text)
                           FROM cron.job j
                          WHERE j.jobname IN ('notificacoes-rotina', 'notificacoes-limpeza')),
                        'NAO encontrados')
        UNION ALL
        SELECT 6, 'pg_cron: execucoes de notificacoes-rotina na ultima hora',
               count(*)::text || ' execucoes; com falha: ' || (count(*) FILTER (WHERE d.status = 'failed'))::text
                 || '; ultima: ' || coalesce(to_char(max(d.start_time) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), 'nenhuma')
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
         WHERE j.jobname = 'notificacoes-rotina'
           AND d.start_time > now() - interval '1 hour'
        UNION ALL
        SELECT 7, 'pg_net: pedidos esperando envio (so a contagem)',
               count(*)::text
          FROM net.http_request_queue
        UNION ALL
        SELECT 8, 'pg_net: respostas guardadas, por resultado (so a contagem)',
               coalesce((SELECT string_agg(r.resultado || ': ' || r.qt::text, '; ' ORDER BY r.resultado)
                           FROM (SELECT CASE WHEN h.status_code IS NULL
                                               THEN 'sem resposta (erro ou tempo esgotado; origem nao identificavel)'
                                             WHEN h.status_code = 503 AND position('DESATIVADO' IN h.content) > 0
                                               THEN '503 DESATIVADO (backend das notificacoes, desligado)'
                                             WHEN h.status_code = 503 AND position('NAO_CONFIGURADO' IN h.content) > 0
                                               THEN '503 NAO_CONFIGURADO (backend das notificacoes, ativo e sem segredo)'
                                             WHEN h.status_code = 401 AND position('NAO_AUTORIZADO' IN h.content) > 0
                                               THEN '401 NAO_AUTORIZADO (backend das notificacoes, ativo; segredo recusado)'
                                             WHEN h.status_code = 202 AND position('recebido' IN h.content) > 0
                                               THEN '202 recebido (backend das notificacoes, ATIVO; chamada aceita)'
                                             ELSE h.status_code::text || ' (origem nao identificavel)' END AS resultado,
                                        count(*) AS qt
                                   FROM net._http_response h
                                  GROUP BY 1) r),
                        'nenhuma')
        UNION ALL
        SELECT 9, 'pg_net: resposta mais recente',
               coalesce(to_char(max(h.created) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), 'nenhuma')
          FROM net._http_response h
        UNION ALL
        SELECT 10, 'fila public.notificacoes, por status',
               coalesce((SELECT string_agg(q.status || ': ' || q.qt::text, '; ' ORDER BY q.status)
                           FROM (SELECT a.status, count(*) AS qt
                                   FROM public.notificacoes a
                                  GROUP BY a.status) q),
                        'vazia')
        UNION ALL
        SELECT 11, 'avisos prontos para envio agora (enquanto houver, o pg_cron chama o backend a cada minuto)',
               count(*)::text
          FROM public.notificacoes a
         WHERE (a.status = 'pendente' AND a.proxima_tentativa <= now())
            OR (a.status = 'enviando' AND a.reservada_ate < now())
        UNION ALL
        SELECT 12, 'avisos ainda guardados que algum backend ja reservou (zero NAO prova que nunca houve processamento)',
               'avisos com tentativas: ' || (SELECT count(*) FROM public.notificacoes a WHERE a.tentativas > 0)::text
                 || '; linhas em notificacao_envios: ' || (SELECT count(*) FROM public.notificacao_envios)::text
      ) x
     ORDER BY x.n;
    COMMIT;
Esperado pelo estado informado: linha 0 "on"; 1 "24 ANTIGA", cabeçalho "sim", search_path=public; 2 ativo; 3 "1 com esse nome", datas de 12/11; 4 igual à informada; 5 os dois jobs ativos com o comando certo; 6 cerca de 60 execuções, 0 falhas; 7 zero ou poucos; 8 só "503 DESATIVADO" e "sem resposta" (Render acordando); 12 zero e zero.
Limites de leitura: net._http_response não guarda a URL e é compartilhada por tudo o que usa o pg_net (Database Webhooks, jobs do Cron com HTTP, Edge Functions); só as respostas identificadas pelo corpo são deste backend. No repositório, só as notificações usam o pg_net; algo criado pelo painel não aparece ali. A linha 3 não diz se o valor é igual ao do Render nem se o formato serve. Se o papel do editor não ignorar RLS, as linhas 5 e 6 só mostram os próprios jobs. A linha 12 não prova que nunca houve processamento (leituras com a fila vazia e a rota de teste não deixam rastro; avisos somem em cascata; sem aparelhos, notificacao_envios não diz nada). Nenhuma linha confirma que NOTIFICACOES_ATIVAS não existe no Render: 503 DESATIVADO só prova que ela não vale "true" no deploy em execução.
9.12 Análises de 12/11 (só leitura; nada aplicado)

Dono esperado de notificacoes_despertares, despertar_backend() e registrar_despertar(text,bigint): nenhuma migration define dono (nenhum OWNER TO). O dono é o papel que roda as migrations no SQL Editor: o mesmo que rodou a 22 (dono de despertar_backend, já que CREATE OR REPLACE mantém o dono) e que deve rodar a 24 revisada (que cria a tabela e registrar_despertar com current_user). A documentação do Supabase diz que o Dashboard executa como postgres (sem superusuário), mas isso não foi confirmado neste projeto: confirmar com o confirmar_dono.sql. Os testes locais rodam como superusuário e não provam nada sobre o dono no Supabase.
Mesmo dono: registrar_despertar e a tabela precisam, na prática (RLS sem policies). despertar_backend não depende delas, mas precisa ler notificacao_config (RLS sem policies), o Vault, o pgcrypto e o pg_net.
D.25: só confere se o dono da tabela é igual ao de despertar_backend. Na reprodução local, dava OK com dono superusuário, com dono authenticator, com qualquer papel, com registrar_despertar ausente e com authenticated membro do dono. Proposta (d25_proposta.sql, 9.13; não aplicada): dono fixado em proposta.dono_esperado depois de confirmado no Supabase; os três objetos existindo e com o mesmo dono; nenhum superusuário nem papel da API como dono ou como membro do dono; donos dos objetos da 21 e da 22 e usuário dos jobs do pg_cron confirmando. A D.12 deveria exigir que quem roda seja o dono, não só membro.
Segurança, segredo fixo contra HMAC com nonce: recomendado HMAC com nonce. O segredo nunca viaja; cada assinatura vale uma vez (chave primária em nonce) e só de agora - 300 s a agora + 60 s; fica presa a método, caminho e versão; permite trocar o segredo sem parar (NOTIFICACOES_SEGREDO_ANTERIOR); o search_path é endurecido. Peso real hoje: chamar /processar só faz ler a fila uma vez a mais (uma execução por vez, 120 por minuto, leitura a cada 20 s quando acordado); quem chama não escolhe destinatário nem texto.
Compatibilidade entre banco e backend: banco na 22 ou na 24 antiga com o backend novo recebe 401; banco na 24 revisada com o backend 83d45a6 recebe 401; banco na 24 revisada com o backend novo recebe 202. Toda combinação errada falha fechada.
Backend novo, nesta ordem: formato exato do cabeçalho (t de 10 dígitos, n de 32 hexadecimais, v1 de 64 hexadecimais); janela de horário; HMAC com timingSafeEqual (segredo atual e anterior, no formato [A-Za-z0-9_-]{32,}); registrar_despertar pela service_role (só true aceita; false, erro ou timeout viram 401); limite das chamadas válidas; 202. Falhas e nonce repetido contam no limite por IP; um cache em memória dos nonces já vistos serve só de otimização.
Rota atual: POST /api/notificacoes/processar definida em backend/src/routes/notificacoes.js:68 e montada em backend/src/app.js:30; compara X-Notificacoes-Segredo com NOTIFICACOES_SEGREDO por SHA-256 e timingSafeEqual (notificacoes.js:24-29); falha fechada.
confirmar_dono.sql (9.13): consulta somente leitura (BEGIN READ ONLY ... COMMIT) que mostra quem roda, os donos, os jobs do pg_cron (lidos com XMLTABLE, que devolve o texto original), os membros diretos e todas as cadeias indiretas até o papel dono (com limite de 10000 cadeias e ATENÇÃO se passar), os superusuários e se anon, authenticated, service_role e authenticator agem como o dono (pg_has_role, exato). Validada localmente: 365 verificações, 365 aprovadas, 0 falhas e 12 não executadas por desenho, em PGlite (PostgreSQL 18.3) e nos PostgreSQL reais 17.9 e 15.19 (embedded-postgres). Compatível com o SQL Editor pelo código-fonte do Studio e do pg-meta (mostra o último resultado com linhas e não acrescenta LIMIT); não testada no Supabase.
9.13 Arquivos no scratchpad (sessão 71318a8b)

Pasta: C:\Users\lucas\AppData\Local\Temp\claude\e37e3206a826157a\71318a8b-3921-4a57-85ad-8c871a55cc9f\scratchpad\
Também é temporária.
Arquivo	O que é
confirmar_dono.sql	Consulta somente leitura de dono, jobs e membros (versão final)
validar_confirmar_dono.mjs e validar_confirmar_dono.log	Validação local (365 verificações)
inventario.mjs	Gera o inventário das verificações a partir do log
rodada198_confirmar_dono.sql, rodada198_validar.mjs e rodada198_validar.log	Rodada anterior da validação (198 verificações), guardada para comparação
confirmar_dono_anterior.sql	Versão com limite de profundidade (nivel < 50), só para comparar
d25_proposta.sql, d25_repro.mjs e d25_repro.log	Correção proposta da D.25 e a reprodução dos falsos OK
pg15\	Pacotes npm de terceiros: embedded-postgres 15.19.0-beta.19 e pg 8.11.3
9.14 Lembrete por WhatsApp 2 horas antes: diagnóstico e plano (12/11)

O diagnóstico abaixo continua valendo. O plano foi SUBSTITUÍDO em 13/11 pela decisão do usuário e pela implementação da seção 9.15 (confirmação de presença com SIM ou NÃO, em que NÃO não cancela). As perguntas do fim desta seção foram decididas na 9.15.

Pedido do usuário: mandar ao cliente, pelo WhatsApp, um lembrete 2 horas antes do atendimento, com nome, data, horário e, se possível, barbeiro e serviço; sem lembrete para cancelados; nunca duplicado; acompanhar mudança de horário; falhas registradas; estado visível (pendente, enviado, falhou). Só API oficial (Cloud API); nada de WhatsApp Web, QR Code ou bibliotecas que imitam o aplicativo.

Diagnóstico (conferido no código em 12/11):
- Agendamentos: o cliente agenda no site (cut-advisor-pro/src/pages/Booking.tsx:113) ou no app (barber-mobile/src/screens/cliente/BookingScreen.tsx:131) com um INSERT direto em public.agendamentos, já com status "confirmado". O gatilho validar_agendamento (BEFORE INSERT OR UPDATE) confere disponibilidade, conflito, limite diário e recusa horário no passado. O status é um enum com confirmado, cancelado e concluido. O job concluir-agendamentos do pg_cron (a cada 5 minutos) passa para concluido o que já terminou. Cancelar é um UPDATE de status (cliente em MeusAgendamentos.tsx, barbeiro em lib/painelBarbeiro.ts).
- Onde ficam os dados: public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora em timestamptz, status, created_at, updated_at, preco); nomes em profiles.nome, barbeiros.nome e servicos.nome. A criação da tabela agendamentos e as policies do cliente não estão nas migrations do repositório (vêm do esquema inicial do Supabase).
- Remarcação: não existe tela nem função de remarcar no site, no app ou no backend. O cliente cancela e agenda de novo. O gatilho aceita UPDATE de data_hora (admin ou barbeiro, direto no banco), então o plano precisa tratar esse caso mesmo sem tela.
- Telefone: profiles.telefone, texto, só dígitos com DDD (10 ou 11), sem o 55. É OPCIONAL no cadastro do site e do app e pode estar vazio (o gatilho handle_new_user grava ''). A validação (lib/telefone.ts no site e no app, services/telefone.js no backend) aceita celular e fixo. O número não é verificado (nada prova que é do cliente nem que tem WhatsApp). Não há consentimento para mensagens: a tabela consentimentos só aceita a finalidade visagismo_foto.
- Notificações: fila public.notificacoes (migrations 21 a 23), gatilhos de novo agendamento, cancelamento e mensagem, job notificacoes-rotina a cada minuto e backend que só sabe enviar pela Expo (services/notificacoes.js e expoPush.js), desligado. Nada nunca foi enviado: o app não registra aparelhos (barber-mobile/src/hooks/usePushToken.ts é uma função vazia) e não existe tela de preferências. A fila não tem coluna de canal.
- WhatsApp hoje: só links wa.me (cliente abre conversa com o barbeiro): lib/whatsapp.ts no site e no app, e a função telefones_barbeiros_do_cliente (migration 12). Não há nenhuma integração com API, token, webhook ou template. Aproveitável: normalizarTelefoneBR (põe o 55).
- Backend e infraestrutura: Express (backend/src/app.js) no Render gratuito, que dorme; sem biblioteca de agendamento (só um setInterval de 20 s, e só com as notificações ativas). As tarefas agendadas ficam no banco: pg_cron (concluir-agendamentos, notificacoes-rotina, notificacoes-limpeza) e pg_net para acordar o backend. Serviços externos em uso: Supabase, OpenAI, Pexels, Replicate e Mercado Pago. O app.js aplica express.json a todas as rotas (o webhook da Meta precisa do corpo bruto).
- Lembrete que já existe: enfileirar_lembretes() (migration 22), chamada pelo job a cada minuto, grava um aviso do tipo lembrete 30 minutos antes (preferência de 15, 30 ou 60; nunca mais de 60), só para push, com chave única por agendamento, destinatário e horário, e não gera para quem agendou já dentro da janela. motivo_para_nao_enviar() reconfere na hora do envio (cancelado, horário passado, horário alterado, preferência). Está rodando em produção: os lembretes de push são gravados e vencem sem envio. É a base a reaproveitar; não serve como está (30 minutos, push, sem telefone e sem consentimento).

Plano proposto (reaproveita a fila, o job de cada minuto, a reconferência no envio e o caminho banco → backend):
- Banco, migration 25 (a criar): coluna canal em notificacoes ('push' padrão ou 'whatsapp'); coluna horario_definido_em em agendamentos (preenchida na criação e quando data_hora muda); função enfileirar_lembretes_whatsapp() chamada pela rotina de cada minuto; reserva e conclusão por canal; tabela whatsapp_mensagens (uma linha por tentativa de envio: aviso, id da mensagem na Meta, estado, código do erro, horários); consentimento para WhatsApp (nova finalidade em consentimentos, e 'whatsapp' como origem de revogação); consulta do estado do lembrete por agendamento. Funções novas com search_path = pg_catalog, pg_temp; tabelas novas com RLS e sem acesso do app.
- Quando gerar: a cada minuto, para agendamento confirmado cujo horário está a 120 minutos ou menos e a mais de 60, com consentimento vigente e telefone válido. Chave única whatsapp:lembrete:<agendamento>:<horário>: o mesmo agendamento no mesmo horário nunca gera dois. "Exatamente 2 horas" quer dizer com atraso de até 1 a 2 minutos (job de 1 minuto, backend acordando e entrega da Meta).
- Horário alterado: a chave leva o horário, então o aviso antigo é descartado no envio (horario_alterado) e o novo horário gera outro. Se o lembrete antigo já saiu e o novo horário está a mais de 2 horas, sai um novo lembrete.
- Criado (ou remarcado) com menos de 2 horas: recomendado NÃO enviar. O cliente acabou de escolher o horário e já vê a confirmação; mandar na hora gasta uma mensagem e parece spam. Usa horario_definido_em, não created_at, para valer também na remarcação.
- Atraso: se o envio não saiu na hora (banco ou backend fora), ainda vale até faltar 60 minutos; depois vence. O texto diz o horário, nunca "daqui a 2 horas", então continua certo mesmo atrasado.
- Sem duplicar: chave única; reserva atômica (FOR UPDATE SKIP LOCKED); a tentativa é gravada em whatsapp_mensagens antes de chamar a Meta; nova tentativa só quando a Meta respondeu com erro (30 s, 2 e 8 minutos, dentro do prazo); resultado incerto (tempo esgotado depois de enviar) NÃO é reenviado, fica como "incerto". A Cloud API não tem chave de idempotência documentada, por isso a regra é no máximo uma vez. Diferente do push de hoje, uma reserva vencida de WhatsApp não volta sozinha para a fila.
- Estados visíveis: pendente, enviando, enviada (aceita pela Meta), entregue e lida (só com o webhook), falhou (com o código), ignorada (com o motivo: sem consentimento, sem telefone, cancelado, horário alterado) e expirada.
- Fuso: data_hora é timestamptz e as contas são em tempo absoluto; o texto usa America/Sao_Paulo (o backend já tem as funções de data).
- Backend: services/whatsapp.js (a criar; cliente da Cloud API com fetch, sem SDK), envio por canal em services/notificacoes.js, chaves separadas (9.2), verificação HMAC em /api/notificacoes/processar (9.4), rota do webhook (a criar; estados de entrega e descadastro), consentimento em routes/privacidade.js.
- Site e app: opção "Receber lembretes pelo WhatsApp" no perfil, com o telefone obrigatório e válido para ligar; nova seção e nova versão do aviso de privacidade.
- Mensagem (template de utilidade, pt_BR, a aprovar): "Olá, {{1}}! Lembrete da Visage Barber: seu horário de {{2}} com {{3}} é {{4}}, às {{5}}. Se não puder vir, cancele pelo aplicativo." (nome, serviço, barbeiro, data, hora).

Meta, conferido em 12/11 na documentação oficial:
- Mensagem iniciada pela empresa fora da janela de 24 horas exige template aprovado: o lembrete sempre precisa de template (categoria utilidade).
- Cobrança só por mensagem entregue. Utilidade para o Brasil: cerca de 0,68 centavo de dólar por mensagem; contas em reais desde 01/07/2026 (valor em reais na tabela de preços da Meta, não conferido). Desde 01/10/2026 o template de utilidade voltou a ser cobrado também dentro da janela aberta. Mensagens de serviço: 1.000 gratuitas por mês por número.
- Portfólio novo: limite de 250 números diferentes por 24 horas fora da janela; sobe para 2.000 com verificação da empresa ou com volume e qualidade.
- Necessário: portfólio empresarial na Meta, app de desenvolvedor com o produto WhatsApp, conta WhatsApp Business (WABA), número (o de teste é gratuito e limitado a poucos destinatários cadastrados; o oficial não pode estar em uso no aplicativo do WhatsApp), usuário do sistema com token permanente, template aprovado, webhook com token de verificação e segredo do app, e forma de pagamento.
- Autenticação: token do usuário do sistema no cabeçalho Authorization (Bearer) ao chamar graph.facebook.com/<versão>/<id do número>/messages; o webhook é validado pela assinatura X-Hub-Signature-256 com o segredo do app.
- Não confirmado: se o campo biz_opaque_callback_data volta nos estados de mensagens de template (serviria para casar o estado com o aviso quando a resposta do envio se perde).
Variáveis planejadas (só nomes; nenhuma existe ainda): NOTIFICACOES_WHATSAPP_ATIVO, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_TEMPLATE_LEMBRETE, WHATSAPP_API_VERSAO, WHATSAPP_PILOTO_USUARIOS, além de NOTIFICACOES_SEGREDO (já existe) e NOTIFICACOES_SEGREDO_ANTERIOR (opcional). NOTIFICACOES_ATIVAS nunca (seção 0).

Riscos e limites: telefone opcional e não verificado (lembrete pode ir para o número errado ou não ir); sem consentimento não se envia (LGPD e política da Meta), então só recebe quem ligar a opção; template pode ser recusado ou reclassificado como marketing (mais caro); Render gratuito acordando atrasa o envio em cerca de 1 minuto; sem o webhook só se sabe "aceita pela Meta", não "entregue"; resultado incerto não é reenviado (prefere perder um lembrete a mandar dois); número fixo ou sem WhatsApp vira falha definitiva; limite de 250 destinatários por dia no começo.

Etapas (cada uma com aprovação; nada começou):
0. Decisões do usuário (abaixo) e conta da Meta com número de teste e template enviado para aprovação.
1. Fechar a transição da seção 9.11 (24 revisada e HMAC no backend): é o caminho que acorda o backend.
2. Migration 25 com testes no banco embutido.
3. Backend: cliente da Cloud API, envio por canal, chaves novas, testes com uma Meta falsa (nenhum envio real).
4. Consentimento no site e no app e aviso de privacidade.
5. Webhook (entregue, lida, falha e descadastro).
6. Piloto com o número de teste e contas de teste (WHATSAPP_PILOTO_USUARIOS).
7. Número oficial, verificação da empresa e acompanhamento; remover o código do push só depois.

Perguntas em aberto para o usuário:
1. O lembrete de 2 horas substitui o lembrete de 30 minutos e a confirmação com SIM ou NÃO da 9.1, ou é a primeira parte (deixando SIM ou NÃO para depois)?
2. Consentimento: basta a opção marcada no perfil, ou mantém o duplo opt-in da 9.2 (o cliente manda "ATIVAR <código>", o que prova que o número é dele, mas exige o webhook já na primeira entrega)?
3. Já existe portfólio empresarial na Meta e um número para a Visage, ou começamos pelo número de teste?
4. Onde o estado do lembrete deve aparecer: no cartão do agendamento para o barbeiro, numa tela do admin, ou só no banco por enquanto?
5. O lembrete de push de 30 minutos que hoje é gravado e vence sem envio pode ser desligado na migration 25?
9.15 Confirmação de presença pelo WhatsApp: implementação de 13/11 (sem commit; nada aplicado em produção)

Decisão do usuário (13/11): 2 horas antes do atendimento o cliente recebe uma mensagem com os dados do agendamento e a pergunta de presença; responde SIM ou NÃO. SIM registra presença confirmada. NÃO registra que não virá e avisa o barbeiro, mas NÃO cancela o agendamento (isso muda a decisão da 9.1, em que NÃO cancelava). Sem resposta: o agendamento continua e o barbeiro vê "Sem resposta". Esta entrega substitui o lembrete simples da 9.14; o lembrete de 30 minutos da 9.1 não foi feito.

Decisões tomadas na implementação (o usuário não respondeu às perguntas da 9.14; mudar se ele quiser):
- Consentimento: opção marcada no Perfil (site e app), gravada pelo backend em consentimentos com a finalidade whatsapp_avisos, versão 2026-11-13. Sem duplo opt-in. PARAR, SAIR ou STOP no WhatsApp revogam.
- Só celular (DDD + 9 dígitos) recebe; fixo e cadastro sem telefone ficam de fora.
- Quem agendou ou mudou o horário com menos de 2 horas não recebe.
- O barbeiro vê a situação no cartão do atendimento (Painel e Agenda, site e app). Se o barbeiro autorizou e tem celular, também recebe um WhatsApp quando o cliente responde NÃO (template opcional). No app o barbeiro não tem tela de perfil: ele autoriza pelo site.
- A chamada do banco ao backend continua com o cabeçalho X-Notificacoes-Segredo (24 antiga, já em produção). A troca por HMAC e nonce (9.3, 9.4 e 9.11) NÃO foi feita nesta entrega e continua pendente.
- O lembrete de push de 30 minutos (enfileirar_lembretes) não foi desligado: continua gravando avisos do canal push, que vencem sem envio.

Banco, migration 25 (supabase/migrations/20261113000025_whatsapp_confirmacao_presenca.sql; uma transação só; pode rodar de novo):
- notificacoes ganha a coluna canal (push ou whatsapp) e os tipos confirmacao_presenca e presenca_negada; reservar_notificacoes passa a ler só o canal push (cópia da função da 21 com esse filtro).
- agendamentos ganha horario_definido_em (gatilho na criação e na mudança de data_hora; sem preencher os antigos, onde vale created_at).
- consentimentos aceita a finalidade whatsapp_avisos e a revogação com origem whatsapp.
- Tabelas novas, com RLS e sem acesso do app: confirmacoes_presenca (um pedido por agendamento e horário; estados pendente, enviada, confirmada, recusada, nao_enviada, invalidada), whatsapp_mensagens (uma linha por tentativa, gravada antes de chamar a Meta; estados iniciado, aceito, enviado, entregue, lido, falhou, incerto) e whatsapp_eventos (mensagens recebidas já processadas).
- Funções novas (SECURITY DEFINER, search_path = pg_catalog, pg_temp): enfileirar_confirmacoes_presenca (chamada pela rotina de cada minuto; gera entre 120 e 60 minutos antes; chave única whatsapp:confirmacao:<agendamento>:<horário>), reservar_whatsapp, concluir_envio_whatsapp, whatsapp_registrar_status, whatsapp_registrar_resposta, whatsapp_motivo_para_nao_enviar, presenca_dos_agendamentos (única liberada para o usuário logado: cliente, barbeiro do atendimento ou admin) e os auxiliares whatsapp_telefone, whatsapp_chave_numero e whatsapp_consentiu. rotina_notificacoes foi trocada para também gerar os pedidos.
- Gatilho invalidar_confirmacao_presenca: cancelar ou mudar o horário invalida o pedido aberto e descarta o aviso pendente.
- Regras: erro informado pela Meta tenta de novo (30 s, 2 e 8 minutos, até vencer 1 hora antes); recusa é definitiva; resultado incerto (sem resposta da Meta ou reserva vencida) nunca é reenviado. A primeira resposta válida é a definitiva. Botão exige o identificador do pedido, a mensagem respondida e o número do destinatário; texto só vale como "sim", "nao" ou "não" e com exatamente um pedido aberto (senão é ambíguo). Antes de aceitar, o banco trava o agendamento e depois o pedido e reconfere status, horário e se já passou. A Meta pode devolver o celular sem o 9: os dois formatos são comparados como iguais.

Backend:
- services/whatsapp.js: cliente da Cloud API (template e texto), classificação do resultado (aceito, recusado, erro, incerto) só com o código do erro, conferência da assinatura X-Hub-Signature-256 e leitura do corpo do webhook.
- services/confirmacaoPresenca.js: lê a fila, monta o template (cliente, serviço, barbeiro, data e hora de Brasília; botões com VB_SIM:<pedido> e VB_NAO:<pedido>), grava o resultado, trata as respostas e manda um retorno curto ao cliente (texto livre, dentro da janela que a resposta dele abriu).
- services/notificacoesConfig.js: chaves por canal. WhatsApp só liga com NOTIFICACOES_WHATSAPP_ATIVO=true e WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN (16 ou mais caracteres) e WHATSAPP_TEMPLATE_CONFIRMACAO. Opcionais: WHATSAPP_TEMPLATE_PRESENCA_NEGADA, WHATSAPP_TEMPLATE_IDIOMA (padrão pt_BR), WHATSAPP_API_VERSAO (padrão v23.0 no código; conferir a versão vigente da Graph API) e WHATSAPP_PILOTO_USUARIOS. Push só com NOTIFICACOES_PUSH_ATIVO=true e EXPO_ACCESS_TOKEN. NOTIFICACOES_ATIVAS preenchida desliga tudo.
- routes/whatsapp.js: GET /api/whatsapp/webhook (verificação da Meta) e POST /api/whatsapp/webhook (só com assinatura válida; falha ao gravar devolve 500 para a Meta entregar de novo; repetição é ignorada). Desligado, responde 503.
- routes/notificacoes.js: /processar funciona com qualquer canal ligado e lê a fila de cada um; /teste é só do push. app.js guarda o corpo bruto só para o webhook e monta /api/whatsapp.
- services/consentimento.js: nova finalidade whatsapp_avisos. backend/.env.example: variáveis novas (só nomes) e sem NOTIFICACOES_ATIVAS.

Site e app:
- Perfil: seção "Mensagens pelo WhatsApp" (components/WhatsappPerfil.tsx nos dois), que só deixa ativar com a concordância marcada e um celular salvo.
- Aviso de Privacidade: Parte 3, mensagens pelo WhatsApp (lib/privacidade.ts nos dois, com o mesmo texto e a mesma versão).
- Barbeiro: lib/painelBarbeiro.ts busca a situação (presenca_dos_agendamentos; se a função não existir, a agenda segue igual) e os cartões mostram "Presença confirmada pelo WhatsApp", "Cliente avisou que não virá" ou "Sem resposta no WhatsApp".

Arquivos criados: supabase/migrations/20261113000025_whatsapp_confirmacao_presenca.sql; backend/src/services/whatsapp.js, confirmacaoPresenca.js e notificacoesConfig.js; backend/src/routes/whatsapp.js; backend/test/whatsapp.sql.test.js e whatsapp.test.js; cut-advisor-pro/src/components/WhatsappPerfil.tsx e src/test/whatsapp-presenca.test.tsx; barber-mobile/src/components/WhatsappPerfil.tsx.
Arquivos alterados: backend/.env.example, src/app.js, src/routes/notificacoes.js, src/services/consentimento.js e test/helpers/bancoAgenda.js; cut-advisor-pro/src/lib/painelBarbeiro.ts, lib/privacidade.ts, pages/Perfil.tsx, pages/AvisoPrivacidade.tsx, components/barbeiro/CartaoAgendamento.tsx e test/painel-barbeiro.test.tsx; barber-mobile/src/lib/painelBarbeiro.ts, lib/privacidade.ts, screens/cliente/PerfilScreen.tsx, screens/cliente/AvisoPrivacidadeScreen.tsx e components/barbeiro/CartaoAtendimento.tsx.

Testes de 13/11 (só locais; nenhum envio real, nenhuma chamada à Meta, nada no Supabase):
- backend: 289 testes, 0 falhas (245 antigos, 24 em whatsapp.sql.test.js e 20 em whatsapp.test.js, com PGlite e uma Meta falsa);
- site: 235 testes, 0 falhas (7 novos em whatsapp-presenca.test.tsx); tsc e eslint dos arquivos novos sem erros;
- app: tsc só com o erro antigo de ThemeContext.tsx; as telas do app não têm teste automatizado.
Não testado: Cloud API real, formato real do webhook da Meta, PostgREST e Supabase reais com a migration 25, e as telas num celular.

Templates a criar na Meta (categoria utilidade, idioma pt_BR; os nomes vão nas variáveis):
- Regras da Meta conferidas em 13/11 (página de revisão de templates): o texto não pode começar nem terminar com variável; variáveis demais para o tamanho do texto causam recusa; nomes só com minúsculas, números e sublinhado; toda variável precisa de um exemplo; resposta rápida tem até 25 caracteres; rodapé até 60. O código envia os valores por posição, então os templates precisam usar variáveis numeradas ({{1}}, {{2}}...), não nomeadas, e não podem ter cabeçalho com variável.
- Confirmação (nome sugerido confirmacao_presenca, em WHATSAPP_TEMPLATE_CONFIRMACAO). Corpo: "Olá, {{1}}! Aqui é a Visage Barber. Você tem um horário marcado: {{2}} com {{3}}, no dia {{4}}, às {{5}}. Você confirma a sua presença? Responda tocando em um dos botões abaixo." Variáveis: 1 primeiro nome do cliente, 2 serviço, 3 primeiro nome do barbeiro, 4 data (20/11), 5 hora (14h30 ou 14h). Dois botões de resposta rápida, nesta ordem: "Sim" e "Não" (o código preenche os identificadores VB_SIM:<pedido> e VB_NAO:<pedido> no envio, pelas posições 0 e 1). Rodapé opcional e fixo: "Responda PARAR para não receber mais mensagens."
- Aviso ao barbeiro (nome sugerido presenca_negada, em WHATSAPP_TEMPLATE_PRESENCA_NEGADA; opcional), sem botões. Corpo: "Aviso da Visage Barber: {{1}} informou que não poderá comparecer ao atendimento de {{2}} marcado para o dia {{3}}, às {{4}}. O horário continua reservado na sua agenda. Se quiser liberá-lo, cancele o agendamento pelo aplicativo." Variáveis: 1 primeiro nome do cliente, 2 serviço, 3 data, 4 hora. A primeira redação deste template (de 13/11, mais cedo) começava com uma variável e seria recusada; esta é a que vale.

O que falta fora do código (cada item com autorização):
1. Revisão do usuário e commit.
2. Meta: portfólio empresarial, app com o produto WhatsApp, número (começar pelo de teste), usuário do sistema com token permanente e os templates aprovados.
3. Supabase: executar a migration 25 (mostrar conteúdo, dependências e ordem antes; a 16, a 21 e a 22 precisam estar aplicadas).
4. Deploy do backend ainda desligado; conferir no log "[notificacoes] desligadas".
5. Render: criar as variáveis WHATSAPP_ e, por último, NOTIFICACOES_WHATSAPP_ATIVO=true, com WHATSAPP_PILOTO_USUARIOS preenchida. Nunca NOTIFICACOES_ATIVAS.
6. Meta: cadastrar o webhook https://visage-backend-vnfg.onrender.com/api/whatsapp/webhook com o token de verificação e assinar o campo messages.
7. Piloto com contas de teste; depois, publicar o site e gerar um APK novo com as telas.

Limites conhecidos:
- Se o backend reiniciar entre o envio e a gravação do resultado, o pedido vira "resultado incerto" mesmo que a mensagem tenha chegado, e a resposta do cliente a essa mensagem não é aceita.
- O banco considera válida qualquer autorização vigente, mesmo de uma versão antiga do aviso.
- Texto "sim" ou "não" sem responder a uma mensagem específica só vale com um pedido aberto.
- Enquanto existirem avisos de push pendentes (os lembretes de 30 minutos), o banco continua acordando o backend a cada minuto.
- Os textos do aviso de privacidade e da concordância precisam de validação jurídica.
