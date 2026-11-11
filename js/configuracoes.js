// ============================================================
// PROJETO GOLDEN — Página de Configurações
// ============================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  iniciarLayoutBase,
  definirTema,
  definirFonte,
  aplicarPermissoesSidebar,
  obterDadosUsuario,
  atualizarCabecalhoUsuario
} from "./layout-base.js";

const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];

const ACESSO_POR_CARGO = {
  estoque: ["estoque"],
  vendas: ["vendas"],
  producao: ["producao"],
  administracao: ["estoque", "vendas", "producao", "consultoria"]
};

const conteudoProtegido = document.getElementById("conteudo-protegido");
const nomeUsuario = document.getElementById("nome-usuario");
const emailUsuario = document.getElementById("email-usuario");
const avatar = document.getElementById("avatar");
const botaoSair = document.getElementById("botao-sair");
const contagemUsuarios = document.getElementById("contagem-usuarios");
const contagemPendentes = document.getElementById("contagem-pendentes");

let cargoAtual = null;

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  conteudoProtegido.classList.remove("oculto");
  iniciarLayoutBase();

  const dadosUsuario = await obterDadosUsuario(usuario, db);
  atualizarCabecalhoUsuario(dadosUsuario);

  carregarDados();
  iniciarSeletores();
});

async function carregarDados() {
  try {
    const resultado = await getDocs(collection(db, "solicitacoes"));
    let aprovados = 0;
    let pendentes = 0;

    resultado.forEach((documento) => {
      const dados = documento.data();
      if ((dados.email || "").toLowerCase() ===
          (auth.currentUser.email || "").toLowerCase()) {
        cargoAtual = dados.cargo || null;
      }
      if (dados.status === "aprovada") aprovados++;
      if (dados.status === "pendente") pendentes++;
    });

    contagemUsuarios.textContent = aprovados;
    contagemPendentes.textContent = pendentes;

    const ehAdminEmail = ADMINISTRADORES.includes(
      (auth.currentUser.email || "").toLowerCase()
    );
    const ehAdmin = cargoAtual === "administracao" || ehAdminEmail;
    aplicarPermissoesSidebar(cargoAtual, ehAdmin);
  } catch (erro) {
    contagemUsuarios.textContent = "—";
    contagemPendentes.textContent = "—";
  }
}

function iniciarSeletores() {
  const temaAtual = localStorage.getItem("golden-tema") || "claro";
  const fonteAtual = localStorage.getItem("golden-fonte") || "normal";

  marcarSelecionado("opcoes-tema", "tema", temaAtual);
  marcarSelecionado("opcoes-fonte", "fonte", fonteAtual);

  document.querySelectorAll("#opcoes-tema .opcao-config").forEach((botao) => {
    botao.addEventListener("click", () => {
      definirTema(botao.dataset.tema);
      marcarSelecionado("opcoes-tema", "tema", botao.dataset.tema);
    });
  });

  document.querySelectorAll("#opcoes-fonte .opcao-config").forEach((botao) => {
    botao.addEventListener("click", () => {
      definirFonte(botao.dataset.fonte);
      marcarSelecionado("opcoes-fonte", "fonte", botao.dataset.fonte);
    });
  });
}

function marcarSelecionado(idContainer, atributo, valor) {
  const container = document.getElementById(idContainer);
  if (!container) return;
  container.querySelectorAll(".opcao-config").forEach((botao) => {
    botao.classList.toggle("selecionada", botao.dataset[atributo] === valor);
  });
}

botaoSair.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});
