# Roteiro da demonstração (5 minutos) — 05/12/2026, 8h

Slide 13 ("DEMONSTRAÇÃO"). Gabriel mostra o cliente (2:30); Lucas mostra o barbeiro e o admin (2:30).

## Preparar na véspera (04/12) — ensaiar o roteiro inteiro uma vez
1. **Conta de cliente só para a demo** (ex.: "Cliente Demo"), criada no site e com e-mail confirmado. Não usar a conta pessoal: ela já tem muitos agendamentos, e o sistema limita a 3 por dia e bloqueia serviços repetidos no mesmo dia.
2. **Celular com o APK 11**, logado como **Eliselton** (`eli@gmail.com`), com notificações permitidas, carregado e com som/vibração ligados.
3. **Navegador com três janelas** (ou perfis): uma para o cliente da demo, uma para o Eliselton e uma para o admin (`admin@gmail.com`), já logadas em https://visage-barber.onrender.com.
4. **Foto para o visagismo** salva no computador (rosto de frente, boa luz), além de uma **análise já salva** na conta da demo (plano B).
5. Conferir que o backend responde: abrir https://visage-backend-vnfg.onrender.com/api/pagamentos/config (deve mostrar `{"online":false,...}`).
6. Internet: levar um roteador do celular como reserva.

## Gabriel — lado do cliente (2:30)
1. **Agendar** (1:00): na janela do cliente, abrir "Agendar", escolher **Barba e Bigode** (serviço novo), barbeiro **Eliselton**, o dia seguinte e um horário livre. Confirmar.
   - Fala: "O sistema só mostra horários livres e não deixa marcar dois clientes no mesmo horário."
2. **Visagismo** (1:30): abrir "Visagismo", aceitar o consentimento ("a cada análise pedimos autorização, por causa da LGPD"), enviar a foto, mostrar o formato do rosto e as recomendações, e então gerar a simulação.
   - Enquanto a IA processa (pode levar de 20 a 40 s): "A máscara limita a IA ao cabelo e à barba, por isso o rosto continua o mesmo."
   - **Plano B**: se a IA demorar mais de 40 s ou der erro, abrir a análise já salva.

## Lucas — barbeiro e administrador (2:30)
1. **Push** (0:30): mostrar no celular a notificação do novo agendamento (aparece em alguns segundos). Abrir a central de avisos no app.
   - Fala: "O aviso é genérico, sem nome nem horário, para não expor dados na tela bloqueada."
2. **Painel do Barbeiro** (0:45): na janela do Eliselton, o Painel com o filtro "Este mês": faturamento, comissão (50%), gráficos e o agendamento que acabou de entrar.
3. **Financeiro do admin** (1:00): na janela do admin, abrir **Financeiro** (receita por mês e formas de pagamento) e depois **Comissões** (percentual padrão de 50% e saldo de cada barbeiro).
4. **Gestão** (0:15): Admin → Serviços, mostrando Bigode, Cavanhaque e Barba e Bigode, cada um com seus componentes.

## Se algo falhar
- **Sem internet**: seguir com os slides e falar sobre os prints. Recomendo tirar prints de cada passo na véspera e guardar numa pasta.
- **Push não chegou**: "a entrega depende do Firebase/Google; normalmente chega em segundos". Mostrar a central de avisos do app.
- **IA lenta**: plano B (análise salva).
