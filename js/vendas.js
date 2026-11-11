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

import {
  iniciarLayoutBase,
  aplicarPermissoesSidebar,
  obterDadosUsuario,
  atualizarCabecalhoUsuario
} from "./layout-base.js";
import { substituirIcones } from "./icones.js";

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
let cargoAtual = null;
let ehAdmin = false;
let termoBusca = "";
let filtroPrioridadeSelecionada = "";
let ordenacaoColunas = {};
try {
  const salvo = localStorage.getItem("golden_ordenacao_colunas");
  if (salvo) ordenacaoColunas = JSON.parse(salvo);
} catch (e) {}
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
const botaoPerfil = document.getElementById("botao-perfil");
const menuPerfil = document.getElementById("menu-perfil");
const itemSair = document.getElementById("item-sair");
const buscaCard = document.getElementById("campo-busca") || document.getElementById("busca-card");
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
  if (!timestamp) return 0;
  if (typeof timestamp.seconds === "number") return timestamp.seconds;
  if (typeof timestamp.toDate === "function") return Math.floor(timestamp.toDate().getTime() / 1000);
  if (timestamp instanceof Date) return Math.floor(timestamp.getTime() / 1000);
  if (typeof timestamp === "number") {
    return timestamp > 1e11 ? Math.floor(timestamp / 1000) : timestamp;
  }
  const d = new Date(timestamp);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  return 0;
}

function abrirModal(caixa) {
  modalConteudo.innerHTML = "";
  const scrollWrapper = document.createElement("div");
  scrollWrapper.className = "modal-scroll";
  scrollWrapper.appendChild(caixa);
  modalConteudo.appendChild(scrollWrapper);

  const scrollEl = modalConteudo.querySelector(".modal-scroll");
  if (scrollEl) {
    const barraAntiga = modalConteudo.querySelector(".barra-custom-wrapper");
    if (barraAntiga) barraAntiga.remove();
    montarBarraCustomizada(scrollEl);
  }

  modalOverlay.style.display = "flex";

  requestAnimationFrame(() => {
    const scrollEl = modalConteudo.querySelector(".modal-scroll");
    if (scrollEl) {
      const barra = modalConteudo.querySelector(".barra-custom-wrapper");
      if (barra) {
        const alturaVisivel = scrollEl.clientHeight;
        const alturaTotal = scrollEl.scrollHeight;
        if (alturaTotal > alturaVisivel + 4) {
          barra.classList.add("visivel");
        }
      }
    }
  });
  scrollWrapper.scrollTop = 0;
}

function fecharModal() {
  fecharCalendarioFofo();
  modalOverlay.style.display = "none";
  modalConteudo.innerHTML = "";
  modalConteudo.classList.remove("modal-conteudo-largo");
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
  cargoAtual = null;

  if (!autorizado) {
    const resultado = await usuarioTemCargoAutorizado(email);
    autorizado = resultado.autorizado;
    cargoAtual = resultado.cargo;
  } else {
    const resultado = await usuarioTemCargoAutorizado(email);
    cargoAtual = resultado.cargo || "administracao";
  }

  if (!autorizado) {
    conteudoProtegido.classList.remove("oculto");
    acessoNegado.style.display = "block";
    return;
  }

  ehAdmin = ehAdminEmail || cargoAtual === "administracao";

  const dadosUsuario = await obterDadosUsuario(usuario, db);
  usuarioAtual = {
    uid: usuario.uid,
    email: usuario.email,
    nome: dadosUsuario.nomeCompleto
  };

  conteudoProtegido.classList.remove("oculto");
  iniciarLayoutBase();
  aplicarPermissoesSidebar(cargoAtual, ehAdmin);
  atualizarCabecalhoUsuario(dadosUsuario);
  conteudoVendas.classList.remove("oculto");

  if (ehAdmin) {
    itemCardTeste.style.display = "";
  }

  escutarColunas();
  escutarCards();
  escutarConfiguracoes();
  iniciarSistemaReordenacao();
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
    const dados = await obterDadosUsuario({ email }, db);
    return dados.nomeCompleto;
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

    const sequenciaCores = ["lilas", "amarelo", "verde"];
    cacheColunas.forEach((coluna, indice) => {
      if (!coluna.cor) {
        coluna.cor = sequenciaCores[indice % sequenciaCores.length];
        updateDoc(doc(db, "colunas", coluna.id), { cor: coluna.cor }).catch(() => {});
      }
    });

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

setInterval(verificarEnviosDeColuna, 30000);

// ------------------------------------------------------------
// RENDERIZAR O KANBAN COMPLETO
// ------------------------------------------------------------
let renderizacaoPendente = false;

function renderizarKanban() {
  if (arrastoAtivo) {
    renderizacaoPendente = true;
    return;
  }

  if (cacheColunas.length === 0) {
    kanban.innerHTML =
      '<p class="texto-ajuda">Nenhuma coluna criada ainda. Clique em "Nova coluna" para começar.</p>';
    return;
  }

  kanban.innerHTML = "";

  cacheColunas.forEach((coluna) => {
    kanban.appendChild(criarColuna(coluna));
  });

  sincronizarAlturaColunas();
  atualizarArredondamentoCabecalhos();
}

// Garante que todas as .coluna tenham a mesma altura total de rolagem
// do .kanban, mantendo todos os .cabecalho-coluna (sticky) sempre visíveis
// mesmo nas colunas curtas ou vazias, sem esticar o fundo visual (.corpo-coluna).
function sincronizarAlturaColunas() {
  const colunas = Array.from(kanban.querySelectorAll(".coluna"));
  if (colunas.length === 0) return;

  colunas.forEach((c) => {
    c.style.minHeight = "";
  });

  let maiorAltura = kanban.clientHeight;
  colunas.forEach((c) => {
    const cab = c.querySelector(".cabecalho-coluna");
    const corpo = c.querySelector(".corpo-coluna");
    const h = (cab ? cab.offsetHeight : 0) + (corpo ? corpo.offsetHeight : 0) + 5;
    if (h > maiorAltura) maiorAltura = h;
  });

  colunas.forEach((c) => {
    c.style.minHeight = maiorAltura + "px";
  });
}

// Arredonda os cantos inferiores do cabeçalho da coluna apenas quando
// nenhum pedaço do corpo dos cards está visível abaixo dele na rolagem.
function atualizarArredondamentoCabecalhos() {
  const colunas = kanban.querySelectorAll(".coluna");
  colunas.forEach((col) => {
    const cab = col.querySelector(".cabecalho-coluna");
    const corpo = col.querySelector(".corpo-coluna");
    if (!cab || !corpo) return;

    const cabRect = cab.getBoundingClientRect();
    const corpoRect = corpo.getBoundingClientRect();

    // Se o fundo do corpo não ultrapassa o fundo do cabeçalho,
    // apenas o cabeçalho está visível nesta rolagem.
    const soCabecalhoVisivel = corpoRect.bottom <= (cabRect.bottom + 2);

    if (soCabecalhoVisivel) {
      cab.classList.add("cabecalho-isolado");
    } else {
      cab.classList.remove("cabecalho-isolado");
    }
  });
}

window.addEventListener("resize", () => {
  sincronizarAlturaColunas();
  atualizarArredondamentoCabecalhos();
  if (cardArrastado && colunaFantasmaAtual) {
    atualizarPosicaoFantasma(colunaFantasmaAtual);
  }
});

// ------------------------------------------------------------
// CRIAR ELEMENTO DE COLUNA
// ------------------------------------------------------------
function criarColuna(coluna) {
  const cardsDaColuna = cardsFiltradosDaColuna(coluna.id);

  const div = document.createElement("div");
  div.className = "coluna" + (coluna.tipo === "funcionaria" ? " coluna-funcionaria" : "");
  div.dataset.colunaId = coluna.id;
  div.dataset.cor = coluna.cor || "lilas";

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
  botaoPontos.innerHTML = '<span data-icone="tres_pontos" data-tamanho="14"></span>';
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

  // Drag and drop na coluna inteira (cobre cabeçalho, corpo e área abaixo da coluna)
  const aoArrastarSobre = (evento) => {
    if (!cardArrastado) return;
    if (coluna.id === colunaArrastada) {
      limparDestaquesArrastoCard();
      return;
    }
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    destacarColunaAlvo(div);
    mostrarColunaFantasma(div, evento.clientY);
  };

  const aoSairDaColuna = (evento) => {
    if (div.contains(evento.relatedTarget)) return;
    div.classList.remove("arrastando-sobre");
    if (colunaFantasmaAtual === div) {
      esconderColunaFantasma();
    }
  };

  const aoSoltarNaColuna = async (evento) => {
    if (!cardArrastado) return;
    evento.preventDefault();
    evento.stopPropagation();
    const idCard = cardArrastado;
    const idOrigem = colunaArrastada;
    cardArrastado = null;
    colunaArrastada = null;
    limparDestaquesArrastoCard();
    if (coluna.id && coluna.id !== idOrigem) {
      await moverCard(idCard, coluna.id);
    }
  };

  corpo.addEventListener("dragover", aoArrastarSobre);
  corpo.addEventListener("dragleave", aoSairDaColuna);
  corpo.addEventListener("drop", aoSoltarNaColuna);

  div.addEventListener("dragover", aoArrastarSobre);
  div.addEventListener("dragleave", aoSairDaColuna);
  div.addEventListener("drop", aoSoltarNaColuna);

  div.appendChild(corpo);
  substituirIcones(div);
  return div;
}

// ------------------------------------------------------------
// CARDS FILTRADOS DA COLUNA (aplica busca + ordenação)
// ------------------------------------------------------------
function cardsFiltradosDaColuna(colunaId) {
  let lista = cacheCards.filter((c) => c.colunaId === colunaId);

  if (filtroPrioridadeSelecionada) {
    lista = lista.filter(
      (c) => (c.prioridade || "").toLowerCase() === filtroPrioridadeSelecionada.toLowerCase()
    );
  }

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

  const modo = ordenacaoColunas[colunaId] || "padrao";

  if (modo === "prioridade") {
    // Organiza os cards da coluna da prioridade Alta, para Média, para Sem Marcação, para Baixa
    const peso = {
      alta: 1,
      media: 2,
      "": 3,
      baixa: 4
    };
    lista.sort((a, b) => {
      const pa = (a.prioridade || "").toLowerCase();
      const pb = (b.prioridade || "").toLowerCase();
      const pesoA = peso[pa] !== undefined ? peso[pa] : 3;
      const pesoB = peso[pb] !== undefined ? peso[pb] : 3;
      if (pesoA !== pesoB) {
        return pesoA - pesoB;
      }
      return segundosDe(b.ultimaAtividade || b.criadoEm) - segundosDe(a.ultimaAtividade || a.criadoEm);
    });
  } else if (modo === "nome") {
    // Organiza os cards da coluna pelo nome
    lista.sort((a, b) => {
      const nomeA = (a.nomeConta || "").trim();
      const nomeB = (b.nomeConta || "").trim();
      return nomeA.localeCompare(nomeB, "pt-BR", { sensitivity: "base" });
    });
  } else if (modo === "tempo") {
    // Organiza a ordem dos cards do card mais antigo para o card mais novo
    lista.sort((a, b) => {
      const tempoA = segundosDe(a.iniciadoEm || a.criadoEm || a.ultimaAtividade);
      const tempoB = segundosDe(b.iniciadoEm || b.criadoEm || b.ultimaAtividade);
      return tempoA - tempoB;
    });
  } else {
    // Padrão: mais recente primeiro
    lista.sort((a, b) =>
      segundosDe(b.ultimaAtividade || b.criadoEm) -
      segundosDe(a.ultimaAtividade || a.criadoEm)
    );
  }

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

  // Linha do nome do cliente + aviso de prioridade
  const linhaNome = document.createElement("div");
  linhaNome.className = "linha-nome-cliente";

  const nome = document.createElement("p");
  nome.className = "nome-cliente";
  nome.textContent = card.nomeConta || "Sem nome";
  linhaNome.appendChild(nome);

  if (card.prioridade) {
    const p = card.prioridade.toLowerCase();
    const avisoPrioridade = document.createElement("span");
    avisoPrioridade.className = "aviso-prioridade aviso-prioridade-" + p;
    avisoPrioridade.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    linhaNome.appendChild(avisoPrioridade);
  }

  div.appendChild(linhaNome);

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

  // Descrição oculta (abaixo do valor)
  if (card.descricao) {
    const rotulo = document.createElement("div");
    rotulo.className = "linha-info linha-descricao";
    const rotuloForte = document.createElement("strong");
    rotuloForte.textContent = "Descrição:";
    const rotuloTexto = document.createElement("span");
    rotuloTexto.className = "rotulo-descricao";
    rotuloTexto.textContent = "Ver descrição";
    rotulo.appendChild(rotuloForte);
    rotulo.appendChild(rotuloTexto);

    const texto = document.createElement("p");
    texto.className = "texto-descricao";
    texto.textContent = card.descricao;

    rotuloTexto.addEventListener("click", () => {
      texto.classList.toggle("visivel");
      rotuloTexto.textContent = texto.classList.contains("visivel")
        ? "Ocultar descrição" : "Ver descrição";
      sincronizarAlturaColunas();
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
  botaoEditar.innerHTML = '<span data-icone="editar" data-tamanho="12"></span> Editar';
  botaoEditar.addEventListener("click", () => abrirEdicaoCard(card));
  rodape.appendChild(botaoEditar);

  const botaoAcessar = document.createElement("button");
  botaoAcessar.type = "button";
  botaoAcessar.className = "botao-card botao-card-primario";
  botaoAcessar.innerHTML = '<span data-icone="acessar" data-tamanho="12"></span> Acessar';
  botaoAcessar.addEventListener("click", () => acessarConversa(card));
  rodape.appendChild(botaoAcessar);

  div.appendChild(rodape);
  substituirIcones(div);

  // Botão de programar (só em coluna funcionária)
  if (coluna.tipo === "funcionaria") {
    const botaoProgramar = document.createElement("button");
    botaoProgramar.type = "button";
    botaoProgramar.className = "botao-programar";
    const jaProgramado = card.programacao && card.programacao.status !== "enviado";
    if (jaProgramado) {
      botaoProgramar.classList.add("programado");
      botaoProgramar.innerHTML = '<span data-icone="relogio" data-tamanho="12"></span> Aguardando envio';
    } else {
      botaoProgramar.innerHTML = '<span data-icone="calendario" data-tamanho="12"></span> Programar mensagem';
    }
    botaoProgramar.addEventListener("click", () => abrirProgramacao(card, coluna));
    div.appendChild(botaoProgramar);
  }

  // Drag
  let cardFlutuante = null;
  let deslocamentoX = 0;
  let deslocamentoY = 0;

  div.addEventListener("dragstart", (evento) => {
    cardArrastado = card.id;
    colunaArrastada = coluna.id;
    evento.dataTransfer.effectAllowed = "move";
    evento.dataTransfer.setData("text/plain", card.id);

    const rect = div.getBoundingClientRect();

    cardFlutuante = div.cloneNode(true);
    cardFlutuante.classList.remove("arrastando");
    cardFlutuante.classList.add("card-flutuante-arrasto");
    cardFlutuante.style.width = rect.width + "px";
    cardFlutuante.style.height = rect.height + "px";
    cardFlutuante.style.left = rect.left + "px";
    cardFlutuante.style.top = rect.top + "px";
    document.body.appendChild(cardFlutuante);

    deslocamentoX = evento.clientX - rect.left;
    deslocamentoY = evento.clientY - rect.top;

    // Imagem de arrasto invisível: desliga o fantasma nativo do navegador.
    const vazio = document.createElement("div");
    vazio.style.width = "1px";
    vazio.style.height = "1px";
    vazio.style.opacity = "0";
    document.body.appendChild(vazio);
    evento.dataTransfer.setDragImage(vazio, 0, 0);
    setTimeout(() => vazio.remove(), 0);

    requestAnimationFrame(() => {
      div.classList.add("arrastando");
    });
  });

  div.addEventListener("drag", (evento) => {
    if (!cardFlutuante) return;
    if (evento.clientX === 0 && evento.clientY === 0) return;
    cardFlutuante.style.left = (evento.clientX - deslocamentoX) + "px";
    cardFlutuante.style.top = (evento.clientY - deslocamentoY) + "px";
  });

  div.addEventListener("dragend", () => {
    div.classList.remove("arrastando");
    if (cardFlutuante) {
      cardFlutuante.remove();
      cardFlutuante = null;
    }
    cardArrastado = null;
    colunaArrastada = null;
    limparDestaquesArrastoCard();
  });

  substituirIcones(div);
  return div;
}

function criarLinhaInfo(rotulo, valor) {
  const linha = document.createElement("div");
  linha.className = "linha-info";
  linha.innerHTML = "<strong>" + rotulo + ":</strong> " + valor;
  return linha;
}

// ------------------------------------------------------------
// COLUNA FANTASMA
// Aparece durante o arrasto de um card sobre a faixa horizontal
// de qualquer coluna (inclusive no espaço vazio abaixo de colunas
// curtas). Reaproveita um único elemento .coluna-fantasma no DOM.
// ------------------------------------------------------------

let colunaFantasma = null;
let colunaFantasmaAtual = null;

function obterCorDaColuna(colunaEl) {
  if (!colunaEl) return "lilas";
  return colunaEl.dataset.cor || "lilas";
}

function destacarColunaAlvo(colunaEl) {
  document.querySelectorAll(".coluna.arrastando-sobre").forEach((c) => {
    if (c !== colunaEl) c.classList.remove("arrastando-sobre");
  });
  if (colunaEl) colunaEl.classList.add("arrastando-sobre");
}

function limparDestaquesArrastoCard() {
  esconderColunaFantasma();
  document.querySelectorAll(".coluna").forEach((c) =>
    c.classList.remove("arrastando-sobre")
  );
}

function obterColunaNaFaixaHorizontal(clientX) {
  const colunas = Array.from(kanban.querySelectorAll(".coluna"));
  for (const col of colunas) {
    const rect = col.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      return col;
    }
  }
  return null;
}

function mostrarColunaFantasma(colunaEl, clientY) {
  if (!cardArrastado || !colunaEl) return;
  if (colunaEl.dataset.colunaId === colunaArrastada) {
    esconderColunaFantasma();
    return;
  }

  const corpo = colunaEl.querySelector(".corpo-coluna");
  const temCards = corpo ? !!corpo.querySelector(".card-conversa") : false;
  const kanbanRect = kanban.getBoundingClientRect();
  const corpoRect = corpo ? corpo.getBoundingClientRect() : colunaEl.getBoundingClientRect();
  const cabecalho = colunaEl.querySelector(".cabecalho-coluna");
  const cabRect = cabecalho ? cabecalho.getBoundingClientRect() : colunaEl.getBoundingClientRect();
  const margemVertical = 12;

  // O topo de referência NUNCA pode ficar acima da base do cabeçalho (.cabecalho-coluna).
  // Se houver rolagem vertical ou se apenas o topo da coluna aparecer, a fantasma
  // começará sempre estritamente abaixo do cabeçalho.
  const topoMinimo = cabRect ? cabRect.bottom : colunaEl.getBoundingClientRect().top;
  const topoReferencia = temCards ? Math.max(topoMinimo, corpoRect.bottom) : topoMinimo;

  // Se o cursor estiver sobre o cabeçalho ou sobre os cards, não exibimos a fantasma
  if (typeof clientY === "number" && clientY <= topoReferencia) {
    esconderColunaFantasma();
    return;
  }

  const topo = Math.max(topoReferencia, kanbanRect.top) + margemVertical;
  const base = kanbanRect.bottom - margemVertical;
  const altura = base - topo;

  if (altura < 30) {
    esconderColunaFantasma();
    return;
  }

  if (!colunaFantasma) {
    colunaFantasma = document.createElement("div");
    colunaFantasma.className = "coluna-fantasma";
  }

  if (!colunaFantasma.parentElement) {
    document.body.appendChild(colunaFantasma);
  }

  colunaFantasma.dataset.cor = obterCorDaColuna(colunaEl);
  colunaFantasmaAtual = colunaEl;
  atualizarPosicaoFantasma(colunaEl);
}

function atualizarPosicaoFantasma(colunaEl) {
  if (!colunaFantasma || !colunaEl) return;

  const colRect = colunaEl.getBoundingClientRect();
  const cabecalho = colunaEl.querySelector(".cabecalho-coluna");
  const corpo = colunaEl.querySelector(".corpo-coluna");
  const kanbanRect = kanban.getBoundingClientRect();

  const cabRect = cabecalho ? cabecalho.getBoundingClientRect() : colRect;
  const corpoRect = corpo ? corpo.getBoundingClientRect() : colRect;
  const temCards = corpo ? !!corpo.querySelector(".card-conversa") : false;

  // Espaço de respiro para não colar nos elementos em tela:
  // 10px nos lados e 12px no topo e na parte inferior
  const margemHorizontal = 10;
  const margemVertical = 12;

  const esquerda = Math.max(colRect.left, kanbanRect.left) + margemHorizontal;
  const direita = Math.min(colRect.right, kanbanRect.right) - margemHorizontal;
  const largura = Math.max(0, direita - esquerda);

  // A área fantasma inicia abaixo dos cards (se visíveis) ou estritamente abaixo do cabeçalho
  const topoMinimo = cabRect ? cabRect.bottom : colRect.top;
  const topoReferencia = temCards ? Math.max(topoMinimo, corpoRect.bottom) : topoMinimo;
  const topo = Math.max(topoReferencia, kanbanRect.top) + margemVertical;
  const base = kanbanRect.bottom - margemVertical;
  const altura = base - topo;

  if (altura < 30) {
    esconderColunaFantasma();
    return;
  }

  colunaFantasma.style.left = esquerda + "px";
  colunaFantasma.style.top = topo + "px";
  colunaFantasma.style.width = largura + "px";
  colunaFantasma.style.height = altura + "px";
}

function esconderColunaFantasma() {
  if (colunaFantasma && colunaFantasma.parentElement) {
    colunaFantasma.remove();
  }
  colunaFantasmaAtual = null;
}

kanban.addEventListener("dragover", (evento) => {
  if (!cardArrastado) return;
  const col = obterColunaNaFaixaHorizontal(evento.clientX);
  if (col && col.dataset.colunaId !== colunaArrastada) {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    destacarColunaAlvo(col);
    mostrarColunaFantasma(col, evento.clientY);
  } else {
    limparDestaquesArrastoCard();
  }
});

kanban.addEventListener("dragleave", (evento) => {
  if (kanban.contains(evento.relatedTarget)) return;
  limparDestaquesArrastoCard();
});

kanban.addEventListener("drop", async (evento) => {
  if (!cardArrastado) return;
  const col = obterColunaNaFaixaHorizontal(evento.clientX) || colunaFantasmaAtual;
  if (!col) return;
  evento.preventDefault();
  const idCard = cardArrastado;
  const idOrigem = colunaArrastada;
  cardArrastado = null;
  colunaArrastada = null;
  limparDestaquesArrastoCard();
  if (col.dataset.colunaId && col.dataset.colunaId !== idOrigem) {
    await moverCard(idCard, col.dataset.colunaId);
  }
});

kanban.addEventListener("scroll", () => {
  if (cardArrastado && colunaFantasmaAtual) {
    atualizarPosicaoFantasma(colunaFantasmaAtual);
  }
  atualizarArredondamentoCabecalhos();
});

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && cardArrastado) {
    cardArrastado = null;
    colunaArrastada = null;
    limparDestaquesArrastoCard();
  }
});

