import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../../lib/theme';
import {
  ComissoesConfig, LinhaFechamento, METODOS_COMISSAO, PagamentoComissao, buscarComissoes, buscarFechamento,
  buscarPagamentosComissao, configurarComissao, dataCurta, dataIso, fimDaSemana, inicioDaSemana, percentual,
  registrarPagamentoComissao, semanaAnterior, semanaSeguinte,
} from '../../../lib/financeiro';
import { formatarReais } from '../../../lib/pagamentos';
import { Botoes, Estilos, Folha, Secao, numero, paraCampo } from './comum';

// "60", "55,5" -> numero; "" -> null (usa o padrao); invalido -> NaN
const lerPercentual = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const textoPercentual = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));

// Percentual padrao e de cada barbeiro, historico das alteracoes, fechamento
// semanal e pagamentos de comissao (iguais as telas Comissoes do site)
export default function ComissoesAba({ s, C, recarga, onCarregado }: {
  s: Estilos; C: Theme; recarga: number; onCarregado: () => void;
}) {
  const [config, setConfig] = useState<ComissoesConfig | null>(null);
  const [padrao, setPadrao] = useState('');
  const [proprios, setProprios] = useState<Record<string, string>>({});
  const [semana, setSemana] = useState(() => dataIso(inicioDaSemana(new Date())));
  const [fechamento, setFechamento] = useState<LinhaFechamento[]>([]);
  const [pagos, setPagos] = useState<PagamentoComissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [pagando, setPagando] = useState<LinhaFechamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [c, f, p] = await Promise.all([buscarComissoes(), buscarFechamento(semana), buscarPagamentosComissao()]);
      setConfig(c);
      setPadrao(textoPercentual(c.padrao));
      setProprios(Object.fromEntries(c.barbeiros.map((b) => [b.barbeiro_id, textoPercentual(b.proprio)])));
      setFechamento(f);
      setPagos(p);
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível carregar as comissões.');
    }
    setCarregando(false);
    onCarregado();
  }, [semana, onCarregado]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));
  // Puxar para atualizar: a tela principal muda "recarga" (a primeira carga ja veio do foco)
  const primeiraCarga = useRef(true);
  useEffect(() => {
    if (primeiraCarga.current) { primeiraCarga.current = false; return; }
    carregar();
  }, [recarga]);

  async function salvar(barbeiroId: string | null, texto: string) {
    const valor = lerPercentual(texto);
    setAviso(null);
    if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 100)) {
      setErro('O percentual deve estar entre 0 e 100.');
      return;
    }
    setSalvando(barbeiroId ?? 'padrao');
    setErro(null);
    try {
      await configurarComissao(barbeiroId, valor);
      setAviso(barbeiroId ? 'Comissão do barbeiro atualizada.' : 'Comissão padrão atualizada.');
      await carregar();
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível salvar.');
    }
    setSalvando(null);
  }

  if (carregando) return <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />;

  return (
    <>
      <Text style={[s.nota, { paddingHorizontal: 24, marginTop: 16 }]}>
        A comissão é calculada sobre o valor efetivamente pago por cada serviço concluído. Mudar um percentual vale só
        para os próximos serviços: os já calculados não mudam.
      </Text>
      {!!erro && <Text style={s.erro} accessibilityRole="alert">{erro}</Text>}
      {!!aviso && <Text style={s.sucesso} accessibilityRole="alert">{aviso}</Text>}

      {config && (
        <>
          <Secao s={s} titulo="PADRÃO DA BARBEARIA">
            <View style={[s.linha, { borderBottomWidth: 0 }]}>
              <TextInput
                style={s.campo} value={padrao} onChangeText={setPadrao} keyboardType="decimal-pad"
                placeholder="Não configurado" placeholderTextColor={C.mutedFg} accessibilityLabel="Percentual padrão"
              />
              <TouchableOpacity style={s.acao} onPress={() => salvar(null, padrao)} disabled={salvando === 'padrao'} accessibilityRole="button">
                <Text style={s.acaoText}>SALVAR</Text>
              </TouchableOpacity>
            </View>
            <Text style={[s.nota, { paddingHorizontal: 24, marginTop: 0 }]}>
              Vale para quem não tem percentual próprio. Sem padrão e sem percentual próprio, a comissão do serviço fica
              aguardando até o percentual ser configurado.
            </Text>
          </Secao>

          <Secao s={s} titulo="POR BARBEIRO">
            {config.barbeiros.map((b) => (
              <View key={b.barbeiro_id} style={[s.linha, { flexWrap: 'wrap' }]}>
                <View style={{ width: '100%' }}>
                  <Text style={s.linhaTitulo}>{b.nome}{!b.ativo ? '  ·  INATIVO' : ''}</Text>
                  <Text style={[s.legenda, b.vigente == null && { color: C.warning }]}>
                    {b.vigente == null ? 'NÃO CONFIGURADA' : `EM VIGOR ${percentual(b.vigente)}${b.proprio == null ? ' (PADRÃO)' : ''}`}
                  </Text>
                </View>
                <TextInput
                  style={s.campo} value={proprios[b.barbeiro_id] ?? ''} keyboardType="decimal-pad"
                  onChangeText={(t) => setProprios((p) => ({ ...p, [b.barbeiro_id]: t }))}
                  placeholder="Usa o padrão" placeholderTextColor={C.mutedFg} accessibilityLabel={`Percentual de ${b.nome}`}
                />
                <TouchableOpacity
                  style={s.acao} onPress={() => salvar(b.barbeiro_id, proprios[b.barbeiro_id] ?? '')}
                  disabled={salvando === b.barbeiro_id} accessibilityRole="button" accessibilityLabel={`Salvar percentual de ${b.nome}`}
                >
                  <Text style={s.acaoText}>SALVAR</Text>
                </TouchableOpacity>
                {b.proprio != null && (
                  <TouchableOpacity
                    style={s.acao} onPress={() => salvar(b.barbeiro_id, '')} disabled={salvando === b.barbeiro_id}
                    accessibilityRole="button" accessibilityLabel={`${b.nome} passa a usar o padrão`}
                  >
                    <Text style={s.acaoText}>USAR PADRÃO</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </Secao>
        </>
      )}

      <View style={s.semanaRow}>
        <Text style={[s.secao, { paddingHorizontal: 0, marginTop: 0, marginBottom: 0 }]}>FECHAMENTO SEMANAL</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity onPress={() => setSemana(semanaAnterior(semana))} hitSlop={8} accessibilityLabel="Semana anterior">
            <Feather name="chevron-left" size={16} color={C.primary} />
          </TouchableOpacity>
          <Text style={s.legenda}>{dataCurta(semana)} a {dataCurta(fimDaSemana(semana))}</Text>
          <TouchableOpacity onPress={() => setSemana(semanaSeguinte(semana))} hitSlop={8} accessibilityLabel="Próxima semana">
            <Feather name="chevron-right" size={16} color={C.primary} />
          </TouchableOpacity>
        </View>
      </View>
      {fechamento.length === 0 ? (
        <Text style={s.vazio}>Nenhum barbeiro com movimento nesta semana.</Text>
      ) : fechamento.map((f) => {
        const maximo = Math.min(Number(f.pendente), Number(f.saldo_geral));
        return (
          <View key={f.barbeiro_id} style={s.linha}>
            <View style={{ flex: 1 }}>
              <Text style={s.linhaTitulo}>{f.nome} · {percentual(f.percentual)}</Text>
              <Text style={s.legenda}>{f.servicos} serviço(s) · faturamento {formatarReais(f.faturamento)}</Text>
              <Text style={s.legenda}>comissão {formatarReais(f.comissao)} · pago {formatarReais(f.pago)}</Text>
              <Text style={[s.legenda, { color: C.primary, marginTop: 2 }]}>PENDENTE {formatarReais(f.pendente)}</Text>
            </View>
            {maximo > 0 && (
              <TouchableOpacity style={s.acao} onPress={() => setPagando(f)} accessibilityRole="button" accessibilityLabel={`Pagar comissão de ${f.nome}`}>
                <Text style={s.acaoText}>PAGAR</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      <Text style={[s.nota, { paddingHorizontal: 24 }]}>
        Semanas de segunda a domingo (horário de Brasília). Reembolsos e cancelamentos entram na semana em que acontecem.
      </Text>

      <Secao s={s} titulo="PAGAMENTOS DE COMISSÃO REGISTRADOS">
        {pagos.length === 0 ? (
          <Text style={s.vazio}>Nenhum pagamento de comissão registrado.</Text>
        ) : pagos.map((p) => (
          <View key={p.id} style={s.linha}>
            <View style={{ flex: 1 }}>
              <Text style={s.linhaTitulo}>{p.barbeiro} · semana de {dataCurta(p.semana_inicio, true)}</Text>
              <Text style={s.legenda}>
                {new Date(p.pago_em).toLocaleDateString('pt-BR')} · {METODOS_COMISSAO.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo}
                {p.comprovante ? ` · ${p.comprovante}` : ''} · por {p.registrado_por}
              </Text>
              {!!p.observacoes && <Text style={[s.nota, { marginTop: 2 }]}>{p.observacoes}</Text>}
            </View>
            <Text style={s.linhaValor}>{formatarReais(p.valor)}</Text>
          </View>
        ))}
      </Secao>

      {config && (
        <Secao s={s} titulo="HISTÓRICO DE ALTERAÇÕES">
          {config.historico.length === 0 ? (
            <Text style={s.vazio}>Nenhuma comissão configurada ainda.</Text>
          ) : config.historico.map((h) => (
            <View key={h.id} style={s.linha}>
              <View style={{ flex: 1 }}>
                <Text style={s.linhaTitulo}>{h.barbeiro}: {h.percentual == null ? 'percentual removido' : percentual(h.percentual)}</Text>
                <Text style={s.legenda}>{new Date(h.alterado_em).toLocaleString('pt-BR')} · {h.alterado_por}</Text>
              </View>
            </View>
          ))}
        </Secao>
      )}

      <PagarComissaoModal
        s={s} C={C} linha={pagando} semana={semana} onFechar={() => setPagando(null)}
        onConcluido={(mensagem) => { setPagando(null); setAviso(mensagem); carregar(); }}
      />
    </>
  );
}

// Registro do pagamento que o admin ja fez ao barbeiro (o app nao transfere dinheiro)
function PagarComissaoModal({ s, C, linha, semana, onFechar, onConcluido }: {
  s: Estilos; C: Theme; linha: LinhaFechamento | null; semana: string; onFechar: () => void; onConcluido: (mensagem: string) => void;
}) {
  const maximo = linha ? Math.min(Number(linha.pendente), Number(linha.saldo_geral)) : 0;
  const [valor, setValor] = useState('');
  const [metodo, setMetodo] = useState('pix');
  const [comprovante, setComprovante] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!linha) return;
    setValor(maximo > 0 ? paraCampo(maximo) : ''); setMetodo('pix'); setComprovante(''); setObservacoes(''); setErro(null);
  }, [linha, maximo]);

  async function confirmar() {
    if (!linha) return;
    const v = numero(valor);
    if (!Number.isFinite(v) || v <= 0) { setErro('Informe um valor maior que zero.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      const r = await registrarPagamentoComissao({ barbeiroId: linha.barbeiro_id, semanaInicio: semana, valor: v, metodo, comprovante, observacoes });
      onConcluido(Number(r.saldo_semana) > 0
        ? `Comissão paga. Ainda faltam ${formatarReais(r.saldo_semana)} desta semana.`
        : 'Comissão paga. Semana quitada.');
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível registrar.');
    }
    setSalvando(false);
  }

  return (
    <Folha s={s} visivel={!!linha} onFechar={() => { if (!salvando) onFechar(); }}>
      {linha && (
        <>
          <Text style={s.modalTitulo}>PAGAMENTO DE COMISSÃO</Text>
          <Text style={s.linhaTitulo}>{linha.nome} · semana de {dataCurta(semana)} a {dataCurta(fimDaSemana(semana), true)}</Text>
          <Text style={s.legenda}>PENDENTE {formatarReais(maximo)}</Text>
          <View style={s.opcoes} accessibilityRole="radiogroup" accessibilityLabel="Como foi pago">
            {METODOS_COMISSAO.map((o) => (
              <TouchableOpacity
                key={o.valor} style={[s.chip, metodo === o.valor && s.chipAtivo]} onPress={() => setMetodo(o.valor)}
                accessibilityRole="radio" accessibilityState={{ checked: metodo === o.valor }}
              >
                <Text style={[s.chipText, metodo === o.valor && { color: C.primaryFg }]}>{o.rotulo.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={s.campo} value={valor} onChangeText={setValor} keyboardType="decimal-pad" accessibilityLabel="Valor pago" />
          <TextInput style={[s.campo, { marginTop: 8 }]} value={comprovante} onChangeText={setComprovante} placeholder="Comprovante (opcional)" placeholderTextColor={C.mutedFg} accessibilityLabel="Comprovante" />
          <TextInput style={[s.campo, { marginTop: 8 }]} value={observacoes} onChangeText={setObservacoes} placeholder="Observações (opcional)" placeholderTextColor={C.mutedFg} accessibilityLabel="Observações" />
          <Text style={s.nota}>Registre o pagamento que você já fez. O app não transfere dinheiro. Um valor menor que o pendente deixa o restante em aberto.</Text>
          {!!erro && <Text style={[s.nota, { color: C.destructive }]} accessibilityRole="alert">{erro}</Text>}
          <Botoes s={s} C={C} onCancelar={onFechar} onConfirmar={confirmar} salvando={salvando} rotulo="REGISTRAR" />
        </>
      )}
    </Folha>
  );
}
