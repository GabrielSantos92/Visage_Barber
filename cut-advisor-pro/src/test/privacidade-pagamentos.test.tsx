// Aviso de Privacidade: a parte de pagamentos online explica o que vai para o
// Mercado Pago (conferido no backend), o que fica guardado e quem ve. A parte
// do visagismo nao muda: mesma versao, sem pedir a concordancia de novo.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));

import AvisoPrivacidade from "@/pages/AvisoPrivacidade";
import { VERSAO_AVISO_PAGAMENTOS, VERSAO_AVISO_VISAGISMO } from "@/lib/privacidade";

const abrir = () => render(<MemoryRouter initialEntries={["/privacidade#pagamentos"]}><AvisoPrivacidade /></MemoryRouter>);

describe("Aviso de Privacidade - pagamentos online", () => {
  it("explica o que vai para o Mercado Pago, o que fica guardado e quem vê", () => {
    abrir();
    const parte = screen.getByRole("region", { name: "Pagamentos online" });
    for (const t of [
      "O que o Visage Barber envia ao Mercado Pago", "O que o Mercado Pago recebe diretamente de você", "O que guardamos",
      "Para que usamos e base legal", "Quem vê os seus pagamentos", "Por quanto tempo guardamos", "Seus direitos",
    ]) {
      expect(within(parte).getByRole("heading", { name: t })).toBeInTheDocument();
    }
    expect(within(parte).getByText(/O e-mail da sua conta no Visage Barber/)).toBeInTheDocument();
    expect(within(parte).getByText(/O nome do serviço e o valor do agendamento/)).toBeInTheDocument();
    expect(within(parte).getByText(/Não enviamos seu nome, telefone, CPF/)).toBeInTheDocument();
    expect(within(parte).getByText(/não passam pelo Visage Barber e não são guardados por nós/)).toBeInTheDocument();
    expect(within(parte).getByText(/nenhum dado seu é enviado ao Mercado Pago/)).toBeInTheDocument();
    expect(within(parte).getByText(/Versão de 05\/11\/2026/)).toBeInTheDocument();
    expect(VERSAO_AVISO_PAGAMENTOS).toBe("2026-11-05");
  });

  it("a parte do visagismo continua igual: mesma versão, a concordância não precisa ser pedida de novo", () => {
    expect(VERSAO_AVISO_VISAGISMO).toBe("2026-11-04");
    abrir();
    expect(screen.getByText("Análise de visagismo por foto · Versão de 04/11/2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "5. Processamento por inteligência artificial e compartilhamento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "pagamentos online" })).toHaveAttribute("href", "#pagamentos");
  });
});
