-- =====================================================================
-- Nota media de cada barbeiro (cards de barbeiro no app e na web)
--
-- O RLS de avaliacoes so deixa o cliente ler as proprias avaliacoes, entao o
-- app nao consegue calcular a media sozinho. Esta funcao devolve apenas o
-- agregado (media e quantidade) por barbeiro ativo: nao expoe comentarios,
-- notas individuais nem quem avaliou.
--
-- Barbeiros sem avaliacao nao aparecem no resultado.
-- Seguro para re-executar. Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

CREATE OR REPLACE FUNCTION public.notas_barbeiros()
RETURNS TABLE (barbeiro_id uuid, media numeric, total integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT av.barbeiro_id,
         round(avg(av.nota)::numeric, 1) AS media,
         count(*)::integer               AS total
  FROM public.avaliacoes av
  JOIN public.barbeiros b ON b.id = av.barbeiro_id
  WHERE b.ativo = true
  GROUP BY av.barbeiro_id;
$$;

-- Liberada tambem para anon: os barbeiros ativos ja sao publicos
REVOKE ALL ON FUNCTION public.notas_barbeiros() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notas_barbeiros() TO anon, authenticated;
