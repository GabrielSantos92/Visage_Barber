import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../../lib/theme';
import {
  AReceber, FORMAS_PRESENCIAIS, LinhaBarbeiro, PontoSerie, Resumo, agrupar, buscarAReceber, buscarPorBarbeiro,
  buscarResumo, buscarSerie, percentual, registrarPagamentoPresencial,
} from '../../../lib/financeiro';
import { ROTULO_METODO, cancelarCobrancasAbertas, formatarReais } from '../../../lib/pagamentos';
import { Botoes, Cartao, Estilos, FiltrosFinanceiro, Folha, Secao, dataHora, numero } from './comum';
import { GraficoBarbeiros, GraficoFaturamento } from './Graficos';

// Indicadores, pendencias, graficos, desempenho por barbeiro e o que falta
// receber na barbearia. Os valores vem do banco (mesmas funcoes do site).
export default function VisaoGeral({ s, C, filtros, onCarregado, irParaPagamentos }: {
  s: Estilos; C: Theme; filtros: FiltrosFinanceiro; onCarregado: () => void; irParaPagamentos: () => void;
}) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [serie, setSerie] = useState<PontoSerie[]>([]);
  const [porBarbeiro, setPorBarbeiro] = useState<LinhaBarbeiro[]>([]);
  const [aReceber, setAReceber] = useState<AReceber[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [receber, setReceber] = useState<AReceber | null>(null);
  const [cancelando, setCancelando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [r, sr, b, a] = await Promise.all([
        buscarResumo(filtros), buscarSerie(filtros), buscarPorBarbeiro(filtros), buscarAReceber(filtros.inicio, filtros.fim),
      ]);
      setResumo(r); setSerie(sr); setPorBarbeiro(b); setAReceber(a);
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível carregar o financeiro.');
    }
    setCarregando(false);
    onCarregado();
  }, [filtros, onCarregado]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  const grafico = useMemo(() => agrupar(serie, filtros.inicio, filtros.fim), [serie, filtros.inicio, filtros.fim]);

  // Cobrancas canceladas aqui que ainda podem ser pagas no Mercado Pago
  async function cancelarAbertas() {
    setCancelando(true);
    setAviso(null);
    try {
      const r = await cancelarCobrancasAbertas();
      setAviso(r.falharam
        ? `${r.falharam} cobrança(s) não puderam ser canceladas agora. Se alguma já tiver sido paga, ela aparece como duplicidade.`
        : r.canceladas ? `${r.canceladas} cobrança(s) cancelada(s) no Mercado Pago.` : 'Nenhuma cobrança aberta para cancelar.');
      await carregar();
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível cancelar no Mercado Pago.');
    }
    setCancelando(false);
  }

  if (carregando) return <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />;

  return (
    <>
      {!!erro && <Text style={s.erro} accessibilityRole="alert">{erro}</Text>}
      {!!aviso && <Text style={s.sucesso} accessibilityRole="alert">{aviso}</Text>}
      {resumo && (
        <>
          <View style={s.grid}>
            <Cartao s={s} rotulo="FATURAMENTO BRUTO" valor={formatarReais(resumo.faturamento_bruto)}
              sub={`${resumo.servicos} serviço(s) · líquido ${formatarReais(resumo.faturamento)}`} />
            <Cartao s={s} rotulo="TOTAL RECEBIDO" valor={formatarReais(resumo.total_recebido)}
              sub={`Sem taxas e reembolsos: ${formatarReais(resumo.recebido_liquido)}`} />
            <Cartao s={s} rotulo="PENDENTES" valor={formatarReais(resumo.pendentes_valor)} sub={`${resumo.pendentes_quantidade} cobrança(s) em aberto`} />
            <Cartao s={s} rotulo="TAXAS" valor={formatarReais(resumo.taxas)} sub="Meios de pagamento" />
            <Cartao s={s} rotulo="COMISSÕES" valor={formatarReais(resumo.comissoes)} sub="Serviços do período" />
            <Cartao s={s} rotulo="COMISSÕES A PAGAR" valor={formatarReais(resumo.comissoes_pendentes)} sub="Saldo hoje" />
            <Cartao s={s} rotulo="COMISSÕES PAGAS" valor={formatarReais(resumo.comissoes_pagas)} sub="Pagas no período" />
            <Cartao s={s} rotulo="REEMBOLSOS" valor={formatarReais(resumo.reembolsos)}
              sub={resumo.descontos ? `Descontos: ${formatarReais(resumo.descontos)}` : undefined} />
          </View>
          <View style={s.receita}>
            <Text style={s.cartaoRotulo}>RECEITA DA BARBEARIA ANTES DAS DEMAIS DESPESAS</Text>
            <Text style={[s.cartaoValor, { fontSize: 22 }]}>{formatarReais(resumo.receita_barbearia)}</Text>
            <Text style={s.nota}>Serviços realizados menos comissões e taxas. Não desconta aluguel, produtos e outras despesas: não é lucro líquido.</Text>
          </View>

          {(resumo.duplicados_quantidade > 0 || resumo.cobrancas_abertas > 0) && (
            <View style={s.alerta} accessibilityRole="alert">
              {resumo.duplicados_quantidade > 0 && (
                <>
                  <Text style={s.alertaTexto}>
                    {resumo.duplicados_quantidade} pagamento(s) em duplicidade: {formatarReais(resumo.duplicados_valor)} recebidos a mais. Devolva ao cliente.
                  </Text>
                  <TouchableOpacity style={s.acao} onPress={irParaPagamentos} accessibilityRole="button">
                    <Text style={s.acaoText}>VER DUPLICIDADES</Text>
                  </TouchableOpacity>
                </>
              )}
              {resumo.cobrancas_abertas > 0 && (
                <>
                  <Text style={s.alertaTexto}>{resumo.cobrancas_abertas} cobrança(s) cancelada(s) aqui ainda podem ser pagas no Mercado Pago.</Text>
                  <TouchableOpacity style={s.acao} onPress={cancelarAbertas} disabled={cancelando} accessibilityRole="button">
                    {cancelando ? <ActivityIndicator color={C.primary} size="small" /> : <Text style={s.acaoText}>CANCELAR NO MERCADO PAGO</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          <Secao s={s} titulo="FATURAMENTO E COMISSÕES">
            <View style={s.bloco}><GraficoFaturamento dados={grafico} C={C} /></View>
          </Secao>
          <Secao s={s} titulo="DESEMPENHO DOS PROFISSIONAIS">
            <View style={s.bloco}><GraficoBarbeiros linhas={porBarbeiro} C={C} /></View>
          </Secao>

          <Secao s={s} titulo="POR BARBEIRO">
            {porBarbeiro.map((b) => (
              <View key={b.barbeiro_id} style={s.linha}>
                <View style={{ flex: 1 }}>
                  <Text style={s.linhaTitulo}>{b.nome}{!b.ativo ? '  ·  INATIVO' : ''}</Text>
                  <Text style={s.legenda}>
                    {b.servicos} serviço(s) · {formatarReais(b.faturamento)} · comissão {formatarReais(b.comissao)}
                  </Text>
                  <Text style={[s.legenda, b.percentual == null && { color: C.warning }]}>
                    {b.percentual == null ? 'COMISSÃO NÃO CONFIGURADA' : `% ATUAL ${percentual(b.percentual)}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.legenda}>A PAGAR</Text>
                  <Text style={s.linhaValor}>{formatarReais(b.saldo_pendente)}</Text>
                </View>
              </View>
            ))}
          </Secao>
        </>
      )}

      <Secao s={s} titulo="A RECEBER NA BARBEARIA">
        {aReceber.length === 0 ? (
          <Text style={s.vazio}>Nenhum atendimento pendente de pagamento no período.</Text>
        ) : aReceber.map((a) => (
          <View key={a.agendamento_id} style={s.linha}>
            <View style={{ flex: 1 }}>
              <Text style={s.linhaTitulo}>{a.cliente} · {a.servico}</Text>
              <Text style={s.legenda}>
                {dataHora(a.data_hora)} · {a.barbeiro} · {formatarReais(a.preco)}
                {a.metodo_pendente ? ` · ${a.metodo_pendente === 'presencial' ? 'vai pagar na barbearia' : `${ROTULO_METODO[a.metodo_pendente]} em aberto`}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={s.acao} onPress={() => setReceber(a)} accessibilityRole="button" accessibilityLabel={`Receber de ${a.cliente}`}>
              <Text style={s.acaoText}>RECEBER</Text>
            </TouchableOpacity>
          </View>
        ))}
      </Secao>

      <ReceberModal
        s={s} C={C} item={receber} onFechar={() => setReceber(null)}
        onConcluido={() => { setReceber(null); setAviso('Pagamento registrado.'); carregar(); }}
      />
    </>
  );
}

// Pagamento feito na barbearia (dinheiro, maquininha ou PIX direto)
function ReceberModal({ s, C, item, onFechar, onConcluido }: {
  s: Estilos; C: Theme; item: AReceber | null; onFechar: () => void; onConcluido: () => void;
}) {
  const [forma, setForma] = useState('dinheiro');
  const [desconto, setDesconto] = useState('');
  const [taxa, setTaxa] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setForma('dinheiro'); setDesconto(''); setTaxa(''); setErro(null);
  }, [item]);

  async function confirmar() {
    if (!item) return;
    setSalvando(true);
    setErro(null);
    try {
      await registrarPagamentoPresencial(item.agendamento_id, forma, numero(desconto), numero(taxa));
      onConcluido();
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível registrar.');
    }
    setSalvando(false);
  }

  return (
    <Folha s={s} visivel={!!item} onFechar={() => { if (!salvando) onFechar(); }}>
      {item && (
        <>
          <Text style={s.modalTitulo}>PAGAMENTO NA BARBEARIA</Text>
          <Text style={s.linhaTitulo}>{item.cliente} · {item.servico} · {formatarReais(item.preco)}</Text>
          <View style={s.opcoes} accessibilityRole="radiogroup" accessibilityLabel="Forma de pagamento">
            {FORMAS_PRESENCIAIS.map((o) => (
              <TouchableOpacity
                key={o.valor} style={[s.chip, forma === o.valor && s.chipAtivo]} onPress={() => setForma(o.valor)}
                accessibilityRole="radio" accessibilityState={{ checked: forma === o.valor }}
              >
                <Text style={[s.chipText, forma === o.valor && { color: C.primaryFg }]}>{o.rotulo.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={s.campo} value={desconto} onChangeText={setDesconto} placeholder="Desconto (R$)" placeholderTextColor={C.mutedFg} keyboardType="decimal-pad" accessibilityLabel="Desconto" />
            <TextInput style={s.campo} value={taxa} onChangeText={setTaxa} placeholder="Taxa maquininha (R$)" placeholderTextColor={C.mutedFg} keyboardType="decimal-pad" accessibilityLabel="Taxa da maquininha" />
          </View>
          <Text style={[s.legenda, { marginTop: 10 }]}>VALOR RECEBIDO {formatarReais(Math.max(0, item.preco - numero(desconto)))}</Text>
          {!!erro && <Text style={[s.nota, { color: C.destructive }]} accessibilityRole="alert">{erro}</Text>}
          <Botoes s={s} C={C} onCancelar={onFechar} onConfirmar={confirmar} salvando={salvando} />
        </>
      )}
    </Folha>
  );
}
