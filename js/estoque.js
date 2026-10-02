// ============================================================
// PROJETO GOLDEN — Lógica do módulo de Estoque (versão 5)
// ============================================================
// ⚠️ ALTERAÇÕES DESTA VERSÃO:
// 1. ORDENAÇÃO DA TABELA: seletor "Ordenar por" com 7 critérios
//    (código, alfabética, numérica, categoria, maior/menor
//    quantidade, edição mais recente/antiga).
// 2. MENU SANDUÍCHE (☰): "Resetar tabela" (limpa busca e volta
//    à ordenação padrão) e "Editar categorias".
// 3. COLEÇÃO NOVA "categorias": nome, tipo, descrição opcional e
//    cor pastel (12 tons). Categorias são criadas/editadas pelo
//    usuário no gerenciador — o seletor do cadastro é alimentado
//    por elas.
// 4. COR DA CATEGORIA: sorteio automático (escolhe a cor menos
//    usada) e troca manual na edição, via paleta de 12 tons.
// 5. RENOMEAR CATEGORIA atualiza todos os produtos marcados com
//    o nome antigo — SEM gerar eventos no histórico (decisão de
//    projeto: ajuste de catálogo não é movimentação de estoque).
// 6. TABELA exibe a categoria como etiqueta com a cor dela.
// 7. Edição de produto grava "atualizadoEm" (base das ordenações
//    por edição mais recente/antiga).
// ⚠️ ESTE ARQUIVO É ENTREGUE EM 2 PARTES: cole a Parte 1 e, em
// seguida, a Parte 2 imediatamente após — juntas formam o arquivo.
// ============================================================

import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged, signOut } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection, addDoc, updateDoc, doc, onSnapshot,
  query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
// LISTA DE ADMINISTRADORES + CARGOS AUTORIZADOS
// ------------------------------------------------------------
const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];
const CARGOS_AUTORIZADOS = ["estoque", "administracao"];

// ------------------------------------------------------------
// REGEX DO CÓDIGO DE PRODUTO (padrão NN.NNN-XX, ex.: 11.111-CG)
// ------------------------------------------------------------
const REGEX_CODIGO = /^\d{2}\.\d{3}-[A-Z]{2}$/;

// ------------------------------------------------------------
// PALETA DE 12 CORES PASTÉIS
// Cada categoria recebe uma cor de identificação. O sorteio
// automático escolhe a cor MENOS usada (para distribuir bem);
// o usuário pode trocar na edição da categoria.
// ------------------------------------------------------------
const PALETA_CORES = [
  "#FFD6D6", // rosa claro
  "#FFE3B3", // pêssego
  "#FFF3B0", // amarelo claro
  "#D9F2D0", // verde claro
  "#C9EDE4", // menta
  "#CDE4F7", // azul claro
  "#D9D2F7", // lilás
  "#F2D2F7", // lavanda
  "#F7D2E3", // rosa
  "#E8E3D5", // bege
  "#D5E8E3", // verde água
  "#F0E0C8"  // areia
];

// ------------------------------------------------------------
// MÁSCARA DO CÓDIGO: "11111cg" → "11.111-CG"
// Maiúsculas → remove símbolos → separa até 5 dígitos e até 2
// letras → insere ponto após o 2º dígito e traço antes das
// letras quando os 5 dígitos estão completos.
// ------------------------------------------------------------
function formatarCodigo(texto) {
  const limpo = texto.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const digitos = (limpo.match(/^\d{0,5}/) || [""])[0];
  const letras = (limpo.slice(digitos.length).match(/^[A-Z]{0,2}/) || [""])[0];

  let formatado = digitos;

  if (digitos.length > 2) {
    formatado = digitos.slice(0, 2) + "." + digitos.slice(2);
  }

  if (digitos.length === 5 && letras.length > 0) {
    formatado += "-" + letras;
  }

  return formatado;
}

// ------------------------------------------------------------
// Capturando os elementos da tela
// ------------------------------------------------------------
const conteudoProtegido = document.getElementById("conteudo-protegido");
const nomeUsuario = document.getElementById("nome-usuario");
const avatar = document.getElementById("avatar");
const acessoNegado = document.getElementById("acesso-negado");
const conteudoEstoque = document.getElementById("conteudo-estoque");

// Cabeçalho
const botaoVoltar = document.getElementById("botao-voltar");
const botaoPerfil = document.getElementById("botao-perfil");
const menuPerfil = document.getElementById("menu-perfil");
const itemConfiguracoes = document.getElementById("item-configuracoes");
const itemSair = document.getElementById("item-sair");

// Menu lateral e painéis
const itensMenu = document.querySelectorAll(".item-menu");
const paineis = document.querySelectorAll(".painel");

// Cadastro de produto
const formProduto = document.getElementById("form-produto");
const campoFoto = document.getElementById("foto-produto");
const previewFoto = document.getElementById("preview-foto");
const campoCodigo = document.getElementById("codigo-produto");
const campoNome = document.getElementById("nome-produto");
const campoCategoria = document.getElementById("categoria-produto");
const campoDescricao = document.getElementById("descricao-produto");
const campoQuantidade = document.getElementById("quantidade-produto");
const campoValor = document.getElementById("valor-produto");
const campoPeso = document.getElementById("peso-produto");
const botaoCadastrar = document.getElementById("botao-cadastrar-produto");

// Movimentações
const formEntrada = document.getElementById("form-entrada");
const selectEntradaProduto = document.getElementById("entrada-produto");
const campoEntradaQtd = document.getElementById("entrada-quantidade");
const campoEntradaOrigem = document.getElementById("entrada-origem");
const campoEntradaPedido = document.getElementById("entrada-pedido");
const botaoEntrada = document.getElementById("botao-entrada");

const formSaida = document.getElementById("form-saida");
const selectSaidaProduto = document.getElementById("saida-produto");
const campoSaidaQtd = document.getElementById("saida-quantidade");
const campoSaidaDestino = document.getElementById("saida-destino");
const campoSaidaPedido = document.getElementById("saida-pedido");
const botaoSaida = document.getElementById("botao-saida");

// Tabela, controles e histórico
const campoBusca = document.getElementById("busca-produto");
const seletorOrdenacao = document.getElementById("ordenar-por");
const botaoMenuTabela = document.getElementById("botao-menu-tabela");
const menuTabela = document.getElementById("menu-tabela");
const itemResetar = document.getElementById("item-resetar");
const itemEditarCategorias = document.getElementById("item-editar-categorias");
const corpoTabela = document.getElementById("corpo-tabela");
const semProdutos = document.getElementById("sem-produtos");
const listaHistorico = document.getElementById("lista-historico");
// Filtros do histórico (NOVO): busca por código/nome + seletor de tipo.
const campoBuscaHistorico = document.getElementById("busca-historico");
const seletorFiltroHistorico = document.getElementById("filtro-historico");

// Modal genérico
const modalOverlay = document.getElementById("modal-overlay");
const modalConteudo = document.getElementById("modal-conteudo");

const areaMensagem = document.getElementById("mensagem");

// ------------------------------------------------------------
// ESTADO DA PÁGINA
// ------------------------------------------------------------
let cacheProdutos = [];        // produtos ativos (sem excluídos)
let cacheMovimentacoes = [];   // histórico completo
let cacheCategorias = [];      // catálogo de categorias
let fotoSelecionada = null;    // foto do cadastro (base64)
let fotoEdicaoSelecionada = null; // foto escolhida na edição
let edicaoModificada = false;  // guarda do modal de edição
let ordenacaoAtual = "codigo"; // critério ativo do "Ordenar por"
let corEdicaoSelecionada = null;  // cor escolhida na edição de categoria
let categoriaEdicaoModificada = false; // guarda do modal de categoria
let categoriasSemeadas = false; // controla a criação inicial das 5 categorias

