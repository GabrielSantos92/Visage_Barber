-- Analises de visagismo salvas no app + envio da comparacao pelo chat.
--
--   visagismo_analises   historico do cliente (JSON da analise + caminho da imagem)
--   bucket "visagismo"   privado; cada cliente grava em <user_id>/<arquivo>.jpg
--   mensagens.imagem_path anexo de imagem em uma mensagem do chat
--
-- O bucket e privado porque guarda foto do rosto do cliente. O barbeiro so
-- consegue ler uma imagem depois que o cliente a enviou em uma conversa com ele.

-- 1) Historico ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.visagismo_analises (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resultado   jsonb NOT NULL,
  imagem_path text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visagismo_analises_user_idx
  ON public.visagismo_analises (user_id, created_at DESC);

ALTER TABLE public.visagismo_analises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente le suas analises" ON public.visagismo_analises;
CREATE POLICY "Cliente le suas analises" ON public.visagismo_analises
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Cliente salva suas analises" ON public.visagismo_analises;
CREATE POLICY "Cliente salva suas analises" ON public.visagismo_analises
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Cliente apaga suas analises" ON public.visagismo_analises;
CREATE POLICY "Cliente apaga suas analises" ON public.visagismo_analises
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 2) Imagem no chat ----------------------------------------------------------

ALTER TABLE public.mensagens ADD COLUMN IF NOT EXISTS imagem_path text;

-- Verdadeiro se quem chama e o barbeiro de uma conversa em que essa imagem foi
-- enviada, e a imagem pertence ao cliente dessa mesma conversa.
-- SECURITY DEFINER para nao depender das policies de mensagens/conversas.
CREATE OR REPLACE FUNCTION public.pode_ver_imagem_chat(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.mensagens m
      JOIN public.conversas c ON c.id = m.conversa_id
      JOIN public.barbeiros b ON b.id = c.barbeiro_id
     WHERE m.imagem_path = p_path
       AND b.user_id = auth.uid()
       AND split_part(p_path, '/', 1) = c.cliente_id::text
  );
$$;

REVOKE ALL ON FUNCTION public.pode_ver_imagem_chat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_ver_imagem_chat(text) TO authenticated;

-- 3) Storage -----------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('visagismo', 'visagismo', false, 10485760, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Visagismo: dono envia" ON storage.objects;
CREATE POLICY "Visagismo: dono envia" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'visagismo' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Visagismo: dono le" ON storage.objects;
CREATE POLICY "Visagismo: dono le" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'visagismo' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Visagismo: dono apaga" ON storage.objects;
CREATE POLICY "Visagismo: dono apaga" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'visagismo' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Visagismo: barbeiro le o que recebeu no chat" ON storage.objects;
CREATE POLICY "Visagismo: barbeiro le o que recebeu no chat" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'visagismo' AND public.pode_ver_imagem_chat(name));
