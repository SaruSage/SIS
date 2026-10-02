// ============================================================
// PROJETO GOLDEN — Lógica da homepage (portal com cargos)
// ============================================================
// Responsabilidades:
// 1. Proteger a página (só logados entram).
// 2. Personalizar a topbar com o nome do usuário.
// 3. Alternar (abrir/fechar) a caixa de notificações e o
//    menu do perfil.
// 4. Ler o CARGO do usuário no banco e aplicar as permissões:
//    cada cargo só vê os cards da sua área.
// 5. Filtrar os cards conforme a digitação, SEM revelar
//    nada que a permissão tenha escondido.
// 6. Preencher o centro de controle com dados do banco.
// ============================================================

import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged, signOut } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { collection, getDocs } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
// Capturando os elementos da tela
// ------------------------------------------------------------
const conteudoProtegido = document.getElementById("conteudo-protegido");
const nomeUsuario = document.getElementById("nome-usuario");
const emailUsuario = document.getElementById("email-usuario");
const avatar = document.getElementById("avatar");
const botaoNotificacoes = document.getElementById("botao-notificacoes");
const seloNotificacao = document.getElementById("selo-notificacao");
const caixaNotificacoes = document.getElementById("caixa-notificacoes");
const listaNotificacoes = document.getElementById("lista-notificacoes");
const botaoPerfil = document.getElementById("botao-perfil");
const menuPerfil = document.getElementById("menu-perfil");
const botaoSair = document.getElementById("botao-sair");
const campoBusca = document.getElementById("campo-busca");
const gradeApps = document.getElementById("grade-apps");
const semResultados = document.getElementById("sem-resultados");
const contagemUsuarios = document.getElementById("contagem-usuarios");
const contagemPendentes = document.getElementById("contagem-pendentes");
const atalhoAdmin = document.getElementById("atalho-admin");

// ------------------------------------------------------------
// LISTA DE ADMINISTRADORES
// Rede de segurança: o e-mail dono do sistema sempre tem
// acesso total, mesmo que o cargo dele não esteja gravado.
// ------------------------------------------------------------
const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];

// ------------------------------------------------------------
// MAPA DE ACESSO POR CARGO
// O coração da camada de permissões da home. Cada cargo
// aponta para a lista de cards (data-nome) que ele pode ver.
// - Estoque só vê Estoque; Vendas só vê Vendas; Produção só
//   vê Produção.
// - Administração vê tudo, incluindo Consultoria.
// Consultoria ainda não tem cargo próprio, então por enquanto
// só a Administração a vê — ajuste fácil quando definirmos.
// Se o cargo for desconhecido (|| []), ninguém vê nada:
// o padrão seguro é NEGAR, nunca liberar por acidente.
// ------------------------------------------------------------
const ACESSO_POR_CARGO = {
  estoque: ["estoque"],
  vendas: ["vendas"],
  producao: ["producao"],
  administracao: ["estoque", "vendas", "producao", "consultoria"]
};

// Guarda o cargo do usuário logado. Começa vazio e é preenchido
// pela leitura do banco. A busca usa esta variável para nunca
// revelar um card que o cargo do usuário não pode ver.
let cargoAtual = null;

// ------------------------------------------------------------
// 1) PROTEÇÃO DA PÁGINA + PERSONALIZAÇÃO
// Mesma guarda das outras páginas, mas aqui também preenchemos
// o avatar (inicial do nome) e disparamos a leitura dos dados.
// ------------------------------------------------------------
onAuthStateChanged(auth, (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  // Revela todo o conteúdo da página.
  conteudoProtegido.classList.remove("oculto");

  // Saudação: usa o nome se existir, senão o e-mail.
  const nome = usuario.displayName || usuario.email;
  nomeUsuario.textContent = nome;
  emailUsuario.textContent = usuario.email;

  // Primeira letra do nome, em maiúscula, dentro do avatar.
  avatar.textContent = nome.charAt(0).toUpperCase();

  carregarNotificacoes();
  carregarDadosDoUsuario();
});

// ------------------------------------------------------------
// 2) ALTERNAR CAIXAS FLUTUANTES (notificações e perfil)
// "toggle" = liga/desliga: se a caixa está aberta, fecha;
// se está fechada, abre. E ao abrir uma, fechamos a outra —
// assim as duas nunca ficam abertas ao mesmo tempo.
// ------------------------------------------------------------
botaoNotificacoes.addEventListener("click", () => {
  const vaiAbrir = !caixaNotificacoes.classList.contains("aberta");
  menuPerfil.classList.remove("aberta");
  caixaNotificacoes.classList.toggle("aberta", vaiAbrir);
  // Abriu a caixa? Então o usuário "leu" as novidades:
  // o selo vermelho desaparece.
  if (vaiAbrir) seloNotificacao.classList.remove("visivel");
});

botaoPerfil.addEventListener("click", () => {
  const vaiAbrir = !menuPerfil.classList.contains("aberta");
  caixaNotificacoes.classList.remove("aberta");
  menuPerfil.classList.toggle("aberta", vaiAbrir);
});

