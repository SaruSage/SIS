// ============================================================
// PROJETO GOLDEN — Lógica do módulo de Vendas (Kanban)
// ============================================================
// ⚠️ ESTE ARQUIVO É ENTREGUE EM 2 PARTES: cole a Parte 1 e, em
// seguida, a Parte 2 imediatamente após — juntas formam o arquivo.
//
// Responsabilidades:
// 1. Proteger a página (cargo "vendas" ou "administracao").
// 2. Carregar colunas e cards em tempo real (onSnapshot).
// 3. Renderizar o Kanban com cards ordenados do mais recente
//    para o mais antigo.
// 4. Drag and drop nativo (HTML5) entre colunas.
// 5. Busca em tempo real por nome, telefone e e-mail.
// 6. CRUD de colunas com fluxo de solicitação para vendedor.
// 7. CRUD de cards com gerador aleatório (admin).
// 8. Programação de mensagem (simulada) em colunas funcionárias.
// 9. Dois históricos: do card e da coluna.
// 10. Histórico global mesclado, excluídos e configurações.
// ============================================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, addDoc, updateDoc, doc, onSnapshot,
  query, where, getDocs, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
// LISTA DE ADMINISTRADORES + CARGOS AUTORIZADOS
// ------------------------------------------------------------
const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];
const CARGOS_AUTORIZADOS = ["vendas", "administracao"];

// ------------------------------------------------------------
// ESTADO DA PÁGINA
// ------------------------------------------------------------
let cacheColunas = [];        // colunas ativas
let cacheCards = [];          // cards ativos (sem excluídos)
let cacheCardsExcluidos = []; // cards com excluido === true
let usuarioAtual = null;      // { uid, email, nome }
let ehAdmin = false;
let termoBusca = "";
let colunaArrastada = null;   // id da coluna de origem do drag
let cardArrastado = null;     // id do card em drag
let configKanban = {          // configurações globais
  colunaPerdidaId: "",
  colunaFinalizadaId: ""
};

// ------------------------------------------------------------
// CAPTURA DE ELEMENTOS
// ------------------------------------------------------------
const conteudoProtegido = document.getElementById("conteudo-protegido");
const nomeUsuario = document.getElementById("nome-usuario");
const avatar = document.getElementById("avatar");
const acessoNegado = document.getElementById("acesso-negado");
const conteudoVendas = document.getElementById("conteudo-vendas");
const botaoVoltar = document.getElementById("botao-voltar");
const botaoPerfil = document.getElementById("botao-perfil");
const menuPerfil = document.getElementById("menu-perfil");
const itemSair = document.getElementById("item-sair");
const buscaCard = document.getElementById("busca-card");
const botaoNovaColuna = document.getElementById("botao-nova-coluna");
const botaoMenuKanban = document.getElementById("botao-menu-kanban");
const menuKanban = document.getElementById("menu-kanban");
const itemExcluidos = document.getElementById("item-excluidos");
const itemHistoricoGlobal = document.getElementById("item-historico-global");
const itemConfiguracoes = document.getElementById("item-configuracoes");
const itemCardTeste = document.getElementById("item-card-teste");
const kanban = document.getElementById("kanban");
const areaMensagem = document.getElementById("mensagem");
const modalOverlay = document.getElementById("modal-overlay");
const modalConteudo = document.getElementById("modal-conteudo");

// ------------------------------------------------------------
// UTILITÁRIOS
// ------------------------------------------------------------
function mostrarMensagem(texto, tipo) {
  areaMensagem.textContent = texto;
  areaMensagem.className = "mensagem " + tipo;
  setTimeout(() => {
    areaMensagem.className = "mensagem";
    areaMensagem.textContent = "";
  }, 4000);
}

function formatarMoeda(valor) {
  const n = Number(valor) || 0;
  return "R$ " + n.toFixed(2).replace(".", ",");
}

function formatarData(timestamp) {
  if (!timestamp) return "—";
  const segundos = timestamp.seconds || timestamp;
  return new Date(segundos * 1000).toLocaleString("pt-BR");
}

function formatarDataCurta(timestamp) {
  if (!timestamp) return "—";
  const segundos = timestamp.seconds || timestamp;
  return new Date(segundos * 1000).toLocaleDateString("pt-BR");
}

function segundosDe(timestamp) {
  return (timestamp && timestamp.seconds) || 0;
}

function abrirModal(conteudo) {
  modalConteudo.innerHTML = "";
  modalConteudo.appendChild(conteudo);
  modalOverlay.style.display = "flex";
}

function fecharModal() {
  modalOverlay.style.display = "none";
  modalConteudo.innerHTML = "";
}

function fecharMenuOpcoes() {
  const existente = document.getElementById("menu-opcoes");
  if (existente) existente.remove();
}

// ------------------------------------------------------------
// PROTEÇÃO DA PÁGINA
// ------------------------------------------------------------
onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  const email = (usuario.email || "").toLowerCase();
  const ehAdminEmail = ADMINISTRADORES.includes(email);

  let autorizado = ehAdminEmail;
  let cargo = null;

  if (!autorizado) {
    const resultado = await usuarioTemCargoAutorizado(email);
    autorizado = resultado.autorizado;
    cargo = resultado.cargo;
  }

  if (!autorizado) {
    conteudoProtegido.classList.remove("oculto");
    acessoNegado.style.display = "block";
    return;
  }

  ehAdmin = ehAdminEmail || cargo === "administracao";

  const nomeCompleto = await obterNomeUsuario(usuario.email);
  usuarioAtual = {
    uid: usuario.uid,
    email: usuario.email,
    nome: nomeCompleto
  };

  conteudoProtegido.classList.remove("oculto");
  const primeiroNome = nomeCompleto.split(" ")[0];
  nomeUsuario.textContent = primeiroNome;
  avatar.textContent = primeiroNome.charAt(0).toUpperCase();
  conteudoVendas.style.display = "block";

  if (ehAdmin) {
    itemCardTeste.style.display = "block";
  }

  escutarColunas();
  escutarCards();
  escutarConfiguracoes();
});

// ------------------------------------------------------------
// VERIFICA O CARGO DO USUÁRIO NO BANCO
// ------------------------------------------------------------
async function usuarioTemCargoAutorizado(email) {
  try {
    const resultado = await getDocs(collection(db, "solicitacoes"));
    let autorizado = false;
    let cargo = null;
    resultado.forEach((documento) => {
      const dados = documento.data();
      const mesmoEmail = (dados.email || "").toLowerCase() === email.toLowerCase();
      if (mesmoEmail && dados.status === "aprovada") {
        if (CARGOS_AUTORIZADOS.includes(dados.cargo)) {
          autorizado = true;
          cargo = dados.cargo;
        }
      }
    });
    return { autorizado, cargo };
  } catch (erro) {
    return { autorizado: false, cargo: null };
  }
}

