import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../../lib/theme';
import {
  EventoPagamento, LinhaPagamento, LinhaReembolso, ROTULO_ORIGEM, ROTULO_ORIGEM_REEMBOLSO, buscarDuplicidades,
  buscarHistorico, buscarPagamentosAdmin, buscarReembolsos, descreverEvento, detalheDoEvento, registrarReembolsoPresencial,
} from '../../../lib/financeiro';
import {
  ROTULO_METODO, ROTULO_STATUS, StatusPagamento, formatarReais, reembolsarOnline, sincronizarPagamento,
} from '../../../lib/pagamentos';
import { Botoes, Chips, Confirmacao, Estilos, FiltrosFinanceiro, Folha, Secao, dataHora, numero, paraCampo } from './comum';

const STATUS: { valor: StatusPagamento | ''; rotulo: string }[] = [
  { valor: '', rotulo: 'TODOS' },
  { valor: 'approved', rotulo: 'PAGOS' },
  { valor: 'pending', rotulo: 'AGUARDANDO' },
  { valor: 'partially_refunded', rotulo: 'REEMBOLSO PARCIAL' },
  { valor: 'refunded', rotulo: 'REEMBOLSADOS' },
  { valor: 'rejected', rotulo: 'RECUSADOS' },
  { valor: 'expired', rotulo: 'EXPIRADOS' },
  { valor: 'canceled', rotulo: 'CANCELADOS' },
];

const reembolsavel = (p: LinhaPagamento) => p.status === 'approved' || p.status === 'partially_refunded';

