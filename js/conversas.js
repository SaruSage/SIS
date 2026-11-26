import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, getDocs, onSnapshot, query, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { iniciarLayoutBase, aplicarPermissoesSidebar, obterDadosUsuario, atualizarCabecalhoUsuario } from "./layout-base.js";
import { inicial, criarItemConversa, criarMensagem } from "./conversas-ui.mjs";

const el = (id) => document.getElementById(id);
const call = (name, data) => httpsCallable(functions, name)(data);
const dia = 24 * 60 * 60 * 1000;
let usuario;
let nomeUsuario = "";
let cards = [];
let leituras = new Map();
let selecionado = new URLSearchParams(location.search).get("card") || "";
let numeros = [];
let administrador = false;
let colunasRelevantes = new Set();
let leituraEmAndamento = "";
let ultimaLeitura = "";
let versaoHistorico = 0;
let assinaturaAcesso = "";
let cancelarCards = [];
let atualizandoAcesso = false;
let ultimoAcessoRegistrado = "";
const contagens = new Map();
const contagensPendentes = new Map();
const filaContagens = [];
let contagensEmExecucao = 0;

function millis(valor) {
  return valor && typeof valor.toMillis === "function" ? valor.toMillis() : 0;
}

function contarNaoLidas(cardId) {
  return new Promise((resolve, reject) => {
    filaContagens.push({ cardId, resolve, reject });
    processarFilaContagens();
  });
}

function processarFilaContagens() {
  while (contagensEmExecucao < 6 && filaContagens.length) {
    const tarefa = filaContagens.shift();
    contagensEmExecucao++;
    call("contarNaoLidasWhatsApp", { cardId: tarefa.cardId })
      .then(tarefa.resolve, tarefa.reject)
      .finally(() => {
        contagensEmExecucao--;
        processarFilaContagens();
      });
  }
}

function aviso(texto, erro = false) {
  el("conversas-aviso").textContent = texto;
  el("conversas-aviso").className = "mensagem " + (erro ? "erro" : "");
  el("conversas-aviso").style.display = texto ? "block" : "none";
}

async function registrarHistorico(cardId, tipo, detalhes) {
  await addDoc(collection(db, "cards", cardId, "historico"), {
    tipo,
    autor: { uid: usuario.uid, email: usuario.email || "", nome: nomeUsuario },
    automatico: false,
    diretrizDe: null,
    detalhes,
    timestamp: serverTimestamp()
  });
}

function renderizarLista() {
  const lista = el("lista-conversas");
  const termo = el("busca-conversas").value.trim().toLocaleLowerCase("pt-BR");
  const visiveis = cards.filter((card) =>
    [card.nomeConta, card.telefone].some((valor) => String(valor || "").toLocaleLowerCase("pt-BR").includes(termo))
  ).sort((a, b) => millis(b.ultimaAtividade) - millis(a.ultimaAtividade));
  lista.replaceChildren();
  if (!visiveis.length) {
    lista.textContent = "Nenhuma conversa encontrada.";
    return;
  }
  visiveis.forEach((card) => {
    const entrada = millis(card.lastInboundAt);
    const minhaLeitura = millis(leituras.get(card.id));
    const fila = entrada > millis(card.whatsappLidaAte);
    const paraMim = entrada > minhaLeitura &&
      ((card.atendimentoWhatsapp && card.atendimentoWhatsapp.uid === usuario.uid) || colunasRelevantes.has(card.colunaId));
    const previaAntiga = !millis(card.ultimaMensagemWhatsappEm) &&
      millis(card.whatsappLastOutboundAt) > entrada;
    const { item, lateral } = criarItemConversa({
      nome: card.nomeConta || card.telefone || "Contato",
      resumo: previaAntiga ? "Última mensagem indisponível" : (card.ultimaMensagemWhatsapp || "Sem mensagens"),
      timestamp: millis(card.ultimaMensagemWhatsappEm) || Math.max(entrada, millis(card.whatsappLastOutboundAt)),
      ativo: card.id === selecionado,
      estado: paraMim ? "para-voce" : (fila ? "na-fila" : "")
    });
    if (paraMim) {
      const chave = card.id + ":" + entrada + ":" + minhaLeitura;
      const cached = contagens.get(card.id);
      if (cached && cached.chave === chave) {
        exibirContagem(lateral, cached.quantidade);
      } else {
        if (!contagensPendentes.has(chave)) {
          const requisicao = contarNaoLidas(card.id)
            .then((resultado) => {
              const quantidade = resultado.data.quantidade;
              if (!Number.isSafeInteger(quantidade) || quantidade < 0) throw new Error("Contagem inválida.");
              contagens.set(card.id, { chave, quantidade });
              return quantidade;
            })
            .finally(() => contagensPendentes.delete(chave));
          contagensPendentes.set(chave, requisicao);
        }
        contagensPendentes.get(chave).then((quantidade) => {
          if (item.isConnected) exibirContagem(lateral, quantidade);
        }).catch((erro) => {
          if (item.isConnected) aviso("Não foi possível contar as mensagens não lidas: " + erro.message, true);
        });
      }
    }
    item.addEventListener("click", () => selecionar(card.id));
    lista.appendChild(item);
  });
}

