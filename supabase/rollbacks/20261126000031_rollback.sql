-- Rollback da migration 31 (limite de uso do visagismo).
-- Antes de rodar, volte o backend para uma versão sem services/cotaVisagismo.js
-- ou aceite que ele passe a contar só na memória de cada instância (o backend
-- detecta a função ausente e cai para essa contagem, avisando no log).
DROP FUNCTION IF EXISTS public.consumir_cota_visagismo(uuid, text, integer, integer, integer);
DROP TABLE IF EXISTS public.visagismo_uso;