function mostrarMensagem(texto, tipo) {
  areaMensagem.textContent = texto;
  areaMensagem.className = "mensagem " + tipo;
}

// ------------------------------------------------------------
// MODAL: abrir/fechar
// appendChild MOVE o elemento para dentro da caixa branca.
// ------------------------------------------------------------
function abrirModal(conteudo) {
  modalConteudo.innerHTML = "";
  modalConteudo.appendChild(conteudo);
  modalOverlay.style.display = "flex";
}

function fecharModal() {
  modalOverlay.style.display = "none";
  modalConteudo.innerHTML = "";
  fotoEdicaoSelecionada = null;
  edicaoModificada = false;
  corEdicaoSelecionada = null;
  categoriaEdicaoModificada = false;
}

// ------------------------------------------------------------
// MÁSCARA AO VIVO NO CAMPO CÓDIGO (cadastro)
// ------------------------------------------------------------
campoCodigo.addEventListener("input", () => {
  const formatado = formatarCodigo(campoCodigo.value);
  if (campoCodigo.value !== formatado) {
    campoCodigo.value = formatado;
  }
});

// ------------------------------------------------------------
// PROTEÇÃO DA PÁGINA + SAUDAÇÃO COM O PRIMEIRO NOME
// ------------------------------------------------------------
onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  const ehAdminEmail = ADMINISTRADORES.includes((usuario.email || "").toLowerCase());
  let autorizado = ehAdminEmail;

  if (!autorizado) {
    autorizado = await usuarioTemCargoAutorizado(usuario.email);
  }

  if (!autorizado) {
    conteudoProtegido.classList.remove("oculto");
    acessoNegado.style.display = "block";
    return;
  }

  conteudoProtegido.classList.remove("oculto");

  const nomeCompleto = usuario.displayName || (usuario.email || "").split("@")[0];
  const primeiroNome = nomeCompleto.split(" ")[0];
  nomeUsuario.textContent = primeiroNome;
  avatar.textContent = primeiroNome.charAt(0).toUpperCase();

  conteudoEstoque.style.display = "block";
  escutarProdutos();
  escutarMovimentacoes();
  escutarCategorias();
});

// ------------------------------------------------------------
// VERIFICA O CARGO DO USUÁRIO NO BANCO
// Padrão seguro: erro na consulta = NEGAR o acesso.
// ------------------------------------------------------------
async function usuarioTemCargoAutorizado(email) {
  try {
    const resultado = await getDocs(collection(db, "solicitacoes"));
    let autorizado = false;

    resultado.forEach((documento) => {
      const dados = documento.data();
      const mesmoEmail = (dados.email || "").toLowerCase() === email.toLowerCase();

      if (mesmoEmail &&
          dados.status === "aprovada" &&
          CARGOS_AUTORIZADOS.includes(dados.cargo)) {
        autorizado = true;
      }
    });

    return autorizado;
  } catch (erro) {
    return false;
  }
}

// ------------------------------------------------------------
// HELPER: ativar um painel do menu lateral
// ------------------------------------------------------------
function ativarPainel(nome) {
  itensMenu.forEach((i) =>
    i.classList.toggle("ativo", i.dataset.painel === nome));
  paineis.forEach((p) =>
    p.classList.toggle("visivel", p.id === "painel-" + nome));
}

// ------------------------------------------------------------
// NAVEGAÇÃO DO MENU LATERAL
// ------------------------------------------------------------
itensMenu.forEach((item) => {
  item.addEventListener("click", () => {
    ativarPainel(item.dataset.painel);
  });
});

// ------------------------------------------------------------
// BOTÃO VOLTAR (com confirmação)
// ------------------------------------------------------------
botaoVoltar.addEventListener("click", () => {
  const querVoltar = window.confirm("Deseja realmente voltar para a página inicial?");
  if (querVoltar) {
    window.location.href = "home.html";
  }
});

// ------------------------------------------------------------
// MENUS FLUTUANTES (perfil e sanduíche) + FECHAMENTO GLOBAL
// Um único ouvinte no documento fecha os três menus possíveis
// (perfil, sanduíche e menu dos três pontinhos) ao clicar fora.
// ------------------------------------------------------------
botaoPerfil.addEventListener("click", () => {
  menuTabela.classList.remove("aberta");
  menuPerfil.classList.toggle("aberta");
});

botaoMenuTabela.addEventListener("click", () => {
  menuPerfil.classList.remove("aberta");
  menuTabela.classList.toggle("aberta");
});

document.addEventListener("click", (evento) => {
  // Fecha o menu de perfil...
  if (!menuPerfil.contains(evento.target) && !botaoPerfil.contains(evento.target)) {
    menuPerfil.classList.remove("aberta");
  }
  // ...o menu sanduíche...
  if (!menuTabela.contains(evento.target) && !botaoMenuTabela.contains(evento.target)) {
    menuTabela.classList.remove("aberta");
  }
  // ...e o menu dos três pontinhos (se existir).
  const menuOpcoes = document.getElementById("menu-opcoes");
  if (menuOpcoes &&
      !menuOpcoes.contains(evento.target) &&
      !evento.target.classList.contains("botao-tres-pontos")) {
    fecharMenuOpcoes();
  }
});

itemConfiguracoes.addEventListener("click", () => {
  menuPerfil.classList.remove("aberta");
  mostrarMensagem("Configurações estarão disponíveis em breve.", "sucesso");
});

itemSair.addEventListener("click", async () => {
  menuPerfil.classList.remove("aberta");

  const querSair = window.confirm("Deseja realmente sair do sistema?");
  if (!querSair) return;

  await signOut(auth);
  window.location.href = "index.html";
});

// ------------------------------------------------------------
// ORDENAR POR — troca de critério
// Ao trocar: reordena o cache, redesenha a tabela e reaplica
// o filtro de busca (para a ordenação valer também com busca ativa).
// ------------------------------------------------------------
seletorOrdenacao.addEventListener("change", () => {
  ordenacaoAtual = seletorOrdenacao.value;
  ordenarProdutos();
  renderizarTabela();
  aplicarFiltros();
});

// ------------------------------------------------------------
// MENU SANDUÍCHE — ações
// ------------------------------------------------------------
// RESETAR TABELA: limpa a busca, volta à ordenação padrão,
// redesenha tudo e remove os filtros das linhas.
itemResetar.addEventListener("click", () => {
  menuTabela.classList.remove("aberta");

  campoBusca.value = "";
  seletorOrdenacao.value = "codigo";
  ordenacaoAtual = "codigo";

  ordenarProdutos();
  renderizarTabela();
  aplicarFiltros();

  mostrarMensagem("Tabela resetada.", "sucesso");
});

// EDITAR CATEGORIAS: abre o gerenciador em modal.
itemEditarCategorias.addEventListener("click", () => {
  menuTabela.classList.remove("aberta");
  abrirGerenciadorCategorias();
});

// ------------------------------------------------------------
// ESCUTAR PRODUTOS EM TEMPO REAL
// Filtra excluídos, aplica a ordenação ativa e redesenha.
// ------------------------------------------------------------
function escutarProdutos() {
  onSnapshot(collection(db, "produtos"), (resultado) => {
    cacheProdutos = [];
    resultado.forEach((documento) => {
      cacheProdutos.push({ id: documento.id, ...documento.data() });
    });

    cacheProdutos = cacheProdutos.filter((p) => !p.excluido);
    ordenarProdutos();

    renderizarTabela();
    preencherSeletor(selectEntradaProduto);
    preencherSeletor(selectSaidaProduto);
  });
}

