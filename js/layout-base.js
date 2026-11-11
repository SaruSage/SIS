// ============================================================
// PROJETO GOLDEN — Layout base compartilhado
// Sidebar recolhível, caixas do header e barra de rolagem
// customizada. Importado por todas as páginas.
// ============================================================

import { substituirIcones } from "./icones.js";

const CHAVE_SIDEBAR = "golden-sidebar-recolhida";

export function iniciarLayoutBase() {
  aplicarPreferencias();
  substituirIcones();
  iniciarSidebar();
  iniciarCaixasHeader();
  iniciarBotaoConfig();
}

// ------------------------------------------------------------
// PREFERÊNCIAS VISUAIS (tema e tamanho da fonte)
// ------------------------------------------------------------
export function aplicarPreferencias() {
  const tema = localStorage.getItem("golden-tema") || "claro";
  const fonte = localStorage.getItem("golden-fonte") || "normal";

  document.documentElement.classList.remove("tema-claro", "tema-escuro");
  document.documentElement.classList.add("tema-" + tema);

  document.body.classList.remove("tema-claro", "tema-escuro");
  document.body.classList.add("tema-" + tema);

  document.documentElement.classList.remove("fonte-pequena", "fonte-normal", "fonte-grande");
  document.documentElement.classList.add("fonte-" + fonte);

  document.body.classList.remove("fonte-pequena", "fonte-normal", "fonte-grande");
  document.body.classList.add("fonte-" + fonte);
}

export function definirTema(tema) {
  localStorage.setItem("golden-tema", tema);
  aplicarPreferencias();
}

export function definirFonte(tamanho) {
  localStorage.setItem("golden-fonte", tamanho);
  aplicarPreferencias();
}

function iniciarBotaoConfig() {
  const botao = document.getElementById("botao-config");
  if (!botao) return;
  botao.addEventListener("click", () => {
    window.location.href = "configuracoes.html";
  });
}

// ------------------------------------------------------------
// SIDEBAR RECOLHÍVEL
// ------------------------------------------------------------
function iniciarSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const botao = document.querySelector(".botao-recolher");
  if (!sidebar || !botao) return;

  const salvo = localStorage.getItem(CHAVE_SIDEBAR);
  if (salvo === "true") sidebar.classList.add("recolhida");
  atualizarIconeRecolher(sidebar, botao);

  botao.addEventListener("click", () => {
    sidebar.classList.toggle("recolhida");
    const recolhida = sidebar.classList.contains("recolhida");
    localStorage.setItem(CHAVE_SIDEBAR, recolhida ? "true" : "false");
    atualizarIconeRecolher(sidebar, botao);
  });
}

function atualizarIconeRecolher(sidebar, botao) {
  const recolhida = sidebar.classList.contains("recolhida");
  if (recolhida) {
    botao.innerHTML = '<span data-icone="sanduiche" data-tamanho="16"></span>';
    botao.title = "Expandir menu";
  } else {
    botao.innerHTML = '<span data-icone="recolher" data-tamanho="16"></span>';
    botao.title = "Recolher menu";
  }
  substituirIcones(botao);
}

// ------------------------------------------------------------
// CAIXAS FLUTUANTES DO HEADER (notificações e perfil)
// ------------------------------------------------------------
function iniciarCaixasHeader() {
  const botaoNotif = document.getElementById("botao-notificacoes");
  const caixaNotif = document.getElementById("caixa-notificacoes");
  const botaoPerfil = document.getElementById("botao-perfil");
  const caixaPerfil = document.getElementById("menu-perfil");

  if (botaoNotif && caixaNotif) {
    botaoNotif.addEventListener("click", (e) => {
      e.stopPropagation();
      const abrir = !caixaNotif.classList.contains("aberta");
      if (caixaPerfil) caixaPerfil.classList.remove("aberta");
      caixaNotif.classList.toggle("aberta", abrir);
      const selo = document.getElementById("selo-notificacao");
      if (abrir && selo) selo.classList.remove("visivel");
    });
  }

  if (botaoPerfil && caixaPerfil) {
    botaoPerfil.addEventListener("click", (e) => {
      e.stopPropagation();
      const abrir = !caixaPerfil.classList.contains("aberta");
      if (caixaNotif) caixaNotif.classList.remove("aberta");
      caixaPerfil.classList.toggle("aberta", abrir);
    });
  }

  const itemConfigUsuario = document.getElementById("item-config-usuario");
  if (itemConfigUsuario) {
    itemConfigUsuario.addEventListener("click", (e) => {
      e.stopPropagation();
      if (caixaPerfil) caixaPerfil.classList.remove("aberta");
      abrirModalConfigUsuario();
    });
  }

  document.addEventListener("click", (e) => {
    if (caixaNotif && !caixaNotif.contains(e.target) &&
        !botaoNotif?.contains(e.target)) {
      caixaNotif.classList.remove("aberta");
    }
    if (caixaPerfil && !caixaPerfil.contains(e.target) &&
        !botaoPerfil?.contains(e.target)) {
      caixaPerfil.classList.remove("aberta");
    }
  });
}