// ------------------------------------------------------------
// BUSCA E FILTROS EM TEMPO REAL
// ------------------------------------------------------------
buscaCard.addEventListener("input", () => {
  termoBusca = buscaCard.value.trim();
  renderizarKanban();
});

const filtroPrioridade = document.getElementById("filtro-prioridade");
const wrapperFiltroPrioridade = document.getElementById("wrapper-filtro-prioridade");
const botaoFiltroPrioridade = document.getElementById("botao-filtro-prioridade");
const dropdownFiltroPrioridade = document.getElementById("dropdown-filtro-prioridade");
const textoFiltroPrioridade = document.getElementById("texto-filtro-prioridade");

function fecharDropdownPrioridade() {
  if (!dropdownFiltroPrioridade) return;
  dropdownFiltroPrioridade.style.display = "none";
  if (botaoFiltroPrioridade) {
    botaoFiltroPrioridade.classList.remove("aberto");
    botaoFiltroPrioridade.setAttribute("aria-expanded", "false");
  }
}

function abrirDropdownPrioridade() {
  if (!dropdownFiltroPrioridade || !botaoFiltroPrioridade) return;
  dropdownFiltroPrioridade.style.display = "block";
  botaoFiltroPrioridade.classList.add("aberto");
  botaoFiltroPrioridade.setAttribute("aria-expanded", "true");
  substituirIcones(dropdownFiltroPrioridade);
}

function alternarDropdownPrioridade(evento) {
  if (evento) evento.stopPropagation();
  if (!dropdownFiltroPrioridade) return;
  const estaAberto = dropdownFiltroPrioridade.style.display !== "none";
  if (estaAberto) {
    fecharDropdownPrioridade();
  } else {
    if (menuKanban) menuKanban.classList.remove("aberta");
    if (menuPerfil) menuPerfil.classList.remove("aberta");
    fecharMenuOpcoes();
    abrirDropdownPrioridade();
  }
}

function selecionarPrioridadeFiltro(valor) {
  filtroPrioridadeSelecionada = (valor || "").trim();
  if (filtroPrioridade) {
    filtroPrioridade.value = filtroPrioridadeSelecionada;
  }

  // Atualizar visual do botão gatilho
  if (botaoFiltroPrioridade) {
    botaoFiltroPrioridade.classList.remove("ativo-alta", "ativo-media", "ativo-baixa");
    if (filtroPrioridadeSelecionada === "alta") {
      botaoFiltroPrioridade.classList.add("ativo-alta");
      if (textoFiltroPrioridade) textoFiltroPrioridade.textContent = "Alta";
    } else if (filtroPrioridadeSelecionada === "media") {
      botaoFiltroPrioridade.classList.add("ativo-media");
      if (textoFiltroPrioridade) textoFiltroPrioridade.textContent = "Média";
    } else if (filtroPrioridadeSelecionada === "baixa") {
      botaoFiltroPrioridade.classList.add("ativo-baixa");
      if (textoFiltroPrioridade) textoFiltroPrioridade.textContent = "Baixa";
    } else {
      if (textoFiltroPrioridade) textoFiltroPrioridade.textContent = "Prioridade";
    }
  }

  // Atualizar seleção no dropdown
  if (dropdownFiltroPrioridade) {
    dropdownFiltroPrioridade.querySelectorAll(".item-prioridade-drop").forEach((btn) => {
      const at = (btn.dataset.valor || "") === filtroPrioridadeSelecionada;
      btn.classList.toggle("ativo", at);
    });
  }

  fecharDropdownPrioridade();
  renderizarKanban();
}

