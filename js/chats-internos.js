import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { iniciarLayoutBase, aplicarPermissoesSidebar, obterDadosUsuario, atualizarCabecalhoUsuario } from "./layout-base.js";
import { inicial, criarItemConversa, criarMensagem } from "./conversas-ui.mjs";

const el = (id) => document.getElementById(id);
const call = (name, data) => httpsCallable(functions, name)(data);
const sessionId = crypto.randomUUID();
let usuario;
let chats = [];
let membros = [];
let selecionado = new URLSearchParams(location.search).get("chat") || "";
let pendente = null;
let atualizando = false;
let presencaFila = Promise.resolve();

function aviso(texto, erro = false) {
  const elemento = el("chat-aviso");
  elemento.textContent = texto;
  elemento.className = "mensagem " + (erro ? "erro" : "");
  elemento.style.display = texto ? "block" : "none";
}

function nomeChat(chat) {
  if (chat.grupo) return chat.nome;
  const outro = chat.membros.find((uid) => uid !== usuario.uid);
  return chat.nomes[outro] || outro || "Conversa";
}

function renderizarChats() {
  const lista = el("chats-lista");
  const termo = el("busca-chats").value.trim().toLocaleLowerCase("pt-BR");
  lista.replaceChildren();
  const visiveis = chats.filter((chat) => nomeChat(chat).toLocaleLowerCase("pt-BR").includes(termo));
  visiveis.sort((a, b) => b.ultimaAtividade - a.ultimaAtividade).forEach((chat) => {
    const { item } = criarItemConversa({
      nome: nomeChat(chat), resumo: chat.ultimaMensagem || "Sem mensagens",
      timestamp: chat.ultimaAtividade, ativo: chat.id === selecionado
    });
    item.addEventListener("click", () => selecionar(chat.id));
    lista.appendChild(item);
  });
  if (!visiveis.length) lista.textContent = termo ? "Nenhum chat encontrado." : "Nenhum chat iniciado.";
}

function atualizarPresenca() {
  const chatId = selecionado;
  const ativa = !!chatId && !document.hidden && document.hasFocus();
  presencaFila = presencaFila.then(async () => {
    if (!usuario) return;
    await call("presencaChatInterno", { sessionId, chatId, ativa });
  }).catch((erro) => {
    aviso("Não foi possível atualizar sua presença: " + erro.message, true);
  });
}

async function marcarNotificacoesChat(chatId) {
  const snapshot = await getDocs(collection(db, "notificacoes", usuario.uid, "itens"));
  const pendentes = snapshot.docs.filter((doc) => {
    const dados = doc.data();
    return dados.tipo === "interna" && dados.chatId === chatId && !dados.lida;
  });
  for (let i = 0; i < pendentes.length; i += 500) {
    const batch = writeBatch(db);
    pendentes.slice(i, i + 500).forEach((doc) => batch.update(doc.ref, { lida: true }));
    await batch.commit();
  }
}

async function selecionar(id) {
  selecionado = id;
  history.replaceState(null, "", "chats-internos.html?chat=" + encodeURIComponent(id));
  el("historico-chat").textContent = "Carregando mensagens...";
  renderizarChats();
  atualizarPresenca();
  try { await marcarNotificacoesChat(id); }
  catch (erro) { aviso("Não foi possível marcar as notificações como lidas: " + erro.message, true); }
  await atualizar();
}

async function atualizar() {
  if (atualizando || !usuario) return;
  atualizando = true;
  try {
    const resultado = await call("listarChatsInternos", {});
    chats = resultado.data.chats || [];
    renderizarChats();
    const chat = chats.find((item) => item.id === selecionado);
    el("chat-ativo").hidden = !chat;
    el("chat-vazio").hidden = !!chat;
    if (!chat) {
      if (selecionado) el("chat-vazio").textContent = "Chat não encontrado ou acesso negado.";
      return;
    }
    el("chat-nome").textContent = nomeChat(chat);
    el("chat-avatar").textContent = inicial(nomeChat(chat));
    el("chat-contexto").textContent = chat.grupo ? "Grupo · " + chat.membros.length + " participantes" : "Conversa com a equipe";
    const id = chat.id;
    const historico = await call("obterMensagensChatInterno", { chatId: id });
    if (selecionado !== id) return;
    const lista = el("historico-chat");
    const noFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
    lista.replaceChildren();
    const mensagens = historico.data.mensagens || [];
    if (!mensagens.length) lista.textContent = "Ainda não há mensagens.";
    mensagens.forEach((mensagem) => {
      lista.appendChild(criarMensagem({
        saida: mensagem.uid === usuario.uid,
        autor: mensagem.nome || "Membro",
        texto: mensagem.texto,
        horario: mensagem.criadoEm ? new Date(mensagem.criadoEm).toLocaleString("pt-BR") : ""
      }));
    });
    if (noFim) lista.scrollTop = lista.scrollHeight;
  } catch (erro) {
    aviso("Não foi possível atualizar os chats: " + erro.message, true);
  } finally { atualizando = false; }
}

