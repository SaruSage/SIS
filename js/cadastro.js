// ============================================================
// PROJETO GOLDEN — Lógica da página de cadastro
// ============================================================
// Responsabilidades:
// 1. Validar o código de adesão contra o banco (coleção
//    "codigosAdesao"), aceitando apenas códigos ainda não usados.
// 2. Revelar o formulário completo somente após a validação.
// 3. Gravar a solicitação no banco (coleção "solicitacoes")
//    com status "pendente" — a conta NÃO é criada aqui.
// 4. Marcar o código como usado, para que sirva uma única vez.
// 5. Redirecionar para o login com o aviso de aguardo.
// ============================================================

import { db } from "./firebase-config.js";

import {
  collection, query, where, getDocs, addDoc, updateDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ------------------------------------------------------------
// Capturando os elementos da tela
// ------------------------------------------------------------
const etapaCodigo = document.getElementById("etapa-codigo");
const campoCodigo = document.getElementById("codigo");
const botaoValidar = document.getElementById("botao-validar-codigo");
const formCadastro = document.getElementById("form-cadastro");
const campoNome = document.getElementById("nome");
const campoEmail = document.getElementById("email");
const campoSenha = document.getElementById("senha");
const campoConfirmar = document.getElementById("confirmar-senha");
const campoCargo = document.getElementById("cargo");
const botaoEnviar = document.getElementById("botao-enviar");
const areaMensagem = document.getElementById("mensagem");

function mostrarMensagem(texto, tipo) {
  areaMensagem.textContent = texto;
  areaMensagem.className = "mensagem " + tipo;
}

// Guarda o código validado (id do documento + o próprio código).
// Enquanto estiver vazio, o formulário não foi liberado.
let codigoValidado = null;

// ------------------------------------------------------------
// ETAPA 1 — VALIDAR O CÓDIGO
// A consulta usa DOIS filtros: o código digitado E "usado ==
// false". Assim um código já consumido é recusado na origem.
// O texto é convertido para MAIÚSCULAS antes de comparar,
// pois os códigos são gerados só com letras maiúsculas —
// assim "abc123" e "ABC123" são o mesmo código para o sistema.
// ------------------------------------------------------------
botaoValidar.addEventListener("click", async () => {
  const digitado = campoCodigo.value.trim().toUpperCase();

  if (!digitado) {
    mostrarMensagem("Digite o código de adesão.", "erro");
    return;
  }

  botaoValidar.disabled = true;

  try {
    // "query" + "where" montam um filtro: traga apenas os
    // documentos da coleção que obedeçam às duas condições.
    const consulta = query(
      collection(db, "codigosAdesao"),
      where("codigo", "==", digitado),
      where("usado", "==", false)
    );

    const resultado = await getDocs(consulta);

    // Nenhum documento encontrado = código inexistente ou já usado.
    if (resultado.empty) {
      mostrarMensagem("Código inválido ou já utilizado.", "erro");
      return;
    }

    // Código válido: guardamos o id do documento (necessário
    // para marcá-lo como usado depois) e liberamos o formulário.
    codigoValidado = {
      id: resultado.docs[0].id,
      codigo: digitado
    };

    etapaCodigo.style.display = "none";
    formCadastro.style.display = "block";
    mostrarMensagem("Código validado! Complete o cadastro.", "sucesso");

  } catch (erro) {
    mostrarMensagem("Erro ao validar o código. Tente novamente.", "erro");

  } finally {
    botaoValidar.disabled = false;
  }
});

// ------------------------------------------------------------
// ETAPA 2 — ENVIAR A SOLICITAÇÃO
// Validações locais primeiro (economizam idas ao banco) e,
// só então, as duas gravações: a solicitação e a marcação
// do código como usado.
// ------------------------------------------------------------
formCadastro.addEventListener("submit", async (evento) => {
  evento.preventDefault(); // impede o recarregamento da página

  const nome = campoNome.value.trim();
  const email = campoEmail.value.trim();
  const senha = campoSenha.value;
  const confirmar = campoConfirmar.value;

  // --- Validações locais ---
  if (!nome || !email || !senha || !campoCargo.value) {
    mostrarMensagem("Preencha todos os campos.", "erro");
    return;
  }

  // O cargo é obrigatório: sem ele não sabemos quais telas
  // liberar para este usuário no futuro.
  if (!campoCargo.value) {
    mostrarMensagem("Selecione o seu cargo.", "erro");
    return;
  }

  if (senha.length < 6) {
    mostrarMensagem("A senha deve ter no mínimo 6 caracteres.", "erro");
    return;
  }

  if (senha !== confirmar) {
    mostrarMensagem("As senhas não conferem.", "erro");
    return;
  }

  botaoEnviar.disabled = true;
  botaoEnviar.textContent = "Enviando...";

  try {
    // GRAVAÇÃO 1 — a solicitação, aguardando o administrador.
    // A senha fica no documento para o admin criar a conta
    // com ela na aprovação (limitação da fase atual; quando
    // formos para Cloud Functions, isso será repensado).
    await addDoc(collection(db, "solicitacoes"), {
      nome: nome,
      email: email,
      senha: senha,
      cargo: campoCargo.value,
      codigo: codigoValidado.codigo,
      status: "pendente",
      criadoEm: serverTimestamp()
    });

    // GRAVAÇÃO 2 — marca o código como usado, para que ele
    // não sirva a outro cadastro. Guardamos quem usou e quando.
    await updateDoc(doc(db, "codigosAdesao", codigoValidado.id), {
      usado: true,
      usadoPor: email,
      usadoEm: serverTimestamp()
    });

    // Limpa o formulário e avisa o usuário.
    formCadastro.reset();
    mostrarMensagem(
      "Solicitação enviada! Redirecionando para o login...",
      "sucesso"
    );

    // Redireciona para a tela de login após 2 segundos (2000 ms),
    // dando tempo de a mensagem verde aparecer.
    // O texto "?aviso=cadastro" no final da URL é um PARÂMETRO:
    // ele viaja junto com o endereço e a página de login o lerá
    // para saber que deve exibir a mensagem de aguardo.
    setTimeout(() => {
      window.location.href = "index.html?aviso=cadastro";
    }, 2000);

  } catch (erro) {
    mostrarMensagem("Erro ao enviar a solicitação. Tente novamente.", "erro");

  } finally {
    botaoEnviar.disabled = false;
    botaoEnviar.textContent = "Enviar solicitação";
  }
});