// ------------------------------------------------------------
// BARRA DE ROLAGEM CUSTOMIZADA
// Uso: montarBarraCustomizada(document.querySelector(".modal-scroll"))
// ------------------------------------------------------------
export function montarBarraCustomizada(scrollEl) {
  if (!scrollEl) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "barra-custom-wrapper";

  const thumb = document.createElement("div");
  thumb.className = "barra-custom-thumb";
  wrapper.appendChild(thumb);

  const container = scrollEl.parentElement;
  if (!container) return null;

  const antiga = container.querySelector(".barra-custom-wrapper");
  if (antiga) antiga.remove();

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
    new ResizeObserver(atualizar).observe(scrollEl);
  }

  atualizar();
  return { atualizar };
}

// ------------------------------------------------------------
// MODAL PADRÃO (com barra customizada)
// ------------------------------------------------------------
export function abrirModalBase(conteudo) {
  let overlay = document.getElementById("modal-overlay");
  let caixa = document.getElementById("modal-conteudo");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.display = "none";
    caixa = document.createElement("div");
    caixa.id = "modal-conteudo";
    caixa.className = "modal-conteudo";
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fecharModalBase();
    });
  }

  caixa.innerHTML = "";
  const scroll = document.createElement("div");
  scroll.className = "modal-scroll";
  scroll.appendChild(conteudo);
  caixa.appendChild(scroll);
  overlay.style.display = "flex";

  requestAnimationFrame(() => montarBarraCustomizada(scroll));
}

export function fecharModalBase() {
  const overlay = document.getElementById("modal-overlay");
  const caixa = document.getElementById("modal-conteudo");
  if (overlay) overlay.style.display = "none";
  if (caixa) caixa.innerHTML = "";
}