if (botaoFiltroPrioridade) {
  botaoFiltroPrioridade.addEventListener("click", alternarDropdownPrioridade);
}

if (dropdownFiltroPrioridade) {
  dropdownFiltroPrioridade.querySelectorAll(".item-prioridade-drop").forEach((btn) => {
    btn.addEventListener("click", (evento) => {
      evento.stopPropagation();
      selecionarPrioridadeFiltro(btn.dataset.valor || "");
    });
  });
}

if (filtroPrioridade) {
  filtroPrioridade.addEventListener("change", () => {
    selecionarPrioridadeFiltro(filtroPrioridade.value.trim());
  });
}

// ------------------------------------------------------------
// MENUS FLUTUANTES
// ------------------------------------------------------------
botaoMenuKanban.addEventListener("click", () => {
  fecharDropdownPrioridade();
  menuKanban.classList.toggle("aberta");
});

document.addEventListener("click", (evento) => {
  if (!menuKanban.contains(evento.target) && !botaoMenuKanban.contains(evento.target)) {
    menuKanban.classList.remove("aberta");
  }
  if (wrapperFiltroPrioridade && !wrapperFiltroPrioridade.contains(evento.target)) {
    fecharDropdownPrioridade();
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

async function concluirMensagemColuna(card, coluna) {
  const cfg = coluna.configFuncionaria || {};
  if (!cfg.colunaDestinoId) {
    mostrarMensagem("A coluna não tem destino configurado.", "erro");
    return;
  }
  if (!window.confirm(
    "Marcar a mensagem desta coluna como entregue para este card?"
  )) return;

  try {
    await updateDoc(doc(db, "cards", card.id), {
      entregaColunaEm: serverTimestamp(),
      ultimaAtividade: serverTimestamp()
    });
    await registrarHistoricoCard(card.id, "programacao", {
      dataHora: "mensagem da coluna entregue manualmente"
    });
    mostrarMensagem("Mensagem da coluna marcada como entregue.", "sucesso");
    await avaliarGatilhoConclusao(card.id);
  } catch (erro) {
    mostrarMensagem("Erro ao concluir a mensagem da coluna.", "erro");
  }
}

async function avaliarGatilhoConclusao(cardId) {
  const card = cacheCards.find((c) => c.id === cardId);
  if (!card) return;

  const coluna = cacheColunas.find((c) => c.id === card.colunaId);
  if (!coluna || coluna.tipo !== "funcionaria") return;

  const cfg = coluna.configFuncionaria || {};
  if (!cfg.colunaDestinoId) return;

  const precisaColuna = cfg.moverAposMensagemColuna === true;
  const precisaCard = cfg.moverAposMensagemCard === true;

  const colunaEntregue = !!card.entregaColunaEm;
  const cardEntregue = !!(card.programacao && card.programacao.status === "enviado");

  const condicaoColuna = !precisaColuna || colunaEntregue;
  const condicaoCard = !precisaCard || cardEntregue;

  if (!condicaoColuna || !condicaoCard) return;

  const destino = cacheColunas.find((c) => c.id === cfg.colunaDestinoId);
  if (!destino) return;

  try {
    await updateDoc(doc(db, "cards", cardId), {
      colunaId: cfg.colunaDestinoId,
      entregaColunaEm: null,
      ultimaAtividade: serverTimestamp()
    });
    await registrarHistoricoCard(cardId, "movimentacao", {
      de: coluna.nome,
      para: destino.nome
    });
    await registrarHistoricoColuna(cfg.colunaDestinoId, "entrada", card, {
      colunaOrigemId: coluna.id,
      colunaDestinoId: cfg.colunaDestinoId
    });
    await registrarHistoricoColuna(coluna.id, "saida", card, {
      colunaOrigemId: coluna.id,
      colunaDestinoId: cfg.colunaDestinoId
    });
    mostrarMensagem("Card movido automaticamente para " + destino.nome + ".", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao mover o card automaticamente.", "erro");
  }
}

async function concluirMensagemCard(card) {
  if (!window.confirm("Marcar a mensagem deste card como enviada?")) return;
  try {
    await updateDoc(doc(db, "cards", card.id), {
      programacao: {
        ...card.programacao,
        status: "enviado",
        enviadoEm: serverTimestamp()
      },
      ultimaAtividade: serverTimestamp()
    });
    await registrarHistoricoCard(card.id, "programacao", {
      dataHora: "mensagem do card marcada como enviada"
    });
    mostrarMensagem("Mensagem do card marcada como enviada.", "sucesso");
    await avaliarGatilhoConclusao(card.id);
  } catch (erro) {
    mostrarMensagem("Erro ao concluir a mensagem do card.", "erro");
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
    { icone: "editar", texto: "Editar nome/descrição", acao: () => abrirEdicaoColuna(coluna) },
    { icone: "ordenar", texto: "Ordenar", acao: () => abrirMenuOrdenacaoColuna(botao, coluna) },
    { icone: "historico", texto: "Ver histórico", acao: () => abrirHistoricoColuna(coluna) }
  ];

  if (coluna.tipo === "funcionaria") {
    opcoes.push({
      icone: "config",
      texto: "Configurar função",
      acao: () => abrirConfiguracaoFuncionaria(coluna)
    });
  }

  // Divisor antes da exclusão
  opcoes.push({ divisor: true });

  if (ehAdmin) {
    opcoes.push({
      icone: "lixeira",
      texto: "Excluir coluna",
      acao: () => excluirColuna(coluna),
      classe: "opcao-perigosa"
    });
  } else {
    opcoes.push({
      icone: "saida",
      texto: "Solicitar exclusão",
      acao: () => solicitarExclusaoColuna(coluna)
    });
  }

  opcoes.forEach((opcao) => {
    if (opcao.divisor) {
      const divisor = document.createElement("div");
      divisor.className = "divisor-menu-opcoes";
      menu.appendChild(divisor);
      return;
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "item-opcao" + (opcao.classe ? " " + opcao.classe : "");

    const spanIcone = document.createElement("span");
    spanIcone.dataset.icone = opcao.icone || "tres_pontos";
    spanIcone.dataset.tamanho = "13";
    item.appendChild(spanIcone);

    const spanTexto = document.createElement("span");
    spanTexto.className = "texto-opcao";
    spanTexto.textContent = opcao.texto;
    item.appendChild(spanTexto);

    item.addEventListener("click", () => {
      fecharMenuOpcoes();
      opcao.acao();
    });
    menu.appendChild(item);
  });

  substituirIcones(menu);
  document.body.appendChild(menu);
  const rect = botao.getBoundingClientRect();
  const larguraMenu = 200;
  let esquerda = rect.right - larguraMenu;
  if (esquerda < 8) esquerda = 8;
  if (esquerda + larguraMenu > window.innerWidth - 8) {
    esquerda = window.innerWidth - larguraMenu - 8;
  }
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = esquerda + "px";
}

// ------------------------------------------------------------
// MENU DE ORDENAÇÃO DA COLUNA
// ------------------------------------------------------------
function abrirMenuOrdenacaoColuna(botao, coluna) {
  fecharMenuOpcoes();
  const menu = document.createElement("div");
  menu.id = "menu-opcoes";
  menu.className = "menu-opcoes menu-opcoes-ordenar";

  const cabecalhoVoltar = document.createElement("button");
  cabecalhoVoltar.type = "button";
  cabecalhoVoltar.className = "item-opcao item-opcao-voltar";
  cabecalhoVoltar.innerHTML = '<span data-icone="recolher" data-tamanho="13"></span> <span class="texto-opcao"><strong>Ordenar</strong></span>';
  cabecalhoVoltar.addEventListener("click", () => {
    fecharMenuOpcoes();
    abrirMenuColuna(botao, coluna);
  });
  menu.appendChild(cabecalhoVoltar);

  const divisor = document.createElement("div");
  divisor.className = "divisor-menu-opcoes";
  menu.appendChild(divisor);

  const atual = ordenacaoColunas[coluna.id] || "padrao";

  const opcoes = [
    {
      modo: "prioridade",
      icone: "bandeira",
      texto: "Por prioridade",
      desc: "Alta → Média → Sem marcação → Baixa"
    },
    {
      modo: "nome",
      icone: "editar",
      texto: "Por nome",
      desc: "Ordem alfabética (A → Z)"
    },
    {
      modo: "tempo",
      icone: "relogio",
      texto: "Por tempo",
      desc: "Mais antigo → Mais novo"
    },
    {
      modo: "padrao",
      icone: "resetar",
      texto: "Padrão",
      desc: "Mais recente primeiro"
    }
  ];

  opcoes.forEach((op) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "item-opcao item-opcao-ordenar" + (atual === op.modo ? " item-opcao-ativo" : "");

    const spanIcone = document.createElement("span");
    spanIcone.dataset.icone = op.icone;
    spanIcone.dataset.tamanho = "13";
    item.appendChild(spanIcone);

    const corpoTexto = document.createElement("div");
    corpoTexto.className = "corpo-texto-ordenar";

    const spanTexto = document.createElement("span");
    spanTexto.className = "texto-opcao";
    spanTexto.textContent = op.texto;
    corpoTexto.appendChild(spanTexto);

    if (op.desc) {
      const spanDesc = document.createElement("span");
      spanDesc.className = "subtexto-ordenar";
      spanDesc.textContent = op.desc;
      corpoTexto.appendChild(spanDesc);
    }

    item.appendChild(corpoTexto);

    if (atual === op.modo) {
      const checkAtivo = document.createElement("span");
      checkAtivo.dataset.icone = "check";
      checkAtivo.dataset.tamanho = "12";
      checkAtivo.className = "check-ativo";
      item.appendChild(checkAtivo);
    }

    item.addEventListener("click", () => {
      fecharMenuOpcoes();
      ordenacaoColunas[coluna.id] = op.modo;
      try {
        localStorage.setItem("golden_ordenacao_colunas", JSON.stringify(ordenacaoColunas));
      } catch (e) {}

      if (op.modo === "prioridade") {
        mostrarMensagem("Coluna ordenada por prioridade (Alta → Baixa).", "sucesso");
      } else if (op.modo === "nome") {
        mostrarMensagem("Coluna ordenada por nome (A → Z).", "sucesso");
      } else if (op.modo === "tempo") {
        mostrarMensagem("Coluna ordenada por tempo (Mais antigo primeiro).", "sucesso");
      } else {
        mostrarMensagem("Ordenação restaurada para o padrão.", "sucesso");
      }

      renderizarKanban();
    });

    menu.appendChild(item);
  });

  substituirIcones(menu);
  document.body.appendChild(menu);
  const rect = botao.getBoundingClientRect();
  const larguraMenu = 240;
  let esquerda = rect.right - larguraMenu;
  if (esquerda < 8) esquerda = 8;
  if (esquerda + larguraMenu > window.innerWidth - 8) {
    esquerda = window.innerWidth - larguraMenu - 8;
  }
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = esquerda + "px";
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
    {
      icone: "historico",
      texto: "Histórico",
      acao: () => abrirHistoricoCard(card)
    }
  ];

  const colunaDoCard = cacheColunas.find((c) => c.id === card.colunaId);
  const ehColunaFuncionaria = colunaDoCard && colunaDoCard.tipo === "funcionaria";

  if (ehColunaFuncionaria) {
    opcoes.push({
      icone: "check",
      texto: "Concluir mensagem da coluna",
      acao: () => concluirMensagemColuna(card, colunaDoCard)
    });
  }

  if (card.programacao && card.programacao.status === "aguardando_envio") {
    opcoes.push({
      icone: "check",
      texto: "Marcar mensagem como enviada",
      acao: () => concluirMensagemCard(card)
    });
  }

  // Divisor para prioridades
  opcoes.push({ divisor: true });

  const pAtual = (card.prioridade || "").toLowerCase();
  opcoes.push({
    blocoPrioridades: true,
    prioridadeAtual: pAtual,
    card: card
  });

  // Divisor para status
  opcoes.push({ divisor: true });

  opcoes.push(
    {
      icone: "x",
      iconeClasse: "icone-perigo",
      texto: "Marcar como perdida",
      acao: () => marcarCard(card, "perdida")
    },
    {
      icone: "check",
      iconeClasse: "icone-sucesso",
      texto: "Marcar como finalizada",
      acao: () => marcarCard(card, "finalizada")
    }
  );

  const temMarcacaoStatus = card.status === "perdida" || card.status === "finalizada";
  const temPrioridade = Boolean(card.prioridade);

  if (temMarcacaoStatus || temPrioridade) {
    opcoes.push({
      icone: "resetar",
      texto: "Desfazer marcação",
      acao: () => desfazerMarcacao(card)
    });
  }

  // Divisor para exclusão
  opcoes.push({ divisor: true });

  opcoes.push({
    icone: "lixeira",
    texto: "Excluir card",
    acao: () => excluirCard(card),
    classe: "opcao-perigosa"
  });

  opcoes.forEach((opcao) => {
    if (opcao.divisor) {
      const divisor = document.createElement("div");
      divisor.className = "divisor-menu-opcoes";
      menu.appendChild(divisor);
      return;
    }

    if (opcao.blocoPrioridades) {
      const bloco = document.createElement("div");
      bloco.className = "bloco-menu-prioridades";

      const rotulo = document.createElement("div");
      rotulo.className = "rotulo-secao-prioridades";
      rotulo.innerHTML = '<span data-icone="bandeira" data-tamanho="11"></span> Prioridade';
      bloco.appendChild(rotulo);

      const linhaPills = document.createElement("div");
      linhaPills.className = "linha-pills-prioridade";

      const niveis = [
        { chave: "alta", rotulo: "Alta", classe: "pill-alta", ponto: "ponto-alta" },
        { chave: "media", rotulo: "Média", classe: "pill-media", ponto: "ponto-media" },
        { chave: "baixa", rotulo: "Baixa", classe: "pill-baixa", ponto: "ponto-baixa" }
      ];

      niveis.forEach((nv) => {
        const btnPill = document.createElement("button");
        btnPill.type = "button";
        const estaAtiva = opcao.prioridadeAtual === nv.chave;
        btnPill.className = "pill-prioridade " + nv.classe + (estaAtiva ? " ativa" : "");
        btnPill.title = estaAtiva ? "Remover prioridade " + nv.rotulo : "Definir prioridade " + nv.rotulo;

        const ponto = document.createElement("span");
        ponto.className = "ponto-prioridade-cozy " + nv.ponto;
        btnPill.appendChild(ponto);

        const texto = document.createElement("span");
        texto.textContent = nv.rotulo;
        btnPill.appendChild(texto);

        if (estaAtiva) {
          const check = document.createElement("span");
          check.dataset.icone = "check";
          check.dataset.tamanho = "10";
          check.className = "check-pill";
          btnPill.appendChild(check);
        }

        btnPill.addEventListener("click", (e) => {
          e.stopPropagation();
          fecharMenuOpcoes();
          marcarPrioridadeCard(opcao.card, nv.chave);
        });

        linhaPills.appendChild(btnPill);
      });

      bloco.appendChild(linhaPills);
      menu.appendChild(bloco);
      return;
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "item-opcao" + (opcao.classe ? " " + opcao.classe : "");

    const spanIcone = document.createElement("span");
    spanIcone.dataset.icone = opcao.icone || "tres_pontos";
    spanIcone.dataset.tamanho = "13";
    if (opcao.iconeClasse) spanIcone.className = opcao.iconeClasse;
    item.appendChild(spanIcone);

    const spanTexto = document.createElement("span");
    spanTexto.className = "texto-opcao";
    spanTexto.textContent = opcao.texto;
    item.appendChild(spanTexto);

    if (opcao.ativo) {
      item.classList.add("item-opcao-ativo");
      const checkAtivo = document.createElement("span");
      checkAtivo.dataset.icone = "check";
      checkAtivo.dataset.tamanho = "12";
      checkAtivo.className = "check-ativo";
      item.appendChild(checkAtivo);
    }

    item.addEventListener("click", () => {
      fecharMenuOpcoes();
      opcao.acao();
    });
    menu.appendChild(item);
  });

  substituirIcones(menu);
  document.body.appendChild(menu);

  const rect = botao.getBoundingClientRect();
  const larguraMenu = 200;
  let esquerda = rect.right - larguraMenu;
  if (esquerda < 8) esquerda = 8;
  if (esquerda + larguraMenu > window.innerWidth - 8) {
    esquerda = window.innerWidth - larguraMenu - 8;
  }
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = esquerda + "px";
}

async function marcarPrioridadeCard(card, prioridade) {
  const pAtual = (card.prioridade || "").toLowerCase();
  const novaPrioridade = pAtual === prioridade ? "" : prioridade;
  try {
    await updateDoc(doc(db, "cards", card.id), {
      prioridade: novaPrioridade,
      ultimaAtividade: serverTimestamp()
    });
    card.prioridade = novaPrioridade;
    if (novaPrioridade) {
      const rotulo = novaPrioridade.charAt(0).toUpperCase() + novaPrioridade.slice(1);
      mostrarMensagem("Prioridade " + rotulo + " definida.", "sucesso");
    } else {
      mostrarMensagem("Prioridade removida.", "sucesso");
    }
  } catch (erro) {
    mostrarMensagem("Erro ao atualizar prioridade do card.", "erro");
  }
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
      const sequenciaCores = ["lilas", "amarelo", "verde"];
      const corNova = sequenciaCores[cacheColunas.length % sequenciaCores.length];

      await addDoc(collection(db, "colunas"), {
        nome: nome,
        descricao: descricao,
        tipo: tipo,
        ordem: ordem,
        cor: corNova,
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
  const coresDisponiveis = [
    { id: "lilas", rotulo: "Lilás" },
    { id: "pessego", rotulo: "Pêssego" },
    { id: "verde", rotulo: "Verde" },
    { id: "azul", rotulo: "Azul" },
    { id: "rosa", rotulo: "Rosa" },
    { id: "amarelo", rotulo: "Amarelo" }
  ];
  const corAtual = coluna.cor || "lilas";

  let botoesCor = "";
  coresDisponiveis.forEach((c) => {
    const sel = c.id === corAtual ? " selecionada" : "";
    botoesCor +=
      '<button type="button" class="opcao-cor' + sel + '" ' +
      'data-cor="' + c.id + '" title="' + c.rotulo + '"></button>';
  });

  caixa.innerHTML =
    "<h3>Editar coluna</h3>" +
    "<label>Nome (obrigatório)</label>" +
    '<input type="text" id="col-nome">' +
    "<label>Descrição (opcional)</label>" +
    '<input type="text" id="col-descricao">' +
    "<label>Cor de identificação</label>" +
    '<div class="seletor-cores">' + botoesCor + "</div>";

  caixa.querySelector("#col-nome").value = coluna.nome;
  caixa.querySelector("#col-descricao").value = coluna.descricao || "";

  let corSelecionada = corAtual;
  caixa.querySelectorAll(".opcao-cor").forEach((botao) => {
    botao.addEventListener("click", () => {
      caixa.querySelectorAll(".opcao-cor").forEach((b) => {
        b.classList.remove("selecionada");
      });
      botao.classList.add("selecionada");
      corSelecionada = botao.dataset.cor;
    });
  });

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
      await updateDoc(doc(db, "colunas", coluna.id), {
        nome,
        descricao,
        cor: corSelecionada
      });
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

  const marcarColuna = cfg.moverAposMensagemColuna !== false;
  const marcarCard = cfg.moverAposMensagemCard === true;

  caixa.innerHTML =
    "<h3>Configurar coluna funcionária</h3>" +
    "<label>Mensagem automática (WhatsApp)</label>" +
    '<textarea id="cfg-mensagem"></textarea>' +
    "<label>Data do envio da mensagem da coluna</label>" +
    '<input type="date" id="cfg-data">' +
    "<label>Horário do envio</label>" +
    '<input type="time" id="cfg-hora">' +
    '<p class="texto-ajuda" style="margin-top:8px;">' +
      "Todos os cards desta coluna receberão esta mensagem no horário definido acima, " +
      "independentemente das opções marcadas abaixo. As opções definem apenas quando o card " +
      "será movido. Mensagens programadas individualmente em cada card continuam valendo em paralelo." +
    "</p>" +
    "<label>Gatilho de conclusão</label>" +
    '<div class="bloco-checkboxes">' +
      '<label class="checkbox-linha">' +
        '<input type="checkbox" id="cfg-mover-coluna"' + (marcarColuna ? " checked" : "") + ">" +
        "<span>Mover após mensagem da coluna ser enviada</span>" +
      "</label>" +
      '<label class="checkbox-linha">' +
        '<input type="checkbox" id="cfg-mover-card"' + (marcarCard ? " checked" : "") + ">" +
        "<span>Mover após mensagem do card ser enviada</span>" +
      "</label>" +
    "</div>" +
    '<p class="texto-ajuda" style="margin-top:8px;">' +
      "Se as duas opções forem marcadas, o card só será movido depois da entrega de ambas." +
    "</p>" +
    "<label>Coluna de destino ao concluir</label>" +
    '<select id="cfg-destino">' + opcoesDestino + "</select>" +
    '<p class="texto-ajuda" style="margin-top:12px;">' +
      "Modo de detecção: manual (o vendedor marca como concluída). " +
      "A detecção automática por IA será ativada em versão futura." +
    "</p>";

  caixa.querySelector("#cfg-mensagem").value = cfg.mensagemWhatsapp || "";
  if (cfg.dataHoraColuna && cfg.dataHoraColuna.seconds) {
    const d = new Date(cfg.dataHoraColuna.seconds * 1000);
    caixa.querySelector("#cfg-data").value = d.toISOString().slice(0, 10);
    caixa.querySelector("#cfg-hora").value = d.toTimeString().slice(0, 5);
  }

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Salvar configuração";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    const mensagemWhatsapp = caixa.querySelector("#cfg-mensagem").value.trim();
    const data = caixa.querySelector("#cfg-data").value;
    const hora = caixa.querySelector("#cfg-hora").value;
    const colunaDestinoId = caixa.querySelector("#cfg-destino").value;
    const moverAposMensagemColuna = caixa.querySelector("#cfg-mover-coluna").checked;
    const moverAposMensagemCard = caixa.querySelector("#cfg-mover-card").checked;

    if (!colunaDestinoId) {
      mostrarMensagem("Selecione a coluna de destino.", "erro");
      return;
    }
    if (!moverAposMensagemColuna && !moverAposMensagemCard) {
      mostrarMensagem("Marque ao menos um gatilho de conclusão.", "erro");
      return;
    }

    let dataHoraColuna = null;
    if (data && hora) {
      dataHoraColuna = new Date(data + "T" + hora);
    }

    botaoSalvar.disabled = true;
    try {
      await updateDoc(doc(db, "colunas", coluna.id), {
        configFuncionaria: {
          mensagemWhatsapp,
          dataHoraColuna,
          moverAposMensagemColuna,
          moverAposMensagemCard,
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
    "<label>Prioridade</label>" +
    "<select id='e-prioridade'>" +
      "<option value=''>Nenhuma</option>" +
      "<option value='alta'>Alta</option>" +
      "<option value='media'>Média</option>" +
      "<option value='baixa'>Baixa</option>" +
    "</select>" +
    "<label>Valor negociado (R$)</label><input type='number' id='e-valor' step='0.01'>" +
    "<label>Descrição</label><textarea id='e-desc'></textarea>";

  caixa.querySelector("#e-nome").value = card.nomeConta || "";
  caixa.querySelector("#e-razao").value = card.razaoSocial || "";
  caixa.querySelector("#e-tel").value = card.telefone || "";
  caixa.querySelector("#e-email").value = card.email || "";
  caixa.querySelector("#e-prioridade").value = (card.prioridade || "").toLowerCase();
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
      prioridade: caixa.querySelector("#e-prioridade").value.trim(),
      valorNegociado: parseFloat(caixa.querySelector("#e-valor").value) || 0,
      descricao: caixa.querySelector("#e-desc").value.trim()
    };

    const mudancas = [];
    if (novos.nomeConta !== (card.nomeConta || "")) mudancas.push("Nome");
    if (novos.razaoSocial !== (card.razaoSocial || "")) mudancas.push("Razão social");
    if (novos.telefone !== (card.telefone || "")) mudancas.push("Telefone");
    if (novos.email !== (card.email || "")) mudancas.push("E-mail");
    if (novos.prioridade !== ((card.prioridade || "").toLowerCase())) mudancas.push("Prioridade");
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

async function desfazerMarcacao(card) {
  if (!window.confirm("Desfazer a marcação deste card?")) return;
  try {
    const dados = {
      ultimaAtividade: serverTimestamp()
    };
    const detalhesHistorico = {};

    if (card.status === "perdida" || card.status === "finalizada") {
      dados.status = "ativa";
      detalhesHistorico.status = "ativa (marcação desfeita)";
      card.status = "ativa";
    }

    if (card.prioridade) {
      dados.prioridade = "";
      detalhesHistorico.prioridade = "removida";
      card.prioridade = "";
    }

    await updateDoc(doc(db, "cards", card.id), dados);
    await registrarHistoricoCard(card.id, "marcacao", detalhesHistorico);
    mostrarMensagem("Marcação desfeita.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao desfazer a marcação.", "erro");
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
      await avaliarGatilhoConclusao(card.id);
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
// AUXILIARES DE BUSCA E FILTROS DO HISTÓRICO
// ------------------------------------------------------------
function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function encontrarCardHistorico(cardId) {
  if (!cardId) return null;
  return cacheCards.find((c) => c.id === cardId) ||
         cacheCardsExcluidos.find((c) => c.id === cardId) ||
         null;
}

function eventoCorrespondeFiltros(ev, filtros) {
  const evSec = segundosDe(ev.timestamp);
  if (filtros.inicioSec !== null && evSec < filtros.inicioSec) return false;
  if (filtros.fimSec !== null && evSec > filtros.fimSec) return false;

  if (!filtros.termo) return true;

  const termoNormalizado = normalizarTexto(filtros.termo);
  const termoDigitos = filtros.termo.replace(/\D/g, "");

  const partes = [];

  // Nome da coluna ou card
  if (ev._nome) partes.push(ev._nome);
  if (ev.colunaOrigemId) {
    const cOri = cacheColunas.find((c) => c.id === ev.colunaOrigemId);
    if (cOri) partes.push(cOri.nome);
  }
  if (ev.colunaDestinoId) {
    const cDest = cacheColunas.find((c) => c.id === ev.colunaDestinoId);
    if (cDest) partes.push(cDest.nome);
  }

  // Card resumo e objeto do card
  if (ev.cardResumo) partes.push(ev.cardResumo);
  if (ev._card) {
    if (ev._card.nomeConta) partes.push(ev._card.nomeConta);
    if (ev._card.telefone) {
      partes.push(ev._card.telefone);
      partes.push(ev._card.telefone.replace(/\D/g, ""));
    }
    if (ev._card.email) partes.push(ev._card.email);
    if (ev._card.razaoSocial) partes.push(ev._card.razaoSocial);
  }

  // Colaborador da plataforma
  if (ev.autor) {
    if (ev.autor.nome) partes.push(ev.autor.nome);
    if (ev.autor.email) partes.push(ev.autor.email);
  }
  if (ev.diretrizDe) {
    if (ev.diretrizDe.nome) partes.push(ev.diretrizDe.nome);
    if (ev.diretrizDe.email) partes.push(ev.diretrizDe.email);
  }

  // Tipo e detalhes
  if (ev.tipo) partes.push(ev.tipo);
  if (ev.detalhes) {
    if (ev.detalhes.de) partes.push(ev.detalhes.de);
    if (ev.detalhes.para) partes.push(ev.detalhes.para);
    if (ev.detalhes.campos) partes.push(ev.detalhes.campos);
    if (ev.detalhes.status) partes.push(ev.detalhes.status);
    if (ev.detalhes.dataHora) partes.push(ev.detalhes.dataHora);
    if (ev.detalhes.ordem) partes.push(ev.detalhes.ordem);
  }

  const textoCompleto = normalizarTexto(partes.join(" "));
  if (textoCompleto.includes(termoNormalizado)) return true;

  if (termoDigitos.length >= 3) {
    const fone = (ev._card?.telefone || "").replace(/\D/g, "");
    if (fone.includes(termoDigitos)) return true;
  }

  return false;
}

// ------------------------------------------------------------
// CALENDÁRIO FOFO E AMIGÁVEL — POPUP FLUTUANTE
// ------------------------------------------------------------
let calendarioFofoAberto = null;

function fecharCalendarioFofo() {
  if (calendarioFofoAberto) {
    calendarioFofoAberto.remove();
    calendarioFofoAberto = null;
    document.removeEventListener("pointerdown", fecharCalendarioFofoAoClicarFora);
    document.removeEventListener("keydown", fecharCalendarioFofoTeclado);
  }
}

function fecharCalendarioFofoAoClicarFora(e) {
  if (!calendarioFofoAberto) return;
  if (!calendarioFofoAberto.contains(e.target) && !e.target.closest(".gatilho-data-fofo")) {
    fecharCalendarioFofo();
  }
}

function fecharCalendarioFofoTeclado(e) {
  if (e.key === "Escape") {
    fecharCalendarioFofo();
  }
}

function abrirCalendarioFofo(botaoAncora, dataInicial, aoConfirmar) {
  fecharCalendarioFofo();

  const popup = document.createElement("div");
  popup.className = "calendario-fofo-popup";
  calendarioFofoAberto = popup;

  const dataBase = dataInicial ? new Date(dataInicial) : new Date();
  let anoVisual = dataBase.getFullYear();
  let mesVisual = dataBase.getMonth();

  let diaSel = dataInicial ? dataInicial.getDate() : null;
  let mesSel = dataInicial ? dataInicial.getMonth() : null;
  let anoSel = dataInicial ? dataInicial.getFullYear() : null;

  let horaSel = dataInicial ? dataInicial.getHours() : 0;
  let minutoSel = dataInicial ? dataInicial.getMinutes() : 0;

  const nomesMeses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const diasSemana = ["D", "S", "T", "Q", "Q", "S", "S"];

  // Cabeçalho (Mês e Ano + Navegação)
  const header = document.createElement("div");
  header.className = "cal-header";

  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.className = "cal-btn-nav";
  btnPrev.innerHTML = "‹";
  btnPrev.title = "Mês anterior";

  const tituloMesAno = document.createElement("span");
  tituloMesAno.className = "cal-titulo-mes-ano";

  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.className = "cal-btn-nav";
  btnNext.innerHTML = "›";
  btnNext.title = "Próximo mês";

  header.appendChild(btnPrev);
  header.appendChild(tituloMesAno);
  header.appendChild(btnNext);
  popup.appendChild(header);

  // Dias da Semana (D S T Q Q S S)
  const semanaRow = document.createElement("div");
  semanaRow.className = "cal-semana-row";
  diasSemana.forEach((d) => {
    const el = document.createElement("span");
    el.className = "cal-semana-dia";
    el.textContent = d;
    semanaRow.appendChild(el);
  });
  popup.appendChild(semanaRow);

  // Grade de Dias
  const gridDias = document.createElement("div");
  gridDias.className = "cal-grid-dias";
  popup.appendChild(gridDias);

  function atualizarHeader() {
    tituloMesAno.textContent = `${nomesMeses[mesVisual]} ${anoVisual}`;
  }

  function renderizarDias() {
    gridDias.innerHTML = "";
    atualizarHeader();

    const hoje = new Date();
    const hojeDia = hoje.getDate();
    const hojeMes = hoje.getMonth();
    const hojeAno = hoje.getFullYear();

    const primeiroDiaSemana = new Date(anoVisual, mesVisual, 1).getDay();
    const totalDiasMes = new Date(anoVisual, mesVisual + 1, 0).getDate();
    const totalDiasMesAnterior = new Date(anoVisual, mesVisual, 0).getDate();

    // Dias do mês anterior
    for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
      const diaNum = totalDiasMesAnterior - i;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-dia fora-mes";
      btn.textContent = diaNum;
      btn.addEventListener("click", () => {
        if (mesVisual === 0) {
          mesVisual = 11;
          anoVisual--;
        } else {
          mesVisual--;
        }
        diaSel = diaNum;
        mesSel = mesVisual;
        anoSel = anoVisual;
        renderizarDias();
      });
      gridDias.appendChild(btn);
    }

    // Dias do mês atual
    for (let dia = 1; dia <= totalDiasMes; dia++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-dia";
      btn.textContent = dia;

      const ehHoje = (dia === hojeDia && mesVisual === hojeMes && anoVisual === hojeAno);
      if (ehHoje) btn.classList.add("hoje");

      const ehSelecionado = (dia === diaSel && mesVisual === mesSel && anoVisual === anoSel);
      if (ehSelecionado) btn.classList.add("selecionado");

      btn.addEventListener("click", () => {
        diaSel = dia;
        mesSel = mesVisual;
        anoSel = anoVisual;
        renderizarDias();
      });

      // Duplo clique confirma e fecha
      btn.addEventListener("dblclick", () => {
        diaSel = dia;
        mesSel = mesVisual;
        anoSel = anoVisual;
        confirmar();
      });

      gridDias.appendChild(btn);
    }

    // Dias do próximo mês para completar grade
    const totalExibido = primeiroDiaSemana + totalDiasMes;
    const totalCelulas = totalExibido > 35 ? 42 : 35;
    const diasProximo = totalCelulas - totalExibido;
    for (let dia = 1; dia <= diasProximo; dia++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-dia fora-mes";
      btn.textContent = dia;
      btn.addEventListener("click", () => {
        if (mesVisual === 11) {
          mesVisual = 0;
          anoVisual++;
        } else {
          mesVisual++;
        }
        diaSel = dia;
        mesSel = mesVisual;
        anoSel = anoVisual;
        renderizarDias();
      });
      gridDias.appendChild(btn);
    }
  }

  btnPrev.addEventListener("click", () => {
    if (mesVisual === 0) {
      mesVisual = 11;
      anoVisual--;
    } else {
      mesVisual--;
    }
    renderizarDias();
  });

  btnNext.addEventListener("click", () => {
    if (mesVisual === 11) {
      mesVisual = 0;
      anoVisual++;
    } else {
      mesVisual++;
    }
    renderizarDias();
  });

  // Seção de Horário
  const secaoHorario = document.createElement("div");
  secaoHorario.className = "cal-secao-horario";

  const linhaHorario = document.createElement("div");
  linhaHorario.className = "cal-linha-horario";

  const rotuloHorario = document.createElement("span");
  rotuloHorario.className = "cal-rotulo-horario";
  rotuloHorario.innerHTML = '<span data-icone="relogio" data-tamanho="13"></span> Horário';

  const inputsTempoWrapper = document.createElement("div");
  inputsTempoWrapper.className = "cal-inputs-tempo-wrapper";

  const inputHora = document.createElement("input");
  inputHora.type = "number";
  inputHora.className = "cal-input-tempo cal-hora";
  inputHora.min = 0;
  inputHora.max = 23;
  inputHora.value = String(horaSel).padStart(2, "0");

  const divisorTempo = document.createElement("span");
  divisorTempo.className = "cal-tempo-divisor";
  divisorTempo.textContent = ":";

  const inputMinuto = document.createElement("input");
  inputMinuto.type = "number";
  inputMinuto.className = "cal-input-tempo cal-minuto";
  inputMinuto.min = 0;
  inputMinuto.max = 59;
  inputMinuto.value = String(minutoSel).padStart(2, "0");

  function validarTempo() {
    let h = parseInt(inputHora.value, 10);
    if (isNaN(h) || h < 0) h = 0;
    if (h > 23) h = 23;
    inputHora.value = String(h).padStart(2, "0");
    horaSel = h;

    let m = parseInt(inputMinuto.value, 10);
    if (isNaN(m) || m < 0) m = 0;
    if (m > 59) m = 59;
    inputMinuto.value = String(m).padStart(2, "0");
    minutoSel = m;
  }

  inputHora.addEventListener("change", validarTempo);
  inputMinuto.addEventListener("change", validarTempo);
  inputHora.addEventListener("input", () => {
    let v = parseInt(inputHora.value, 10);
    if (!isNaN(v) && v >= 0 && v <= 23) horaSel = v;
  });
  inputMinuto.addEventListener("input", () => {
    let v = parseInt(inputMinuto.value, 10);
    if (!isNaN(v) && v >= 0 && v <= 59) minutoSel = v;
  });

  inputsTempoWrapper.appendChild(inputHora);
  inputsTempoWrapper.appendChild(divisorTempo);
  inputsTempoWrapper.appendChild(inputMinuto);

  linhaHorario.appendChild(rotuloHorario);
  linhaHorario.appendChild(inputsTempoWrapper);
  secaoHorario.appendChild(linhaHorario);

  // Chips de Horários Rápidos
  const chipsWrapper = document.createElement("div");
  chipsWrapper.className = "cal-chips-horario";
  const chips = [
    { label: "00:00", h: 0, m: 0 },
    { label: "08:00", h: 8, m: 0 },
    { label: "12:00", h: 12, m: 0 },
    { label: "18:00", h: 18, m: 0 },
    { label: "23:59", h: 23, m: 59 }
  ];
  chips.forEach((c) => {
    const chipBtn = document.createElement("button");
    chipBtn.type = "button";
    chipBtn.className = "cal-chip-tempo";
    chipBtn.textContent = c.label;
    chipBtn.addEventListener("click", () => {
      horaSel = c.h;
      minutoSel = c.m;
      inputHora.value = String(c.h).padStart(2, "0");
      inputMinuto.value = String(c.m).padStart(2, "0");
    });
    chipsWrapper.appendChild(chipBtn);
  });
  secaoHorario.appendChild(chipsWrapper);
  popup.appendChild(secaoHorario);

  // Rodapé de Ações
  const rodape = document.createElement("div");
  rodape.className = "cal-rodape";

  const btnAgora = document.createElement("button");
  btnAgora.type = "button";
  btnAgora.className = "cal-btn-acao cal-btn-agora";
  btnAgora.textContent = "Agora";
  btnAgora.title = "Definir para data e hora atual";
  btnAgora.addEventListener("click", () => {
    const agora = new Date();
    diaSel = agora.getDate();
    mesSel = agora.getMonth();
    anoSel = agora.getFullYear();
    anoVisual = anoSel;
    mesVisual = mesSel;
    horaSel = agora.getHours();
    minutoSel = agora.getMinutes();
    inputHora.value = String(horaSel).padStart(2, "0");
    inputMinuto.value = String(minutoSel).padStart(2, "0");
    renderizarDias();
  });

  const grupoDireita = document.createElement("div");
  grupoDireita.className = "cal-grupo-acoes-dir";

  const btnLimpar = document.createElement("button");
  btnLimpar.type = "button";
  btnLimpar.className = "cal-btn-acao cal-btn-limpar";
  btnLimpar.textContent = "Limpar";
  btnLimpar.addEventListener("click", () => {
    fecharCalendarioFofo();
    aoConfirmar(null);
  });

  const btnAplicar = document.createElement("button");
  btnAplicar.type = "button";
  btnAplicar.className = "cal-btn-acao cal-btn-aplicar";
  btnAplicar.textContent = "Aplicar";

  function confirmar() {
    validarTempo();
    const finalAno = anoSel !== null ? anoSel : anoVisual;
    const finalMes = mesSel !== null ? mesSel : mesVisual;
    const finalDia = diaSel !== null ? diaSel : new Date().getDate();
    const res = new Date(finalAno, finalMes, finalDia, horaSel, minutoSel, 0);
    fecharCalendarioFofo();
    aoConfirmar(res);
  }

  btnAplicar.addEventListener("click", confirmar);

  grupoDireita.appendChild(btnLimpar);
  grupoDireita.appendChild(btnAplicar);
  rodape.appendChild(btnAgora);
  rodape.appendChild(grupoDireita);
  popup.appendChild(rodape);

  renderizarDias();
  substituirIcones(popup);
  document.body.appendChild(popup);

  // Posicionamento inteligente (flutua fixo abaixo ou acima do botão)
  const rect = botaoAncora.getBoundingClientRect();
  const largura = 295;
  let left = rect.left;
  if (left + largura > window.innerWidth - 12) {
    left = window.innerWidth - largura - 12;
  }
  if (left < 12) left = 12;

  let top = rect.bottom + 6;
  const alturaEstimada = 385;
  if (top + alturaEstimada > window.innerHeight - 12 && rect.top > alturaEstimada + 12) {
    top = rect.top - alturaEstimada - 6;
  }

  popup.style.top = Math.round(top) + "px";
  popup.style.left = Math.round(left) + "px";

  setTimeout(() => {
    document.addEventListener("pointerdown", fecharCalendarioFofoAoClicarFora);
    document.addEventListener("keydown", fecharCalendarioFofoTeclado);
  }, 10);
}

function criarSeletorDataFofo(rotuloPrefixo, placeholder, aoAlterar) {
  let dataSelecionada = null;

  const container = document.createElement("div");
  container.className = "seletor-data-fofo-container";

  const botaoGatilho = document.createElement("button");
  botaoGatilho.type = "button";
  botaoGatilho.className = "gatilho-data-fofo";
  botaoGatilho.title = "Selecionar data e horário";

  const spanIcone = document.createElement("span");
  spanIcone.className = "icone-calendario-fofo";
  spanIcone.dataset.icone = "calendario";
  spanIcone.dataset.tamanho = "14";

  const spanTexto = document.createElement("span");
  spanTexto.className = "texto-data-fofo";
  spanTexto.textContent = rotuloPrefixo + ": " + placeholder;

  const botaoLimparIndividual = document.createElement("span");
  botaoLimparIndividual.className = "limpar-data-fofo";
  botaoLimparIndividual.textContent = "✕";
  botaoLimparIndividual.title = "Limpar data";
  botaoLimparIndividual.style.display = "none";

  botaoLimparIndividual.addEventListener("click", (e) => {
    e.stopPropagation();
    definirValor(null);
  });

  botaoGatilho.appendChild(spanIcone);
  botaoGatilho.appendChild(spanTexto);
  botaoGatilho.appendChild(botaoLimparIndividual);
  container.appendChild(botaoGatilho);

  function formatarTextoData(data) {
    if (!data) return rotuloPrefixo + ": " + placeholder;
    const dia = String(data.getDate()).padStart(2, "0");
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const ano = String(data.getFullYear()).slice(-2);
    const hora = String(data.getHours()).padStart(2, "0");
    const min = String(data.getMinutes()).padStart(2, "0");
    return `${rotuloPrefixo}: ${dia}/${mes}/${ano} ${hora}:${min}`;
  }

  function definirValor(novaData) {
    dataSelecionada = novaData;
    spanTexto.textContent = formatarTextoData(novaData);
    if (novaData) {
      botaoGatilho.classList.add("ativo");
      botaoLimparIndividual.style.display = "inline-flex";
    } else {
      botaoGatilho.classList.remove("ativo");
      botaoLimparIndividual.style.display = "none";
    }
    aoAlterar(dataSelecionada);
  }

  botaoGatilho.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirCalendarioFofo(botaoGatilho, dataSelecionada, (dataConfirmada) => {
      definirValor(dataConfirmada);
    });
  });

  return {
    elemento: container,
    obterValor: () => dataSelecionada,
    definirValor: definirValor
  };
}

function montarBarraFiltrosHistorico(aoFiltrar, placeholderTexto) {
  const container = document.createElement("div");
  container.className = "barra-filtros-historico";

  const buscaWrapper = document.createElement("div");
  buscaWrapper.className = "busca-historico-wrapper";

  const iconeBusca = document.createElement("span");
  iconeBusca.className = "icone-busca-hist";
  iconeBusca.dataset.icone = "busca";
  iconeBusca.dataset.tamanho = "14";

  const inputBusca = document.createElement("input");
  inputBusca.type = "text";
  inputBusca.className = "campo-busca-historico";
  inputBusca.placeholder = placeholderTexto || "Buscar no histórico...";
  inputBusca.autocomplete = "off";

  buscaWrapper.appendChild(iconeBusca);
  buscaWrapper.appendChild(inputBusca);

  const periodoWrapper = document.createElement("div");
  periodoWrapper.className = "periodo-historico-wrapper";

  let dataInicio = null;
  let dataFim = null;

  const seletorInicio = criarSeletorDataFofo("De", "Início", (d) => {
    dataInicio = d;
    disparar();
  });

  const seletorFim = criarSeletorDataFofo("Até", "Fim", (d) => {
    dataFim = d;
    disparar();
  });

  const botaoLimpar = document.createElement("button");
  botaoLimpar.type = "button";
  botaoLimpar.className = "botao-limpar-filtros-hist";
  botaoLimpar.title = "Limpar todos os filtros";
  botaoLimpar.textContent = "✕";
  botaoLimpar.style.display = "none";

  periodoWrapper.appendChild(seletorInicio.elemento);
  periodoWrapper.appendChild(seletorFim.elemento);
  periodoWrapper.appendChild(botaoLimpar);

  container.appendChild(buscaWrapper);
  container.appendChild(periodoWrapper);

  function disparar() {
    const termo = inputBusca.value.trim();
    const temFiltro = Boolean(termo || dataInicio || dataFim);
    botaoLimpar.style.display = temFiltro ? "inline-flex" : "none";

    const inicioSec = dataInicio ? Math.floor(dataInicio.getTime() / 1000) : null;
    const fimSec = dataFim ? Math.floor(dataFim.getTime() / 1000) + 59 : null;

    aoFiltrar({
      termo,
      inicioSec,
      fimSec
    });
  }

  inputBusca.addEventListener("input", disparar);

  botaoLimpar.addEventListener("click", () => {
    inputBusca.value = "";
    seletorInicio.definirValor(null);
    seletorFim.definirValor(null);
    botaoLimpar.style.display = "none";
    disparar();
  });

  return container;
}

function renderizarListaEventos(lista, eventosFiltrados, ehGlobal) {
  lista.innerHTML = "";
  if (eventosFiltrados.length === 0) {
    lista.innerHTML = '<p class="texto-ajuda" style="padding: 12px 0;">Nenhum evento encontrado para os filtros selecionados.</p>';
    return;
  }
  eventosFiltrados.slice(0, 300).forEach((ev) => {
    const cartao = criarCartaoEvento(ev);
    if (ehGlobal) {
      const origem = document.createElement("div");
      origem.className = "texto-ajuda";
      origem.style.fontWeight = "700";
      origem.style.marginBottom = "4px";
      origem.textContent = (ev._origem === "coluna" ? "Coluna: " : (ev._origem === "card" ? "Card: " : "")) + (ev._nome || "—");
      cartao.insertBefore(origem, cartao.firstChild);
    }
    lista.appendChild(cartao);
  });
}

// ------------------------------------------------------------
// HISTÓRICO DO CARD
// ------------------------------------------------------------
async function abrirHistoricoCard(card) {
  modalConteudo.classList.add("modal-conteudo-largo");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Histórico — " + (card.nomeConta || "card") + "</h3>" +
    '<p class="texto-ajuda mensagem-carregando">Carregando...</p>';

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);

  try {
    const snap = await getDocs(collection(db, "cards", card.id, "historico"));
    const eventos = [];
    snap.forEach((d) => eventos.push({ id: d.id, ...d.data(), _origem: "card", _nome: card.nomeConta, _card: card }));
    eventos.sort((a, b) => segundosDe(b.timestamp) - segundosDe(a.timestamp));

    const carregando = caixa.querySelector(".mensagem-carregando");
    if (carregando) carregando.remove();

    const lista = document.createElement("div");
    lista.className = "lista-eventos-historico";

    const barraFiltros = montarBarraFiltrosHistorico((filtros) => {
      const filtrados = eventos.filter((ev) => eventoCorrespondeFiltros(ev, filtros));
      renderizarListaEventos(lista, filtrados, false);
    }, "Buscar por colaborador ou termo...");

    caixa.insertBefore(barraFiltros, botaoFechar);
    caixa.insertBefore(lista, botaoFechar);

    renderizarListaEventos(lista, eventos, false);
    substituirIcones(caixa);
  } catch (erro) {
    const carregando = caixa.querySelector(".mensagem-carregando");
    if (carregando) carregando.textContent = "Erro ao carregar o histórico.";
  }
}

// ------------------------------------------------------------
// HISTÓRICO DA COLUNA
// ------------------------------------------------------------
async function abrirHistoricoColuna(coluna) {
  modalConteudo.classList.add("modal-conteudo-largo");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Histórico — " + coluna.nome + "</h3>" +
    '<p class="texto-ajuda mensagem-carregando">Carregando...</p>';

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);

  try {
    const snap = await getDocs(collection(db, "colunas", coluna.id, "historico"));
    const eventos = [];
    snap.forEach((d) => {
      const data = d.data();
      const cardAssoc = encontrarCardHistorico(data.cardId);
      eventos.push({
        id: d.id,
        ...data,
        _origem: "coluna",
        _nome: coluna.nome,
        _card: cardAssoc
      });
    });
    eventos.sort((a, b) => segundosDe(b.timestamp) - segundosDe(a.timestamp));

    const carregando = caixa.querySelector(".mensagem-carregando");
    if (carregando) carregando.remove();

    const lista = document.createElement("div");
    lista.className = "lista-eventos-historico";

    const barraFiltros = montarBarraFiltrosHistorico((filtros) => {
      const filtrados = eventos.filter((ev) => eventoCorrespondeFiltros(ev, filtros));
      renderizarListaEventos(lista, filtrados, false);
    }, "Buscar por card, telefone, e-mail, razão social ou colaborador...");

    caixa.insertBefore(barraFiltros, botaoFechar);
    caixa.insertBefore(lista, botaoFechar);

    renderizarListaEventos(lista, eventos, false);
    substituirIcones(caixa);
  } catch (erro) {
    const carregando = caixa.querySelector(".mensagem-carregando");
    if (carregando) carregando.textContent = "Erro ao carregar o histórico.";
  }
}

// ------------------------------------------------------------
// CARTÃO DE EVENTO (usado nos históricos)
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
    case "entrada":
      descricao = "Card entrou na coluna" + (ev.cardResumo ? ': "' + ev.cardResumo + '"' : "");
      break;
    case "saida":
      descricao = "Card saiu da coluna" + (ev.cardResumo ? ': "' + ev.cardResumo + '"' : "");
      break;
    case "configuracao": descricao = "Configuração alterada"; break;
    case "reordenacao":
      descricao = "Colunas reordenadas: " + (ev.detalhes?.ordem || "—");
      break;
    default: descricao = ev.tipo || "Evento";
  }

  if (ev.automatico && ev.diretrizDe) {
    descricao += " (automático por diretriz de " + (ev.diretrizDe.nome || ev.diretrizDe.email) + ")";
  }

  let infoCard = "";
  if (ev._card) {
    const partes = [];
    if (ev._card.razaoSocial) partes.push(ev._card.razaoSocial);
    if (ev._card.telefone) partes.push(ev._card.telefone);
    if (ev._card.email) partes.push(ev._card.email);
    if (partes.length > 0) {
      infoCard = '<div class="texto-ajuda" style="margin-top: 3px; font-size: 11px;">' + partes.join(" · ") + '</div>';
    }
  }

  div.innerHTML =
    '<div class="linha-evento-topo">' +
      '<span class="etiqueta-evento">' + (ev.tipo || "evento") + "</span>" +
      '<span class="hora-evento">' + formatarData(ev.timestamp) + "</span>" +
    "</div>" +
    "<div>" + descricao + "</div>" +
    infoCard +
    '<div class="texto-ajuda" style="margin-top: 2px;">Por: ' + autor + "</div>";

  return div;
}

// ------------------------------------------------------------
// HISTÓRICO GLOBAL (mescla card + coluna)
// ------------------------------------------------------------
async function abrirHistoricoGlobal() {
  menuKanban.classList.remove("aberta");
  modalConteudo.classList.add("modal-conteudo-largo");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Histórico geral</h3>" +
    '<p class="texto-ajuda mensagem-carregando">Carregando eventos de todas as colunas e cards...</p>';

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);

  try {
    const todos = [];

    // Colunas
    for (const coluna of cacheColunas) {
      const snap = await getDocs(collection(db, "colunas", coluna.id, "historico"));
      snap.forEach((d) => {
        const data = d.data();
        const cardAssoc = encontrarCardHistorico(data.cardId);
        todos.push({
          id: d.id,
          ...data,
          _origem: "coluna",
          _nome: coluna.nome,
          _card: cardAssoc
        });
      });
    }

    // Cards ativos
    for (const card of cacheCards) {
      const snap = await getDocs(collection(db, "cards", card.id, "historico"));
      snap.forEach((d) => {
        todos.push({
          id: d.id,
          ...d.data(),
          _origem: "card",
          _nome: card.nomeConta,
          _card: card
        });
      });
    }

    // Cards excluídos
    for (const card of cacheCardsExcluidos) {
      const snap = await getDocs(collection(db, "cards", card.id, "historico"));
      snap.forEach((d) => {
        todos.push({
          id: d.id,
          ...d.data(),
          _origem: "card",
          _nome: card.nomeConta,
          _card: card
        });
      });
    }

    // Histórico global
    const snapGlobal = await getDocs(collection(db, "historicoGlobal"));
    snapGlobal.forEach((d) => {
      todos.push({
        id: d.id,
        ...d.data(),
        _origem: "global",
        _nome: "Kanban"
      });
    });

    todos.sort((a, b) => segundosDe(b.timestamp) - segundosDe(a.timestamp));

    const carregando = caixa.querySelector(".mensagem-carregando");
    if (carregando) carregando.remove();

    const lista = document.createElement("div");
    lista.className = "lista-eventos-historico";

    const barraFiltros = montarBarraFiltrosHistorico((filtros) => {
      const filtrados = todos.filter((ev) => eventoCorrespondeFiltros(ev, filtros));
      renderizarListaEventos(lista, filtrados, true);
    }, "Buscar por coluna, card, telefone, e-mail, razão social ou colaborador...");

    caixa.insertBefore(barraFiltros, botaoFechar);
    caixa.insertBefore(lista, botaoFechar);

    renderizarListaEventos(lista, todos, true);
    substituirIcones(caixa);
  } catch (erro) {
    const carregando = caixa.querySelector(".mensagem-carregando");
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
function criarCampoSeletorColunaAcolhedor(tipoId, rotuloTipo, iconeTipo, idValorInicial, classeTag) {
  const wrapper = document.createElement("div");
  wrapper.className = "campo-seletor-cfg-wrapper";

  const rotulo = document.createElement("label");
  rotulo.className = "rotulo-cfg-seletor";
  rotulo.innerHTML =
    '<span class="selo-cfg-tag ' + classeTag + '">' +
      '<span data-icone="' + iconeTipo + '" data-tamanho="11"></span> ' + rotuloTipo +
    '</span>' +
    '<span class="texto-rotulo-cfg">Coluna para cards "' + rotuloTipo + '"</span>';
  wrapper.appendChild(rotulo);

  const inputHidden = document.createElement("input");
  inputHidden.type = "hidden";
  inputHidden.id = tipoId;
  inputHidden.value = idValorInicial || "";
  wrapper.appendChild(inputHidden);

  const gatilho = document.createElement("button");
  gatilho.type = "button";
  gatilho.className = "gatilho-seletor-cfg";
  gatilho.setAttribute("aria-expanded", "false");

  const mioloGatilho = document.createElement("div");
  mioloGatilho.className = "miolo-gatilho-cfg";

  const pontoGatilho = document.createElement("span");
  pontoGatilho.className = "ponto-cor-coluna";

  const textoGatilho = document.createElement("span");
  textoGatilho.className = "texto-gatilho-cfg";

  mioloGatilho.appendChild(pontoGatilho);
  mioloGatilho.appendChild(textoGatilho);
  gatilho.appendChild(mioloGatilho);

  const chevron = document.createElement("span");
  chevron.className = "chevron-cfg-svg";
  chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  gatilho.appendChild(chevron);

  wrapper.appendChild(gatilho);

  const menuDrop = document.createElement("div");
  menuDrop.className = "menu-seletor-cfg-drop";
  menuDrop.style.display = "none";

  function atualizarVisualGatilho(idSelecionado) {
    const coluna = cacheColunas.find((c) => c.id === idSelecionado);
    if (coluna) {
      pontoGatilho.className = "ponto-cor-coluna ponto-cor-" + (coluna.cor || "lilas");
      textoGatilho.textContent = coluna.nome;
    } else {
      pontoGatilho.className = "ponto-cor-coluna ponto-cor-nenhuma";
      textoGatilho.textContent = "Nenhuma vinculação";
    }
  }

  function fecharDrop() {
    menuDrop.style.display = "none";
    gatilho.classList.remove("aberto");
    gatilho.setAttribute("aria-expanded", "false");
  }

  function abrirDrop() {
    document.querySelectorAll(".menu-seletor-cfg-drop").forEach((m) => {
      if (m !== menuDrop) m.style.display = "none";
    });
    document.querySelectorAll(".gatilho-seletor-cfg").forEach((g) => {
      if (g !== gatilho) g.classList.remove("aberto");
    });
    menuDrop.style.display = "block";
    gatilho.classList.add("aberto");
    gatilho.setAttribute("aria-expanded", "true");
    substituirIcones(menuDrop);
  }

  gatilho.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuDrop.style.display === "none") {
      abrirDrop();
    } else {
      fecharDrop();
    }
  });

  // Opção Nenhuma
  const itemNenhuma = document.createElement("button");
  itemNenhuma.type = "button";
  itemNenhuma.className = "item-opcao-cfg-coluna" + (!idValorInicial ? " ativo" : "");
  itemNenhuma.innerHTML =
    '<span class="ponto-cor-coluna ponto-cor-nenhuma"></span>' +
    '<span class="nome-coluna-cfg">Nenhuma vinculação</span>' +
    '<span class="subtexto-coluna-cfg">(não mover)</span>' +
    '<span class="check-cfg-item" data-icone="check" data-tamanho="12"></span>';

  itemNenhuma.addEventListener("click", (e) => {
    e.stopPropagation();
    inputHidden.value = "";
    atualizarVisualGatilho("");
    menuDrop.querySelectorAll(".item-opcao-cfg-coluna").forEach((el) => el.classList.remove("ativo"));
    itemNenhuma.classList.add("ativo");
    fecharDrop();
  });
  menuDrop.appendChild(itemNenhuma);

  const divisor = document.createElement("div");
  divisor.className = "divisor-cfg-menu";
  menuDrop.appendChild(divisor);

  const tituloSecao = document.createElement("div");
  tituloSecao.className = "titulo-secao-cfg-drop";
  tituloSecao.textContent = "Colunas do Kanban";
  menuDrop.appendChild(tituloSecao);

  cacheColunas.forEach((c) => {
    const item = document.createElement("button");
    item.type = "button";
    const selecionado = idValorInicial === c.id;
    item.className = "item-opcao-cfg-coluna" + (selecionado ? " ativo" : "");

    const cor = c.cor || "lilas";
    const ehFunc = c.tipo === "funcionaria";

    item.innerHTML =
      '<span class="ponto-cor-coluna ponto-cor-' + cor + '"></span>' +
      '<span class="nome-coluna-cfg">' + c.nome + '</span>' +
      (ehFunc ? '<span class="selo-coluna-func-cfg">Automação</span>' : '') +
      '<span class="check-cfg-item" data-icone="check" data-tamanho="12"></span>';

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      inputHidden.value = c.id;
      atualizarVisualGatilho(c.id);
      menuDrop.querySelectorAll(".item-opcao-cfg-coluna").forEach((el) => el.classList.remove("ativo"));
      item.classList.add("ativo");
      fecharDrop();
    });

    menuDrop.appendChild(item);
  });

  wrapper.appendChild(menuDrop);
  atualizarVisualGatilho(idValorInicial);

  return wrapper;
}

function abrirConfiguracoes() {
  menuKanban.classList.remove("aberta");
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";

  const titulo = document.createElement("h3");
  titulo.textContent = "Configurações";
  caixa.appendChild(titulo);

  const textoAjuda = document.createElement("p");
  textoAjuda.className = "texto-ajuda";
  textoAjuda.textContent = "Vincule colunas às marcações. Ao marcar um card, ele será movido automaticamente.";
  caixa.appendChild(textoAjuda);

  const seletorPerdida = criarCampoSeletorColunaAcolhedor(
    "cfg-perdida",
    "Perdida",
    "x",
    configKanban.colunaPerdidaId,
    "selo-cfg-perdida"
  );
  caixa.appendChild(seletorPerdida);

  const seletorFinalizada = criarCampoSeletorColunaAcolhedor(
    "cfg-finalizada",
    "Finalizada",
    "check",
    configKanban.colunaFinalizadaId,
    "selo-cfg-finalizada"
  );
  caixa.appendChild(seletorFinalizada);

  caixa.addEventListener("click", (e) => {
    if (!e.target.closest(".campo-seletor-cfg-wrapper")) {
      caixa.querySelectorAll(".menu-seletor-cfg-drop").forEach((m) => (m.style.display = "none"));
      caixa.querySelectorAll(".gatilho-seletor-cfg").forEach((g) => g.classList.remove("aberto"));
    }
  });

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

  substituirIcones(caixa);
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

function verificarEnviosDeColuna() {
  const agora = Date.now();

  cacheColunas.forEach(async (coluna) => {
    if (coluna.tipo !== "funcionaria") return;

    const cfg = coluna.configFuncionaria || {};
    if (!cfg.dataHoraColuna || !cfg.dataHoraColuna.seconds) return;

    const horarioEnvio = cfg.dataHoraColuna.seconds * 1000;
    if (agora < horarioEnvio) return;

    const cardsDaColuna = cacheCards.filter((c) => c.colunaId === coluna.id);

    for (const card of cardsDaColuna) {
      if (card.entregaColunaEm) continue;

      try {
        await updateDoc(doc(db, "cards", card.id), {
          entregaColunaEm: serverTimestamp(),
          ultimaAtividade: serverTimestamp()
        });
        await registrarHistoricoCard(card.id, "programacao", {
          dataHora: "mensagem da coluna enviada automaticamente"
        });
        await avaliarGatilhoConclusao(card.id);
      } catch (erro) {
        // Silencioso: falha em um card não deve travar os demais.
      }
    }
  });
}

// ------------------------------------------------------------
// REORDENAÇÃO DE COLUNAS (somente administrador)
// ------------------------------------------------------------
let colunaSendoArrastada = null;
let colunaFlutuante = null;
let indicadorPosicao = null;
let temporizadorBotao = null;
let temporizadorParada = null;
let ultimoMouseX = 0;
let ultimoMouseY = 0;
let deslocamentoColunaX = 0;
let deslocamentoColunaY = 0;
let novaOrdemColuna = null;
let arrastoAtivo = false;
let inicioMouseX = 0;
let inicioMouseY = 0;

function iniciarSistemaReordenacao() {
  if (!ehAdmin) return;
  if (kanban.dataset.reordenacaoAtiva === "true") return;
  kanban.dataset.reordenacaoAtiva = "true";

  kanban.addEventListener("contextmenu", (evento) => {
    if (evento.target.closest(".coluna")) evento.preventDefault();
  });

  kanban.addEventListener("selectstart", (evento) => {
    if (temporizadorBotao || arrastoAtivo) {
      evento.preventDefault();
    }
  });

  kanban.addEventListener("dragstart", (evento) => {
    if (arrastoAtivo) {
      evento.preventDefault();
      return;
    }
    if (temporizadorBotao) {
      clearTimeout(temporizadorBotao);
      temporizadorBotao = null;
    }
  });

  kanban.addEventListener("mousedown", (evento) => {
    if (evento.button !== 0) return;
    if (arrastoAtivo) return;
    const coluna = evento.target.closest(".coluna");
    if (!coluna) return;
    if (!evento.target.closest(".cabecalho-coluna") && !evento.target.closest(".corpo-coluna")) return;
    if (evento.target.closest("button")) return;
    if (evento.target.closest(".card-conversa")) return;

    // Impede seleção de texto e arrasto nativo do navegador ao segurar o clique na coluna
    evento.preventDefault();
    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }

    if (temporizadorBotao) {
      clearTimeout(temporizadorBotao);
      temporizadorBotao = null;
    }

    inicioMouseX = evento.clientX;
    inicioMouseY = evento.clientY;
    ultimoMouseX = evento.clientX;
    ultimoMouseY = evento.clientY;
    const colunaId = coluna.dataset.colunaId;

    temporizadorBotao = setTimeout(() => {
      temporizadorBotao = null;
      const colunaAtual =
        kanban.querySelector('.coluna[data-coluna-id="' + colunaId + '"]') || coluna;
      if (!colunaAtual || !colunaAtual.isConnected) return;
      iniciarArrastoColuna(colunaAtual, ultimoMouseX, ultimoMouseY);
    }, 1000);
  });

  document.addEventListener("mousemove", (evento) => {
    if (temporizadorBotao && !arrastoAtivo) {
      const dx = Math.abs(evento.clientX - inicioMouseX);
      const dy = Math.abs(evento.clientY - inicioMouseY);
      if (dx > 10 || dy > 10) {
        clearTimeout(temporizadorBotao);
        temporizadorBotao = null;
      }
    }
    if (arrastoAtivo) {
      evento.preventDefault();
      moverColunaFlutuante(evento);
      atualizarIndicadorPosicao(evento);
    }
  });

  document.addEventListener("mouseup", () => {
    if (temporizadorBotao) {
      clearTimeout(temporizadorBotao);
      temporizadorBotao = null;
    }
    if (arrastoAtivo) {
      finalizarArrastoColuna();
    }
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && arrastoAtivo) {
      cancelarArrastoColuna();
    }
  });
}

