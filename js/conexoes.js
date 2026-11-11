// ============================================================
// PROJETO GOLDEN — Módulo de Conexões (Placeholder)
// ============================================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  iniciarLayoutBase,
  aplicarPermissoesSidebar,
  obterDadosUsuario,
  atualizarCabecalhoUsuario
} from "./layout-base.js";

const conteudoProtegido = document.getElementById("conteudo-protegido");
const nomeUsuario = document.getElementById("nome-usuario");
const emailUsuario = document.getElementById("email-usuario");
const avatar = document.getElementById("avatar");
const botaoSair = document.getElementById("botao-sair");
const contagemUsuarios = document.getElementById("contagem-usuarios");
const contagemPendentes = document.getElementById("contagem-pendentes");

const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  if (conteudoProtegido) conteudoProtegido.classList.remove("oculto");
  iniciarLayoutBase();

  const dadosUsuario = await obterDadosUsuario(usuario, db);
  atualizarCabecalhoUsuario(dadosUsuario);

  const ehAdmin = ADMINISTRADORES.includes(usuario.email);
  try {
    const snap = await getDoc(doc(db, "usuarios", usuario.uid));
    const cargo = (snap.exists() && snap.data().cargo) ? snap.data().cargo : null;
    aplicarPermissoesSidebar(cargo, ehAdmin);
  } catch (erro) {
    console.error("Erro ao ler cargo:", erro);
    aplicarPermissoesSidebar(null, ehAdmin);
  }

  carregarCentroControle();
});

if (botaoSair) {
  botaoSair.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "index.html";
    } catch (erro) {
      console.error("Erro ao sair:", erro);
    }
  });
}

async function carregarCentroControle() {
  try {
    const [snapUsuarios, snapPendentes] = await Promise.all([
      getDocs(collection(db, "usuarios")),
      getDocs(collection(db, "solicitacoes"))
    ]);
    if (contagemUsuarios) contagemUsuarios.textContent = snapUsuarios.size;
    if (contagemPendentes) contagemPendentes.textContent = snapPendentes.size;
  } catch (erro) {
    console.error("Erro ao ler centro de controle:", erro);
  }
}
