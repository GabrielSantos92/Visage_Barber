-- Tabela de avaliações de serviços
CREATE TABLE IF NOT EXISTS public.avaliacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id UUID REFERENCES public.agendamentos(id) ON DELETE CASCADE UNIQUE,
  cliente_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  barbeiro_id UUID REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  nota INTEGER NOT NULL CHECK (nota >= 1 AND nota <= 5),
  comentario TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

-- Cliente pode inserir avaliação para seus próprios agendamentos
CREATE POLICY "Cliente insere propria avaliacao" ON public.avaliacoes
  FOR INSERT WITH CHECK (auth.uid() = cliente_id);

-- Cliente lê suas próprias avaliações
CREATE POLICY "Cliente le proprias avaliacoes" ON public.avaliacoes
  FOR SELECT USING (auth.uid() = cliente_id);

-- Barbeiro lê avaliações que recebeu
CREATE POLICY "Barbeiro le suas avaliacoes" ON public.avaliacoes
  FOR SELECT USING (
    barbeiro_id IN (
      SELECT id FROM public.barbeiros WHERE user_id = auth.uid()
    )
  );
