-- Exclusao de barbeiros: o banco passa a impedir apagar um barbeiro que tenha
-- qualquer agendamento, em qualquer status.
-- Antes a FK agendamentos.barbeiro_id era ON DELETE CASCADE: apagar o barbeiro
-- (ou a conta de login dele, que apaga o barbeiro por cascata) levava junto todo
-- o historico de agendamentos. Com RESTRICT o DELETE falha (erro 23001 ou 23503) e
-- nada e apagado, mesmo que o agendamento seja criado no instante da exclusao.
-- Nao altera nem remove nenhum dado. Seguro para re-executar.
-- Execute no Supabase Dashboard > SQL Editor

ALTER TABLE public.agendamentos
  DROP CONSTRAINT IF EXISTS agendamentos_barbeiro_id_fkey;

ALTER TABLE public.agendamentos
  ADD CONSTRAINT agendamentos_barbeiro_id_fkey
  FOREIGN KEY (barbeiro_id) REFERENCES public.barbeiros(id) ON DELETE RESTRICT;