// ------------------------------------------------------------
// NOME COMPLETO DO USUÁRIO
// ------------------------------------------------------------
async function obterNomeUsuario(email) {
  try {
    const resultado = await getDocs(collection(db, "solicitacoes"));
    let nome = email;
    resultado.forEach((documento) => {
      const dados = documento.data();
      if ((dados.email || "").toLowerCase() === email.toLowerCase() && dados.nome) {
        nome = dados.nome;
      }
    });
    return nome;
  } catch (erro) {
    return email;
  }
}

// ------------------------------------------------------------
// ESCUTAR COLUNAS EM TEMPO REAL
// ------------------------------------------------------------
function escutarColunas() {
  onSnapshot(collection(db, "colunas"), (resultado) => {
    cacheColunas = [];
    resultado.forEach((documento) => {
      cacheColunas.push({ id: documento.id, ...documento.data() });
    });
    cacheColunas.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    renderizarKanban();
  });
}

// ------------------------------------------------------------
// ESCUTAR CARDS EM TEMPO REAL
// ------------------------------------------------------------
function escutarCards() {
  onSnapshot(collection(db, "cards"), (resultado) => {
    cacheCards = [];
    cacheCardsExcluidos = [];
    resultado.forEach((documento) => {
      const card = { id: documento.id, ...documento.data() };
      if (card.excluido) {
        cacheCardsExcluidos.push(card);
      } else {
        cacheCards.push(card);
      }
    });
    renderizarKanban();
  });
}

// ------------------------------------------------------------
// ESCUTAR CONFIGURAÇÕES GLOBAIS
// ------------------------------------------------------------
function escutarConfiguracoes() {
  onSnapshot(doc(db, "configuracoes", "kanban"), (documento) => {
    if (documento.exists()) {
      configKanban = documento.data();
    }
  });
}

// ------------------------------------------------------------
// RENDERIZAR O KANBAN COMPLETO
// ------------------------------------------------------------
function renderizarKanban() {
  if (cacheColunas.length === 0) {
    kanban.innerHTML =
      '<p class="texto-ajuda">Nenhuma coluna criada ainda. Clique em "Nova coluna" para começar.</p>';
    return;
  }

  kanban.innerHTML = "";

  cacheColunas.forEach((coluna) => {
    kanban.appendChild(criarColuna(coluna));
  });

  // Botão de adicionar coluna no fim
  const botaoAdicionar = document.createElement("button");
  botaoAdicionar.type = "button";
  botaoAdicionar.className = "coluna-adicionar";
  botaoAdicionar.textContent = "➕ Adicionar coluna";
  botaoAdicionar.addEventListener("click", abrirCriacaoColuna);
  kanban.appendChild(botaoAdicionar);
}

// ------------------------------------------------------------
// CRIAR ELEMENTO DE COLUNA
// ------------------------------------------------------------
function criarColuna(coluna) {
  const cardsDaColuna = cardsFiltradosDaColuna(coluna.id);

  const div = document.createElement("div");
  div.className = "coluna" + (coluna.tipo === "funcionaria" ? " coluna-funcionaria" : "");
  div.dataset.colunaId = coluna.id;

  // Cabeçalho
  const cabecalho = document.createElement("div");
  cabecalho.className = "cabecalho-coluna";

  const linhaTitulo = document.createElement("div");
  linhaTitulo.className = "linha-titulo-coluna";

  const nome = document.createElement("h3");
  nome.className = "nome-coluna";
  nome.textContent = coluna.nome;
  linhaTitulo.appendChild(nome);

  const botaoPontos = document.createElement("button");
  botaoPontos.type = "button";
  botaoPontos.className = "botao-tres-pontos-card";
  botaoPontos.textContent = "⋮";
  botaoPontos.title = "Opções da coluna";
  botaoPontos.addEventListener("click", (evento) => {
    evento.stopPropagation();
    abrirMenuColuna(botaoPontos, coluna);
  });
  linhaTitulo.appendChild(botaoPontos);

  cabecalho.appendChild(linhaTitulo);

  if (coluna.descricao) {
    const desc = document.createElement("p");
    desc.className = "descricao-coluna";
    desc.textContent = coluna.descricao;
    cabecalho.appendChild(desc);
  }

  // Métricas
  const valorTotal = cardsDaColuna.reduce(
    (soma, card) => soma + (Number(card.valorNegociado) || 0), 0
  );

  const metricas = document.createElement("div");
  metricas.className = "metricas-coluna";
  metricas.innerHTML =
    '<div class="metrica">' +
      '<span class="metrica-rotulo">Conversas</span>' +
      '<span class="metrica-valor">' + cardsDaColuna.length + "</span>" +
    "</div>" +
    '<div class="metrica">' +
      '<span class="metrica-rotulo">Valor</span>' +
      '<span class="metrica-valor">' + formatarMoeda(valorTotal) + "</span>" +
    "</div>";
  cabecalho.appendChild(metricas);

  div.appendChild(cabecalho);

  // Corpo com cards
  const corpo = document.createElement("div");
  corpo.className = "corpo-coluna";
  corpo.dataset.colunaId = coluna.id;

  if (cardsDaColuna.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "texto-ajuda";
    vazio.textContent = "Nenhuma conversa nesta coluna.";
    corpo.appendChild(vazio);
  } else {
    cardsDaColuna.forEach((card) => {
      corpo.appendChild(criarCard(card, coluna));
    });
  }

  // Drag and drop
  corpo.addEventListener("dragover", (evento) => {
    evento.preventDefault();
    div.classList.add("arrastando-sobre");
  });

  corpo.addEventListener("dragleave", () => {
    div.classList.remove("arrastando-sobre");
  });

  corpo.addEventListener("drop", async (evento) => {
    evento.preventDefault();
    div.classList.remove("arrastando-sobre");
    if (!cardArrastado) return;
    await moverCard(cardArrastado, coluna.id);
    cardArrastado = null;
  });

  div.appendChild(corpo);
  return div;
}

// ------------------------------------------------------------
// CARDS FILTRADOS DA COLUNA (aplica busca + ordenação)
// ------------------------------------------------------------
function cardsFiltradosDaColuna(colunaId) {
  let lista = cacheCards.filter((c) => c.colunaId === colunaId);

  if (termoBusca) {
    const termo = termoBusca.toLowerCase();
    lista = lista.filter((c) => {
      const alvo = (
        (c.nomeConta || "") + " " +
        (c.telefone || "") + " " +
        (c.email || "") + " " +
        (c.razaoSocial || "")
      ).toLowerCase();
      return alvo.includes(termo);
    });
  }

  lista.sort((a, b) =>
    segundosDe(b.ultimaAtividade || b.criadoEm) -
    segundosDe(a.ultimaAtividade || a.criadoEm)
  );

  return lista;
}