// ------------------------------------------------------------
// ORDENAR PRODUTOS (switch do critério ativo)
// Para "edição mais recente/antiga" usamos atualizadoEm (gravado
// a cada edição) com fallback para criadoEm (produtos nunca
// editados). O operador || devolve o primeiro valor "verdadeiro".
// ------------------------------------------------------------
function ordenarProdutos() {
  const segundos = (t) => (t && t.seconds) || 0;

  switch (ordenacaoAtual) {
    case "alfabetica":
      cacheProdutos.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
      break;

    case "numerica":
      cacheProdutos.sort((a, b) => a.codigo.localeCompare(b.codigo));
      break;

    case "categoria":
      cacheProdutos.sort((a, b) =>
        a.categoria.localeCompare(b.categoria) ||
        a.codigo.localeCompare(b.codigo));
      break;

    case "maiorQtd":
      cacheProdutos.sort((a, b) => b.quantidade - a.quantidade);
      break;

    case "menorQtd":
      cacheProdutos.sort((a, b) => a.quantidade - b.quantidade);
      break;

    case "edicaoRecente":
      cacheProdutos.sort((a, b) =>
        segundos(b.atualizadoEm || b.criadoEm) -
        segundos(a.atualizadoEm || a.criadoEm));
      break;

    case "edicaoAntiga":
      cacheProdutos.sort((a, b) =>
        segundos(a.atualizadoEm || a.criadoEm) -
        segundos(b.atualizadoEm || b.criadoEm));
      break;

    default: // "codigo" — padrão
      cacheProdutos.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
}

// ------------------------------------------------------------
// ESCUTAR MOVIMENTAÇÕES EM TEMPO REAL (histórico)
// ------------------------------------------------------------
function escutarMovimentacoes() {
  onSnapshot(collection(db, "movimentacoes"), (resultado) => {
    cacheMovimentacoes = [];
    resultado.forEach((documento) => {
      cacheMovimentacoes.push({ id: documento.id, ...documento.data() });
    });

    cacheMovimentacoes.sort((a, b) => (b.dataHora?.seconds || 0) - (a.dataHora?.seconds || 0));

    renderizarHistorico();
  });
}

// ------------------------------------------------------------
// ESCUTAR CATEGORIAS EM TEMPO REAL
// Alimenta o gerenciador, os seletores e as cores da tabela.
// SEMEADURA INICIAL: se a coleção estiver vazia na primeira
// leitura, criamos as 5 categorias clássicas com cores sorteadas
// — assim o sistema já nasce utilizável.
// ------------------------------------------------------------
function escutarCategorias() {
  onSnapshot(collection(db, "categorias"), async (resultado) => {
    cacheCategorias = [];
    resultado.forEach((documento) => {
      cacheCategorias.push({ id: documento.id, ...documento.data() });
    });

    cacheCategorias.sort((a, b) => a.nome.localeCompare(b.nome));

    // Semeadura: apenas uma vez, e só se o banco estiver vazio.
    if (cacheCategorias.length === 0 && !categoriasSemeadas) {
      categoriasSemeadas = true;
      await semearCategorias();
    }

    renderizarTabela();
    preencherSeletorCategorias();
  });
}

// ------------------------------------------------------------
// SEMEAR CATEGORIAS PADRÃO
// Cria as 5 categorias clássicas do sistema, cada uma com uma
// cor diferente da paleta (índice i garante cores distintas).
// ------------------------------------------------------------
async function semearCategorias() {
  const iniciais = [
    { nome: "Cabos", tipo: "Cabos e fios elétricos", descricao: "" },
    { nome: "Conectores", tipo: "Conexões e terminais", descricao: "" },
    { nome: "Ferramentas", tipo: "Ferramentas manuais e elétricas", descricao: "" },
    { nome: "Acessórios", tipo: "Acessórios diversos", descricao: "" },
    { nome: "Outros", tipo: "Itens sem categoria específica", descricao: "" }
  ];

  for (let i = 0; i < iniciais.length; i++) {
    await addDoc(collection(db, "categorias"), {
      ...iniciais[i],
      cor: PALETA_CORES[i % PALETA_CORES.length],
      criadoPor: auth.currentUser.email,
      criadoEm: serverTimestamp()
    });
  }
}

// ------------------------------------------------------------
// PREENCHER O SELETOR DE CATEGORIAS DO CADASTRO
// Agora dinâmico: uma <option> por categoria criada.
// ------------------------------------------------------------
function preencherSeletorCategorias() {
  const atual = campoCategoria.value;

  campoCategoria.innerHTML =
    '<option value="" disabled selected>Selecione a categoria...</option>';

  cacheCategorias.forEach((categoria) => {
    const opcao = document.createElement("option");
    opcao.value = categoria.nome;
    opcao.textContent = categoria.nome;
    campoCategoria.appendChild(opcao);
  });

  if (atual) campoCategoria.value = atual;
}

// ------------------------------------------------------------
// FOTO DO CADASTRO: pré-visualização + redimensionamento
// ------------------------------------------------------------
campoFoto.addEventListener("change", () => {
  const arquivo = campoFoto.files[0];

  if (!arquivo) {
    fotoSelecionada = null;
    previewFoto.style.display = "none";
    return;
  }

  processarFoto(arquivo, (base64) => {
    fotoSelecionada = base64;
    previewFoto.src = base64;
    previewFoto.style.display = "block";
  });
});

// ------------------------------------------------------------
// CADASTRAR PRODUTO
// ------------------------------------------------------------
formProduto.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const codigo = campoCodigo.value.trim().toUpperCase();
  const nome = campoNome.value.trim();
  const descricao = campoDescricao.value.trim();
  const quantidade = parseInt(campoQuantidade.value, 10);
  const categoria = campoCategoria.value;

  const valorCusto = campoValor.value === "" ? 0 : parseFloat(campoValor.value);
  const pesoUnitario = campoPeso.value === "" ? 0 : parseFloat(campoPeso.value);

  if (!codigo || !nome || !descricao) {
    mostrarMensagem("Preencha código, nome e descrição.", "erro");
    return;
  }

  if (!categoria) {
    mostrarMensagem("Selecione a categoria do produto.", "erro");
    return;
  }

  if (!(quantidade > 0)) {
    mostrarMensagem("Informe uma quantidade inicial positiva.", "erro");
    return;
  }

  if (!REGEX_CODIGO.test(codigo)) {
    mostrarMensagem(
      "Código incompleto. Digite 5 números e 2 letras (ex.: 11111CG).",
      "erro"
    );
    return;
  }

  if (valorCusto < 0 || pesoUnitario < 0) {
    mostrarMensagem("Custo e peso não podem ser negativos.", "erro");
    return;
  }

  botaoCadastrar.disabled = true;

  try {
    const consulta = query(
      collection(db, "produtos"),
      where("codigo", "==", codigo)
    );
    const existentes = await getDocs(consulta);

    if (!existentes.empty) {
      mostrarMensagem(
        "Já existe um produto com o código " + codigo + ".",
        "erro"
      );
      return;
    }

    const nomeCriador = await obterNomeUsuario(auth.currentUser.email);

    await addDoc(collection(db, "produtos"), {
      codigo: codigo,
      nome: nome,
      categoria: categoria,
      descricao: descricao,
      quantidade: quantidade,
      valorCusto: valorCusto,
      pesoUnitario: pesoUnitario,
      foto: fotoSelecionada || null,
      criadoPor: auth.currentUser.email,
      criadoPorNome: nomeCriador,
      criadoEm: serverTimestamp()
    });

    mostrarMensagem("Produto cadastrado com sucesso!", "sucesso");
    formProduto.reset();
    fotoSelecionada = null;
    previewFoto.style.display = "none";

    ativarPainel("estoque");

  } catch (erro) {
    mostrarMensagem("Erro ao cadastrar o produto. Tente novamente.", "erro");

  } finally {
    botaoCadastrar.disabled = false;
  }
});