function iniciarArrastoColuna(coluna, x, y) {
  const rect = coluna.getBoundingClientRect();
  const cab = coluna.querySelector(".cabecalho-coluna");
  const corpo = coluna.querySelector(".corpo-coluna");
  const alturaVisual = (cab ? cab.offsetHeight : 0) + (corpo ? corpo.offsetHeight : 0) + 5;
  arrastoAtivo = true;
  colunaSendoArrastada = coluna;

  colunaFlutuante = coluna.cloneNode(true);
  colunaFlutuante.classList.remove("coluna-arrastando");
  colunaFlutuante.classList.add("coluna-flutuante-coluna");
  colunaFlutuante.style.minHeight = "0px";
  colunaFlutuante.style.width = rect.width + "px";
  colunaFlutuante.style.height = (alturaVisual || rect.height) + "px";
  colunaFlutuante.style.left = rect.left + "px";
  colunaFlutuante.style.top = rect.top + "px";
  document.body.appendChild(colunaFlutuante);

  deslocamentoColunaX = x - rect.left;
  deslocamentoColunaY = y - rect.top;

  coluna.classList.add("coluna-arrastando");
  kanban.classList.add("arrastando-coluna");

  indicadorPosicao = document.createElement("div");
  indicadorPosicao.className = "indicador-posicao-coluna";
  kanban.insertBefore(indicadorPosicao, coluna);

  novaOrdemColuna = calcularNovaOrdem();

  ultimoMouseX = x;
  ultimoMouseY = y;
  clearTimeout(temporizadorParada);

  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
}

