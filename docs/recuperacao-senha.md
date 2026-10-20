# Recuperação de senha ("Esqueceu a senha?")

Vale para clientes, barbeiros e administradores: todos são contas do Supabase Auth
(`auth.users`), com perfil em `profiles` e papel em `user_roles`. A recuperação só
altera a senha. Perfil, papel e agendamentos não mudam, e nenhuma conta é criada.

## Como funciona

1. Web (`/forgot-password`) ou app (`EsqueciSenha`) → `POST /api/auth/recuperar-senha/email`.
2. O backend valida, aplica limites e chama `supabase.auth.resetPasswordForEmail`.
   A resposta é sempre a mesma, exista ou não a conta, e é enviada antes do e-mail
   para que o tempo de resposta também não revele nada.
3. O Supabase envia o e-mail com um link de uso único e prazo de validade.
4. O link abre:
   - **web**: `/reset-password` (`ResetPassword.tsx`);
   - **app**: `visagebarber://auth/callback` → `AuthContext` → `RedefinirSenhaScreen`.
5. A nova senha é salva com `supabase.auth.updateUser`. O Supabase Auth valida o
   token e o tamanho mínimo da senha no servidor e grava o hash (bcrypt).
6. Em seguida as sessões são encerradas (web: todas; app: as dos outros aparelhos,
   e a atual ao tocar em "IR PARA O LOGIN").

### Proteções

| Proteção | Onde |
|---|---|
| Resposta igual para dado cadastrado ou não | backend (`MSG_GENERICA`) |
| 3 pedidos a cada 15 min por e-mail, 10 por IP | backend (memória) |
| E-mail completo fora dos logs | backend |

Os limites em memória valem por processo. Se o backend rodar com várias
instâncias, cada uma conta separadamente.

## Configuração necessária

### 1. Supabase Auth — envio real de e-mail

- **Authentication → Emails → SMTP Settings**: configure um SMTP próprio
  (ex.: Resend, Brevo, SendGrid, Amazon SES). O SMTP padrão do Supabase só entrega
  para os membros da equipe do projeto e tem limite muito baixo por hora: **sem
  SMTP próprio, usuários comuns não recebem o e-mail**.
- **Authentication → Rate Limits**: ajuste o limite de e-mails por hora depois de
  configurar o SMTP.
- **Authentication → URL Configuration → Redirect URLs**: inclua
  - `https://SEU-DOMINIO/reset-password` (web em produção)
  - `http://localhost:8080/reset-password` (web em desenvolvimento)
  - `visagebarber://auth/callback` (app instalado)
  - `exp://**` (Expo Go em desenvolvimento)

  Se o endereço não estiver na lista, o Supabase manda o usuário para a Site URL e
  a tela de nova senha não abre.
- **Authentication → Emails → Templates → Reset Password**: opcional, traduzir o
  texto. Mantenha o link `{{ .ConfirmationURL }}`.
- **Authentication → Providers → Email**: confira a validade do link ("Email OTP
  Expiration", padrão 1 hora) e o tamanho mínimo de senha (o app usa 6).

### 2. Frontends

Nenhuma chave nova. O site usa `VITE_API_URL` e o app usa `EXPO_PUBLIC_API_URL`
(ou o IP do Metro em desenvolvimento) para falar com o backend.

## Testes

- `cd backend && npm test`: validações, limites e resposta genérica (Supabase Auth simulado).
- `cd cut-advisor-pro && npm test`: regras de senha.

O envio real de e-mail só pode ser conferido depois de configurar o SMTP.