// ------------------------------------------------------------
// PERMISSÕES DA SIDEBAR
// Cada item declara os cargos que podem vê-lo em data-cargos.
// O item sem data-cargos é visível para todos.
// ------------------------------------------------------------
export function aplicarPermissoesSidebar(cargo, ehAdmin) {
  document.querySelectorAll(".nav-item[data-cargos]").forEach((item) => {
    const permitidos = (item.dataset.cargos || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    const podeVer = ehAdmin || permitidos.includes(cargo);
    item.style.display = podeVer ? "" : "none";
  });

  const itemAdmin = document.querySelector(".nav-item[data-admin-only]");
  if (itemAdmin) {
    itemAdmin.style.display = ehAdmin ? "" : "none";
  }

  const secao = document.querySelector(".sidebar-secao");
  const divisor = document.querySelector(".sidebar-divisor");
  if (secao && divisor) {
    const itensVisiveis = Array.from(secao.querySelectorAll(".nav-item")).some(
      (it) => it.style.display !== "none"
    );
    divisor.style.display = itensVisiveis ? "" : "none";
    secao.style.display = itensVisiveis ? "" : "none";
  }
}

// ------------------------------------------------------------
// DADOS DO USUÁRIO E CABEÇALHO
// Obtém o nome completo do usuário pelo Auth ou Firestore,
// extrai o primeiro nome para a topbar e atualiza o menu de perfil.
// ------------------------------------------------------------
let dadosUsuarioCache = null;

export async function obterDadosUsuario(usuario, db) {
  if (!usuario) {
    return { nomeCompleto: "Usuário", primeiroNome: "Usuário", email: "", cargo: "vendas", ehAdmin: false };
  }

  const email = (usuario.email || "").trim();
  const emailLower = email.toLowerCase();
  let nomeCompleto = "";
  let cargo = "";

  // 1. Verificar displayName do Firebase Auth
  if (usuario.displayName && usuario.displayName.trim() && !usuario.displayName.includes("@")) {
    nomeCompleto = usuario.displayName.trim();
  }

  // 2. Buscar em 'solicitacoes'
  if (db) {
    try {
      const { collection, getDocs } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      const snap = await getDocs(collection(db, "solicitacoes"));
      snap.forEach((d) => {
        const dados = d.data();
        if ((dados.email || "").trim().toLowerCase() === emailLower) {
          if (!nomeCompleto && dados.nome && dados.nome.trim()) {
            nomeCompleto = dados.nome.trim();
          }
          if (dados.cargo) cargo = dados.cargo;
        }
      });
    } catch (e) {
      // Silencioso
    }
  }

  // 3. Buscar em 'usuarios/{uid}'
  if (db && usuario.uid) {
    try {
      const { doc, getDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      const snapUsuario = await getDoc(doc(db, "usuarios", usuario.uid));
      if (snapUsuario.exists()) {
        const u = snapUsuario.data();
        if (!nomeCompleto && u.nome) nomeCompleto = u.nome.trim();
        if (!cargo && u.cargo) cargo = u.cargo;
      }
    } catch (e) {
      // Silencioso
    }
  }

  // 4. Se for o administrador master configurado (eamgfn4ever@gmail.com)
  if (emailLower === "eamgfn4ever@gmail.com") {
    if (!nomeCompleto) nomeCompleto = "Samuel Cáceres";
    cargo = "administracao";
  }

  // 5. Fallback seguro caso não tenha nome cadastrado
  if (!nomeCompleto || nomeCompleto.includes("@")) {
    const parte = email.split("@")[0].replace(/[._0-9-]+/g, " ").trim();
    if (parte) {
      nomeCompleto = parte
        .split(" ")
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(" ");
    } else {
      nomeCompleto = "Administrador";
    }
  }

  const partes = nomeCompleto.split(" ").filter(Boolean);
  const primeiroNome = partes[0] || nomeCompleto;
  const ehAdmin = emailLower === "eamgfn4ever@gmail.com" || cargo === "administracao";

  dadosUsuarioCache = {
    nomeCompleto,
    primeiroNome,
    email,
    cargo: cargo || (ehAdmin ? "administracao" : "vendas"),
    status: "aprovada",
    ehAdmin
  };

  return dadosUsuarioCache;
}

export function atualizarCabecalhoUsuario(dadosUsuario) {
  if (!dadosUsuario) return;
  dadosUsuarioCache = dadosUsuario;
  const nomeUsuario = document.getElementById("nome-usuario");
  const avatar = document.getElementById("avatar");
  const nomeCompletoUsuario = document.getElementById("nome-completo-usuario");
  const emailUsuario = document.getElementById("email-usuario");

  if (nomeUsuario) nomeUsuario.textContent = dadosUsuario.primeiroNome;
  if (avatar) avatar.textContent = dadosUsuario.primeiroNome.charAt(0).toUpperCase();
  if (nomeCompletoUsuario) nomeCompletoUsuario.textContent = dadosUsuario.nomeCompleto;
  if (emailUsuario) emailUsuario.textContent = dadosUsuario.email;
}

// ------------------------------------------------------------
// MODAL DE DADOS CADASTRAIS E PERMISSÕES DO USUÁRIO
// ------------------------------------------------------------
export function abrirModalConfigUsuario() {
  const dados = dadosUsuarioCache || {
    nomeCompleto: "Samuel Cáceres",
    primeiroNome: "Samuel",
    email: "eamgfn4ever@gmail.com",
    cargo: "administracao",
    status: "aprovada",
    ehAdmin: true
  };

  const inicial = (dados.primeiroNome || "U").charAt(0).toUpperCase();
  const ehAdmin = dados.ehAdmin || dados.cargo === "administracao" || (dados.email || "").toLowerCase() === "eamgfn4ever@gmail.com";

  const cargoMapeado = {
    administracao: "Administrador Master",
    vendas: "Vendas & Comercial",
    estoque: "Controle de Estoque",
    producao: "Produção & Montagem",
    consultoria: "Consultoria Técnica"
  };
  const cargoRotulo = cargoMapeado[dados.cargo] || (ehAdmin ? "Administrador Master" : "Colaborador Autorizado");

  // Relação de permissões conforme cargo
  const permissoes = [
    {
      modulo: "Vendas & Kanban",
      permitido: ehAdmin || dados.cargo === "vendas",
      desc: "Gestão do quadro Kanban, criação e edição de cards, valores e movimentação de etapas."
    },
    {
      modulo: "Estoque & Materiais",
      permitido: ehAdmin || dados.cargo === "estoque",
      desc: "Controle de cabos e conectores, movimentações de entrada/saída e auditoria de saldos."
    },
    {
      modulo: "Conexões & Integrações",
      permitido: ehAdmin || dados.cargo === "vendas",
      desc: "Gestão e configuração de canais de atendimento e integrações externas da plataforma."
    },
    {
      modulo: "Produção",
      permitido: ehAdmin || dados.cargo === "producao",
      desc: "Acompanhamento de ordens de serviço, etapas operacionais e montagem técnica."
    },
    {
      modulo: "Consultoria",
      permitido: ehAdmin || dados.cargo === "consultoria",
      desc: "Acesso a relatórios de consultoria e projetos técnicos especializados."
    },
    {
      modulo: "Painel Administrativo",
      permitido: ehAdmin,
      desc: "Aprovação de novos colaboradores, liberação de códigos, alteração de cargos e controle de acessos."
    }
  ];

  const container = document.createElement("div");
  container.className = "modal-perfil-corpo";

  // Cabeçalho do modal
  const cabecalho = document.createElement("div");
  cabecalho.className = "modal-cabecalho-perfil";
  cabecalho.innerHTML = `
    <div class="usuario-cabecalho-bloco">
      <div class="avatar-modal-perfil">${inicial}</div>
      <div>
        <h2 class="titulo-modal-perfil">${dados.nomeCompleto}</h2>
        <p class="subtitulo-modal-perfil">${dados.email}</p>
      </div>
    </div>
    <button type="button" class="botao-fechar-modal-x" title="Fechar">&times;</button>
  `;
  cabecalho.querySelector(".botao-fechar-modal-x").addEventListener("click", fecharModalBase);
  container.appendChild(cabecalho);

  // Seção 1: Dados Cadastrais Completos
  const secaoDados = document.createElement("div");
  secaoDados.className = "bloco-secao-perfil";
  secaoDados.innerHTML = `
    <h3 class="titulo-secao-modal">
      <span data-icone="admin" data-tamanho="15"></span> Dados Cadastrais
    </h3>
    <div class="grade-dados-cadastrais">
      <div class="card-info-cadastral">
        <span class="rotulo-info">Nome Completo</span>
        <strong class="valor-info">${dados.nomeCompleto}</strong>
      </div>
      <div class="card-info-cadastral">
        <span class="rotulo-info">E-mail de Acesso</span>
        <strong class="valor-info">${dados.email}</strong>
      </div>
      <div class="card-info-cadastral">
        <span class="rotulo-info">Cargo / Função</span>
        <span class="badge-tag-cargo">${cargoRotulo}</span>
      </div>
      <div class="card-info-cadastral">
        <span class="rotulo-info">Status da Conta</span>
        <span class="badge-tag-status">● Ativa & Aprovada</span>
      </div>
    </div>
  `;
  container.appendChild(secaoDados);

  // Seção 2: Relação de Permissões
  const secaoPermissoes = document.createElement("div");
  secaoPermissoes.className = "bloco-secao-perfil";
  
  let htmlPermissoes = `
    <h3 class="titulo-secao-modal">
      <span data-icone="check" data-tamanho="15"></span> Relação de Permissões
    </h3>
    <div class="lista-permissoes-box">
  `;

  permissoes.forEach((p) => {
    htmlPermissoes += `
      <div class="item-permissao-linha">
        <div class="info-permissao-modulo">
          <strong class="nome-permissao-modulo">${p.modulo}</strong>
          <span class="desc-permissao-modulo">${p.desc}</span>
        </div>
        <span class="selo-permissao-status ${p.permitido ? "selo-permitido" : "selo-restrito"}">
          ${p.permitido ? "✓ Permitido" : "✕ Restrito"}
        </span>
      </div>
    `;
  });
  htmlPermissoes += `</div>`;
  secaoPermissoes.innerHTML = htmlPermissoes;
  container.appendChild(secaoPermissoes);

  // Rodapé com botão Fechar
  const rodape = document.createElement("div");
  rodape.className = "rodape-modal-perfil";
  const btnFechar = document.createElement("button");
  btnFechar.type = "button";
  btnFechar.className = "btn-fechar-perfil";
  btnFechar.textContent = "Fechar";
  btnFechar.addEventListener("click", fecharModalBase);
  rodape.appendChild(btnFechar);
  container.appendChild(rodape);

  substituirIcones(container);
  abrirModalBase(container);
}