function moverColunaFlutuante(evento) {
  if (!colunaFlutuante) return;
  colunaFlutuante.style.left = (evento.clientX - deslocamentoColunaX) + "px";
  colunaFlutuante.style.top = (evento.clientY - deslocamentoColunaY) + "px";

  const dx = Math.abs(evento.clientX - ultimoMouseX);
  const dy = Math.abs(evento.clientY - ultimoMouseY);
  const emMovimento = dx > 2 || dy > 2;
  if (emMovimento) {
    colunaFlutuante.classList.remove("parada");
    ultimoMouseX = evento.clientX;
    ultimoMouseY = evento.clientY;
    clearTimeout(temporizadorParada);
    temporizadorParada = setTimeout(() => {
      if (colunaFlutuante) colunaFlutuante.classList.add("parada");
    }, 180);
  }

  atualizarAutoScroll(evento.clientX);
}

// ------------------------------------------------------------
// AUTO-SCROLL DO KANBAN DURANTE O ARRASTO DE COLUNA
// Quando o ponteiro chega a 25px de uma borda lateral do kanban,
// a rolagem horizontal avança sozinha, revelando o conteúdo que
// estava fora da tela. A velocidade cresce conforme o ponteiro
// se aproxima da borda.
// ------------------------------------------------------------
const ZONA_BORDA = 25;
const VELOCIDADE_MAXIMA = 18;