// ------------------------------------------------------------
// RENDERIZAR A TABELA DE PRODUTOS
// NOVIDADE: a célula de categoria agora é uma ETIQUETA COLORIDA
// — procuramos a categoria no cache para pegar a cor dela.
// Categoria sem registro no catálogo (produtos antigos) ganha
// cinza neutro.
// ------------------------------------------------------------
function renderizarTabela() {
  if (cacheProdutos.length === 0) {
    corpoTabela.innerHTML =
      '<tr><td colspan="7" class="texto-ajuda">Nenhum produto cadastrado ainda.</td></tr>';
    semProdutos.style.display = "none";
    return;
  }

  corpoTabela.innerHTML = "";

  cacheProdutos.forEach((produto) => {
    const linha = document.createElement("tr");
    linha.className = "linha-produto";

    const codigoCompacto = produto.codigo.replace(/[^A-Z0-9]/g, "").toLowerCase();

    linha.dataset.busca = (
      produto.codigo + " " +
      codigoCompacto + " " +
      (produto.nome || "") + " " +
      produto.categoria + " " +
      produto.descricao
    ).toLowerCase();

    const celulaFoto = produto.foto
      ? '<img src="' + produto.foto + '" class="foto-produto" alt="Foto do produto">'
      : '<span class="foto-vazia">📷</span>';

    // Cor da categoria: busca no catálogo; fallback cinza.
    const cat = cacheCategorias.find((c) => c.nome === produto.categoria);
    const corCat = cat ? cat.cor : "#e0e0e0";

    linha.innerHTML =
      "<td>" + celulaFoto + "</td>" +
      '<td class="celula-codigo">' + produto.codigo + "</td>" +
      "<td>" + (produto.nome || "—") + "</td>" +
      '<td><span class="etiqueta-categoria" style="background:' + corCat + '">' +
        produto.categoria + "</span></td>" +
      "<td>" + produto.quantidade + "</td>" +
      "<td>" + produto.descricao + "</td>";

    const celulaAcoes = document.createElement("td");
    const botaoTresPontos = document.createElement("button");
    botaoTresPontos.textContent = "⋮";
    botaoTresPontos.className = "botao-tres-pontos";
    botaoTresPontos.title = "Opções";
    botaoTresPontos.addEventListener("click", (evento) => {
      evento.stopPropagation();
      abrirMenuOpcoes(botaoTresPontos, produto);
    });
    celulaAcoes.appendChild(botaoTresPontos);
    linha.appendChild(celulaAcoes);

    corpoTabela.appendChild(linha);
  });
}

// ------------------------------------------------------------
// BUSCA NA TABELA (aplicarFiltros)
// ------------------------------------------------------------
function aplicarFiltros() {
  const termo = campoBusca.value.trim().toLowerCase();
  let visiveis = 0;

  corpoTabela.querySelectorAll(".linha-produto").forEach((linha) => {
    const texto = linha.dataset.busca || "";
    const corresponde = texto.includes(termo);

    linha.style.display = corresponde ? "" : "none";
    if (corresponde) visiveis++;
  });

  semProdutos.style.display =
    (visiveis === 0 && cacheProdutos.length > 0) ? "block" : "none";
}

campoBusca.addEventListener("input", aplicarFiltros);
// ============================================================
// PARTE 2 — movimentações, histórico, edição de produto,
// menu dos três pontinhos e GERENCIADOR DE CATEGORIAS.
// ============================================================

// ------------------------------------------------------------
// PREENCHER UM SELETOR DE PRODUTOS (entrada e saída)
// ------------------------------------------------------------
function preencherSeletor(seletor) {
  const selecaoAtual = seletor.value;

  seletor.innerHTML =
    '<option value="" disabled selected>Selecione o produto...</option>';

  cacheProdutos.forEach((produto) => {
    const opcao = document.createElement("option");
    opcao.value = produto.id;
    opcao.textContent =
      produto.codigo + " — " + (produto.nome || produto.descricao) +
      " (saldo: " + produto.quantidade + ")";
    seletor.appendChild(opcao);
  });

  if (selecaoAtual) seletor.value = selecaoAtual;
}

// ------------------------------------------------------------
// REGISTRAR MOVIMENTAÇÃO (função compartilhada)
// ------------------------------------------------------------
async function registrarMovimentacao(
  tipo, seletor, campoQtd, campoLocal, campoPed, botao
) {
  const produtoId = seletor.value;
  const quantidade = parseInt(campoQtd.value, 10);
  const local = campoLocal.value.trim();
  const pedido = campoPed.value.trim();

  const produto = cacheProdutos.find((p) => p.id === produtoId);

  if (!produto) {
    mostrarMensagem("Selecione um produto válido.", "erro");
    return;
  }

  if (!(quantidade > 0)) {
    mostrarMensagem("Informe uma quantidade positiva.", "erro");
    return;
  }

  if (!local) {
    mostrarMensagem(
      tipo === "entrada"
        ? "Informe a origem da entrada."
        : "Informe o destino da saída.",
      "erro"
    );
    return;
  }

  if (tipo === "saida" && quantidade > produto.quantidade) {
    mostrarMensagem(
      "Saldo insuficiente: o produto " + produto.codigo +
      " possui apenas " + produto.quantidade + " un. em estoque.",
      "erro"
    );
    return;
  }

  botao.disabled = true;

  try {
    const novoSaldo = tipo === "entrada"
      ? produto.quantidade + quantidade
      : produto.quantidade - quantidade;

    await updateDoc(doc(db, "produtos", produtoId), {
      quantidade: novoSaldo
    });

    await addDoc(collection(db, "movimentacoes"), {
      produtoId: produtoId,
      codigo: produto.codigo,
      nome: produto.nome || "",
      descricao: produto.descricao,
      tipo: tipo,
      quantidade: quantidade,
      origemDestino: local,
      pedido: pedido || "—",
      responsavel: auth.currentUser.email,
      dataHora: serverTimestamp()
    });

    mostrarMensagem(
      "Movimentação registrada! Novo saldo de " +
      produto.codigo + ": " + novoSaldo + " un.",
      "sucesso"
    );

    if (tipo === "entrada") formEntrada.reset();
    else formSaida.reset();

  } catch (erro) {
    mostrarMensagem("Erro ao registrar a movimentação. Tente novamente.", "erro");

  } finally {
    botao.disabled = false;
  }
}

formEntrada.addEventListener("submit", (evento) => {
  evento.preventDefault();
  registrarMovimentacao(
    "entrada", selectEntradaProduto, campoEntradaQtd,
    campoEntradaOrigem, campoEntradaPedido, botaoEntrada
  );
});

formSaida.addEventListener("submit", (evento) => {
  evento.preventDefault();
  registrarMovimentacao(
    "saida", selectSaidaProduto, campoSaidaQtd,
    campoSaidaDestino, campoSaidaPedido, botaoSaida
  );
});

