# Perguntas prováveis da banca e respostas curtas

Quem responde: Alice (negócio, documentação, requisitos), Gabriel (arquitetura, IA), Lucas (financeiro, segurança, testes). Quem souber melhor pode complementar.

**1. Por que o pagamento online está só em teste?** (Lucas)
Para receber dinheiro real é preciso a conta do Mercado Pago da própria barbearia, verificada e com chave Pix. Integração, aprovação conferida no servidor e webhook assinado estão prontos e foram testados no ambiente de testes do Mercado Pago. Ir para produção é trocar as credenciais. O pagamento na barbearia funciona de verdade e gera a comissão.

**2. Como vocês protegem os dados (LGPD)?** (Lucas)
Pedimos consentimento a cada análise por foto. As fotos ficam em armazenamento privado, só do dono, e existe um aviso de privacidade. As notificações push não levam nome, horário nem serviço. No banco, cada perfil só acessa os próprios dados (Row Level Security).

**3. E se alguém chamar a API direto, sem o app?** (Lucas)
As regras estão no banco, não só na tela: conflito de horário, limite de 3 agendamentos por dia, preço congelado no agendamento e quem pode ver o quê. O preço enviado pelo app é ignorado.

**4. A IA pode errar o formato do rosto?** (Gabriel)
Pode. Por isso o resultado é uma recomendação, não uma decisão, e o cliente pode ajustar preferências (formal, despojado, sem barba). Usamos saída estruturada (JSON com esquema) para a resposta vir sempre no mesmo formato, e a simulação preserva o rosto original com uma máscara.

**5. Por que a simulação não deforma o rosto?** (Gabriel)
Modelos de edição de imagem costumam redesenhar o rosto inteiro. Geramos uma máscara só do cabelo e da barba (segmentação com Grounded SAM) e montamos o resultado sobre a foto original. O que está fora da máscara é a foto verdadeira.

**6. Quanto custa a IA? Isso não inviabiliza o negócio?** (Alice/Gabriel)
Cerca de US$ 0,17 por simulação completa (cerca de R$ 0,95): a análise custa centavos e o maior custo é a imagem. Por isso cada plano tem uma cota mensal de simulações, e o backend tem limite por usuário e um total diário, configuráveis.

**7. Como vocês testaram?** (Lucas)
São 792 testes automatizados: 501 no back-end, inclusive sobre o banco montado pelas migrations reais num PostgreSQL embutido, e 291 no site. O app foi testado manualmente em celular Android, por perfil. Limitação: não há testes automatizados no app nem testes de carga (trabalho futuro).

**8. Por que Supabase e não um banco próprio?** (Gabriel)
Ele entrega PostgreSQL, autenticação e regras de acesso por linha prontos, com plano gratuito para começar. Isso deixou o tempo para as regras de negócio.

**9. Por que React Native com Expo?** (Gabriel)
É um código só em TypeScript, como o site, o que permite reaproveitar a lógica: as bibliotecas de pagamento e do painel são iguais no site e no app, e um teste confere isso. Além disso, o build do APK é feito na nuvem.

**10. Os requisitos mudaram desde o início?** (Alice)
Alguns foram reescritos para refletir o sistema real (ex.: "cadastro de cortes" virou "cadastro de serviços", e a notificação virou push). Os 27 do escopo foram entregues e entraram 8 novos (financeiro, pagamento, painel do barbeiro, push, consentimento).

**11. Dá para agendar para duas pessoas ao mesmo tempo?** (Alice)
Ainda não: é trabalho futuro. Exige rever duas regras do banco, o limite diário por cliente e o bloqueio de serviços repetidos no mesmo dia.

**12. Funciona no iPhone?** (Gabriel)
O site funciona em qualquer navegador, inclusive no iPhone. O app foi publicado para Android; como é React Native, a versão iOS é viável, mas exige a conta de desenvolvedor da Apple (trabalho futuro).

**13. De onde vem o "74% preferem agendar online"?** (Alice)
⚠ Conferir a fonte citada no texto do TCC antes da apresentação. A banca pode pedir.