// Duplicidades a devolver, lista de pagamentos (com historico e acoes) e reembolsos
export default function PagamentosAba({ s, C, filtros, onCarregado }: {
  s: Estilos; C: Theme; filtros: FiltrosFinanceiro; onCarregado: () => void;
}) {
  const [status, setStatus] = useState<StatusPagamento | ''>('');
  const [pagamentos, setPagamentos] = useState<LinhaPagamento[]>([]);
  const [duplicidades, setDuplicidades] = useState<LinhaPagamento[]>([]);
  const [reembolsos, setReembolsos] = useState<LinhaReembolso[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ item: LinhaPagamento; reembolsar: boolean } | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [p, d, r] = await Promise.all([
        buscarPagamentosAdmin({ ...filtros, status: status || null }), buscarDuplicidades(), buscarReembolsos(filtros),
      ]);
      setPagamentos(p); setDuplicidades(d); setReembolsos(r);
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível carregar os pagamentos.');
    }
    setCarregando(false);
    onCarregado();
  }, [filtros, status, onCarregado]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  return (
    <>
      <Chips s={s} C={C} opcoes={STATUS} valor={status} onChange={setStatus} rotulo="Status do pagamento" />
      {!!erro && <Text style={s.erro} accessibilityRole="alert">{erro}</Text>}
      {!!aviso && <Text style={s.sucesso} accessibilityRole="alert">{aviso}</Text>}

      {carregando ? <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} /> : (
        <>
          {duplicidades.length > 0 && (
            <Secao s={s} titulo="PAGAMENTOS EM DUPLICIDADE">
              <Text style={[s.nota, { paddingHorizontal: 24, marginTop: 0, marginBottom: 4 }]}>
                O atendimento já estava quitado por outro pagamento. O valor entrou na conta, não gera comissão e deve ser
                devolvido ao cliente. Nada é devolvido automaticamente.
              </Text>
              {duplicidades.map((d) => (
                <View key={d.id} style={s.linha}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.linhaTitulo}>{d.cliente} · {d.servico}</Text>
                    <Text style={s.legenda}>{ROTULO_METODO[d.metodo]}{d.aprovado_em ? ` · pago em ${dataHora(d.aprovado_em)}` : ''}</Text>
                    <Text style={[s.linhaValor, { marginTop: 2 }]}>{formatarReais(d.valor - d.valor_reembolsado)}</Text>
                  </View>
                  <TouchableOpacity style={s.acao} onPress={() => setAberto({ item: d, reembolsar: true })} accessibilityRole="button" accessibilityLabel={`Devolver duplicidade de ${d.cliente}`}>
                    <Text style={s.acaoText}>DEVOLVER</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </Secao>
          )}

          <Secao s={s} titulo="PAGAMENTOS">
            {pagamentos.length === 0 ? (
              <Text style={s.vazio}>Nenhum pagamento no período.</Text>
            ) : pagamentos.map((p) => {
              const abertaNoProvedor = p.status === 'canceled' && (p.cancelamento_provedor === 'pendente' || p.cancelamento_provedor === 'falhou');
              return (
                <TouchableOpacity
                  key={p.id} style={s.linha} onPress={() => setAberto({ item: p, reembolsar: false })}
                  accessibilityRole="button" accessibilityLabel={`Pagamento de ${p.cliente}, ${ROTULO_STATUS[p.status]}, ${formatarReais(p.valor)}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.linhaTitulo}>{p.cliente} · {p.servico}</Text>
                    <Text style={s.legenda}>{dataHora(p.data_hora)} · {p.barbeiro} · {ROTULO_METODO[p.metodo]}</Text>
                    <Text style={s.legenda}>{ROTULO_STATUS[p.status].toUpperCase()}</Text>
                    {!!p.duplicidade_de && <Text style={s.selo}>DUPLICIDADE</Text>}
                    {abertaNoProvedor && <Text style={s.selo}>CANCELAMENTO NO MERCADO PAGO NÃO CONFIRMADO</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.linhaValor}>{formatarReais(p.valor)}</Text>
                    {p.valor_reembolsado > 0 && <Text style={[s.legenda, { color: C.destructive }]}>- {formatarReais(p.valor_reembolsado)}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </Secao>

          <Secao s={s} titulo="REEMBOLSOS DO PERÍODO">
            {reembolsos.length === 0 ? (
              <Text style={s.vazio}>Nenhum reembolso no período.</Text>
            ) : reembolsos.map((r) => (
              <View key={r.id} style={s.linha}>
                <View style={{ flex: 1 }}>
                  <Text style={s.linhaTitulo}>{r.cliente} · {r.servico}</Text>
                  <Text style={s.legenda}>
                    {dataHora(r.reembolsado_em)} · {ROTULO_METODO[r.metodo]} · {ROTULO_ORIGEM_REEMBOLSO[r.origem]}{r.registrado_por ? ` · ${r.registrado_por}` : ''}
                  </Text>
                  {!!r.motivo && <Text style={[s.nota, { marginTop: 2 }]}>{r.motivo}</Text>}
                  {r.duplicidade && <Text style={s.selo}>DUPLICIDADE</Text>}
                </View>
                <Text style={[s.linhaValor, { color: C.destructive }]}>- {formatarReais(r.valor)}</Text>
              </View>
            ))}
          </Secao>
        </>
      )}

      <PagamentoModal
        s={s} C={C} aberto={aberto} onFechar={() => setAberto(null)}
        onAlterado={(mensagem) => { setAberto(null); setAviso(mensagem); carregar(); }}
      />
    </>
  );
}

// Detalhe de um pagamento: situacao, acoes (verificar, reembolsar, devolver
// duplicidade) e o historico de todas as operacoes do atendimento
function PagamentoModal({ s, C, aberto, onFechar, onAlterado }: {
  s: Estilos; C: Theme; aberto: { item: LinhaPagamento; reembolsar: boolean } | null;
  onFechar: () => void; onAlterado: (mensagem: string) => void;
}) {
  const item = aberto?.item ?? null;
  const [historico, setHistorico] = useState<EventoPagamento[] | null>(null);
  const [formulario, setFormulario] = useState(false);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const duplicada = !!item?.duplicidade_de;

  useEffect(() => {
    if (!aberto) return;
    const p = aberto.item;
    setFormulario(aberto.reembolsar);
    setValor(paraCampo(p.valor - p.valor_reembolsado));
    setMotivo(p.duplicidade_de ? 'Pagamento em duplicidade' : '');
    setConfirmado(false); setErro(null); setHistorico(null);
    buscarHistorico(p.id).then(setHistorico).catch(() => setHistorico([]));
  }, [aberto]);

  async function verificar() {
    if (!item) return;
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await sincronizarPagamento(item.id);
      onAlterado(`Pagamento ${ROTULO_STATUS[atualizado.status].toLowerCase()}.`);
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível consultar o Mercado Pago.');
    }
    setSalvando(false);
  }

  async function reembolsar() {
    if (!item) return;
    setSalvando(true);
    setErro(null);
    try {
      if (item.metodo === 'presencial') {
        await registrarReembolsoPresencial(item.id, numero(valor), motivo);
        onAlterado('Reembolso registrado.');
      } else {
        await reembolsarOnline(item.id, numero(valor), motivo.trim() || undefined);
        onAlterado(duplicada ? 'Duplicidade devolvida ao cliente pelo Mercado Pago.' : 'Reembolso realizado no Mercado Pago.');
      }
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível reembolsar.');
    }
    setSalvando(false);
  }

  return (
    <Folha s={s} visivel={!!item} onFechar={() => { if (!salvando) onFechar(); }}>
      {item && (
        <>
          <Text style={s.modalTitulo}>{formulario ? (duplicada ? 'DEVOLVER PAGAMENTO EM DUPLICIDADE' : 'REEMBOLSAR PAGAMENTO') : 'PAGAMENTO'}</Text>
          <Text style={s.linhaTitulo}>{item.cliente} · {item.servico}</Text>
          <Text style={s.legenda}>ATENDIMENTO {dataHora(item.data_hora)} · {item.barbeiro}</Text>
          <Text style={[s.legenda, { marginTop: 4 }]}>
            {ROTULO_METODO[item.metodo].toUpperCase()} · {ROTULO_STATUS[item.status].toUpperCase()} · {formatarReais(item.valor)}
            {item.valor_reembolsado > 0 ? ` · DEVOLVIDO ${formatarReais(item.valor_reembolsado)}` : ''}
            {item.taxa > 0 ? ` · TAXA ${formatarReais(item.taxa)}` : ''}
          </Text>
          {duplicada && <Text style={s.selo}>DUPLICIDADE: O ATENDIMENTO JÁ ESTAVA QUITADO POR OUTRO PAGAMENTO</Text>}

          {formulario ? (
            <>
              <Text style={[s.legenda, { marginTop: 14, marginBottom: 6 }]}>{duplicada ? 'VALOR A DEVOLVER (R$)' : 'VALOR A REEMBOLSAR (R$)'}</Text>
              <TextInput style={s.campo} value={valor} onChangeText={setValor} keyboardType="decimal-pad" accessibilityLabel="Valor" />
              <TextInput
                style={[s.campo, { marginTop: 8 }]} value={motivo} onChangeText={setMotivo}
                placeholder="Motivo (opcional)" placeholderTextColor={C.mutedFg} accessibilityLabel="Motivo"
              />
              {item.metodo !== 'presencial' && (
                <Text style={s.nota}>O reembolso é feito no Mercado Pago e devolvido ao cliente pelo mesmo meio de pagamento.</Text>
              )}
              {duplicada ? (
                <>
                  <Text style={s.nota}>Devolver não altera a comissão nem o faturamento do atendimento.</Text>
                  <Confirmacao
                    s={s} C={C} marcado={confirmado} onChange={setConfirmado}
                    texto="Confirmo que este pagamento é uma duplicidade e autorizo a devolução ao cliente."
                  />
                </>
              ) : (
                <Text style={[s.nota, { color: C.warning }]}>A comissão do barbeiro é ajustada proporcionalmente ao valor reembolsado.</Text>
              )}
              {!!erro && <Text style={[s.nota, { color: C.destructive }]} accessibilityRole="alert">{erro}</Text>}
              <Botoes
                s={s} C={C} salvando={salvando} desabilitado={duplicada && !confirmado}
                onCancelar={() => (aberto?.reembolsar ? onFechar() : setFormulario(false))} onConfirmar={reembolsar}
              />
            </>
          ) : (
            <>
              <View style={[s.opcoes, { marginBottom: 0 }]}>
                {item.status === 'pending' && item.metodo !== 'presencial' && (
                  <TouchableOpacity style={s.acao} onPress={verificar} disabled={salvando} accessibilityRole="button">
                    {salvando ? <ActivityIndicator color={C.primary} size="small" /> : <Text style={s.acaoText}>VERIFICAR NO MERCADO PAGO</Text>}
                  </TouchableOpacity>
                )}
                {reembolsavel(item) && !item.tem_duplicidade && (
                  <TouchableOpacity style={s.acao} onPress={() => setFormulario(true)} accessibilityRole="button">
                    <Text style={s.acaoText}>{duplicada ? 'DEVOLVER' : 'REEMBOLSAR'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {reembolsavel(item) && item.tem_duplicidade && (
                <Text style={[s.nota, { color: C.warning }]}>Este atendimento tem um pagamento em duplicidade. Devolva a duplicidade antes de reembolsar este.</Text>
              )}
              {!!erro && <Text style={[s.nota, { color: C.destructive }]} accessibilityRole="alert">{erro}</Text>}

              <Text style={[s.modalTitulo, { marginTop: 18 }]}>HISTÓRICO DO ATENDIMENTO</Text>
              {historico === null ? <ActivityIndicator color={C.primary} /> : historico.length === 0 ? (
                <Text style={s.nota}>Nenhuma operação registrada. O histórico começa a ser gravado a partir desta versão do financeiro.</Text>
              ) : historico.map((e) => (
                <View key={e.id} style={s.evento}>
                  <Text style={[s.linhaTitulo, { fontSize: 13 }]}>{descreverEvento(e)}</Text>
                  <Text style={s.legenda}>
                    {new Date(e.registrado_em).toLocaleString('pt-BR')} · {ROTULO_METODO[e.metodo]} · {ROTULO_ORIGEM[e.origem]}{e.ator ? ` (${e.ator})` : ''}
                  </Text>
                  {!!detalheDoEvento(e) && <Text style={[s.nota, { marginTop: 2 }]}>{detalheDoEvento(e)}</Text>}
                </View>
              ))}
              <TouchableOpacity style={[s.botao, s.botaoSecundario, { marginTop: 12 }]} onPress={onFechar} accessibilityRole="button">
                <Text style={[s.botaoText, { color: C.primary }]}>FECHAR</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </Folha>
  );
}
