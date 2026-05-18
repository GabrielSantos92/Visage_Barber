-- Adiciona campo de formato do rosto no perfil do usuário
-- Possíveis valores: oval, redondo, quadrado, triangular, losango, oblongo
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS formato_rosto TEXT;