let autoScrollAtivo = false;
let direcaoAutoScroll = 0;
let intensidadeAutoScroll = 0;
let quadroAutoScroll = null;

function atualizarAutoScroll(clientX) {
  const rect = kanban.getBoundingClientRect();

  const dentroVertical =
    clientX >= rect.left - ZONA_BORDA &&
    clientX <= rect.right + ZONA_BORDA;

  if (!dentroVertical) {
    pararAutoScroll();
    return;
  }

  const distanciaEsquerda = clientX - rect.left;
  const distanciaDireita = rect.right - clientX;

  if (distanciaEsquerda < ZONA_BORDA) {
    direcaoAutoScroll = -1;
    intensidadeAutoScroll = 1 - Math.max(0, distanciaEsquerda) / ZONA_BORDA;
  } else if (distanciaDireita < ZONA_BORDA) {
    direcaoAutoScroll = 1;
    intensidadeAutoScroll = 1 - Math.max(0, distanciaDireita) / ZONA_BORDA;
  } else {
    pararAutoScroll();
    return;
  }

  intensidadeAutoScroll = Math.min(1, Math.max(0.15, intensidadeAutoScroll));
  iniciarAutoScroll();
}

function iniciarAutoScroll() {
  if (autoScrollAtivo) return;
  autoScrollAtivo = true;
  executarAutoScroll();
}