async function criarChat(membros, nome) {
  const resultado = await call("criarChatInterno", { membros, nome });
  await selecionar(resultado.data.chatId);
}

function renderizarListaMembros() {
  const lista = el("membros-lista");
  const termo = el("busca-chats").value.trim().toLocaleLowerCase("pt-BR");
  lista.replaceChildren();
  membros.filter((membro) => membro.uid !== usuario.uid &&
    String(membro.nome || "").toLocaleLowerCase("pt-BR").includes(termo)).forEach((membro) => {
    const { item: botao } = criarItemConversa({
      nome: membro.nome || "Funcionário", resumo: "Iniciar conversa"
    });
    botao.addEventListener("click", async () => {
      botao.disabled = true;
      try { await criarChat([membro.uid], ""); }
      catch (erro) { aviso("Não foi possível abrir o chat: " + erro.message, true); }
      finally { botao.disabled = false; }
    });
    lista.appendChild(botao);
  });
  if (!lista.children.length) lista.textContent = termo ? "Nenhum funcionário encontrado." : "Nenhum outro funcionário disponível.";
}

function renderizarMembros(consultados) {
  membros = consultados;
  const grupo = el("membros-grupo");
  grupo.replaceChildren();
  membros.filter((membro) => membro.uid !== usuario.uid).forEach((membro) => {
    const label = document.createElement("label");
    const caixa = document.createElement("input");
    caixa.type = "checkbox";
    caixa.value = membro.uid;
    label.append(caixa, document.createTextNode(" " + membro.nome));
    grupo.appendChild(label);
  });
  renderizarListaMembros();
}

onAuthStateChanged(auth, async (atual) => {
  if (!atual) { location.href = "index.html"; return; }
  usuario = atual;
  el("conteudo-protegido").classList.remove("oculto");
  iniciarLayoutBase();
  try {
    const dados = await obterDadosUsuario(atual, db);
    aplicarPermissoesSidebar(dados.cargo, dados.ehAdmin);
    atualizarCabecalhoUsuario(dados);
    const solicitacoes = await getDocs(collection(db, "solicitacoes"));
    el("contagem-usuarios").textContent = solicitacoes.docs.filter((doc) => doc.data().status === "aprovada").length;
    el("contagem-pendentes").textContent = solicitacoes.docs.filter((doc) => doc.data().status === "pendente").length;
    const resultado = await call("listarMembrosChat", {});
    renderizarMembros(resultado.data.membros || []);
    await atualizar();
    if (selecionado && chats.some((chat) => chat.id === selecionado)) {
      atualizarPresenca();
      await marcarNotificacoesChat(selecionado);
    }
    setInterval(atualizar, 5000);
    setInterval(atualizarPresenca, 25000);
  } catch (erro) { aviso("Não foi possível iniciar os chats internos: " + erro.message, true); }
});

el("busca-chats").addEventListener("input", () => {
  renderizarChats();
  renderizarListaMembros();
});
el("form-grupo").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const membros = Array.from(el("membros-grupo").querySelectorAll('input:checked'), (item) => item.value);
  if (membros.length < 2) { aviso("Selecione ao menos dois funcionários para criar um grupo.", true); return; }
  const botao = evento.currentTarget.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    await criarChat(membros, el("nome-grupo").value.trim());
    evento.currentTarget.reset();
    aviso("");
  } catch (erro) { aviso("Não foi possível criar o grupo: " + erro.message, true); }
  finally { botao.disabled = false; }
});

el("form-chat").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const texto = el("texto-chat").value.trim();
  if (!texto || !selecionado) return;
  if (!pendente || pendente.texto !== texto || pendente.chatId !== selecionado) {
    pendente = { chatId: selecionado, texto, messageId: crypto.randomUUID() };
  }
  const mensagem = pendente;
  const botao = evento.currentTarget.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    await call("enviarMensagemChatInterno", mensagem);
    if (pendente === mensagem) pendente = null;
    if (selecionado === mensagem.chatId && el("texto-chat").value.trim() === mensagem.texto) {
      el("texto-chat").value = "";
    }
    aviso("");
    await atualizar();
  } catch (erro) { aviso("Não foi possível enviar a mensagem: " + erro.message, true); }
  finally { botao.disabled = false; }
});

el("sair").addEventListener("click", async () => {
  try { await call("presencaChatInterno", { sessionId, chatId: selecionado, ativa: false }); }
  catch (erro) { console.warn("Não foi possível encerrar a presença do chat:", erro.message); }
  await signOut(auth);
  location.href = "index.html";
});
document.addEventListener("visibilitychange", atualizarPresenca);
window.addEventListener("focus", atualizarPresenca);
window.addEventListener("blur", atualizarPresenca);
