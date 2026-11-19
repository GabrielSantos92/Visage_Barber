// Central de notificacoes do app (barber-mobile/src/lib/centralNotificacoes.ts):
// texto de cada tipo, tela aberta pelo toque e os canais do Android iguais aos
// do backend. Nada chama o Supabase (cliente simulado).
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../../barber-mobile/src/lib/supabase", () => ({ supabase: {} }));
import {
  textoDaNotificacao, destinoDaNotificacao, quando, deveExibirNoApp,
} from "../../../barber-mobile/src/lib/centralNotificacoes";
vi.mock("../../../barber-mobile/src/lib/api", () => ({ api: {} }));
import * as appPriv from "../../../barber-mobile/src/lib/privacidade";
import * as webPriv from "@/lib/privacidade";

const RAIZ = path.resolve(__dirname, "../../..");
const HORA = "2026-11-20T17:30:00Z"; // 14h30 em Sao Paulo

describe("central de notificações do app", () => {
  it("data e hora no fuso da barbearia", () => {
    expect(quando(HORA)).toBe("20/11 às 14h30");
    expect(quando("2026-11-20T17:00:00Z")).toBe("20/11 às 14h");
    expect(quando("invalida")).toBe("o horário marcado");
  });

  it("texto de cada tipo, sem texto de mensagem do chat", () => {
    const base = { data_hora: HORA, servico: "Corte", cliente_nome: "Ana", barbeiro_nome: "João" };
    expect(textoDaNotificacao({ tipo: "novo_agendamento", dados: { ...base, papel: "barbeiro" } }))
      .toEqual({ titulo: "Novo agendamento", corpo: "Ana agendou Corte para 20/11 às 14h30." });
    expect(textoDaNotificacao({ tipo: "cancelamento", dados: { ...base, papel: "barbeiro", ator: "cliente" } }).corpo)
      .toBe("Ana cancelou o atendimento de 20/11 às 14h30 (Corte).");
    expect(textoDaNotificacao({ tipo: "cancelamento", dados: { ...base, papel: "cliente", ator: "barbeiro" } }).corpo)
      .toBe("João cancelou o seu atendimento de 20/11 às 14h30 (Corte).");
    expect(textoDaNotificacao({ tipo: "cancelamento", dados: { ...base, papel: "cliente", ator: "barbearia" } }).corpo)
      .toBe("A barbearia cancelou o seu atendimento de 20/11 às 14h30 (Corte).");
    expect(textoDaNotificacao({ tipo: "lembrete", dados: { ...base, papel: "cliente" } }))
      .toEqual({ titulo: "Seu atendimento está próximo", corpo: "Corte com João às 14h30." });
    expect(textoDaNotificacao({ tipo: "lembrete", dados: { ...base, papel: "barbeiro" } }).corpo).toBe("Ana às 14h30 (Corte).");
    expect(textoDaNotificacao({ tipo: "mensagem", dados: { outro_nome: "João" } }).corpo).toBe("Você recebeu uma mensagem de João.");
  });

  it("novo agendamento para o cliente: diz quem agendou para ele", () => {
    const base = { data_hora: HORA, servico: "Corte", cliente_nome: "Ana", barbeiro_nome: "João", papel: "cliente" as const };
    expect(textoDaNotificacao({ tipo: "novo_agendamento", dados: { ...base, ator: "barbeiro" } }))
      .toEqual({ titulo: "Agendamento marcado para você", corpo: "João agendou Corte para você em 20/11 às 14h30." });
    expect(textoDaNotificacao({ tipo: "novo_agendamento", dados: { ...base, ator: "barbearia" } }).corpo)
      .toBe("A barbearia agendou Corte para você em 20/11 às 14h30.");
  });

  it("com o app aberto, só aparece o aviso da conta logada (nada sem login)", () => {
    expect(deveExibirNoApp({ destinatario: "u1" }, "u1")).toBe(true);
    expect(deveExibirNoApp({ destinatario: "u1" }, "u2")).toBe(false);
    expect(deveExibirNoApp({ destinatario: "u1" }, null)).toBe(false);
    expect(deveExibirNoApp({}, null)).toBe(false);
    expect(deveExibirNoApp({}, "u1")).toBe(true);
  });

  it("tela bloqueada: todos os canais escondem o conteúdo; o logout limpa a barra e invalida o token", () => {
    const app = fs.readFileSync(path.join(RAIZ, "barber-mobile/src/lib/pushNotificacoes.ts"), "utf8");
    expect(app).toMatch(/lockscreenVisibility: Notifications\.AndroidNotificationVisibility\.PRIVATE/);
    const remover = app.slice(app.indexOf("export async function removerAparelho"));
    expect(remover).toMatch(/dismissAllNotificationsAsync/);
    expect(remover).toMatch(/unregisterForNotificationsAsync/);
    expect(fs.readFileSync(path.join(RAIZ, "barber-mobile/src/contexts/AuthContext.tsx"), "utf8"))
      .toMatch(/await removerAparelho\(\);\s*await supabase\.auth\.signOut\(\)/);
  });

  it("WhatsApp fora do Perfil no site e no app (mesma chave nas duas plataformas)", () => {
    expect(webPriv.WHATSAPP_NO_PERFIL).toBe(false);
    expect(appPriv.WHATSAPP_NO_PERFIL).toBe(webPriv.WHATSAPP_NO_PERFIL);
    const tela = fs.readFileSync(path.join(RAIZ, "barber-mobile/src/screens/cliente/PerfilScreen.tsx"), "utf8");
    expect(tela).toMatch(/\{WHATSAPP_NO_PERFIL && \(\s*<WhatsappPerfil/);
  });

  it("o toque abre o chat da conversa ou a agenda; sem dados, nenhuma tela", () => {
    expect(destinoDaNotificacao("mensagem", { barbeiro_id: "b1", cliente_id: "c1", outro_nome: "João" }))
      .toEqual({ tela: "chat", params: { outroNome: "João", barbeiroId: "b1", clienteId: "c1" } });
    expect(destinoDaNotificacao("mensagem", { outro_nome: "João" })).toBeNull();
    for (const tipo of ["novo_agendamento", "cancelamento", "lembrete"]) {
      expect(destinoDaNotificacao(tipo, { agendamento_id: "a1" })).toEqual({ tela: "agenda" });
    }
    expect(destinoDaNotificacao("teste", {})).toBeNull();
    expect(destinoDaNotificacao(undefined, undefined)).toBeNull();
  });

  it("os canais do Android do app são exatamente os que o backend usa", () => {
    const app = fs.readFileSync(path.join(RAIZ, "barber-mobile/src/lib/pushNotificacoes.ts"), "utf8");
    const backend = fs.readFileSync(path.join(RAIZ, "backend/src/services/notificacoes.js"), "utf8");
    const doApp = [...app.matchAll(/\{ id: '([a-z]+)', nome:/g)].map((m) => m[1]).sort();
    const bloco = backend.slice(backend.indexOf("const CANAIS = {"), backend.indexOf("};", backend.indexOf("const CANAIS = {")));
    const doBackend = [...new Set([...bloco.matchAll(/: '([a-z]+)'/g)].map((m) => m[1]))].sort();
    expect(doApp).toEqual(doBackend);
  });

  it("o app não envia push direto (nenhuma chamada à API da Expo nem leitura de push_token)", () => {
    const pasta = path.join(RAIZ, "barber-mobile/src");
    const arquivos: string[] = [];
    const varrer = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) varrer(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !p.includes(`${path.sep}types${path.sep}`)) arquivos.push(p);
    });
    varrer(pasta);
    for (const f of arquivos) {
      const t = fs.readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/exp\.host|push_token|sendPushNotification/);
    }
  });
});