function exibirContagem(lateral, quantidade) {
  if (!quantidade) return;
  const badge = document.createElement("span");
  badge.className = "conversa-contagem";
  badge.textContent = quantidade > 99 ? "99+" : String(quantidade);
  badge.setAttribute("aria-label", quantidade + (quantidade === 1 ? " mensagem não lida para você" : " mensagens não lidas para você"));
  lateral.appendChild(badge);
}

async function marcarLida(card) {
  const entrada = millis(card.lastInboundAt);
  if (document.hidden || !entrada) return;
  const chave = card.id + ":" + entrada;
  if (ultimaLeitura === chave || leituraEmAndamento === chave) return;
  leituraEmAndamento = chave;
  try {
    await call("marcarConversaWhatsAppLida", { cardId: card.id, ultimaEntradaMillis: entrada });
    ultimaLeitura = chave;
  } catch (erro) {
    aviso("Não foi possível marcar a conversa como lida: " + erro.message, true);
  } finally {
    if (leituraEmAndamento === chave) leituraEmAndamento = "";
  }
}

function atualizarPainel() {
  const card = cards.find((item) => item.id === selecionado);
  el("conversa-vazia").hidden = !!card;
  el("conversa-ativa").hidden = !card;
  if (!card) {
    ultimoAcessoRegistrado = "";
    if (selecionado) el("conversa-vazia").textContent = "Conversa não encontrada ou indisponível.";
    return;
  }
  if (ultimoAcessoRegistrado !== card.id) {
    ultimoAcessoRegistrado = card.id;
    registrarHistorico(card.id, "acesso", {}).catch((erro) =>
      aviso("Não foi possível registrar o acesso no histórico do card: " + erro.message, true));
  }
  el("contato-nome").textContent = card.nomeConta || card.telefone || "Contato";
  el("contato-avatar").textContent = inicial(card.nomeConta || card.telefone);
  el("contato-telefone").textContent = card.telefone || "Contato sem telefone cadastrado.";
  const atendimento = card.atendimentoWhatsapp;
  el("atendimento-status").textContent = atendimento
    ? "Em atendimento por " + atendimento.nome
    : "Sem atendente";
  el("atendimento-status").title = atendimento ? "Automação pausada" : "Automação conforme configuração";
  el("atendimento-status").classList.toggle("status-ativo", !!atendimento);
  const botao = el("atendimento-acao");
  botao.disabled = !!atendimento && atendimento.uid !== usuario.uid && !administrador;
  botao.textContent = atendimento && (atendimento.uid === usuario.uid || administrador) ? "Liberar" : "Assumir";
  const aberta = millis(card.lastInboundAt) && Date.now() - millis(card.lastInboundAt) <= dia;
  el("janela-status").textContent = aberta
    ? "Janela de 24h ativa"
    : "Janela encerrada · use modelo";
  el("janela-status").classList.toggle("status-aviso", !aberta);
  if (!aberta && el("tipo").value === "text") {
    el("tipo").value = "template";
    atualizarTipo();
  }
  if (numeros.some((numero) => numero.phoneNumberId === card.whatsappPhoneNumberId)) {
    el("numero").value = card.whatsappPhoneNumberId;
  }
}

