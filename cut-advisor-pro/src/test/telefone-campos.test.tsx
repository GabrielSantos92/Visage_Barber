// Campo de telefone (web) e os formularios que o usam: mascara ao digitar,
// cursor, colagem, validacao e envio so com digitos ao banco/backend.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sb = vi.hoisted(() => ({
  signUp: vi.fn(),
  perfil: { nome: "Ana", telefone: "11987654321" } as { nome: string; telefone: string | null },
  updates: [] as unknown[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signUp: sb.signUp },
    from: () => {
      const b: any = {
        select: () => b, eq: () => b,
        single: async () => ({ data: sb.perfil, error: null }),
        update: (v: unknown) => { sb.updates.push(v); return { eq: async () => ({ error: null }) }; },
      };
      return b;
    },
  },
}));
const auth = vi.hoisted(() => ({ user: { id: "u1", email: "ana@x.com" }, role: "cliente" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/PrivacidadePerfil", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));
const api = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), apiPost: api.apiPost }));

import TelefoneInput from "@/components/TelefoneInput";
import Register from "@/pages/Register";
import Perfil from "@/pages/Perfil";
import BarbeiroFormDialog from "@/components/admin/BarbeiroFormDialog";
import { telefoneCorresponde } from "@/lib/telefone";

beforeEach(() => {
  sb.signUp.mockReset().mockResolvedValue({ error: null });
  sb.perfil = { nome: "Ana", telefone: "11987654321" };
  sb.updates.length = 0;
  api.apiPost.mockReset().mockResolvedValue({});
  toast.success.mockClear();
  toast.error.mockClear();
});

// Simula o navegador: aplica a edicao no texto e posiciona o cursor
function editar(el: HTMLInputElement, novo: string, cursor = novo.length) {
  fireEvent.keyDown(el, { key: "x" });
  fireEvent.change(el, { target: { value: novo, selectionStart: cursor, selectionEnd: cursor } });
}
function digitar(el: HTMLInputElement, texto: string) {
  for (const c of texto) {
    const pos = el.selectionStart ?? el.value.length;
    editar(el, el.value.slice(0, pos) + c + el.value.slice(pos), pos + 1);
  }
}

function Campo({ inicial = "" }: { inicial?: string }) {
  const [v, setV] = useState(inicial);
  return <TelefoneInput aria-label="telefone" value={v} onChange={setV} />;
}

describe("TelefoneInput", () => {
  const campo = () => screen.getByLabelText("telefone") as HTMLInputElement;

  it("aplica a mascara ao digitar celular e fixo, com teclado numerico", () => {
    render(<Campo />);
    campo().focus();
    digitar(campo(), "11987654321");
    expect(campo().value).toBe("(11) 98765-4321");
    expect(campo()).toHaveAttribute("type", "tel");
    expect(campo()).toHaveAttribute("inputmode", "numeric");

    editar(campo(), "");
    digitar(campo(), "1133334444");
    expect(campo().value).toBe("(11) 3333-4444");
  });

  it("ignora letras e simbolos", () => {
    render(<Campo />);
    campo().focus();
    digitar(campo(), "11a9b#8");
    expect(campo().value).toBe("(11) 98");
  });

  it("colar com mascara, com +55 ou so numeros", () => {
    render(<Campo />);
    campo().focus();
    editar(campo(), "+55 (21) 99876-5432");
    expect(campo().value).toBe("(21) 99876-5432");
    editar(campo(), "11987654321");
    expect(campo().value).toBe("(11) 98765-4321");
  });

  it("apagar um digito do meio mantem o cursor no mesmo ponto", () => {
    render(<Campo inicial="(11) 98765-4321" />);
    campo().focus();
    const pos = "(11) 987".length;
    // Backspace com o cursor depois do 7
    editar(campo(), "(11) 98" + "65-4321", pos - 1);
    expect(campo().value).toBe("(11) 9865-4321");
    expect(campo().selectionStart).toBe("(11) 98".length);
  });

  it("apagar tudo deixa o campo vazio", () => {
    render(<Campo inicial="(11) 98765-4321" />);
    campo().focus();
    editar(campo(), "", 0);
    expect(campo().value).toBe("");
  });

  it("busca por telefone com ou sem mascara", () => {
    expect(telefoneCorresponde("11987654321", "(11) 9876")).toBe(true);
    expect(telefoneCorresponde("(11) 98765-4321", "119876")).toBe(true);
    expect(telefoneCorresponde("11987654321", "joao")).toBe(false);
  });
});

