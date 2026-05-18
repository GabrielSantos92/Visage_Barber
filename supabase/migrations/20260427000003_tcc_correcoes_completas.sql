-- =====================================================================
-- TCC BarberPro — Migration completa para testar o app mobile
-- Execute no Supabase Dashboard > SQL Editor
-- Seguro para re-executar (usa IF NOT EXISTS e DROP IF EXISTS)
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Campo formato_rosto em profiles (VisagismoScreen + PerfilScreen)
-- ---------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS formato_rosto TEXT;

-- ---------------------------------------------------------------
-- 2. Tabela avaliacoes (AgendamentosScreen — botão AVALIAR)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avaliacoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.agendamentos(id) ON DELETE CASCADE UNIQUE,
  cliente_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  barbeiro_id    UUID REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  nota           INTEGER NOT NULL CHECK (nota >= 1 AND nota <= 5),
  comentario     TEXT,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente insere propria avaliacao" ON public.avaliacoes;
CREATE POLICY "Cliente insere propria avaliacao" ON public.avaliacoes
  FOR INSERT WITH CHECK (auth.uid() = cliente_id);

DROP POLICY IF EXISTS "Cliente le proprias avaliacoes" ON public.avaliacoes;
CREATE POLICY "Cliente le proprias avaliacoes" ON public.avaliacoes
  FOR SELECT USING (auth.uid() = cliente_id);

DROP POLICY IF EXISTS "Barbeiro le suas avaliacoes" ON public.avaliacoes;
CREATE POLICY "Barbeiro le suas avaliacoes" ON public.avaliacoes
  FOR SELECT USING (
    barbeiro_id IN (SELECT id FROM public.barbeiros WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------
-- 3. Admin: acesso total a barbeiros (BarbeariasScreen)
--    Sem isso: criar/ativar/desativar barbeiro falha silenciosamente
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admin acessa barbeiros" ON public.barbeiros;
CREATE POLICY "Admin acessa barbeiros" ON public.barbeiros
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------
-- 4. Admin: ver todos os profiles (UsuariosScreen)
--    Sem isso: admin só vê seu próprio perfil
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admin ve todos os profiles" ON public.profiles;
CREATE POLICY "Admin ve todos os profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------
-- 5. Admin: acesso total a agendamentos e avaliações
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admin acessa agendamentos" ON public.agendamentos;
CREATE POLICY "Admin acessa agendamentos" ON public.agendamentos
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin acessa avaliacoes" ON public.avaliacoes;
CREATE POLICY "Admin acessa avaliacoes" ON public.avaliacoes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------
-- 6. Admin: acesso total a servicos
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admin acessa servicos" ON public.servicos;
CREATE POLICY "Admin acessa servicos" ON public.servicos
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------
-- 7. Leitura pública de barbeiros e serviços (web homepage)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view active barbeiros" ON public.barbeiros;
CREATE POLICY "Public can view active barbeiros" ON public.barbeiros
  FOR SELECT USING (ativo = true);

DROP POLICY IF EXISTS "Public can view active servicos" ON public.servicos;
CREATE POLICY "Public can view active servicos" ON public.servicos
  FOR SELECT USING (ativo = true);
