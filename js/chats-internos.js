import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { iniciarLayoutBase, aplicarPermissoesSidebar, obterDadosUsuario, atualizarCabecalhoUsuario } from "./layout-base.js";
import { inicial, criarItemConversa, criarMensagem, classificarArquivo, deveRolarAoFim, ehAtalhoEnviar } from "./conversas-ui.mjs";
import { descreverErroServico } from "./erros-servico.mjs";

const el = (id) => document.getElementById(id);
const call = (name, data) => httpsCallable(functions, name)(data);
const storage = getStorage();
const sessionId = crypto.randomUUID();
let usuario;
let chats = [];
let membros = [];
let selecionado = new URLSearchParams(location.search).get("chat") || "";
let forcarScrollFim = !!selecionado;
let pendente = null;
let atualizando = false;
let atualizandoMembros = false;
let membrosCarregados = false;
let chatsCarregados = false;
let acompanhandoFimHistorico = true;
let assinaturaMembros = "";
let sincronizarChatInicial = !!selecionado;
let presencaFila = Promise.resolve();
let arquivoSelecionado = null;
const urlsMidia = new Map();

function aviso(texto, erro = false) {
  const elemento = el("chat-aviso");
  elemento.textContent = texto;
  elemento.className = "mensagem " + (erro ? "erro" : "");
  elemento.style.display = texto ? "block" : "none";
}

function desenharArquivoSelecionado() {
  const status = el("chat-arquivo-selecionado");
  status.replaceChildren();
  status.hidden = !arquivoSelecionado;
  if (!arquivoSelecionado) return;
  const nome = document.createElement("span");
  nome.textContent = arquivoSelecionado.name;
  const remover = document.createElement("button");
  remover.type = "button";
  remover.className = "arquivo-remover";
  remover.textContent = "Remover";
  remover.addEventListener("click", limparArquivoSelecionado);
  status.append(nome, remover);
}

function limparArquivoSelecionado() {
  arquivoSelecionado = null;
  el("chat-arquivo-input").value = "";
  desenharArquivoSelecionado();
}

function selecionarArquivo(file) {
  if (!file) return;
  const classificacao = classificarArquivo(file);
  if (!file.size || file.size > classificacao.maxBytes) {
    window.alert("Este arquivo excede o limite para " + classificacao.tipo + ".");
    el("chat-arquivo-input").value = "";
    return;
  }
  arquivoSelecionado = file;
  desenharArquivoSelecionado();
}

async function carregarMidiaAutenticada(url) {
  if (urlsMidia.has(url)) return urlsMidia.get(url);
  const atual = auth.currentUser;
  if (!atual) throw new Error("Sua sessão expirou. Entre novamente para abrir a mídia.");
  const token = await atual.getIdToken();
  const resposta = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store"
  });
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error("Você não tem acesso a esta mídia ou sua sessão expirou.");
    }
    throw new Error("Não foi possível carregar a mídia (" + resposta.status + ").");
  }
  const objeto = URL.createObjectURL(await resposta.blob());
  urlsMidia.set(url, objeto);
  return objeto;
}

function revogarUrlsMidia() {
  urlsMidia.forEach((url) => URL.revokeObjectURL(url));
  urlsMidia.clear();
}

function nomeChat(chat) {
  if (chat.grupo) return chat.nome || "Grupo";
  const outro = chat.membros.find((uid) => uid !== usuario.uid);
  return (chat.nomes && chat.nomes[outro]) || outro || "Conversa";
}