// ------------------------------------------------------------
// RENDERIZAR O HISTÓRICO (4 tipos de evento)
// ------------------------------------------------------------
function renderizarHistorico() {
  // NOVO — FILTROS DO HISTÓRICO
  // O método "filter" devolve um novo array só com os eventos
  // que passam nas duas condições (tipo E texto).
  const termo = campoBuscaHistorico.value.trim().toLowerCase();
  const tipoFiltro = seletorFiltroHistorico.value;

  const listaFiltrada = cacheMovimentacoes.filter((mov) => {
    // Condição 1 — tipo: "todas" passa tudo; senão compara.
    if (tipoFiltro !== "todas" && mov.tipo !== tipoFiltro) {
      return false;
    }

    // Condição 2 — texto: compara o termo com código e nome
    // do evento, tudo em minúsculas.
    if (termo) {
      const texto = (mov.codigo + " " + (mov.nome || "")).toLowerCase();
      if (!texto.includes(termo)) {
        return false;
      }
    }

    return true;
  });

  // Mensagem diferente conforme o caso: banco vazio ou filtros
  // que não encontraram nada.
  if (listaFiltrada.length === 0) {
    listaHistorico.innerHTML =
      cacheMovimentacoes.length === 0
        ? '<p class="texto-ajuda">Nenhuma movimentação registrada ainda.</p>'
        : '<p class="texto-ajuda">Nenhum registro encontrado para os filtros aplicados.</p>';
    return;
  }

  listaHistorico.innerHTML = "";

  listaFiltrada.forEach((mov) => {
    const cartao = document.createElement("div");
    cartao.className = "cartao-movimento " + classeDoTipo(mov.tipo);

    const quando = mov.dataHora
      ? new Date(mov.dataHora.seconds * 1000).toLocaleString("pt-BR")
      : "registrando...";

    cartao.innerHTML =
      '<span class="etiqueta-status ' + etiquetaDoTipo(mov.tipo) + '">' +
        rotuloDoTipo(mov.tipo) +
      "</span>" +
      "<strong>" + mov.codigo + "</strong>" +
      (mov.nome ? " — " + mov.nome : "") + "<br>" +
      (mov.tipo === "entrada" || mov.tipo === "saida"
        ? "<strong>" + mov.quantidade + " un.</strong>" +
          ' <span class="texto-ajuda">(' +
          (mov.tipo === "entrada" ? "de " : "para ") +
          mov.origemDestino + ")</span><br>"
        : "") +
      (mov.detalhes
        ? '<span class="texto-ajuda">Alterações: ' + mov.detalhes + "</span><br>"
        : "") +
      '<span class="texto-ajuda">Pedido: ' + mov.pedido +
        " · Responsável: " + mov.responsavel + "</span><br>" +
      '<span class="texto-ajuda">' + quando + "</span>";

    listaHistorico.appendChild(cartao);
  });
}

function classeDoTipo(tipo) {
  if (tipo === "entrada") return "movimento-entrada";
  if (tipo === "saida") return "movimento-saida";
  if (tipo === "edicao") return "movimento-edicao";
  return "movimento-exclusao";
}

function etiquetaDoTipo(tipo) {
  if (tipo === "entrada") return "etiqueta-aprovada";
  if (tipo === "saida") return "etiqueta-bloqueada";
  if (tipo === "edicao") return "etiqueta-pendente";
  return "etiqueta-excluida";
}

function rotuloDoTipo(tipo) {
  if (tipo === "entrada") return "Entrada";
  if (tipo === "saida") return "Saída";
  if (tipo === "edicao") return "Edição";
  return "Exclusão";
}

// ------------------------------------------------------------
// NOVO — OUVINTES DOS FILTROS DO HISTÓRICO
// Qualquer digitação na busca ou troca no seletor re-renderiza
// o histórico — a função já aplica os filtros internamente.
// Roda UMA VEZ no carregamento da página (nível do arquivo),
// por isso fica FORA de qualquer função.
// ------------------------------------------------------------
campoBuscaHistorico.addEventListener("input", renderizarHistorico);
seletorFiltroHistorico.addEventListener("change", renderizarHistorico);

// ------------------------------------------------------------
// PROCESSAR FOTO (ler → redimensionar 300px → comprimir JPEG)
// ------------------------------------------------------------
function processarFoto(arquivo, quandoPronto) {
  const leitor = new FileReader();

  leitor.onload = () => {
    const img = new Image();

    img.onload = () => {
      const maxLado = 300;
      let largura = img.width;
      let altura = img.height;

      if (largura > altura && largura > maxLado) {
        altura = Math.round(altura * (maxLado / largura));
        largura = maxLado;
      } else if (altura > maxLado) {
        largura = Math.round(largura * (maxLado / altura));
        altura = maxLado;
      }

      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      canvas.getContext("2d").drawImage(img, 0, 0, largura, altura);

      quandoPronto(canvas.toDataURL("image/jpeg", 0.7));
    };

    img.src = leitor.result;
  };

  leitor.readAsDataURL(arquivo);
}

// ------------------------------------------------------------
// NOME COMPLETO DO USUÁRIO (buscado no cadastro de usuários)
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
// ÚLTIMO MOVIMENTO DE UM PRODUTO
// ------------------------------------------------------------
function ultimoMovimento(produtoId) {
  return cacheMovimentacoes.find((m) => m.produtoId === produtoId) || null;
}

function descreverUltimoMovimento(produtoId) {
  const ultimo = ultimoMovimento(produtoId);
  if (!ultimo) return "nenhuma movimentação registrada";

  const quando = ultimo.dataHora
    ? new Date(ultimo.dataHora.seconds * 1000).toLocaleString("pt-BR")
    : "—";

  return rotuloDoTipo(ultimo.tipo) + " em " + quando;
}

// ------------------------------------------------------------
// MENU DOS TRÊS PONTINHOS
// ------------------------------------------------------------
function fecharMenuOpcoes() {
  const existente = document.getElementById("menu-opcoes");
  if (existente) existente.remove();
}

