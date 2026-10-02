// ============================================================
// PROJETO GOLDEN — Lógica de login (versão 3, arquivo completo)
// ============================================================
// Responsabilidades:
// 1. Autenticar e-mail e senha no Firebase.
// 2. Consultar o status do usuário no banco (Firestore):
//      aprovada  → acesso liberado
//      bloqueada / excluida → acesso recusado
//      pendente / rejeitada → acesso recusado
//      null (sem registro)  → acesso recusado, exceto admins
// 3. Mostrar o aviso pós-cadastro quando a URL trouxer
//    o parâmetro "?aviso=cadastro".
// ============================================================

import { auth, db } from "./firebase-config.js";

import { signInWithEmailAndPassword, signOut } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { collection, getDocs } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
// LISTA DE ADMINISTRADORES
// O admin foi criado manualmente no painel do Firebase, sem
// passar pelo fluxo de solicitação — por isso precisamos
// reconhecê-lo aqui para não bloquearmos o próprio dono.
// ------------------------------------------------------------
const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];

// ------------------------------------------------------------
// Capturando os elementos da tela
// ------------------------------------------------------------
const form = document.getElementById("form-login");
const campoEmail = document.getElementById("email");
const campoSenha = document.getElementById("senha");
const botaoEntrar = document.getElementById("botao-entrar");
const areaMensagem = document.getElementById("mensagem");

function mostrarMensagem(texto, tipo) {
  areaMensagem.textContent = texto;
  areaMensagem.className = "mensagem " + tipo;
}

function traduzirErro(codigo) {
  switch (codigo) {
    case "auth/invalid-email":
      return "Formato de e-mail inválido.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "E-mail ou senha incorretos.";
    case "auth/user-not-found":
      return "Não existe conta com este e-mail.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Tente novamente em alguns minutos.";
    case "auth/network-request-failed":
      return "Falha de conexão. Verifique sua internet.";
    default:
      return "Não foi possível entrar. Tente novamente.";
  }
}

// ------------------------------------------------------------
// VERIFICAÇÃO DE STATUS NO BANCO
// Percorre as solicitações procurando o e-mail digitado e
// devolve o status do cadastro dele: "aprovada", "bloqueada",
// "excluida", "rejeitada", "pendente" ou null (nada encontrado).
// Comparamos em minúsculas dos dois lados para que "Ana@X.com"
// e "ana@x.com" sejam reconhecidas como o mesmo endereço.
// ------------------------------------------------------------
async function verificarStatus(email) {
  const resultado = await getDocs(collection(db, "solicitacoes"));
  let status = null;

  resultado.forEach((documento) => {
    const dados = documento.data();
    if ((dados.email || "").toLowerCase() === email.toLowerCase()) {
      status = dados.status;
    }
  });

  return status;
}

// ------------------------------------------------------------
// EVENTO PRINCIPAL: envio do formulário
// ------------------------------------------------------------
form.addEventListener("submit", async (evento) => {
  evento.preventDefault(); // impede o recarregamento da página

  const email = campoEmail.value.trim();
  const senha = campoSenha.value;

  if (!email || !senha) {
    mostrarMensagem("Preencha e-mail e senha.", "erro");
    return;
  }

  botaoEntrar.disabled = true;
  botaoEntrar.textContent = "Entrando...";

  try {
    // 1ª ETAPA — o Firebase valida e-mail e senha.
    await signInWithEmailAndPassword(auth, email, senha);

    // 2ª ETAPA — verificação de status no banco.
    const status = await verificarStatus(email);
    const ehAdmin = ADMINISTRADORES.includes(email.toLowerCase());

    // Bloqueado ou excluído: senha certa, acesso revogado.
    if (status === "bloqueada" || status === "excluida") {
      await signOut(auth);
      mostrarMensagem(
        "Seu acesso está bloqueado. Procure o administrador.",
        "erro"
      );
      return;
    }

    // Sem registro nenhum no banco: ou a conta foi apagada
    // pelo administrador, ou nunca passou pelo fluxo de
    // solicitação. Em ambos os casos, a entrada é recusada
    // (exceto para administradores da lista).
    if (!status && !ehAdmin) {
      await signOut(auth);
      mostrarMensagem(
        "Não há autorização de acesso para esta conta. Procure o administrador.",
        "erro"
      );
      return;
    }

    // Ainda pendente ou rejeitada: conta existe, mas sem liberação.
    if (status === "pendente" || status === "rejeitada") {
      await signOut(auth);
      mostrarMensagem(
        "Seu cadastro ainda não foi liberado pela administração.",
        "erro"
      );
      return;
    }

    // 3ª ETAPA — acesso liberado: avisa e redireciona.
    mostrarMensagem("Login realizado! Redirecionando...", "sucesso");

    setTimeout(() => {
      window.location.href = "home.html";
    }, 1500);

  } catch (erro) {
    mostrarMensagem(traduzirErro(erro.code), "erro");

  } finally {
    botaoEntrar.disabled = false;
    botaoEntrar.textContent = "Entrar";
  }
});

// ------------------------------------------------------------
// AVISO PÓS-CADASTRO (veio do redirecionamento do cadastro.js)
// "URLSearchParams" lê os parâmetros do endereço atual. Se o
// bilhete "?aviso=cadastro" existir, mostramos a mensagem.
// ------------------------------------------------------------
const parametros = new URLSearchParams(window.location.search);

if (parametros.get("aviso") === "cadastro") {
  mostrarMensagem(
    "Solicitação enviada! Assim que receber o e-mail de aprovação, faça o login aqui mesmo.",
    "sucesso"
  );
}