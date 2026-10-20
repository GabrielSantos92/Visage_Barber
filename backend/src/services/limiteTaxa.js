// Limite de requisicoes em memoria (janela deslizante). Vale por processo:
// com mais de uma instancia do backend, cada uma conta separadamente.
function criarLimitador({ max, janelaMs, agora = Date.now }) {
  const registros = new Map();

  function recentes(chave) {
    const limite = agora() - janelaMs;
    const lista = (registros.get(chave) ?? []).filter((t) => t > limite);
    if (lista.length) registros.set(chave, lista);
    else registros.delete(chave);
    return lista;
  }

  function limpar() {
    for (const chave of [...registros.keys()]) recentes(chave);
  }

  return {
    excedido: (chave) => recentes(chave).length >= max,
    registrar(chave) {
      if (registros.size > 10000) limpar();
      registros.set(chave, [...recentes(chave), agora()]);
    },
    // Registra e diz se ainda estava dentro do limite
    consumir(chave) {
      if (recentes(chave).length >= max) return false;
      this.registrar(chave);
      return true;
    },
    zerar: (chave) => registros.delete(chave),
  };
}

module.exports = { criarLimitador };
