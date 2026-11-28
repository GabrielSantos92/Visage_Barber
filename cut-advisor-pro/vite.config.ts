import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Variaveis que o site precisa em producao (sao publicas: vao no pacote). Sem
// elas o build da hospedagem para aqui, em vez de publicar um site que chama
// http://localhost:3001 ou um Supabase vazio. Ver .env.example.
const OBRIGATORIAS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_API_URL"];

function conferirAmbienteDoBuild(mode: string) {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const faltam = OBRIGATORIAS.filter((nome) => !env[nome]?.trim());
  if (faltam.length) {
    throw new Error(`Build de produção sem ${faltam.join(", ")}. Configure as variáveis na hospedagem (ver cut-advisor-pro/.env.example).`);
  }
  // Na hospedagem (Vercel, Render ou CI), o backend local nao serve
  const hospedagem = Boolean(process.env.VERCEL || process.env.RENDER || process.env.CI);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.VITE_API_URL.trim())) {
    const aviso = "VITE_API_URL aponta para o backend local.";
    if (hospedagem) throw new Error(`${aviso} Use o endereço público do backend (Render).`);
    console.warn(`[build] ${aviso} O pacote gerado só funciona nesta máquina.`);
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  if (command === "build" && mode === "production") conferirAmbienteDoBuild(mode);
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