// Fecha as duas caixas ao clicar FORA delas.
// O clique no documento inteiro é capturado; se o alvo do
// clique não estiver dentro de nenhuma caixa nem de seus
// botões, ambas são fechadas.
document.addEventListener("click", (evento) => {
  const clicouFora =
    !caixaNotificacoes.contains(evento.target) &&
    !menuPerfil.contains(evento.target) &&
    !botaoNotificacoes.contains(evento.target) &&
    !botaoPerfil.contains(evento.target);

  if (clicouFora) {
    caixaNotificacoes.classList.remove("aberta");
    menuPerfil.classList.remove("aberta");
  }
});

// ------------------------------------------------------------
// 3) NOTIFICAÇÕES
// Por enquanto, as notificações são fixas (demonstração).
// No futuro, virão do banco: novas solicitações, aprovações,
// bloqueios etc. O selo vermelho aparece porque há itens.
// ------------------------------------------------------------
function carregarNotificacoes() {
  const notificacoes = [
    "Bem-vindo ao Projeto Golden! 🎉",
    "Novas funcionalidades chegam em breve."
  ];

  listaNotificacoes.innerHTML = "";
  notificacoes.forEach((texto) => {
    const item = document.createElement("li");
    item.textContent = texto;
    listaNotificacoes.appendChild(item);
  });

  // Há notificações não lidas → mostra o selo vermelho.
  seloNotificacao.classList.add("visivel");
}

// ------------------------------------------------------------
// 4) DADOS DO USUÁRIO + CENTRO DE CONTROLE
// Uma única leitura do banco faz três coisas:
// 1. Descobre o CARGO do usuário logado (procurando o e-mail
//    dele nas solicitações).
// 2. Conta aprovados e pendentes para o centro de controle.
// 3. Chama aplicarPermissoes(), que esconde os cards proibidos.
// ------------------------------------------------------------
async function carregarDadosDoUsuario() {
  try {
    const resultado = await getDocs(collection(db, "solicitacoes"));

    let aprovados = 0;
    let pendentes = 0;

    resultado.forEach((documento) => {
      const dados = documento.data();

      // Encontra o registro do próprio usuário logado para
      // descobrir o cargo dele (comparação em minúsculas dos
      // dois lados, para evitar diferenças de digitação).
      if ((dados.email || "").toLowerCase() === (auth.currentUser.email || "").toLowerCase()) {
        cargoAtual = dados.cargo || null;
      }

      if (dados.status === "aprovada") aprovados++;
      if (dados.status === "pendente") pendentes++;
    });

    contagemUsuarios.textContent = aprovados;
    contagemPendentes.textContent = pendentes;

    aplicarPermissoes();

  } catch (erro) {
    // Sem permissão ou falha de rede: mantemos o traço "—".
    contagemUsuarios.textContent = "—";
    contagemPendentes.textContent = "—";
  }
}

// ------------------------------------------------------------
// 5) APLICAR PERMISSÕES NA GRADE DE CARDS
// Percorre cada card e mostra apenas os que o cargo permite.
// O atalho admin aparece só para Administração (ou para o
// e-mail dono do sistema, como rede de segurança).
// ------------------------------------------------------------
function aplicarPermissoes() {
  const ehAdminEmail = ADMINISTRADORES.includes((auth.currentUser.email || "").toLowerCase());
  const permitidos = ACESSO_POR_CARGO[cargoAtual] || [];

  gradeApps.querySelectorAll(".card-app").forEach((card) => {
    const podeVer = permitidos.includes(card.dataset.nome);
    card.style.display = podeVer ? "flex" : "none";
  });

  if (cargoAtual === "administracao" || ehAdminEmail) {
    atalhoAdmin.style.display = "block";
  }
}

// ------------------------------------------------------------
// 6) BUSCA EM TEMPO REAL (respeitando permissões)
// O evento "input" dispara A CADA tecla digitada. Um card só
// aparece se DUAS condições forem verdadeiras:
// 1. O cargo do usuário permite vê-lo (permitido).
// 2. O texto digitado corresponde ao nome dele (corresponde).
// Assim a busca nunca "revela" um card que a permissão esconde.
// ------------------------------------------------------------
campoBusca.addEventListener("input", () => {
  const termo = campoBusca.value.trim().toLowerCase();
  const permitidos = ACESSO_POR_CARGO[cargoAtual] || [];
  let visiveis = 0;

  // querySelectorAll pega todos os cards de uma vez.
  gradeApps.querySelectorAll(".card-app").forEach((card) => {
    const corresponde = card.dataset.nome.includes(termo);
    const permitido = permitidos.includes(card.dataset.nome);

    // display controla a visibilidade de cada card.
    card.style.display = (corresponde && permitido) ? "flex" : "none";
    if (corresponde && permitido) visiveis++;
  });

  // Nenhum card visível → mostra a mensagem de vazio.
  semResultados.style.display = visiveis === 0 ? "block" : "none";
});

// ------------------------------------------------------------
// 7) SAIR (logout)
// ------------------------------------------------------------
botaoSair.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});