describe("Cadastro de cliente", () => {
  async function preencher(telefone: string) {
    render(<MemoryRouter><Register /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText("Seu nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByPlaceholderText("seu@email.com"), { target: { value: "ana@x.com" } });
    const senhas = document.querySelectorAll('input[type="password"]');
    senhas.forEach((s) => fireEvent.change(s, { target: { value: "segredo1" } }));
    const tel = screen.getByPlaceholderText("(11) 99999-9999") as HTMLInputElement;
    tel.focus();
    if (telefone) editar(tel, telefone);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /criar conta/i })); });
  }

  it("envia o telefone so com digitos", async () => {
    await preencher("(11) 98765-4321");
    expect(sb.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: { data: { nome: "Ana", telefone: "11987654321" } },
    }));
  });

  it("telefone opcional: vazio e aceito", async () => {
    await preencher("");
    expect(sb.signUp.mock.calls[0][0].options.data.telefone).toBe("");
  });

  it("telefone incompleto bloqueia o cadastro", async () => {
    await preencher("119876");
    expect(screen.getByText(/telefone incompleto/i)).toBeInTheDocument();
    expect(sb.signUp).not.toHaveBeenCalled();
  });
});

describe("Perfil", () => {
  async function abrir() {
    render(<MemoryRouter><Perfil /></MemoryRouter>);
    return (await screen.findByPlaceholderText("(11) 99999-9999")) as HTMLInputElement;
  }

  it("mostra o telefone salvo formatado e salva so digitos ao editar", async () => {
    const tel = await abrir();
    expect(tel.value).toBe("(11) 98765-4321");
    tel.focus();
    editar(tel, "(21) 3333-4444");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i })); });
    expect(sb.updates).toEqual([{ nome: "Ana", telefone: "2133334444" }]);
  });

  it("numero antigo salvo com mascara continua aparecendo certo", async () => {
    sb.perfil = { nome: "Ana", telefone: "(11) 3333-4444" };
    expect((await abrir()).value).toBe("(11) 3333-4444");
  });

  it("telefone invalido nao e salvo", async () => {
    const tel = await abrir();
    tel.focus();
    editar(tel, "(11) 8876-5432");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i })); });
    expect(screen.getByText(/fixo deve começar/i)).toBeInTheDocument();
    expect(sb.updates).toHaveLength(0);
  });

  it("apagar o telefone salva vazio (campo opcional)", async () => {
    const tel = await abrir();
    tel.focus();
    editar(tel, "", 0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i })); });
    expect(sb.updates).toEqual([{ nome: "Ana", telefone: null }]);
  });
});

describe("Cadastro de barbeiro pelo admin", () => {
  async function criar(telefone: string) {
    render(<BarbeiroFormDialog open barbeiro={null} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Nome completo"), { target: { value: "Carlos" } });
    fireEvent.change(screen.getByPlaceholderText("barbeiro@email.com"), { target: { value: "c@x.com" } });
    fireEvent.change(screen.getByPlaceholderText("Mínimo 6 caracteres"), { target: { value: "segredo1" } });
    const tel = screen.getByPlaceholderText("(11) 99999-9999") as HTMLInputElement;
    tel.focus();
    if (telefone) editar(tel, telefone);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar barbeiro" })); });
  }

  it("telefone obrigatorio", async () => {
    await criar("");
    expect(screen.getByText("Telefone é obrigatório")).toBeInTheDocument();
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("recusa numero incompleto", async () => {
    await criar("1198765");
    expect(screen.getByText(/telefone incompleto/i)).toBeInTheDocument();
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("envia ao backend so com digitos", async () => {
    await criar("(11) 98765-4321");
    expect(api.apiPost).toHaveBeenCalledWith("/api/admin/create-barbeiro", expect.objectContaining({ telefone: "11987654321" }));
  });
});
