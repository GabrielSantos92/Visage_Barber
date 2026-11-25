// Cada tela de login so abre a propria area: conta de barbeiro nao entra pela
// Area do Cliente (email e senha ou Google) e conta de cliente nao entra pela
// Area do Barbeiro. O admin entra pelas duas. Login recusado encerra so a
// sessao recem-criada (scope "local") e mostra o motivo. A regra e a mesma no
// site e no app.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "u0000000-0000-4000-8000-000000000001";

const sb = vi.hoisted(() => ({
  // Linhas de user_roles da conta; null = a consulta falha
  roles: [] as string[] | null,
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  consultas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signInWithPassword: sb.signInWithPassword, signOut: sb.signOut, getSession: sb.getSession },
    from: (tabela: string) => {
      sb.consultas.push(tabela);
      const b = {
        select: () => b,
        eq: async () =>
          sb.roles === null
            ? { data: null, error: { message: "falha de rede" } }
            : { data: sb.roles.map((role) => ({ role })), error: null },
      };
      return b;
    },
  },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));
vi.mock("@/lib/loginGoogle", async (orig) => ({
  ...(await orig<typeof import("@/lib/loginGoogle")>()),
  preencherNomeDoGoogle: vi.fn(),
}));

import Login from "@/pages/Login";
import BarbeiroLogin from "@/pages/BarbeiroLogin";
import AuthCallback from "@/pages/AuthCallback";
import * as web from "@/lib/areaDeLogin";
import * as app from "../../../barber-mobile/src/lib/areaDeLogin";

const { MENSAGENS_AREA } = web;
const CLIENTE = ["cliente"];
const BARBEIRO = ["cliente", "barbeiro"]; // o gatilho do cadastro tambem cria "cliente"
const ADMIN = ["admin"];

beforeEach(() => {
  sb.roles = [];
  sb.consultas = [];
  sb.signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: USER }, session: {} }, error: null });
  sb.signOut.mockReset().mockResolvedValue({ error: null });
  sb.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER, user_metadata: {} } } } });
  toast.success.mockClear();
  toast.error.mockClear();
});

function abrir(inicial: string) {
  render(
    <MemoryRouter initialEntries={[inicial]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/barbeiro/login" element={<BarbeiroLogin />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<p>tela inicial</p>} />
        <Route path="/dashboard" element={<p>painel do barbeiro</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function entrar(inicial: "/login" | "/barbeiro/login", roles: string[] | null) {
  sb.roles = roles;
  abrir(inicial);
  fireEvent.change(screen.getByPlaceholderText("seu@email.com"), { target: { value: "conta@visage.com" } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "senha123" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "ENTRAR" })); });
}

describe("regra das areas de login", () => {
  const casos: [string, string[] | null, web.AreaDeLogin, string | null][] = [
    ["cliente na Area do Cliente", CLIENTE, "cliente", null],
    ["barbeiro na Area do Cliente", BARBEIRO, "cliente", MENSAGENS_AREA.contaDeBarbeiro],
    ["barbeiro so com a linha barbeiro na Area do Cliente", ["barbeiro"], "cliente", MENSAGENS_AREA.contaDeBarbeiro],
    ["admin na Area do Cliente", ADMIN, "cliente", null],
    ["conta sem papel na Area do Cliente", [], "cliente", null],
    ["barbeiro na Area do Barbeiro", BARBEIRO, "barbeiro", null],
    ["cliente na Area do Barbeiro", CLIENTE, "barbeiro", MENSAGENS_AREA.contaDeCliente],
    ["conta sem papel na Area do Barbeiro", [], "barbeiro", MENSAGENS_AREA.contaDeCliente],
    ["admin (que tambem e barbeiro) na Area do Barbeiro", ["admin", "barbeiro"], "barbeiro", null],
    ["papel nao confirmado na Area do Cliente", null, "cliente", MENSAGENS_AREA.semConfirmacao],
    ["papel nao confirmado na Area do Barbeiro", null, "barbeiro", MENSAGENS_AREA.semConfirmacao],
  ];

  it.each(casos)("%s (site e app iguais)", (_nome, roles, area, esperado) => {
    expect(web.recusaDaArea(roles, area)).toBe(esperado);
    expect(app.recusaDaArea(roles, area)).toBe(esperado);
  });

  it("mesmo codigo no site e no app", () => {
    const raiz = resolve(__dirname, "../../..");
    const normalizar = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8").replace(/\r\n/g, "\n").replace(/"/g, "'");
    expect(normalizar("barber-mobile/src/lib/areaDeLogin.ts")).toBe(normalizar("cut-advisor-pro/src/lib/areaDeLogin.ts"));
  });
});

describe("Area do Cliente (/login)", () => {
  it("conta de barbeiro e recusada: a sessao e encerrada so neste navegador e o motivo aparece", async () => {
    await entrar("/login", BARBEIRO);
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.getByText(MENSAGENS_AREA.contaDeBarbeiro)).toBeInTheDocument();
    expect(screen.queryByText("tela inicial")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("conta de cliente entra normalmente", async () => {
    await entrar("/login", CLIENTE);
    expect(sb.consultas).toEqual(["user_roles"]);
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("tela inicial")).toBeInTheDocument();
  });

  it("admin entra pela Area do Cliente", async () => {
    await entrar("/login", ADMIN);
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("tela inicial")).toBeInTheDocument();
  });

  it("sem confirmar o papel, recusa e encerra a sessao", async () => {
    await entrar("/login", null);
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.getByText(MENSAGENS_AREA.semConfirmacao)).toBeInTheDocument();
    expect(screen.queryByText("tela inicial")).not.toBeInTheDocument();
  });

  it("senha errada continua com a mensagem de sempre, sem consultar o papel", async () => {
    sb.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid login credentials" } });
    await entrar("/login", CLIENTE);
    expect(screen.getByText("Email ou senha incorretos")).toBeInTheDocument();
    expect(sb.consultas).toEqual([]);
    expect(sb.signOut).not.toHaveBeenCalled();
  });
});

describe("Area do Barbeiro (/barbeiro/login)", () => {
  it("conta de cliente e recusada: a sessao e encerrada so neste navegador e o motivo aparece", async () => {
    await entrar("/barbeiro/login", CLIENTE);
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.getByText(MENSAGENS_AREA.contaDeCliente)).toBeInTheDocument();
    expect(screen.queryByText("painel do barbeiro")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("conta de barbeiro abre o Painel", async () => {
    await entrar("/barbeiro/login", BARBEIRO);
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("painel do barbeiro")).toBeInTheDocument();
  });

  it("admin entra pela Area do Barbeiro", async () => {
    await entrar("/barbeiro/login", ADMIN);
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("painel do barbeiro")).toBeInTheDocument();
  });
});

describe("Google (so existe na Area do Cliente)", () => {
  it("conta de barbeiro com o mesmo email e recusada e volta ao login", async () => {
    sb.roles = BARBEIRO;
    abrir("/auth/callback");
    await act(async () => {});
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(toast.error).toHaveBeenCalledWith(MENSAGENS_AREA.contaDeBarbeiro);
    expect(screen.queryByText("tela inicial")).not.toBeInTheDocument();
  });

  it("conta de cliente entra normalmente", async () => {
    sb.roles = CLIENTE;
    abrir("/auth/callback");
    await act(async () => {});
    expect(sb.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("tela inicial")).toBeInTheDocument();
  });
});