function renderizarChats() {
  if (!chatsCarregados) return;
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
  revogarUrlsMidia();
  selecionado = id;
  forcarScrollFim = true;
  sincronizarChatInicial = false;
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
  let listouChats = false;
  try {
    const resultado = await call("listarChatsInternos", {});
    if (!resultado.data || !Array.isArray(resultado.data.chats) ||
        resultado.data.chats.some((chat) => !chat || !Array.isArray(chat.membros))) {
      throw new Error("Resposta inválida ao carregar os chats internos.");
    }
    chats = resultado.data.chats;
    listouChats = true;
    chatsCarregados = true;
    el("chats-erro").hidden = true;
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
    if (sincronizarChatInicial) {
      sincronizarChatInicial = false;
      atualizarPresenca();
      try { await marcarNotificacoesChat(chat.id); }
      catch (erro) { aviso("Não foi possível marcar as notificações como lidas: " + erro.message, true); }
    }
    const id = chat.id;
    const historico = await call("obterMensagensChatInterno", { chatId: id });
    if (selecionado !== id) return;
    const lista = el("historico-chat");
    const noFim = deveRolarAoFim({
      scrollHeight: lista.scrollHeight,
      scrollTop: lista.scrollTop,
      clientHeight: lista.clientHeight,
      forcar: forcarScrollFim
    });
    forcarScrollFim = false;
    acompanhandoFimHistorico = noFim;
    lista.replaceChildren();
    const mensagens = historico.data.mensagens || [];
    if (!mensagens.length) lista.textContent = "Ainda não há mensagens.";
    mensagens.forEach((mensagem) => {
      lista.appendChild(criarMensagem({
        saida: mensagem.uid === usuario.uid,
        autor: mensagem.nome || "Membro",
        texto: mensagem.texto || "",
        tipo: mensagem.tipo || "text",
        mediaUrl: mensagem.mediaUrl || "",
        mediaError: mensagem.mediaError || "",
        fileName: mensagem.fileName || "",
        caption: mensagem.caption || "",
        carregarMidia: carregarMidiaAutenticada,
        raizHistorico: lista,
        aoCarregarMidia: () => {
          if (selecionado === id && acompanhandoFimHistorico) lista.scrollTop = lista.scrollHeight;
        },
        horario: mensagem.criadoEm ? new Date(mensagem.criadoEm).toLocaleString("pt-BR") : ""
      }));
    });
    if (noFim) {
      lista.scrollTop = lista.scrollHeight;
      acompanhandoFimHistorico = true;
    }
  } catch (erro) {
    console.error("Falha ao atualizar chats internos:", erro);
    if (!listouChats) {
      if (["functions/permission-denied", "functions/unauthenticated"].includes(erro.code)) {
        chats = [];
        chatsCarregados = false;
        el("chat-ativo").hidden = true;
        el("chat-vazio").hidden = false;
      }
      el("chats-erro").textContent = descreverErroServico(erro, "listarChatsInternos");
      el("chats-erro").hidden = false;
      if (!chatsCarregados) el("chats-lista").textContent = "Não foi possível carregar os chats.";
    } else {
      aviso("Não foi possível carregar as mensagens: " + descreverErroServico(erro, "obterMensagensChatInterno"), true);
    }
  } finally { atualizando = false; }
}

async function criarChat(membros, nome) {
  const resultado = await call("criarChatInterno", { membros, nome });
  await selecionar(resultado.data.chatId);
}

function renderizarListaMembros() {
  if (!membrosCarregados) return;
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
  const assinatura = JSON.stringify(consultados.map((membro) => [membro.uid, membro.nome]));
  if (membrosCarregados && assinatura === assinaturaMembros) return;
  membros = consultados;
  membrosCarregados = true;
  assinaturaMembros = assinatura;
  const grupo = el("membros-grupo");
  const selecionados = new Set(Array.from(grupo.querySelectorAll('input:checked'), (item) => item.value));
  grupo.replaceChildren();
  membros.filter((membro) => membro.uid !== usuario.uid).forEach((membro) => {
    const label = document.createElement("label");
    const caixa = document.createElement("input");
    caixa.type = "checkbox";
    caixa.value = membro.uid;
    caixa.checked = selecionados.has(membro.uid);
    label.append(caixa, document.createTextNode(" " + membro.nome));
    grupo.appendChild(label);
  });
  renderizarListaMembros();
}