async function carregarHistorico() {
  const card = cards.find((item) => item.id === selecionado);
  if (!card) return;
  const cardId = selecionado;
  const versao = ++versaoHistorico;
  try {
    const resultado = await call("getWhatsAppMessages", { cardId });
    if (cardId !== selecionado || versao !== versaoHistorico) return;
    const lista = el("historico");
    const estavaNoFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
    lista.replaceChildren();
    const mensagens = resultado.data.messages || [];
    if (!mensagens.length) lista.textContent = "Ainda não há mensagens.";
    mensagens.forEach((mensagem) => {
      const saida = mensagem.direction === "outgoing";
      lista.appendChild(criarMensagem({
        saida,
        autor: saida ? (mensagem.atendente && (mensagem.atendente.nome || mensagem.atendente.uid)) || "Equipe" : "Cliente",
        texto: mensagem.text || "[Mensagem sem texto]",
        horario: (mensagem.timestamp ? new Date(mensagem.timestamp).toLocaleString("pt-BR") : "") +
          (mensagem.status ? " · " + mensagem.status : "")
      }));
    });
    if (estavaNoFim) lista.scrollTop = lista.scrollHeight;
    marcarLida(card);
  } catch (erro) {
    if (cardId === selecionado) aviso("Não foi possível carregar o histórico: " + erro.message, true);
  }
}

function selecionar(id) {
  selecionado = id;
  ultimaLeitura = "";
  versaoHistorico++;
  history.replaceState(null, "", "conversas.html?card=" + encodeURIComponent(id));
  el("historico").textContent = "Carregando mensagens...";
  renderizarLista();
  atualizarPainel();
  carregarHistorico();
}

function atualizarTipo() {
  const modelo = el("tipo").value === "template";
  el("campo-texto").hidden = modelo;
  el("campos-template").hidden = !modelo;
  if (modelo) el("config-envio").open = true;
}

async function atualizarAcesso() {
  if (atualizandoAcesso) return;
  atualizandoAcesso = true;
  try {
    const [acesso, conexoes] = await Promise.all([
      call("listarAcessoConversas", {}),
      call("getWhatsAppConnections", {})
    ]);
    numeros = (conexoes.data.numbers || []).filter((numero) => numero.active);
    const numeroAnterior = el("numero").value;
    el("numero").replaceChildren(new Option("Selecione um número", ""));
    numeros.forEach((numero) => el("numero").add(new Option(numero.displayName || numero.displayPhoneNumber || numero.phoneNumberId, numero.phoneNumberId)));
    if (numeros.some((numero) => numero.phoneNumberId === numeroAnterior)) el("numero").value = numeroAnterior;
    else if (numeros.length === 1) el("numero").value = numeros[0].phoneNumberId;
    if (!el("numero").value) el("config-envio").open = true;

    const colunas = (acesso.data.colunas || []).slice().sort();
    colunasRelevantes = new Set(colunas);
    const assinatura = JSON.stringify([acesso.data.completo, colunas]);
    if (assinatura === assinaturaAcesso) return;
    assinaturaAcesso = assinatura;
    cancelarCards.forEach((cancelar) => cancelar());
    cancelarCards = [];
    cards = [];
    const partes = new Map();
    const consultas = acesso.data.completo ? [collection(db, "cards")] : [];
    if (!acesso.data.completo) {
      for (let i = 0; i < colunas.length; i += 30) {
        consultas.push(query(collection(db, "cards"), where("colunaId", "in", colunas.slice(i, i + 30))));
      }
    }
    renderizarLista();
    atualizarPainel();
    consultas.forEach((consulta, indice) => {
      cancelarCards.push(onSnapshot(consulta, (snapshot) => {
        partes.set(indice, snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((card) => !card.excluido));
        cards = Array.from(partes.values()).flat();
        renderizarLista();
        atualizarPainel();
        carregarHistorico();
      }, (erro) => aviso("Não foi possível carregar as conversas: " + erro.message, true)));
    });
  } catch (erro) {
    cancelarCards.forEach((cancelar) => cancelar());
    cancelarCards = [];
    assinaturaAcesso = "";
    cards = [];
    renderizarLista();
    atualizarPainel();
    aviso("Não foi possível atualizar o acesso às conversas: " + erro.message, true);
  } finally { atualizandoAcesso = false; }
}

