# Memória de cálculo: "Quanto o Visage Barber pode render" (slide 15)

Estimativa para planejamento, feita em 28/11/2026. Mude as premissas à vontade: as contas abaixo são simples.

## Premissas
| Item | Valor | Fonte / observação |
|---|---|---|
| Dólar | R$ 5,50 | hipótese; ajuste para a cotação do dia |
| Render (backend, plano Starter 0.5 CPU / 512 MB) | US$ 7/mês | render.com/pricing; o site estático é grátis |
| Supabase Pro | US$ 25/mês | hoje o projeto usa o plano gratuito; Pro ao escalar |
| Análise do rosto (Gemini 3 Flash no Replicate) | ≈ US$ 0,01 | US$ 0,50 por 1M de tokens de entrada, US$ 3,00 de saída |
| Simulação (Nano Banana Pro no Replicate) | ≈ US$ 0,15 | sites de comparação indicam US$ 0,15 a 0,18 por imagem; conferir em replicate.com |
| Máscara (Grounded SAM no Replicate) | ≈ US$ 0,01 | cobrança por tempo de GPU |
| **Simulação completa** | **≈ US$ 0,17 ≈ R$ 0,95** | análise + máscara + imagem |
| Impostos | ≈ 6% da receita | Simples Nacional, faixa inicial (Anexo III) |

## Planos (slide 14)
| Plano | Preço | Cota de simulações/mês |
|---|---|---|
| Básico | R$ 79 | 20 |
| Pró | R$ 149 | 60 |
| Premium | R$ 299 | 150 |

## Cenário: 30 barbearias (15 Básico, 12 Pró, 3 Premium)
- **Receita**: 15 × 79 + 12 × 149 + 3 × 299 = 1.185 + 1.788 + 897 = **R$ 3.870/mês**
- **IA**: cota total = 15 × 20 + 12 × 60 + 3 × 150 = 1.470 simulações; com 60% de uso = 882 × US$ 0,17 = US$ 149,94 ≈ **R$ 825**
- **Servidores**: (US$ 7 + US$ 25) × 5,50 = **R$ 176**
- **Impostos**: 6% × 3.870 ≈ **R$ 232**
- **Custos totais**: 825 + 176 + 232 = **R$ 1.233/mês**
- **Ganho**: 3.870 − 1.233 = **R$ 2.637/mês** (68%) ≈ R$ 880 por sócio (3) ≈ **R$ 31,6 mil por ano**
- **Empate**: o custo fixo (R$ 176) é coberto por 3 barbearias no plano Básico (3 × 79 = 237, menos IA e imposto).

Fora da conta: taxas do Mercado Pago (pagas pela barbearia, não por nós), conta de desenvolvedor do Google Play (US$ 25, uma vez) e o tempo de suporte.