// ------------------------------------------------------------
// CRIAR ELEMENTO DE CARD
// ------------------------------------------------------------
function criarCard(card, coluna) {
  const div = document.createElement("div");
  div.className = "card-conversa";
  div.dataset.cardId = card.id;
  div.draggable = true;

  if (card.status === "perdida") div.classList.add("card-perdida");
  if (card.status === "finalizada") div.classList.add("card-finalizada");

  // Aviso de estado
  if (card.status === "perdida") {
    const aviso = document.createElement("span");
    aviso.className = "aviso-card aviso-perdida";
    aviso.textContent = "Perdida";
    div.appendChild(aviso);
  } else if (card.status === "finalizada") {
    const aviso = document.createElement("span");
    aviso.className = "aviso-card aviso-finalizada";
    aviso.textContent = "Ganha";
    div.appendChild(aviso);
  }

  // Nome do cliente
  const nome = document.createElement("p");
  nome.className = "nome-cliente";
  nome.textContent = card.nomeConta || "Sem nome";
  div.appendChild(nome);

  // Data de início
  const dataInicio = document.createElement("p");
  dataInicio.className = "data-inicio";
  dataInicio.textContent = "Início: " + formatarDataCurta(card.iniciadoEm || card.criadoEm);
  div.appendChild(dataInicio);

  // Linhas de informação
  div.appendChild(criarLinhaInfo("Telefone", card.telefone || "—"));
  div.appendChild(criarLinhaInfo("Razão social", card.razaoSocial || "—"));
  div.appendChild(criarLinhaInfo("E-mail", card.email || "—"));

  // Valor negociado
  const valor = document.createElement("p");
  valor.className = "valor-negociado";
  valor.textContent = formatarMoeda(card.valorNegociado);
  div.appendChild(valor);

  // Descrição oculta
  if (card.descricao) {
    const rotulo = document.createElement("span");
    rotulo.className = "rotulo-descricao";
    rotulo.textContent = "Ver descrição";
    const texto = document.createElement("p");
    texto.className = "texto-descricao";
    texto.textContent = card.descricao;
    rotulo.addEventListener("click", () => {
      texto.classList.toggle("visivel");
      rotulo.textContent = texto.classList.contains("visivel")
        ? "Ocultar descrição" : "Ver descrição";
    });
    div.appendChild(rotulo);
    div.appendChild(texto);
  }

  // Menu de três pontinhos
  const botaoPontos = document.createElement("button");
  botaoPontos.type = "button";
  botaoPontos.className = "botao-tres-pontos-card";
  botaoPontos.textContent = "⋮";
  botaoPontos.title = "Opções do card";
  botaoPontos.addEventListener("click", (evento) => {
    evento.stopPropagation();
    abrirMenuCard(botaoPontos, card, coluna);
  });
  div.appendChild(botaoPontos);

  // Rodapé com botões
  const rodape = document.createElement("div");
  rodape.className = "rodape-card";

  const botaoEditar = document.createElement("button");
  botaoEditar.type = "button";
  botaoEditar.className = "botao-card";
  botaoEditar.textContent = "✏️ Editar";
  botaoEditar.addEventListener("click", () => abrirEdicaoCard(card));
  rodape.appendChild(botaoEditar);

  const botaoAcessar = document.createElement("button");
  botaoAcessar.type = "button";
  botaoAcessar.className = "botao-card botao-card-primario";
  botaoAcessar.textContent = "💬 Acessar";
  botaoAcessar.addEventListener("click", () => acessarConversa(card));
  rodape.appendChild(botaoAcessar);

  div.appendChild(rodape);

  // Botão de programar (só em coluna funcionária)
  if (coluna.tipo === "funcionaria") {
    const botaoProgramar = document.createElement("button");
    botaoProgramar.type = "button";
    botaoProgramar.className = "botao-programar";
    const jaProgramado = card.programacao && card.programacao.status !== "enviado";
    if (jaProgramado) {
      botaoProgramar.classList.add("programado");
      botaoProgramar.textContent = "⏳ Aguardando envio";
    } else {
      botaoProgramar.textContent = "📅 Programar mensagem";
    }
    botaoProgramar.addEventListener("click", () => abrirProgramacao(card, coluna));
    div.appendChild(botaoProgramar);
  }

  // Drag
  div.addEventListener("dragstart", (evento) => {
    cardArrastado = card.id;
    div.classList.add("arrastando");
    evento.dataTransfer.effectAllowed = "move";
  });

  div.addEventListener("dragend", () => {
    div.classList.remove("arrastando");
    cardArrastado = null;
    document.querySelectorAll(".coluna").forEach((c) =>
      c.classList.remove("arrastando-sobre")
    );
  });

  return div;
}

function criarLinhaInfo(rotulo, valor) {
  const linha = document.createElement("div");
  linha.className = "linha-info";
  linha.innerHTML = "<strong>" + rotulo + ":</strong> " + valor;
  return linha;
}

// ------------------------------------------------------------
// BUSCA EM TEMPO REAL
// ------------------------------------------------------------
buscaCard.addEventListener("input", () => {
  termoBusca = buscaCard.value.trim();
  renderizarKanban();
});

// ------------------------------------------------------------
// MENUS FLUTUANTES
// ------------------------------------------------------------
botaoPerfil.addEventListener("click", () => {
  menuKanban.classList.remove("aberta");
  menuPerfil.classList.toggle("aberta");
});

botaoMenuKanban.addEventListener("click", () => {
  menuPerfil.classList.remove("aberta");
  menuKanban.classList.toggle("aberta");
});

document.addEventListener("click", (evento) => {
  if (!menuPerfil.contains(evento.target) && !botaoPerfil.contains(evento.target)) {
    menuPerfil.classList.remove("aberta");
  }
  if (!menuKanban.contains(evento.target) && !botaoMenuKanban.contains(evento.target)) {
    menuKanban.classList.remove("aberta");
  }
  const menuOpcoes = document.getElementById("menu-opcoes");
  if (menuOpcoes &&
      !menuOpcoes.contains(evento.target) &&
      !evento.target.classList.contains("botao-tres-pontos-card")) {
    fecharMenuOpcoes();
  }
});

botaoNovaColuna.addEventListener("click", abrirCriacaoColuna);

// ------------------------------------------------------------
// BOTÃO VOLTAR
// ------------------------------------------------------------
botaoVoltar.addEventListener("click", () => {
  if (window.confirm("Deseja realmente voltar para a página inicial?")) {
    window.location.href = "home.html";
  }
});

// ------------------------------------------------------------
// SAIR
// ------------------------------------------------------------
itemSair.addEventListener("click", async () => {
  menuPerfil.classList.remove("aberta");
  if (!window.confirm("Deseja realmente sair do sistema?")) return;
  await signOut(auth);
  window.location.href = "index.html";
});

