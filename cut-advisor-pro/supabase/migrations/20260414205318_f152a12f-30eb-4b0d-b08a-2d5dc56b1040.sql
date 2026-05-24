
-- Barbeiros table
CREATE TABLE public.barbeiros (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  especialidade TEXT,
  foto_url TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.barbeiros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view active barbeiros"
  ON public.barbeiros FOR SELECT TO authenticated
  USING (ativo = true);

CREATE POLICY "Barbeiros can update their own record"
  ON public.barbeiros FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Servicos table
CREATE TABLE public.servicos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco DECIMAL(10,2) NOT NULL,
  duracao_min INTEGER NOT NULL DEFAULT 30,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.servicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view active servicos"
  ON public.servicos FOR SELECT TO authenticated
  USING (ativo = true);

-- Barbeiro-Servicos junction
CREATE TABLE public.barbeiro_servicos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbeiro_id UUID NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  servico_id UUID NOT NULL REFERENCES public.servicos(id) ON DELETE CASCADE,
  UNIQUE(barbeiro_id, servico_id)
);

ALTER TABLE public.barbeiro_servicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view barbeiro_servicos"
  ON public.barbeiro_servicos FOR SELECT TO authenticated
  USING (true);

-- Horarios disponiveis (weekly schedule)
CREATE TABLE public.horarios_disponiveis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbeiro_id UUID NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  CHECK (hora_fim > hora_inicio)
);

ALTER TABLE public.horarios_disponiveis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view horarios"
  ON public.horarios_disponiveis FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Barbeiros can manage own horarios"
  ON public.horarios_disponiveis FOR ALL TO authenticated
  USING (barbeiro_id IN (SELECT id FROM public.barbeiros WHERE user_id = auth.uid()));

-- Agendamentos status enum
CREATE TYPE public.agendamento_status AS ENUM ('pendente', 'confirmado', 'cancelado', 'concluido');

-- Agendamentos table
CREATE TABLE public.agendamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  barbeiro_id UUID NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  servico_id UUID NOT NULL REFERENCES public.servicos(id) ON DELETE CASCADE,
  data_hora TIMESTAMP WITH TIME ZONE NOT NULL,
  status agendamento_status NOT NULL DEFAULT 'pendente',
  observacoes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own agendamentos"
  ON public.agendamentos FOR SELECT TO authenticated
  USING (auth.uid() = cliente_id);

CREATE POLICY "Barbeiros can view their agendamentos"
  ON public.agendamentos FOR SELECT TO authenticated
  USING (barbeiro_id IN (SELECT id FROM public.barbeiros WHERE user_id = auth.uid()));

CREATE POLICY "Clients can create agendamentos"
  ON public.agendamentos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cliente_id);

CREATE POLICY "Clients can update own agendamentos"
  ON public.agendamentos FOR UPDATE TO authenticated
  USING (auth.uid() = cliente_id);

CREATE TRIGGER update_agendamentos_updated_at
  BEFORE UPDATE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_agendamentos_cliente ON public.agendamentos(cliente_id);
CREATE INDEX idx_agendamentos_barbeiro ON public.agendamentos(barbeiro_id);
CREATE INDEX idx_agendamentos_data ON public.agendamentos(data_hora);
CREATE INDEX idx_horarios_barbeiro ON public.horarios_disponiveis(barbeiro_id);