function executarAutoScroll() {
  if (!autoScrollAtivo) return;

  const velocidade = VELOCIDADE_MAXIMA * intensidadeAutoScroll;
  const antes = kanban.scrollLeft;
  kanban.scrollLeft = antes + direcaoAutoScroll * velocidade;

  if (kanban.scrollLeft !== antes) {
    atualizarIndicadorPosicaoMouse();
  }

  quadroAutoScroll = requestAnimationFrame(executarAutoScroll);
}

function pararAutoScroll() {
  autoScrollAtivo = false;
  direcaoAutoScroll = 0;
  intensidadeAutoScroll = 0;
  if (quadroAutoScroll) {
    cancelAnimationFrame(quadroAutoScroll);
    quadroAutoScroll = null;
  }
}

// Recalcula a posição do indicador usando a última posição do mouse,
// para o indicador acompanhar a rolagem automática.
function atualizarIndicadorPosicaoMouse() {
  if (!indicadorPosicao || !arrastoAtivo) return;
  atualizarIndicadorPosicao({
    clientX: ultimoMouseX,
    clientY: ultimoMouseY
  });
}

function atualizarIndicadorPosicao(evento) {
  const colunas = Array.from(kanban.querySelectorAll(".coluna"));
  if (colunas.length === 0) return;

  let alvo = null;
  let inserirAntes = true;

  for (const col of colunas) {
    const rect = col.getBoundingClientRect();
    const meio = rect.left + rect.width / 2;
    if (evento.clientX < meio) {
      alvo = col;
      inserirAntes = true;
      break;
    }
    alvo = col;
    inserirAntes = false;
  }

  if (alvo) {
    if (inserirAntes) {
      kanban.insertBefore(indicadorPosicao, alvo);
    } else {
      kanban.insertBefore(indicadorPosicao, alvo.nextSibling);
    }
  } else {
    kanban.appendChild(indicadorPosicao);
  }

  novaOrdemColuna = calcularNovaOrdem();
}