// ------------------------------------------------------------
// MOVER CARD ENTRE COLUNAS
// ------------------------------------------------------------
async function moverCard(cardId, colunaDestinoId) {
  const card = cacheCards.find((c) => c.id === cardId);
  if (!card) return;
  if (card.colunaId === colunaDestinoId) return;

  const colunaOrigem = cacheColunas.find((c) => c.id === card.colunaId);
  const colunaDestino = cacheColunas.find((c) => c.id === colunaDestinoId);
  if (!colunaDestino) return;

  // Aviso se o card já tem mensagem programada
  if (card.programacao && card.programacao.status !== "enviado") {
    const continuar = window.confirm(
      "Este card tem uma mensagem programada. Ao movê-lo, a programação será desconfigurada. Deseja continuar?"
    );
    if (!continuar) return;
  }

  try {
    await updateDoc(doc(db, "cards", cardId), {
      colunaId: colunaDestinoId,
      ultimaAtividade: serverTimestamp(),
      programacao: null
    });

    await registrarHistoricoCard(cardId, "movimentacao", {
      de: colunaOrigem ? colunaOrigem.nome : "—",
      para: colunaDestino.nome
    });

    await registrarHistoricoColuna(colunaDestinoId, "entrada", card, {
      colunaOrigemId: card.colunaId,
      colunaDestinoId: colunaDestinoId
    });

    if (colunaOrigem) {
      await registrarHistoricoColuna(colunaOrigem.id, "saida", card, {
        colunaOrigemId: colunaOrigem.id,
        colunaDestinoId: colunaDestinoId
      });
    }

    mostrarMensagem("Card movido para " + colunaDestino.nome + ".", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao mover o card.", "erro");
  }
}

// ------------------------------------------------------------
// ACESSAR CONVERSA (abre WhatsApp)
// ------------------------------------------------------------
async function acessarConversa(card) {
  const telefone = (card.telefone || "").replace(/\D/g, "");
  if (!telefone) {
    mostrarMensagem("Este card não tem telefone cadastrado.", "erro");
    return;
  }
  await registrarHistoricoCard(card.id, "acesso", {});
  window.open("https://wa.me/" + telefone, "_blank");
}

// ------------------------------------------------------------
// REGISTRAR HISTÓRICO DO CARD
// ------------------------------------------------------------
async function registrarHistoricoCard(cardId, tipo, detalhes) {
  try {
    await addDoc(collection(db, "cards", cardId, "historico"), {
      tipo: tipo,
      autor: usuarioAtual,
      automatico: false,
      diretrizDe: null,
      detalhes: detalhes || {},
      timestamp: serverTimestamp()
    });
  } catch (erro) {
    // Silencioso: falha no histórico não deve quebrar a ação principal.
  }
}

// ------------------------------------------------------------
// REGISTRAR HISTÓRICO DA COLUNA
// ------------------------------------------------------------
async function registrarHistoricoColuna(colunaId, tipo, card, extra) {
  try {
    await addDoc(collection(db, "colunas", colunaId, "historico"), {
      tipo: tipo,
      cardId: card.id,
      cardResumo: card.nomeConta || "—",
      autor: usuarioAtual,
      automatico: false,
      diretrizDe: null,
      colunaOrigemId: extra.colunaOrigemId || null,
      colunaDestinoId: extra.colunaDestinoId || null,
      timestamp: serverTimestamp()
    });
  } catch (erro) {
    // Silencioso.
  }
}

// ============================================================
// PARTE 2 — modais, colunas, cards, programação, históricos,
// configurações e excluídos.
// ============================================================

// ------------------------------------------------------------
// MENU DA COLUNA (três pontinhos)
// ------------------------------------------------------------
function abrirMenuColuna(botao, coluna) {
  fecharMenuOpcoes();
  const menu = document.createElement("div");
  menu.id = "menu-opcoes";
  menu.className = "menu-opcoes";

  const opcoes = [
    { texto: "✏️ Editar nome/descrição", acao: () => abrirEdicaoColuna(coluna) },
    { texto: "📜 Ver histórico", acao: () => abrirHistoricoColuna(coluna) }
  ];

  if (coluna.tipo === "funcionaria") {
    opcoes.push({
      texto: "⚙️ Configurar função",
      acao: () => abrirConfiguracaoFuncionaria(coluna)
    });
  }

  if (ehAdmin) {
    opcoes.push({
      texto: "🗑️ Excluir coluna",
      acao: () => excluirColuna(coluna),
      classe: "opcao-perigosa"
    });
  } else {
    opcoes.push({
      texto: "📨 Solicitar exclusão",
      acao: () => solicitarExclusaoColuna(coluna)
    });
  }

  opcoes.forEach((opcao) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = opcao.texto;
    item.className = "item-opcao" + (opcao.classe ? " " + opcao.classe : "");
    item.addEventListener("click", () => {
      fecharMenuOpcoes();
      opcao.acao();
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  const rect = botao.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = Math.max(8, Math.min(
    rect.left,
    window.innerWidth - 210
  )) + "px";
}

// ------------------------------------------------------------
// MENU DO CARD (três pontinhos)
// ------------------------------------------------------------
function abrirMenuCard(botao, card, coluna) {
  fecharMenuOpcoes();
  const menu = document.createElement("div");
  menu.id = "menu-opcoes";
  menu.className = "menu-opcoes";

  const opcoes = [
    { texto: "📜 Histórico", acao: () => abrirHistoricoCard(card) },
    {
      texto: "🔴 Marcar como perdida",
      acao: () => marcarCard(card, "perdida")
    },
    {
      texto: "🟢 Marcar como finalizada",
      acao: () => marcarCard(card, "finalizada")
    },
    {
      texto: "🗑️ Excluir card",
      acao: () => excluirCard(card),
      classe: "opcao-perigosa"
    }
  ];

  opcoes.forEach((opcao) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = opcao.texto;
    item.className = "item-opcao" + (opcao.classe ? " " + opcao.classe : "");
    item.addEventListener("click", () => {
      fecharMenuOpcoes();
      opcao.acao();
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  const rect = botao.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = Math.max(8, Math.min(
    rect.left,
    window.innerWidth - 210
  )) + "px";
}

// ------------------------------------------------------------
// CRIAR COLUNA
// ------------------------------------------------------------
function abrirCriacaoColuna() {
  if (!ehAdmin) {
    solicitarCriacaoColuna();
    return;
  }

  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Nova coluna</h3>" +
    "<label>Nome (obrigatório)</label>" +
    '<input type="text" id="col-nome">' +
    "<label>Descrição (opcional)</label>" +
    '<input type="text" id="col-descricao">' +
    "<label>Tipo</label>" +
    '<select id="col-tipo">' +
      '<option value="estatica">Estática</option>' +
      '<option value="funcionaria">Funcionária</option>' +
    "</select>";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Criar coluna";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const nome = caixa.querySelector("#col-nome").value.trim();
    const descricao = caixa.querySelector("#col-descricao").value.trim();
    const tipo = caixa.querySelector("#col-tipo").value;

    if (!nome) {
      mostrarMensagem("O nome da coluna é obrigatório.", "erro");
      return;
    }

    botaoSalvar.disabled = true;
    try {
      const ordem = cacheColunas.length;
      await addDoc(collection(db, "colunas"), {
        nome: nome,
        descricao: descricao,
        tipo: tipo,
        ordem: ordem,
        criadoPor: usuarioAtual,
        criadoEm: serverTimestamp()
      });
      mostrarMensagem("Coluna criada com sucesso.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao criar a coluna.", "erro");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoSalvar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// EDITAR COLUNA (nome e descrição — qualquer usuário)
// ------------------------------------------------------------
function abrirEdicaoColuna(coluna) {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Editar coluna</h3>" +
    "<label>Nome (obrigatório)</label>" +
    '<input type="text" id="col-nome">' +
    "<label>Descrição (opcional)</label>" +
    '<input type="text" id="col-descricao">';

  caixa.querySelector("#col-nome").value = coluna.nome;
  caixa.querySelector("#col-descricao").value = coluna.descricao || "";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Salvar";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const nome = caixa.querySelector("#col-nome").value.trim();
    const descricao = caixa.querySelector("#col-descricao").value.trim();

    if (!nome) {
      mostrarMensagem("O nome da coluna é obrigatório.", "erro");
      return;
    }

    botaoSalvar.disabled = true;
    try {
      await updateDoc(doc(db, "colunas", coluna.id), { nome, descricao });
      await registrarHistoricoColuna(coluna.id, "configuracao", {
        id: coluna.id, nomeConta: coluna.nome
      }, {});
      mostrarMensagem("Coluna atualizada.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao atualizar a coluna.", "erro");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoSalvar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// EXCLUIR COLUNA (admin)
// ------------------------------------------------------------
async function excluirColuna(coluna) {
  const cardsNaColuna = cacheCards.filter((c) => c.colunaId === coluna.id);
  if (cardsNaColuna.length > 0) {
    mostrarMensagem(
      "Não é possível excluir: a coluna tem " + cardsNaColuna.length + " card(s). Mova-os antes.",
      "erro"
    );
    return;
  }
  if (!window.confirm("Deseja realmente excluir a coluna \"" + coluna.nome + "\"?")) return;

  try {
    await deleteDoc(doc(db, "colunas", coluna.id));
    mostrarMensagem("Coluna excluída.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao excluir a coluna.", "erro");
  }
}

// ------------------------------------------------------------
// SOLICITAR CRIAÇÃO DE COLUNA (vendedor)
// ------------------------------------------------------------
function solicitarCriacaoColuna() {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Solicitar nova coluna</h3>" +
    '<p class="texto-ajuda">Sua solicitação será enviada ao administrador.</p>' +
    "<label>Nome sugerido (obrigatório)</label>" +
    '<input type="text" id="sol-nome">' +
    "<label>Descrição (opcional)</label>" +
    '<input type="text" id="sol-descricao">' +
    "<label>Tipo sugerido</label>" +
    '<select id="sol-tipo">' +
      '<option value="estatica">Estática</option>' +
      '<option value="funcionaria">Funcionária</option>' +
    "</select>";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoEnviar = document.createElement("button");
  botaoEnviar.textContent = "Enviar solicitação";
  botaoEnviar.className = "botao-modal";
  botaoEnviar.addEventListener("click", async () => {
    const nome = caixa.querySelector("#sol-nome").value.trim();
    const descricao = caixa.querySelector("#sol-descricao").value.trim();
    const tipo = caixa.querySelector("#sol-tipo").value;

    if (!nome) {
      mostrarMensagem("O nome sugerido é obrigatório.", "erro");
      return;
    }

    botaoEnviar.disabled = true;
    try {
      await addDoc(collection(db, "solicitacoesColunas"), {
        tipo: "criacao",
        dadosPropostos: { nome, descricao, tipo },
        solicitadoPor: usuarioAtual,
        status: "pendente",
        criadoEm: serverTimestamp()
      });
      mostrarMensagem("Solicitação enviada ao administrador.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao enviar a solicitação.", "erro");
    } finally {
      botaoEnviar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoEnviar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// SOLICITAR EXCLUSÃO DE COLUNA (vendedor)
// ------------------------------------------------------------
async function solicitarExclusaoColuna(coluna) {
  if (!window.confirm("Solicitar ao administrador a exclusão da coluna \"" + coluna.nome + "\"?")) return;
  try {
    await addDoc(collection(db, "solicitacoesColunas"), {
      tipo: "exclusao",
      colunaId: coluna.id,
      dadosPropostos: { nome: coluna.nome },
      solicitadoPor: usuarioAtual,
      status: "pendente",
      criadoEm: serverTimestamp()
    });
    mostrarMensagem("Solicitação de exclusão enviada.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao enviar a solicitação.", "erro");
  }
}

// ------------------------------------------------------------
// CONFIGURAR COLUNA FUNCIONÁRIA
// ------------------------------------------------------------
function abrirConfiguracaoFuncionaria(coluna) {
  const cfg = coluna.configFuncionaria || {};
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";

  let opcoesDestino = '<option value="">Selecione...</option>';
  cacheColunas.forEach((c) => {
    if (c.id === coluna.id) return;
    const sel = cfg.colunaDestinoId === c.id ? " selected" : "";
    opcoesDestino += '<option value="' + c.id + '"' + sel + ">" + c.nome + "</option>";
  });

  caixa.innerHTML =
    "<h3>Configurar coluna funcionária</h3>" +
    "<label>Mensagem automática (WhatsApp)</label>" +
    '<textarea id="cfg-mensagem"></textarea>' +
    "<label>Gatilho de conclusão (descreva a condição)</label>" +
    '<input type="text" id="cfg-gatilho" placeholder="Ex.: cliente confirmar o pedido">' +
    "<label>Coluna de destino ao concluir</label>" +
    '<select id="cfg-destino">' + opcoesDestino + "</select>" +
    '<p class="texto-ajuda" style="margin-top:12px;">' +
      "Modo de detecção: manual (o vendedor marca como concluída). " +
      "A detecção automática por IA será ativada em versão futura." +
    "</p>";

  caixa.querySelector("#cfg-mensagem").value = cfg.mensagemWhatsapp || "";
  caixa.querySelector("#cfg-gatilho").value = cfg.gatilhoConclusao || "";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Salvar configuração";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const mensagemWhatsapp = caixa.querySelector("#cfg-mensagem").value.trim();
    const gatilhoConclusao = caixa.querySelector("#cfg-gatilho").value.trim();
    const colunaDestinoId = caixa.querySelector("#cfg-destino").value;

    if (!colunaDestinoId) {
      mostrarMensagem("Selecione a coluna de destino.", "erro");
      return;
    }

    botaoSalvar.disabled = true;
    try {
      await updateDoc(doc(db, "colunas", coluna.id), {
        configFuncionaria: {
          mensagemWhatsapp,
          gatilhoConclusao,
          colunaDestinoId,
          modoDeteccao: "manual",
          configuradoPor: usuarioAtual
        }
      });
      await registrarHistoricoColuna(coluna.id, "configuracao", {
        id: coluna.id, nomeConta: coluna.nome
      }, {});
      mostrarMensagem("Configuração salva.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao salvar a configuração.", "erro");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoSalvar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// CRIAR CARD (gerador de teste — admin)
// ------------------------------------------------------------
const NOMES_TESTE = [
  "João Silva", "Maria Santos", "Carlos Oliveira", "Ana Costa",
  "Pedro Almeida", "Juliana Ferreira", "Rafael Souza", "Camila Lima",
  "Bruno Rocha", "Fernanda Dias", "Lucas Martins", "Patrícia Gomes"
];
const EMPRESAS_TESTE = [
  "Silva Comércio Ltda", "Santos & Filhos ME", "Oliveira Instalações",
  "Costa Engenharia", "Almeida Serviços", "Ferreira Distribuidora",
  "Souza Materiais", "Lima Construções"
];

function gerarCardAleatorio() {
  if (cacheColunas.length === 0) {
    mostrarMensagem("Crie uma coluna antes de gerar cards.", "erro");
    return;
  }

  const nome = NOMES_TESTE[Math.floor(Math.random() * NOMES_TESTE.length)];
  const empresa = EMPRESAS_TESTE[Math.floor(Math.random() * EMPRESAS_TESTE.length)];
  const ddd = 11 + Math.floor(Math.random() * 89);
  const telefone = "55" + ddd + "9" + Math.floor(10000000 + Math.random() * 89999999);
  const email = nome.toLowerCase().replace(/\s+/g, ".") + "@exemplo.com";
  const valor = Math.floor(Math.random() * 15000) + 500;
  const primeiraColuna = cacheColunas[0];

  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Gerar card de teste</h3>" +
    '<p class="texto-ajuda">Dados aleatórios para simulação.</p>' +
    "<label>Nome</label><input type='text' id='t-nome'>" +
    "<label>Razão social</label><input type='text' id='t-razao'>" +
    "<label>Telefone</label><input type='text' id='t-tel'>" +
    "<label>E-mail</label><input type='text' id='t-email'>" +
    "<label>Valor negociado (R$)</label><input type='number' id='t-valor' step='0.01'>" +
    "<label>Descrição</label><input type='text' id='t-desc'>" +
    "<label>Coluna</label><select id='t-coluna'>" +
      cacheColunas.map((c) =>
        '<option value="' + c.id + '"' +
        (c.id === primeiraColuna.id ? " selected" : "") + ">" + c.nome + "</option>"
      ).join("") +
    "</select>";

  caixa.querySelector("#t-nome").value = nome;
  caixa.querySelector("#t-razao").value = empresa;
  caixa.querySelector("#t-tel").value = telefone;
  caixa.querySelector("#t-email").value = email;
  caixa.querySelector("#t-valor").value = valor;
  caixa.querySelector("#t-desc").value = "Contato inicial via WhatsApp sobre orçamento.";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoCriar = document.createElement("button");
  botaoCriar.textContent = "Criar card";
  botaoCriar.className = "botao-modal";
  botaoCriar.addEventListener("click", async () => {
    const colunaId = caixa.querySelector("#t-coluna").value;
    botaoCriar.disabled = true;
    try {
      const novo = await addDoc(collection(db, "cards"), {
        colunaId: colunaId,
        nomeConta: caixa.querySelector("#t-nome").value.trim(),
        razaoSocial: caixa.querySelector("#t-razao").value.trim(),
        telefone: caixa.querySelector("#t-tel").value.trim(),
        email: caixa.querySelector("#t-email").value.trim(),
        valorNegociado: parseFloat(caixa.querySelector("#t-valor").value) || 0,
        descricao: caixa.querySelector("#t-desc").value.trim(),
        iniciadoEm: serverTimestamp(),
        ultimaAtividade: serverTimestamp(),
        status: "ativa",
        excluido: false,
        programacao: null,
        criadoPor: usuarioAtual,
        criadoEm: serverTimestamp()
      });
      await registrarHistoricoCard(novo.id, "criacao", {});
      mostrarMensagem("Card criado.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao criar o card.", "erro");
    } finally {
      botaoCriar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoCriar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// EDITAR CARD
// ------------------------------------------------------------
function abrirEdicaoCard(card) {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Editar card</h3>" +
    "<label>Nome / conta WhatsApp</label><input type='text' id='e-nome'>" +
    "<label>Razão social</label><input type='text' id='e-razao'>" +
    "<label>Telefone</label><input type='text' id='e-tel'>" +
    "<label>E-mail</label><input type='text' id='e-email'>" +
    "<label>Valor negociado (R$)</label><input type='number' id='e-valor' step='0.01'>" +
    "<label>Descrição</label><textarea id='e-desc'></textarea>";

  caixa.querySelector("#e-nome").value = card.nomeConta || "";
  caixa.querySelector("#e-razao").value = card.razaoSocial || "";
  caixa.querySelector("#e-tel").value = card.telefone || "";
  caixa.querySelector("#e-email").value = card.email || "";
  caixa.querySelector("#e-valor").value = card.valorNegociado || 0;
  caixa.querySelector("#e-desc").value = card.descricao || "";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Salvar";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const novos = {
      nomeConta: caixa.querySelector("#e-nome").value.trim(),
      razaoSocial: caixa.querySelector("#e-razao").value.trim(),
      telefone: caixa.querySelector("#e-tel").value.trim(),
      email: caixa.querySelector("#e-email").value.trim(),
      valorNegociado: parseFloat(caixa.querySelector("#e-valor").value) || 0,
      descricao: caixa.querySelector("#e-desc").value.trim()
    };

    const mudancas = [];
    if (novos.nomeConta !== (card.nomeConta || "")) mudancas.push("Nome");
    if (novos.razaoSocial !== (card.razaoSocial || "")) mudancas.push("Razão social");
    if (novos.telefone !== (card.telefone || "")) mudancas.push("Telefone");
    if (novos.email !== (card.email || "")) mudancas.push("E-mail");
    if (novos.valorNegociado !== (card.valorNegociado || 0)) mudancas.push("Valor");
    if (novos.descricao !== (card.descricao || "")) mudancas.push("Descrição");

    if (mudancas.length === 0) {
      mostrarMensagem("Nenhuma alteração foi feita.", "erro");
      return;
    }

    botaoSalvar.disabled = true;
    try {
      await updateDoc(doc(db, "cards", card.id), {
        ...novos,
        ultimaAtividade: serverTimestamp()
      });
      await registrarHistoricoCard(card.id, "edicao", {
        campos: mudancas.join(", ")
      });
      mostrarMensagem("Card atualizado.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao atualizar o card.", "erro");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoSalvar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// MARCAR CARD (perdida / finalizada)
// ------------------------------------------------------------
async function marcarCard(card, status) {
  const rotulo = status === "perdida" ? "perdida" : "finalizada";
  if (!window.confirm("Marcar este card como " + rotulo + "?")) return;

  try {
    await updateDoc(doc(db, "cards", card.id), {
      status: status,
      ultimaAtividade: serverTimestamp()
    });
    await registrarHistoricoCard(card.id, "marcacao", { status: status });

    // Move para a coluna vinculada, se configurada
    const colunaDestinoId = status === "perdida"
      ? configKanban.colunaPerdidaId
      : configKanban.colunaFinalizadaId;

    if (colunaDestinoId && colunaDestinoId !== card.colunaId) {
      const colunaDestino = cacheColunas.find((c) => c.id === colunaDestinoId);
      if (colunaDestino) {
        await updateDoc(doc(db, "cards", card.id), {
          colunaId: colunaDestinoId
        });
        await registrarHistoricoColuna(colunaDestinoId, "entrada", card, {
          colunaOrigemId: card.colunaId,
          colunaDestinoId: colunaDestinoId
        });
      }
    }

    mostrarMensagem("Card marcado como " + rotulo + ".", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao marcar o card.", "erro");
  }
}

// ------------------------------------------------------------
// EXCLUIR CARD (soft delete)
// ------------------------------------------------------------
async function excluirCard(card) {
  if (!window.confirm("Excluir o card de \"" + (card.nomeConta || "—") + "\"?\n\nEle continuará acessível em \"Ver excluídos\".")) return;

  try {
    await updateDoc(doc(db, "cards", card.id), {
      excluido: true,
      excluidoEm: serverTimestamp()
    });
    await registrarHistoricoCard(card.id, "exclusao", {});
    mostrarMensagem("Card excluído. Acesse em \"Ver excluídos\".", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao excluir o card.", "erro");
  }
}

// ------------------------------------------------------------
// PROGRAMAR MENSAGEM
// ------------------------------------------------------------
function abrirProgramacao(card, coluna) {
  const prog = card.programacao || {};
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Programar mensagem</h3>" +
    '<p class="texto-ajuda">Envio simulado nesta versão. O texto e as imagens ficam registrados no card.</p>' +
    "<label>Data do envio</label><input type='date' id='p-data'>" +
    "<label>Horário</label><input type='time' id='p-hora'>" +
    "<label>Mensagem</label><textarea id='p-texto'></textarea>" +
    "<label>Imagens (nomes dos arquivos)</label><input type='text' id='p-imagens' placeholder='foto1.jpg, foto2.png'>";

  if (prog.dataHora) {
    const d = new Date(prog.dataHora.seconds * 1000);
    caixa.querySelector("#p-data").value = d.toISOString().slice(0, 10);
    caixa.querySelector("#p-hora").value = d.toTimeString().slice(0, 5);
  }
  caixa.querySelector("#p-texto").value = prog.texto || "";
  caixa.querySelector("#p-imagens").value = (prog.imagens || []).join(", ");

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = prog.texto ? "Atualizar programação" : "Programar";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const data = caixa.querySelector("#p-data").value;
    const hora = caixa.querySelector("#p-hora").value;
    const texto = caixa.querySelector("#p-texto").value.trim();
    const imagensRaw = caixa.querySelector("#p-imagens").value.trim();

    if (!data || !hora) {
      mostrarMensagem("Informe data e horário.", "erro");
      return;
    }
    if (!texto) {
      mostrarMensagem("Escreva a mensagem.", "erro");
      return;
    }

    const dataHora = new Date(data + "T" + hora);
    const imagens = imagensRaw
      ? imagensRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    botaoSalvar.disabled = true;
    try {
      await updateDoc(doc(db, "cards", card.id), {
        programacao: {
          texto: texto,
          imagens: imagens,
          dataHora: dataHora,
          status: "aguardando_envio",
          programadoPor: usuarioAtual
        }
      });
      await registrarHistoricoCard(card.id, "programacao", {
        dataHora: dataHora.toLocaleString("pt-BR"),
        imagens: imagens.length
      });
      mostrarMensagem("Mensagem programada.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao programar a mensagem.", "erro");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoSalvar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// HISTÓRICO DO CARD
// ------------------------------------------------------------
async function abrirHistoricoCard(card) {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Histórico — " + (card.nomeConta || "card") + "</h3>" +
    '<p class="texto-ajuda">Carregando...</p>';

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);

  try {
    const snap = await getDocs(collection(db, "cards", card.id, "historico"));
    const eventos = [];
    snap.forEach((d) => eventos.push({ id: d.id, ...d.data() }));
    eventos.sort((a, b) => segundosDe(b.timestamp) - segundosDe(a.timestamp));

    const lista = document.createElement("div");
    if (eventos.length === 0) {
      lista.innerHTML = '<p class="texto-ajuda">Nenhum evento registrado.</p>';
    } else {
      eventos.forEach((ev) => lista.appendChild(criarCartaoEvento(ev)));
    }
    caixa.insertBefore(lista, botaoFechar);
  } catch (erro) {
    caixa.insertBefore(
      Object.assign(document.createElement("p"),
        { className: "texto-ajuda", textContent: "Erro ao carregar o histórico." }),
      botaoFechar
    );
  }
}

// ------------------------------------------------------------
// HISTÓRICO DA COLUNA
// ------------------------------------------------------------
async function abrirHistoricoColuna(coluna) {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Histórico — " + coluna.nome + "</h3>" +
    '<p class="texto-ajuda">Carregando...</p>';

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);

  try {
    const snap = await getDocs(collection(db, "colunas", coluna.id, "historico"));
    const eventos = [];
    snap.forEach((d) => eventos.push({ id: d.id, ...d.data() }));
    eventos.sort((a, b) => segundosDe(b.timestamp) - segundosDe(a.timestamp));

    const lista = document.createElement("div");
    if (eventos.length === 0) {
      lista.innerHTML = '<p class="texto-ajuda">Nenhum evento registrado.</p>';
    } else {
      eventos.forEach((ev) => lista.appendChild(criarCartaoEvento(ev)));
    }
    caixa.insertBefore(lista, botaoFechar);
  } catch (erro) {
    caixa.insertBefore(
      Object.assign(document.createElement("p"),
        { className: "texto-ajuda", textContent: "Erro ao carregar o histórico." }),
      botaoFechar
    );
  }
}

// ------------------------------------------------------------
// CARTÃO DE EVENTO (usado nos dois históricos)
// ------------------------------------------------------------
function criarCartaoEvento(ev) {
  const div = document.createElement("div");
  div.className = "cartao-evento evento-" + (ev.tipo || "edicao");

  const autor = ev.autor ? (ev.autor.nome || ev.autor.email) : "—";
  let descricao = "";

  switch (ev.tipo) {
    case "criacao": descricao = "Card criado"; break;
    case "edicao": descricao = "Editado: " + (ev.detalhes?.campos || "—"); break;
    case "movimentacao":
      descricao = "Movido de \"" + (ev.detalhes?.de || "—") + "\" para \"" + (ev.detalhes?.para || "—") + "\"";
      break;
    case "marcacao": descricao = "Marcado como " + (ev.detalhes?.status || "—"); break;
    case "acesso": descricao = "Conversa acessada"; break;
    case "programacao":
      descricao = "Mensagem programada para " + (ev.detalhes?.dataHora || "—");
      break;
    case "exclusao": descricao = "Card excluído"; break;
    case "entrada": descricao = "Card entrou na coluna"; break;
    case "saida": descricao = "Card saiu da coluna"; break;
    case "configuracao": descricao = "Configuração alterada"; break;
    default: descricao = ev.tipo || "Evento";
  }

  if (ev.automatico && ev.diretrizDe) {
    descricao += " (automático por diretriz de " + (ev.diretrizDe.nome || ev.diretrizDe.email) + ")";
  }

  div.innerHTML =
    '<div class="linha-evento-topo">' +
      '<span class="etiqueta-evento">' + (ev.tipo || "evento") + "</span>" +
      '<span class="hora-evento">' + formatarData(ev.timestamp) + "</span>" +
    "</div>" +
    "<div>" + descricao + "</div>" +
    '<div class="texto-ajuda">Por: ' + autor + "</div>";

  return div;
}

// ------------------------------------------------------------
// HISTÓRICO GLOBAL (mescla card + coluna)
// ------------------------------------------------------------
async function abrirHistoricoGlobal() {
  menuKanban.classList.remove("aberta");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Histórico geral</h3>" +
    '<p class="texto-ajuda">Carregando eventos de todas as colunas e cards...</p>';

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);

  try {
    const todos = [];

    for (const coluna of cacheColunas) {
      const snap = await getDocs(collection(db, "colunas", coluna.id, "historico"));
      snap.forEach((d) => {
        todos.push({ ...d.data(), _origem: "coluna", _nome: coluna.nome });
      });
    }

    for (const card of cacheCards) {
      const snap = await getDocs(collection(db, "cards", card.id, "historico"));
      snap.forEach((d) => {
        todos.push({ ...d.data(), _origem: "card", _nome: card.nomeConta });
      });
    }

    todos.sort((a, b) => segundosDe(b.timestamp) - segundosDe(a.timestamp));

    const lista = document.createElement("div");
    if (todos.length === 0) {
      lista.innerHTML = '<p class="texto-ajuda">Nenhum evento registrado.</p>';
    } else {
      todos.slice(0, 200).forEach((ev) => {
        const cartao = criarCartaoEvento(ev);
        const origem = document.createElement("div");
        origem.className = "texto-ajuda";
        origem.textContent = (ev._origem === "coluna" ? "Coluna: " : "Card: ") + (ev._nome || "—");
        cartao.insertBefore(origem, cartao.firstChild);
        lista.appendChild(cartao);
      });
    }

    const carregando = caixa.querySelector(".texto-ajuda");
    if (carregando) carregando.remove();
    caixa.insertBefore(lista, botaoFechar);
  } catch (erro) {
    const carregando = caixa.querySelector(".texto-ajuda");
    if (carregando) carregando.textContent = "Erro ao carregar o histórico.";
  }
}

// ------------------------------------------------------------
// VER EXCLUÍDOS
// ------------------------------------------------------------
function abrirExcluidos() {
  menuKanban.classList.remove("aberta");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Cards excluídos</h3>";

  if (cacheCardsExcluidos.length === 0) {
    caixa.innerHTML += '<p class="texto-ajuda">Nenhum card excluído.</p>';
  } else {
    cacheCardsExcluidos.forEach((card) => {
      const div = document.createElement("div");
      div.className = "card-excluido";
      div.innerHTML =
        "<strong>" + (card.nomeConta || "—") + "</strong><br>" +
        '<span class="texto-ajuda">' +
          (card.telefone || "—") + " · " + (card.email || "—") + "<br>" +
          "Excluído em: " + formatarData(card.excluidoEm) +
        "</span>";

      const botaoRestaurar = document.createElement("button");
      botaoRestaurar.textContent = "Restaurar";
      botaoRestaurar.className = "botao-modal";
      botaoRestaurar.addEventListener("click", async () => {
        try {
          await updateDoc(doc(db, "cards", card.id), {
            excluido: false,
            excluidoEm: null
          });
          await registrarHistoricoCard(card.id, "edicao", {
            campos: "Card restaurado"
          });
          mostrarMensagem("Card restaurado.", "sucesso");
          fecharModal();
        } catch (erro) {
          mostrarMensagem("Erro ao restaurar o card.", "erro");
        }
      });
      div.appendChild(botaoRestaurar);
      caixa.appendChild(div);
    });
  }

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// CONFIGURAÇÕES (vínculo Perdida/Finalizada)
// ------------------------------------------------------------
function abrirConfiguracoes() {
  menuKanban.classList.remove("aberta");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";

  let opcoesPerdida = '<option value="">Nenhuma</option>';
  let opcoesFinalizada = '<option value="">Nenhuma</option>';

  cacheColunas.forEach((c) => {
    const selP = configKanban.colunaPerdidaId === c.id ? " selected" : "";
    const selF = configKanban.colunaFinalizadaId === c.id ? " selected" : "";
    opcoesPerdida += '<option value="' + c.id + '"' + selP + ">" + c.nome + "</option>";
    opcoesFinalizada += '<option value="' + c.id + '"' + selF + ">" + c.nome + "</option>";
  });

  caixa.innerHTML =
    "<h3>Configurações</h3>" +
    '<p class="texto-ajuda">Vincule colunas às marcações. Ao marcar um card, ele será movido automaticamente.</p>' +
    "<label>Coluna para cards \"Perdida\"</label>" +
    '<select id="cfg-perdida">' + opcoesPerdida + "</select>" +
    "<label>Coluna para cards \"Finalizada\"</label>" +
    '<select id="cfg-finalizada">' + opcoesFinalizada + "</select>";

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Salvar";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const colunaPerdidaId = caixa.querySelector("#cfg-perdida").value;
    const colunaFinalizadaId = caixa.querySelector("#cfg-finalizada").value;

    botaoSalvar.disabled = true;
    try {
      const { setDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      await setDoc(doc(db, "configuracoes", "kanban"), {
        colunaPerdidaId,
        colunaFinalizadaId,
        atualizadoPor: usuarioAtual,
        atualizadoEm: serverTimestamp()
      });
      mostrarMensagem("Configurações salvas.", "sucesso");
      fecharModal();
    } catch (erro) {
      mostrarMensagem("Erro ao salvar as configurações.", "erro");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linha = document.createElement("div");
  linha.className = "linha-botoes-modal";
  linha.appendChild(botaoCancelar);
  linha.appendChild(botaoSalvar);
  caixa.appendChild(linha);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// LIGAÇÕES DOS ITENS DO MENU SANDUÍCHE
// ------------------------------------------------------------
itemExcluidos.addEventListener("click", abrirExcluidos);
itemHistoricoGlobal.addEventListener("click", abrirHistoricoGlobal);
itemConfiguracoes.addEventListener("click", abrirConfiguracoes);
itemCardTeste.addEventListener("click", () => {
  menuKanban.classList.remove("aberta");
  gerarCardAleatorio();
});

// ------------------------------------------------------------
// FECHAR MODAL AO CLICAR FORA
// ------------------------------------------------------------
modalOverlay.addEventListener("click", (evento) => {
  if (evento.target === modalOverlay) fecharModal();
});