onAuthStateChanged(auth, async (atual) => {
  if (!atual) { location.href = "index.html"; return; }
  usuario = atual;
  el("conteudo-protegido").classList.remove("oculto");
  iniciarLayoutBase();
  try {
    const dados = await obterDadosUsuario(atual, db);
    nomeUsuario = dados.nomeCompleto;
    administrador = dados.ehAdmin;
    const solicitacoes = await getDocs(collection(db, "solicitacoes"));
    el("contagem-usuarios").textContent = solicitacoes.docs.filter((doc) => doc.data().status === "aprovada").length;
    el("contagem-pendentes").textContent = solicitacoes.docs.filter((doc) => doc.data().status === "pendente").length;
    const autorizado = (atual.email || "").toLowerCase() === "eamgfn4ever@gmail.com" ||
      solicitacoes.docs.some((doc) => {
        const item = doc.data();
        return (item.email || "").toLowerCase() === (atual.email || "").toLowerCase() &&
          item.status === "aprovada";
      });
    aplicarPermissoesSidebar(dados.cargo, dados.ehAdmin);
    atualizarCabecalhoUsuario(dados);
    if (!autorizado) {
      aviso("Esta área é restrita a funcionários aprovados.", true);
      el("conversa-ativa").hidden = true;
      el("conversa-vazia").hidden = true;
      el("lista-conversas").textContent = "Acesso negado.";
      return;
    }
    onSnapshot(collection(db, "colunas"), (snapshot) => {
      const lista = el("colunas-solicitacao");
      lista.replaceChildren();
      snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).forEach((coluna) => {
          const label = document.createElement("label");
          const caixa = document.createElement("input");
          caixa.type = "checkbox";
          caixa.value = coluna.id;
          label.append(caixa, document.createTextNode(" " + (coluna.nome || coluna.id)));
          lista.appendChild(label);
        });
      if (!snapshot.docs.length) lista.textContent = "Nenhuma coluna cadastrada.";
    }, (erro) => aviso("Não foi possível carregar as colunas: " + erro.message, true));
    onSnapshot(collection(db, "leiturasConversas", usuario.uid, "cards"), (snapshot) => {
      leituras = new Map(snapshot.docs.map((doc) => [doc.id, doc.data().ultimaEntrada]));
      renderizarLista();
    }, (erro) => aviso("Não foi possível carregar suas leituras: " + erro.message, true));
    await atualizarAcesso();
    setInterval(atualizarAcesso, 15000);
  } catch (erro) {
    aviso("Não foi possível iniciar as conversas: " + erro.message, true);
  }
});

el("busca-conversas").addEventListener("input", renderizarLista);
el("solicitacao-colunas").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const columnIds = Array.from(el("colunas-solicitacao").querySelectorAll('input:checked'), (item) => item.value);
  if (!columnIds.length) { aviso("Selecione ao menos uma coluna.", true); return; }
  const botao = evento.currentTarget.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    await call("solicitarNotificacoesColunas", { columnIds });
    aviso("Solicitação enviada ao administrador.");
    evento.currentTarget.reset();
  } catch (erro) {
    aviso("Não foi possível enviar a solicitação: " + erro.message, true);
  } finally { botao.disabled = false; }
});
el("tipo").addEventListener("change", atualizarTipo);
document.addEventListener("visibilitychange", () => { if (!document.hidden) carregarHistorico(); });
el("sair").addEventListener("click", async () => { await signOut(auth); location.href = "index.html"; });
el("atendimento-acao").addEventListener("click", async () => {
  const card = cards.find((item) => item.id === selecionado);
  if (!card) return;
  const botao = el("atendimento-acao");
  botao.disabled = true;
  try {
    await call("definirAtendimentoWhatsApp", { cardId: card.id, acao: card.atendimentoWhatsapp ? "liberar" : "assumir" });
    aviso("");
  } catch (erro) {
    aviso("Não foi possível alterar o atendimento: " + erro.message, true);
    botao.disabled = false;
  }
});
el("form-conversa").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const cardId = selecionado;
  const textoEnviado = el("texto").value;
  const tipoEnviado = el("tipo").value;
  const botao = evento.currentTarget.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    await call("sendWhatsAppMessage", {
      cardId,
      phoneNumberId: el("numero").value,
      mode: tipoEnviado,
      text: textoEnviado.trim(),
      templateName: el("template").value.trim(),
      templateLanguage: el("idioma").value.trim(),
      templateVariables: el("variaveis").value
    });
    if (selecionado === cardId && el("texto").value === textoEnviado) el("texto").value = "";
    aviso("Mensagem aceita pela Meta.");
    try {
      await registrarHistorico(cardId, "mensagemWhatsapp", { tipo: tipoEnviado });
    } catch (erro) {
      aviso("Mensagem aceita pela Meta, mas não foi possível registrar o envio no histórico do card: " + erro.message, true);
    }
    await carregarHistorico();
  } catch (erro) {
    aviso("Não foi possível enviar: " + erro.message, true);
  } finally {
    botao.disabled = false;
  }
});