function calcularNovaOrdem() {
  const filhos = Array.from(kanban.children);
  const indiceIndicador = filhos.indexOf(indicadorPosicao);
  const colunas = filhos.filter((el) => el.classList.contains("coluna"));

  let destino = 0;
  for (let i = 0; i < indiceIndicador; i++) {
    if (filhos[i].classList.contains("coluna") && filhos[i] !== colunaSendoArrastada) {
      destino++;
    }
  }

  const ordem = colunas
    .filter((c) => c !== colunaSendoArrastada)
    .map((c) => c.dataset.colunaId);

  ordem.splice(destino, 0, colunaSendoArrastada.dataset.colunaId);
  return ordem;
}

async function finalizarArrastoColuna() {
  const ordemFinal = novaOrdemColuna;
  const ordemAnterior = cacheColunas.map((c) => c.id);
  limparEstadoArrastoColuna();

  if (!ordemFinal || ordemFinal.length === 0) return;

  const mudouOrdem =
    ordemFinal.length !== ordemAnterior.length ||
    ordemFinal.some((id, idx) => id !== ordemAnterior[idx]);
  if (!mudouOrdem) return;

  try {
    for (let i = 0; i < ordemFinal.length; i++) {
      await updateDoc(doc(db, "colunas", ordemFinal[i]), { ordem: i });
    }
    await registrarHistoricoGlobal("reordenacao", {
      ordem: ordemFinal.map((id) => {
        const c = cacheColunas.find((x) => x.id === id);
        return c ? c.nome : id;
      }).join(" → ")
    });
    mostrarMensagem("Colunas reordenadas.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao reordenar as colunas.", "erro");
  }
}

function cancelarArrastoColuna() {
  limparEstadoArrastoColuna();
  mostrarMensagem("Reordenação cancelada.", "erro");
}

function limparEstadoArrastoColuna() {
  pararAutoScroll();
  esconderColunaFantasma();

  arrastoAtivo = false;

  if (colunaFlutuante) {
    colunaFlutuante.remove();
    colunaFlutuante = null;
  }

  if (indicadorPosicao) {
    indicadorPosicao.remove();
    indicadorPosicao = null;
  }

  if (colunaSendoArrastada) {
    colunaSendoArrastada.classList.remove("coluna-arrastando");
    colunaSendoArrastada = null;
  }

  kanban.classList.remove("arrastando-coluna");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  novaOrdemColuna = null;

  if (renderizacaoPendente) {
    renderizacaoPendente = false;
    renderizarKanban();
  }
}

async function registrarHistoricoGlobal(tipo, detalhes) {
  try {
    await addDoc(collection(db, "historicoGlobal"), {
      tipo: tipo,
      autor: usuarioAtual,
      detalhes: detalhes || {},
      timestamp: serverTimestamp()
    });
  } catch (erro) {
    // Silencioso: falha no histórico não deve quebrar a ação principal.
  }
}

// ------------------------------------------------------------
// BARRA DE ROLAGEM CUSTOMIZADA
// ------------------------------------------------------------
function montarBarraCustomizada(scrollEl) {
  const wrapper = document.createElement("div");
  wrapper.className = "barra-custom-wrapper";

  const thumb = document.createElement("div");
  thumb.className = "barra-custom-thumb";
  wrapper.appendChild(thumb);

  const container = scrollEl.parentElement;
  if (!container) return;
  container.appendChild(wrapper);

  let arrastando = false;
  let inicioY = 0;
  let scrollInicial = 0;

  function atualizar() {
    const alturaVisivel = scrollEl.clientHeight;
    const alturaTotal = scrollEl.scrollHeight;

    if (alturaTotal <= alturaVisivel + 4) {
      wrapper.classList.remove("visivel");
      return;
    }
    wrapper.classList.add("visivel");

    const alturaWrapper = wrapper.clientHeight;
    const proporcao = alturaVisivel / alturaTotal;
    const alturaThumb = Math.min(
      alturaWrapper,
      Math.max(44, alturaWrapper * proporcao)
    );
    const espacoLivre = alturaWrapper - alturaThumb;
    const progresso = scrollEl.scrollTop / (alturaTotal - alturaVisivel);

    thumb.style.height = alturaThumb + "px";
    thumb.style.top = (progresso * espacoLivre) + "px";
  }

  thumb.addEventListener("mousedown", (evento) => {
    evento.preventDefault();
    arrastando = true;
    inicioY = evento.clientY;
    scrollInicial = scrollEl.scrollTop;
    thumb.classList.add("arrastando");
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (evento) => {
    if (!arrastando) return;
    const alturaVisivel = scrollEl.clientHeight;
    const alturaTotal = scrollEl.scrollHeight;
    const alturaThumb = thumb.offsetHeight;
    const espacoLivre = wrapper.clientHeight - alturaThumb;
    if (espacoLivre <= 0) return;

    const delta = evento.clientY - inicioY;
    const deltaScroll = (delta / espacoLivre) * (alturaTotal - alturaVisivel);
    scrollEl.scrollTop = scrollInicial + deltaScroll;
  });

  document.addEventListener("mouseup", () => {
    if (!arrastando) return;
    arrastando = false;
    thumb.classList.remove("arrastando");
    document.body.style.userSelect = "";
  });

  wrapper.addEventListener("mousedown", (evento) => {
    if (evento.target === thumb) return;
    const rect = wrapper.getBoundingClientRect();
    const cliqueY = evento.clientY - rect.top;
    const proporcao = cliqueY / rect.height;
    const alturaTotal = scrollEl.scrollHeight;
    const alturaVisivel = scrollEl.clientHeight;
    scrollEl.scrollTop = proporcao * (alturaTotal - alturaVisivel);
  });

  scrollEl.addEventListener("scroll", atualizar);
  window.addEventListener("resize", atualizar);

  if (window.ResizeObserver) {
    const observador = new ResizeObserver(atualizar);
    observador.observe(scrollEl);
  }

  atualizar();
  return { atualizar };
}