-- =====================================================================
-- Trigger: cria profile e user_role automaticamente ao registrar usuário
-- Resolve: cadastro não criava perfil nem role → usuário ficava inválido
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Cria perfil com dados do metadata do signup
  INSERT INTO public.profiles (user_id, nome, telefone)
  SELECT
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', ''),
    COALESCE(NEW.raw_user_meta_data->>'telefone', '')
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = NEW.id
  );

  -- Atribui role padrão 'cliente'
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, 'cliente'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