function abrirMenuOpcoes(botao, produto) {
  fecharMenuOpcoes();

  const menu = document.createElement("div");
  menu.id = "menu-opcoes";
  menu.className = "menu-opcoes";

  const opcoes = [
    { texto: "✏️ Editar produto", acao: () => abrirEdicao(produto) },
    { texto: "🔄 Movimentar produto", acao: () => abrirEscolhaMovimentacao(produto) },
    { texto: "🔍 Detalhes", acao: () => abrirDetalhes(produto) },
    { texto: "🗑️ Excluir produto", acao: () => excluirProduto(produto), classe: "opcao-perigosa" }
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
  menu.style.top = (rect.bottom + window.scrollY + 4) + "px";
  menu.style.left = Math.max(8, Math.min(
    rect.left + window.scrollX,
    window.innerWidth - 210
  )) + "px";
}

// ------------------------------------------------------------
// EXCLUIR PRODUTO (marca excluido=true; histórico preservado)
// ------------------------------------------------------------
async function excluirProduto(produto) {
  const confirmou = window.confirm(
    "Deseja realmente excluir o produto " + produto.codigo + " — " +
    (produto.nome || produto.descricao) + "?\n\n" +
    "O histórico relacionado a este produto será mantido, e este " +
    "evento de exclusão será anotado no histórico."
  );

  if (!confirmou) return;

  try {
    await updateDoc(doc(db, "produtos", produto.id), {
      excluido: true,
      excluidoEm: serverTimestamp()
    });

    await addDoc(collection(db, "movimentacoes"), {
      produtoId: produto.id,
      codigo: produto.codigo,
      nome: produto.nome || "",
      descricao: produto.descricao,
      tipo: "exclusao",
      quantidade: 0,
      origemDestino: "—",
      pedido: "—",
      responsavel: auth.currentUser.email,
      dataHora: serverTimestamp()
    });

    mostrarMensagem(
      "Produto " + produto.codigo + " excluído. O histórico foi preservado.",
      "sucesso"
    );

  } catch (erro) {
    mostrarMensagem("Erro ao excluir o produto. Tente novamente.", "erro");
  }
}

// ------------------------------------------------------------
// MOVIMENTAR PRODUTO (atalho Entrada/Saída pré-selecionado)
// ------------------------------------------------------------
function abrirEscolhaMovimentacao(produto) {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>Movimentar " + produto.codigo + "</h3>" +
    '<p class="texto-ajuda">' + (produto.nome || produto.descricao) +
    " — saldo atual: " + produto.quantidade + " un.</p>" +
    '<p class="texto-ajuda">Escolha o tipo de movimentação:</p>';

  const botaoEntradaModal = document.createElement("button");
  botaoEntradaModal.textContent = "⬇️ Entrada";
  botaoEntradaModal.className = "botao-modal";
  botaoEntradaModal.addEventListener("click", () => {
    fecharModal();
    ativarPainel("entrada");
    selectEntradaProduto.value = produto.id;
  });

  const botaoSaidaModal = document.createElement("button");
  botaoSaidaModal.textContent = "⬆️ Saída";
  botaoSaidaModal.className = "botao-modal";
  botaoSaidaModal.addEventListener("click", () => {
    fecharModal();
    ativarPainel("saida");
    selectSaidaProduto.value = produto.id;
  });

  const botaoCancelar = document.createElement("button");
  botaoCancelar.textContent = "Cancelar";
  botaoCancelar.className = "botao-modal botao-modal-secundario";
  botaoCancelar.addEventListener("click", fecharModal);

  caixa.appendChild(botaoEntradaModal);
  caixa.appendChild(botaoSaidaModal);
  caixa.appendChild(botaoCancelar);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// DETALHES DO PRODUTO (modal somente leitura)
// ------------------------------------------------------------
function abrirDetalhes(produto) {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";

  const quandoCriado = produto.criadoEm
    ? new Date(produto.criadoEm.seconds * 1000).toLocaleString("pt-BR")
    : "—";

  const movimentos = cacheMovimentacoes
    .filter((m) => m.produtoId === produto.id)
    .slice(0, 5);

  let listaMovimentos = "<p class='texto-ajuda'>Nenhuma movimentação registrada.</p>";
  if (movimentos.length > 0) {
    listaMovimentos = "<ul class='lista-detalhes'>" + movimentos.map((m) => {
      const quando = m.dataHora
        ? new Date(m.dataHora.seconds * 1000).toLocaleString("pt-BR")
        : "—";
      return "<li><strong>" + rotuloDoTipo(m.tipo) + "</strong> — " + quando + "</li>";
    }).join("") + "</ul>";
  }

  caixa.innerHTML =
    "<h3>Detalhes do produto</h3>" +
    (produto.foto
      ? '<img src="' + produto.foto + '" class="foto-detalhes" alt="Foto do produto">'
      : "") +
    "<p><strong>Código:</strong> " + produto.codigo + "</p>" +
    "<p><strong>Nome:</strong> " + (produto.nome || "—") + "</p>" +
    "<p><strong>Categoria:</strong> " + produto.categoria + "</p>" +
    "<p><strong>Descrição:</strong> " + produto.descricao + "</p>" +
    "<p><strong>Quantidade:</strong> " + produto.quantidade + " un.</p>" +
    "<p><strong>Custo unitário:</strong> R$ " +
      produto.valorCusto.toFixed(2).replace(".", ",") + "</p>" +
    "<p><strong>Peso unitário:</strong> " +
      produto.pesoUnitario.toFixed(3).replace(".", ",") + " kg</p>" +
    "<p><strong>Criado por:</strong> " + (produto.criadoPorNome || produto.criadoPor || "—") + "</p>" +
    "<p><strong>Data de criação:</strong> " + quandoCriado + "</p>" +
    "<h4>Últimos movimentos</h4>" +
    listaMovimentos;

  const botaoFechar = document.createElement("button");
  botaoFechar.textContent = "Fechar";
  botaoFechar.className = "botao-modal botao-modal-secundario";
  botaoFechar.addEventListener("click", fecharModal);
  caixa.appendChild(botaoFechar);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// EDITAR PRODUTO (modal)
// ALTERADO: o seletor de categoria agora é montado a partir do
// catálogo de categorias (cacheCategorias), não mais fixo.
// ALTERADO: ao salvar, grava atualizadoEm — base das ordenações
// "edição mais recente/antiga".
// ------------------------------------------------------------
function abrirEdicao(produto) {
  edicaoModificada = false;
  fotoEdicaoSelecionada = null;

  const caixa = document.createElement("div");
  caixa.className = "modal-interno";

  // Monta as opções de categoria dinamicamente.
  let opcoesCategoria = "";
  cacheCategorias.forEach((c) => {
    const selecionada = c.nome === produto.categoria ? " selected" : "";
    opcoesCategoria += '<option value="' + c.nome + '"' + selecionada + ">" +
      c.nome + "</option>";
  });

  caixa.innerHTML =
    "<h3>Editar produto — " + produto.codigo + "</h3>" +

    '<label>Foto (opcional — escolha outra para substituir)</label>' +
    '<input type="file" id="edit-foto" accept="image/*">' +
    '<img id="edit-preview" class="preview-foto" style="display:none;" alt="Pré-visualização">' +

    '<label>Código</label>' +
    '<input type="text" id="edit-codigo" maxlength="9">' +

    '<label>Nome</label>' +
    '<input type="text" id="edit-nome">' +

    '<label>Categoria</label>' +
    '<select id="edit-categoria">' + opcoesCategoria + '</select>' +

    '<label>Descrição</label>' +
    '<input type="text" id="edit-descricao">' +

    '<label>Custo unitário (R$)</label>' +
    '<input type="number" id="edit-valor" min="0" step="0.01">' +

    '<label>Peso unitário (kg)</label>' +
    '<input type="number" id="edit-peso" min="0" step="0.001">' +

    '<div class="bloco-somente-leitura">' +
      "<p><strong>Quantidade atual:</strong> " + produto.quantidade +
      " un. (alterável apenas por Entrada/Saída)</p>" +
      "<p><strong>Criado por:</strong> " +
        (produto.criadoPorNome || produto.criadoPor || "—") + "</p>" +
      "<p><strong>Data de criação:</strong> " +
        (produto.criadoEm
          ? new Date(produto.criadoEm.seconds * 1000).toLocaleString("pt-BR")
          : "—") + "</p>" +
      "<p><strong>Último histórico:</strong> " + descreverUltimoMovimento(produto.id) + "</p>" +
    "</div>";

  const editFoto = caixa.querySelector("#edit-foto");
  const editPreview = caixa.querySelector("#edit-preview");
  const editCodigo = caixa.querySelector("#edit-codigo");
  const editNome = caixa.querySelector("#edit-nome");
  const editCategoria = caixa.querySelector("#edit-categoria");
  const editDescricao = caixa.querySelector("#edit-descricao");
  const editValor = caixa.querySelector("#edit-valor");
  const editPeso = caixa.querySelector("#edit-peso");

  editCodigo.value = produto.codigo;
  editNome.value = produto.nome || "";
  editDescricao.value = produto.descricao;
  editValor.value = produto.valorCusto;
  editPeso.value = produto.pesoUnitario;

  if (produto.foto) {
    editPreview.src = produto.foto;
    editPreview.style.display = "block";
  }

  editCodigo.addEventListener("input", () => {
    const formatado = formatarCodigo(editCodigo.value);
    if (editCodigo.value !== formatado) editCodigo.value = formatado;
  });

  editFoto.addEventListener("change", () => {
    const arquivo = editFoto.files[0];
    if (!arquivo) return;
    processarFoto(arquivo, (base64) => {
      fotoEdicaoSelecionada = base64;
      editPreview.src = base64;
      editPreview.style.display = "block";
    });
  });

  [editCodigo, editNome, editCategoria, editDescricao, editValor, editPeso]
    .forEach((campo) => {
      campo.addEventListener("input", () => { edicaoModificada = true; });
      campo.addEventListener("change", () => { edicaoModificada = true; });
    });
  editFoto.addEventListener("change", () => { edicaoModificada = true; });

  const botaoSairEdicao = document.createElement("button");
  botaoSairEdicao.textContent = "Sair";
  botaoSairEdicao.className = "botao-modal botao-modal-secundario";
  botaoSairEdicao.addEventListener("click", () => {
    if (edicaoModificada) {
      const querSair = window.confirm(
        "Existem modificações não salvas. Deseja sair mesmo assim?"
      );
      if (!querSair) return;
    }
    fecharModal();
  });

  const botaoSalvar = document.createElement("button");
  botaoSalvar.textContent = "Salvar edição";
  botaoSalvar.className = "botao-modal";
  botaoSalvar.addEventListener("click", async () => {
    botaoSalvar.disabled = true;

    try {
      await salvarEdicao(produto, {
        codigo: editCodigo.value.trim().toUpperCase(),
        nome: editNome.value.trim(),
        categoria: editCategoria.value,
        descricao: editDescricao.value.trim(),
        valorCusto: editValor.value === "" ? 0 : parseFloat(editValor.value),
        pesoUnitario: editPeso.value === "" ? 0 : parseFloat(editPeso.value),
        foto: fotoEdicaoSelecionada
      });
      fecharModal();
    } catch (erro) {
      // salvarEdicao já mostra a mensagem de erro específica.
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  const linhaBotoes = document.createElement("div");
  linhaBotoes.className = "linha-botoes-modal";
  linhaBotoes.appendChild(botaoSairEdicao);
  linhaBotoes.appendChild(botaoSalvar);
  caixa.appendChild(linhaBotoes);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// SALVAR EDIÇÃO DO PRODUTO
// ALTERADO: grava atualizadoEm: serverTimestamp() a cada edição.
// ------------------------------------------------------------
async function salvarEdicao(produto, novos) {
  if (!novos.codigo || !novos.nome || !novos.descricao) {
    mostrarMensagem("Código, nome e descrição são obrigatórios.", "erro");
    throw new Error("validacao");
  }

  if (!REGEX_CODIGO.test(novos.codigo)) {
    mostrarMensagem(
      "Código incompleto. Digite 5 números e 2 letras (ex.: 11111CG).",
      "erro"
    );
    throw new Error("validacao");
  }

  if (novos.valorCusto < 0 || novos.pesoUnitario < 0) {
    mostrarMensagem("Custo e peso não podem ser negativos.", "erro");
    throw new Error("validacao");
  }

  const consulta = query(
    collection(db, "produtos"),
    where("codigo", "==", novos.codigo)
  );
  const existentes = await getDocs(consulta);
  const duplicado = existentes.docs.some((d) => d.id !== produto.id);

  if (duplicado) {
    mostrarMensagem(
      "Já existe outro produto com o código " + novos.codigo + ".",
      "erro"
    );
    throw new Error("validacao");
  }

  const mudancas = [];

  if (novos.codigo !== produto.codigo) {
    mudancas.push("Código: '" + produto.codigo + "' → '" + novos.codigo + "'");
  }
  if (novos.nome !== (produto.nome || "")) {
    mudancas.push("Nome: '" + (produto.nome || "—") + "' → '" + novos.nome + "'");
  }
  if (novos.categoria !== produto.categoria) {
    mudancas.push("Categoria: '" + produto.categoria + "' → '" + novos.categoria + "'");
  }
  if (novos.descricao !== produto.descricao) {
    mudancas.push("Descrição: '" + produto.descricao + "' → '" + novos.descricao + "'");
  }
  if (novos.valorCusto !== produto.valorCusto) {
    mudancas.push(
      "Custo unitário: R$ " + produto.valorCusto.toFixed(2).replace(".", ",") +
      " → R$ " + novos.valorCusto.toFixed(2).replace(".", ",")
    );
  }
  if (novos.pesoUnitario !== produto.pesoUnitario) {
    mudancas.push(
      "Peso unitário: " + produto.pesoUnitario.toFixed(3).replace(".", ",") +
      " kg → " + novos.pesoUnitario.toFixed(3).replace(".", ",") + " kg"
    );
  }
  if (fotoEdicaoSelecionada) {
    mudancas.push("Foto do produto atualizada");
  }

  if (mudancas.length === 0) {
    mostrarMensagem("Nenhuma alteração foi feita.", "erro");
    throw new Error("sem-mudancas");
  }

  const dadosAtualizados = {
    codigo: novos.codigo,
    nome: novos.nome,
    categoria: novos.categoria,
    descricao: novos.descricao,
    valorCusto: novos.valorCusto,
    pesoUnitario: novos.pesoUnitario,
    // NOVO: marca o momento da edição (ordenar por edição usa isto).
    atualizadoEm: serverTimestamp()
  };
  if (fotoEdicaoSelecionada) {
    dadosAtualizados.foto = fotoEdicaoSelecionada;
  }

  await updateDoc(doc(db, "produtos", produto.id), dadosAtualizados);

  await addDoc(collection(db, "movimentacoes"), {
    produtoId: produto.id,
    codigo: novos.codigo,
    nome: novos.nome,
    descricao: novos.descricao,
    tipo: "edicao",
    quantidade: 0,
    origemDestino: "—",
    pedido: "—",
    detalhes: mudancas.join("; "),
    responsavel: auth.currentUser.email,
    dataHora: serverTimestamp()
  });

  mostrarMensagem(
    "Edição salva e registrada no histórico (" +
    mudancas.length + " alteração(ões)).",
    "sucesso"
  );
}

// ============================================================
// GERENCIADOR DE CATEGORIAS
// ============================================================

// ------------------------------------------------------------
// COR MENOS USADA (sorteio "inteligente")
// Conta quantas categorias usam cada cor da paleta e devolve a
// primeira com menor uso — distribui as 12 tons de forma pareja.
// ------------------------------------------------------------
function corMenosUsada() {
  const usos = PALETA_CORES.map((cor) => ({
    cor: cor,
    total: cacheCategorias.filter((c) => c.cor === cor).length
  }));

  usos.sort((a, b) => a.total - b.total);
  return usos[0].cor;
}

// ------------------------------------------------------------
// GERENCIADOR DE CATEGORIAS (modal principal)
// Lista cada categoria como um cartão: bloco de cor + nome +
// tipo + descrição + botão ⋮ que abre a edição. Abaixo, os
// botões "Criar categoria" e "Sair".
// ------------------------------------------------------------
function abrirGerenciadorCategorias() {
  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML = "<h3>Categorias</h3>";

  if (cacheCategorias.length === 0) {
    caixa.innerHTML +=
      '<p class="texto-ajuda">Nenhuma categoria criada ainda.</p>';
  }

  cacheCategorias.forEach((categoria) => {
    const cartao = document.createElement("div");
    cartao.className = "cartao-categoria";

    cartao.innerHTML =
      '<span class="bloco-cor" style="background:' + categoria.cor + '"></span>' +
      '<div class="info-categoria">' +
        "<strong>" + categoria.nome + "</strong><br>" +
        '<span class="texto-ajuda">Abrange: ' + categoria.tipo + "</span>" +
        (categoria.descricao
          ? '<br><span class="texto-ajuda">' + categoria.descricao + "</span>"
          : "") +
      "</div>";

    const botaoPontos = document.createElement("button");
    botaoPontos.textContent = "⋮";
    botaoPontos.className = "botao-tres-pontos";
    botaoPontos.title = "Editar categoria";
    botaoPontos.addEventListener("click", () => {
      abrirEdicaoCategoria(categoria);
    });
    cartao.appendChild(botaoPontos);

    caixa.appendChild(cartao);
  });

  const botaoCriar = document.createElement("button");
  botaoCriar.textContent = "➕ Criar categoria";
  botaoCriar.className = "botao-modal";
  botaoCriar.addEventListener("click", () => {
    abrirEdicaoCategoria(null); // null = modo criação
  });

  const botaoSairGerenciador = document.createElement("button");
  botaoSairGerenciador.textContent = "Sair";
  botaoSairGerenciador.className = "botao-modal botao-modal-secundario";
  botaoSairGerenciador.addEventListener("click", fecharModal);

  // Montagem final do gerenciador: lista de cartões + botões
  // "Criar categoria" e "Sair" na base.
  caixa.appendChild(botaoCriar);
  caixa.appendChild(botaoSairGerenciador);

  abrirModal(caixa);
}

// ------------------------------------------------------------
// EDITAR / CRIAR CATEGORIA (modal)
// categoria = null → modo CRIAÇÃO; categoria preenchida → EDIÇÃO.
// Campos: nome (usado no cadastro do produto), tipo de produtos
// que abrange, descrição opcional e COR de identificação.
// A cor é escolhida clicando num dos 12 quadradinhos pastéis —
// na criação, já vem pré-marcada a cor MENOS usada (sorteio
// "inteligente" que distribui as cores de forma pareja).
// O botão Sair tem a mesma guarda do modal de produto: se algo
// foi modificado, pergunta antes de descartar.
// ------------------------------------------------------------
function abrirEdicaoCategoria(categoria) {
  categoriaEdicaoModificada = false;
  corEdicaoSelecionada = null;

  const caixa = document.createElement("div");
  caixa.className = "modal-interno";
  caixa.innerHTML =
    "<h3>" + (categoria ? "Editar categoria — " + categoria.nome : "Criar categoria") + "</h3>" +

    '<label>Nome da categoria</label>' +
    '<input type="text" id="cat-nome">' +

    '<label>Tipo de produtos que ela abrange</label>' +
    '<input type="text" id="cat-tipo">' +

    '<label>Descrição (opcional)</label>' +
    '<input type="text" id="cat-descricao">' +

    '<label>Cor de identificação</label>' +
    '<div id="paleta-cores" class="paleta-cores"></div>';

  const catNome = caixa.querySelector("#cat-nome");
  const catTipo = caixa.querySelector("#cat-tipo");
  const catDescricao = caixa.querySelector("#cat-descricao");
  const paleta = caixa.querySelector("#paleta-cores");

  // Pré-preenchimento: na edição, os dados atuais; na criação,
  // a cor menos usada já vem selecionada.
  if (categoria) {
    catNome.value = categoria.nome;
    catTipo.value = categoria.tipo || "";
    catDescricao.value = categoria.descricao || "";
    corEdicaoSelecionada = categoria.cor;
  } else {
    corEdicaoSelecionada = corMenosUsada();
  }

  // Monta os 12 quadradinhos da paleta. O selecionado ganha a
  // classe "selecionada" (borda destacada via CSS). Clicar em
  // outro quadradinho troca a seleção e marca como modificado.
  PALETA_CORES.forEach((cor) => {
    const opcao = document.createElement("button");
    opcao.type = "button";
    opcao.className = "cor-opcao" + (cor === corEdicaoSelecionada ? " selecionada" : "");
    opcao.style.background = cor;
    opcao.title = cor;
    opcao.addEventListener("click", () => {
      corEdicaoSelecionada = cor;
      categoriaEdicaoModificada = true;
      paleta.querySelectorAll(".cor-opcao").forEach((o) => o.classList.remove("selecionada"));
      opcao.classList.add("selecionada");
    });
    paleta.appendChild(opcao);
  });

  // Qualquer digitação marca o formulário como alterado.
  [catNome, catTipo, catDescricao].forEach((campo) => {
    campo.addEventListener("input", () => { categoriaEdicaoModificada = true; });
  });

  const botaoSairCategoria = document.createElement("button");
  botaoSairCategoria.textContent = "Sair";
  botaoSairCategoria.className = "botao-modal botao-modal-secundario";
  botaoSairCategoria.addEventListener("click", () => {
    if (categoriaEdicaoModificada) {
      const querSair = window.confirm(
        "Existem modificações não salvas. Deseja sair mesmo assim?"
      );
      if (!querSair) return;
    }
    fecharModal();
  });

  const botaoSalvarCategoria = document.createElement("button");
  botaoSalvarCategoria.textContent = categoria ? "Salvar categoria" : "Criar categoria";
  botaoSalvarCategoria.className = "botao-modal";
  botaoSalvarCategoria.addEventListener("click", async () => {
    const nome = catNome.value.trim();
    const tipo = catTipo.value.trim();
    const descricao = catDescricao.value.trim();

    if (!nome) {
      mostrarMensagem("Nome da categoria é obrigatório.", "erro");
      return;
    }

    const dados = {
      nome,
      tipo,
      descricao,
      cor: corEdicaoSelecionada || corMenosUsada()
    };

    try {
      botaoSalvarCategoria.disabled = true;

      ascript

javascript

      if (categoria) {
        // Detecta se o NOME mudou — se sim, propaga para os produtos.
        const nomeMudou = categoria.nome !== nome;

        await updateDoc(doc(db, "categorias", categoria.id), dados);

        if (nomeMudou) {
          // Atualiza todos os produtos marcados com o nome antigo.
          // O loop "for...of" com await garante que cada produto
          // seja atualizado antes do próximo.
          // Decisão de projeto: nada disso entra no histórico —
          // ajuste de catálogo não é movimentação de estoque.
          const afetados = cacheProdutos.filter(
            (p) => p.categoria === categoria.nome
          );

          for (const produto of afetados) {
            await updateDoc(doc(db, "produtos", produto.id), {
              categoria: nome
            });
          }

          mostrarMensagem(
            "Categoria atualizada e " + afetados.length +
            " produto(s) renomeado(s) junto.",
            "sucesso"
          );
        } else {
          mostrarMensagem("Categoria atualizada com sucesso.", "sucesso");
        }
      } else {
        await addDoc(collection(db, "categorias"), {
          ...dados,
          criadoEm: serverTimestamp()
        });
        mostrarMensagem("Categoria criada com sucesso.", "sucesso");
      }

      fecharModal();
    } catch (erro) {
      mostrarMensagem("Não foi possível salvar a categoria.", "erro");
    } finally {
      botaoSalvarCategoria.disabled = false;
    }
  });

  const linhaBotoes = document.createElement("div");
  linhaBotoes.className = "linha-botoes-modal";
  linhaBotoes.appendChild(botaoSairCategoria);
  linhaBotoes.appendChild(botaoSalvarCategoria);
  caixa.appendChild(linhaBotoes);

  abrirModal(caixa);
}