async function carregarMembros() {
  if (atualizandoMembros) return;
  atualizandoMembros = true;
  try {
    const resultado = await call("listarMembrosChat", {});
    if (!resultado.data || !Array.isArray(resultado.data.membros) ||
        resultado.data.membros.some((membro) => !membro || typeof membro.uid !== "string" || !membro.uid)) {
      throw new Error("Resposta inválida ao carregar os funcionários.");
    }
    renderizarMembros(resultado.data.membros);
    const ausentes = resultado.data.cadastrosSemConta || 0;
    el("membros-erro").textContent = ausentes
      ? `${ausentes} cadastro(s) aprovado(s) não possuem conta válida. Peça ao administrador para verificar.`
      : "";
    el("membros-erro").hidden = !ausentes;
  } catch (erro) {
    console.error("Falha ao carregar funcionários do chat:", erro);
    if (["functions/permission-denied", "functions/unauthenticated"].includes(erro.code)) {
      membros = [];
      membrosCarregados = false;
      assinaturaMembros = "";
    }
    el("membros-erro").textContent = descreverErroServico(erro, "listarMembrosChat");
    el("membros-erro").hidden = false;
    if (!membrosCarregados) {
      el("membros-lista").textContent = "Não foi possível carregar os funcionários.";
      el("membros-grupo").textContent = "Não foi possível carregar os participantes.";
    }
  } finally { atualizandoMembros = false; }
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
    await Promise.all([carregarMembros(), atualizar()]);
    setInterval(atualizar, 5000);
    setInterval(carregarMembros, 30000);
    setInterval(atualizarPresenca, 25000);
  } catch (erro) {
    console.error("Falha ao iniciar chats internos:", erro);
    el("chats-lista").textContent = "Não foi possível iniciar os chats.";
    el("membros-lista").textContent = "Não foi possível carregar os funcionários.";
    aviso("Não foi possível iniciar os chats internos: " + descreverErroServico(erro, "chats internos"), true);
  }
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
  const arquivo = arquivoSelecionado;
  const classificacao = arquivo ? classificarArquivo(arquivo) : null;
  if ((!texto && !arquivo) || !selecionado) return;
  if (!pendente || pendente.texto !== texto || pendente.chatId !== selecionado ||
      pendente.arquivo !== arquivo) {
    pendente = {
      chatId: selecionado,
      texto,
      arquivo,
      filePath: arquivo ? "internal-chat-media/" + usuario.uid + "/" + crypto.randomUUID() : "",
      uploaded: false,
      messageId: crypto.randomUUID()
    };
  }
  const mensagem = pendente;
  const botao = el("chat-enviar");
  const botaoAnexo = el("chat-anexar-arquivo");
  botao.disabled = true;
  botaoAnexo.disabled = true;
  try {
    if (arquivo && !mensagem.uploaded) {
      try {
        await uploadBytes(ref(storage, mensagem.filePath), arquivo, {
          contentType: classificacao.mimeType,
          customMetadata: { fileName: arquivo.name.slice(0, 180) }
        });
      } catch (erro) {
        if (pendente === mensagem) pendente = null;
        throw erro;
      }
      mensagem.uploaded = true;
    }
    await call("enviarMensagemChatInterno", {
      chatId: mensagem.chatId,
      texto: mensagem.texto,
      messageId: mensagem.messageId,
      tipo: classificacao ? classificacao.tipo : "text",
      filePath: mensagem.filePath,
      fileName: arquivo ? arquivo.name.slice(0, 180) : "",
      mimeType: classificacao ? classificacao.mimeType : ""
    });
    if (pendente === mensagem) pendente = null;
    if (selecionado === mensagem.chatId && el("texto-chat").value.trim() === mensagem.texto) {
      el("texto-chat").value = "";
      el("texto-chat").style.height = "";
    }
    if (arquivoSelecionado === arquivo) limparArquivoSelecionado();
    await atualizar();
  } catch (erro) {
    const detalhe = erro.code && String(erro.code).startsWith("functions/")
      ? descreverErroServico(erro, "enviarMensagemChatInterno")
      : erro.message || "Erro desconhecido.";
    window.alert("Não foi possível enviar: " + detalhe);
  } finally {
    botao.disabled = false;
    botaoAnexo.disabled = false;
  }
});

el("chat-anexar-arquivo").addEventListener("click", () => {
  el("chat-arquivo-input").value = "";
  el("chat-arquivo-input").click();
});
el("chat-arquivo-input").addEventListener("change", (evento) => {
  selecionarArquivo(evento.currentTarget.files && evento.currentTarget.files[0]);
});
el("texto-chat").addEventListener("keydown", (evento) => {
  if (!ehAtalhoEnviar(evento)) return;
  evento.preventDefault();
  el("form-chat").requestSubmit();
});
el("texto-chat").addEventListener("input", (evento) => {
  const campo = evento.currentTarget;
  campo.style.height = "auto";
  campo.style.height = Math.min(campo.scrollHeight, 120) + "px";
});
el("historico-chat").addEventListener("scroll", () => {
  const lista = el("historico-chat");
  acompanhandoFimHistorico = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
});

el("sair").addEventListener("click", async () => {
  revogarUrlsMidia();
  try { await call("presencaChatInterno", { sessionId, chatId: selecionado, ativa: false }); }
  catch (erro) { console.warn("Não foi possível encerrar a presença do chat:", erro.message); }
  await signOut(auth);
  location.href = "index.html";
});
document.addEventListener("visibilitychange", atualizarPresenca);
window.addEventListener("focus", atualizarPresenca);
window.addEventListener("blur", atualizarPresenca);
