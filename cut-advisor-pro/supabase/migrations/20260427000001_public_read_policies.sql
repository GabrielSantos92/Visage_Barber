-- Allow unauthenticated users to browse the catalog on the homepage
CREATE POLICY "Public can view active servicos"
  ON public.servicos FOR SELECT
  USING (ativo = true);

CREATE POLICY "Public can view active barbeiros"
  ON public.barbeiros FOR SELECT
  USING (ativo = true);
