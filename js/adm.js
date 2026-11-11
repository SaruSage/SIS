// ============================================================
// PROJETO GOLDEN — Lógica do painel do administrador
// ============================================================
// Responsabilidades:
// 1. Proteger a página: entram o e-mail dono do sistema OU
//    qualquer usuário aprovado com cargo "administracao".
// 2. Gerar códigos de adesão e copiá-los com um clique.
// 3. Escutar as solicitações em tempo real e distribuí-las
//    nas três abas conforme o status:
//      pendente  → aba Pendentes   (aprovar / rejeitar)
//      aprovada  → aba Aprovados   (alterar cargo / bloquear / excluir)
//      bloqueada → aba Aprovados   (reativar)
//      excluida  → aba Aprovados   (reativar)
//      rejeitada → aba Rejeitados  (somente histórico)
// 4. Na aprovação, o admin confirma ou corrige o cargo —
//    inclusive atribuindo "Administração", opção que NÃO
//    existe na página de cadastro por segurança.
// 5. Na aba Aprovados, o admin pode ALTERAR o cargo de um
//    usuário ativo a qualquer momento (promover ou rebaixar).
// 6. Aprovação inteligente: e-mail já existente = reativa.
// ============================================================

import { auth, db, firebaseConfig } from "./firebase-config.js";

import {
  onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  collection, addDoc, updateDoc, doc, onSnapshot, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  iniciarLayoutBase,
  aplicarPermissoesSidebar,
  obterDadosUsuario,
  atualizarCabecalhoUsuario
} from "./layout-base.js";

// ------------------------------------------------------------
// LISTA DE ADMINISTRADORES
// O e-mail dono do sistema: acesso garantido ao painel,
// independente de cargo gravado no banco.
// ------------------------------------------------------------
const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];

// ------------------------------------------------------------
// CARGOS DO SISTEMA
// Fonte única de verdade: qualquer lugar que precisar listar
// ou traduzir cargos usa estas constantes. Se um dia surgir
// um cargo novo, mudamos AQUI e o resto do código acompanha.
// "valor" = o que fica gravado no banco (sem acento/espaço).
// "nome"  = o que aparece na tela para o administrador.
// Repare que "administracao" EXISTE aqui: só o admin pode
// atribuí-lo — na aprovação ou na aba Aprovados.
// ------------------------------------------------------------
const CARGOS = [
  { valor: "estoque", nome: "Estoque" },
  { valor: "vendas", nome: "Vendas" },
  { valor: "producao", nome: "Produção" },
  { valor: "administracao", nome: "Administração" }
];

// Tradução rápida de valor → nome exibível. Se o campo cargo
// não existir num documento antigo, devolvemos "—".
const NOMES_CARGOS = {
  estoque: "Estoque",
  vendas: "Vendas",
  producao: "Produção",
  administracao: "Administração"
};

// ------------------------------------------------------------
// CREDENCIAIS DO EMAILJS
// ------------------------------------------------------------
const EMAILJS_SERVICE_ID = "COLE_SEU_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "COLE_SEU_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY = "COLE_SUA_PUBLIC_KEY";

// ------------------------------------------------------------
// APP SECUNDÁRIO — permite criar a conta do novo usuário sem
// deslogar o administrador (a sessão dele vive no app principal).
// ------------------------------------------------------------
const appSecundario = initializeApp(firebaseConfig, "app-secundario");
const authSecundario = getAuth(appSecundario);

// ------------------------------------------------------------
// Capturando elementos da tela
// ------------------------------------------------------------
const conteudoProtegido = document.getElementById("conteudo-protegido");
const nomeUsuario = document.getElementById("nome-usuario");
const emailUsuario = document.getElementById("email-usuario");
const avatar = document.getElementById("avatar");
const contagemUsuarios = document.getElementById("contagem-usuarios");
const contagemPendentes = document.getElementById("contagem-pendentes");

const botaoGerar = document.getElementById("botao-gerar-codigo");
const areaCodigoGerado = document.getElementById("area-codigo-gerado");
const listaSolicitacoes = document.getElementById("lista-solicitacoes");
const botaoSair = document.getElementById("botao-sair");
const areaMensagem = document.getElementById("mensagem");

let filtroAtual = "pendente";

// "Cache" local das solicitações. O onSnapshot o mantém sempre
// atualizado; as funções de renderização apenas o leem.
let cacheSolicitacoes = [];

function mostrarMensagem(texto, tipo) {
  if (!areaMensagem) return;
  areaMensagem.textContent = texto;
  areaMensagem.className = "mensagem " + tipo;
}

// ------------------------------------------------------------
// PROTEÇÃO DA PÁGINA
// Duas portas de entrada:
// 1. O e-mail está na lista ADMINISTRADORES (dono do sistema).
// 2. O usuário está logado, tem status "aprovada" e cargo
//    "administracao" no banco (admins promovidos pelo dono).
// Qualquer outro caso é redirecionado para home.html.
// ------------------------------------------------------------
onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  const ehAdminEmail = ADMINISTRADORES.includes((usuario.email || "").toLowerCase());

  if (!ehAdminEmail) {
    const temCargoAdmin = await usuarioTemCargoAdmin(usuario.email);
    if (!temCargoAdmin) {
      window.location.href = "home.html";
      return;
    }
  }

  if (conteudoProtegido) conteudoProtegido.classList.remove("oculto");
  iniciarLayoutBase();
  aplicarPermissoesSidebar("administracao", true);

  const dadosUsuario = await obterDadosUsuario(usuario, db);
  atualizarCabecalhoUsuario(dadosUsuario);

  escutarSolicitacoes();
});

// ------------------------------------------------------------
// VERIFICA SE O E-MAIL PERTENCE A UM ADMIN PROMOVIDO
// Percorre as solicitações procurando o usuário logado e
// confere se ele está aprovado com cargo "administracao".
// Em caso de erro na consulta, devolve false: o padrão
// seguro é NEGAR o acesso, nunca liberar por acidente.
// ------------------------------------------------------------
async function usuarioTemCargoAdmin(email) {
  try {
    const resultado = await getDocs(collection(db, "solicitacoes"));
    let ehAdmin = false;

    resultado.forEach((documento) => {
      const dados = documento.data();
      const mesmoEmail =
        (dados.email || "").toLowerCase() === email.toLowerCase();

      if (mesmoEmail && dados.status === "aprovada" && dados.cargo === "administracao") {
        ehAdmin = true;
      }
    });

    return ehAdmin;
  } catch (erro) {
    return false;
  }
}

// ------------------------------------------------------------
// NAVEGAÇÃO ENTRE ABAS
// ------------------------------------------------------------
document.querySelectorAll(".aba-adm").forEach((botao) => {
  botao.addEventListener("click", () => {
    document.querySelectorAll(".aba-adm").forEach((b) => b.classList.remove("ativa"));
    botao.classList.add("ativa");
    filtroAtual = botao.dataset.filtro;
    renderizarSolicitacoes();
  });
});

// ------------------------------------------------------------
// ESCUTAR O BANCO EM TEMPO REAL
// Um único onSnapshot na coleção inteira. A cada mudança
// (nova solicitação, aprovação, bloqueio...), o cache é
// refeito e a lista é redesenhada sozinha.
// ------------------------------------------------------------
function escutarSolicitacoes() {
  onSnapshot(collection(db, "solicitacoes"), (resultado) => {
    cacheSolicitacoes = [];
    let aprovados = 0;
    let pendentes = 0;

    resultado.forEach((documento) => {
      const dados = documento.data();
      cacheSolicitacoes.push({ id: documento.id, ...dados });
      if (dados.status === "aprovada") aprovados++;
      if (dados.status === "pendente") pendentes++;
    });

    if (contagemUsuarios) contagemUsuarios.textContent = aprovados;
    if (contagemPendentes) contagemPendentes.textContent = pendentes;

    renderizarSolicitacoes();
  });
}

function renderizarSolicitacoes() {
  if (!listaSolicitacoes) return;

  if (filtroAtual === "pendente") {
    renderizarPendentes();
  } else if (filtroAtual === "aprovada") {
    renderizarAprovados();
  } else if (filtroAtual === "rejeitada") {
    renderizarRejeitados();
  }
}

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR: criar um cartão básico
// ------------------------------------------------------------
function criarCartao(dados, textoStatus, classeStatus) {
  const cartao = document.createElement("div");
  cartao.className = "cartao-solicitacao";

  const info = document.createElement("div");
  info.className = "info-solicitacao";

  const etiqueta = document.createElement("span");
  etiqueta.className = "etiqueta-status " + classeStatus;
  etiqueta.textContent = textoStatus;

  info.appendChild(etiqueta);

  const detalhes = document.createElement("div");
  detalhes.style.marginTop = "6px";
  detalhes.innerHTML =
    "<strong>" + (dados.nome || "Sem nome") + "</strong><br>" +
    (dados.email || "") + "<br>" +
    '<span class="texto-ajuda">Cargo: ' + (NOMES_CARGOS[dados.cargo] || dados.cargo || "—") + "<br>" +
    "Código usado: " + (dados.codigo || "—") + "</span>";

  info.appendChild(detalhes);
  cartao.appendChild(info);

  return cartao;
}

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR: criar um botão de ação
// ------------------------------------------------------------
function criarBotao(texto, classe, acao) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.textContent = texto;
  botao.className = classe;
  botao.addEventListener("click", acao);
  return botao;
}

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR: criar um seletor de cargos
// ------------------------------------------------------------
function criarSeletorCargo(cargoAtual) {
  const seletor = document.createElement("select");
  seletor.className = "seletor-cargo";
  seletor.style.height = "32px";
  seletor.style.padding = "0 8px";
  seletor.style.borderRadius = "8px";
  seletor.style.border = "1px solid var(--borda)";
  seletor.style.fontFamily = "inherit";
  seletor.style.fontSize = "12px";

  CARGOS.forEach((cargo) => {
    const opcao = document.createElement("option");
    opcao.value = cargo.valor;
    opcao.textContent = cargo.nome;
    seletor.appendChild(opcao);
  });

  seletor.value = cargoAtual || "vendas";
  return seletor;
}

// ------------------------------------------------------------
// ABA 1 — PENDENTES (aprovar / rejeitar)
// ------------------------------------------------------------
function renderizarPendentes() {
  const pendentes = cacheSolicitacoes.filter((s) => s.status === "pendente");

  if (pendentes.length === 0) {
    listaSolicitacoes.innerHTML =
      '<p class="texto-ajuda">Nenhuma solicitação pendente no momento.</p>';
    return;
  }

  listaSolicitacoes.innerHTML = "";
  pendentes.forEach((solicitacao) => {
    const cartao = criarCartao(solicitacao, "Aguardando decisão", "etiqueta-pendente");
    const seletor = criarSeletorCargo(solicitacao.cargo);

    const acoes = document.createElement("div");
    acoes.className = "acoes-solicitacao";
    acoes.appendChild(seletor);

    acoes.appendChild(
      criarBotao("Aprovar", "botao-aprovar", () =>
        aprovarSolicitacao(solicitacao.id, solicitacao, seletor))
    );
    acoes.appendChild(
      criarBotao("Rejeitar", "botao-rejeitar", () =>
        rejeitarSolicitacao(solicitacao.id, solicitacao))
    );

    cartao.appendChild(acoes);
    listaSolicitacoes.appendChild(cartao);
  });
}

// ------------------------------------------------------------
// ABA 2 — APROVADOS (alterar cargo / bloquear / excluir / reativar)
// ------------------------------------------------------------
function renderizarAprovados() {
  const ativos = cacheSolicitacoes.filter((s) =>
    s.status === "aprovada" || s.status === "bloqueada" || s.status === "excluida"
  );

  if (ativos.length === 0) {
    listaSolicitacoes.innerHTML =
      '<p class="texto-ajuda">Nenhum usuário aprovado ainda.</p>';
    return;
  }

  listaSolicitacoes.innerHTML = "";
  ativos.forEach((solicitacao) => {
    const acoes = document.createElement("div");
    acoes.className = "acoes-solicitacao";

    if (solicitacao.status === "aprovada") {
      const cartao = criarCartao(solicitacao, "Ativo", "etiqueta-aprovada");
      const seletor = criarSeletorCargo(solicitacao.cargo);
      acoes.appendChild(seletor);

      acoes.appendChild(
        criarBotao("Salvar cargo", "botao-secundario", () =>
          alterarCargo(solicitacao.id, seletor))
      );
      acoes.appendChild(
        criarBotao("Bloquear", "botao-rejeitar", () => bloquearUsuario(solicitacao.id))
      );
      acoes.appendChild(
        criarBotao("Excluir acesso", "botao-rejeitar", () => excluirAcesso(solicitacao.id))
      );
      cartao.appendChild(acoes);
      listaSolicitacoes.appendChild(cartao);
    }

    if (solicitacao.status === "bloqueada") {
      const cartao = criarCartao(solicitacao, "Bloqueado", "etiqueta-rejeitada");
      acoes.appendChild(
        criarBotao("Reativar", "botao-aprovar", () => reativarUsuario(solicitacao.id))
      );
      cartao.appendChild(acoes);
      listaSolicitacoes.appendChild(cartao);
    }

    if (solicitacao.status === "excluida") {
      const cartao = criarCartao(solicitacao, "Acesso excluído", "etiqueta-rejeitada");
      acoes.appendChild(
        criarBotao("Reativar", "botao-aprovar", () => reativarUsuario(solicitacao.id))
      );
      cartao.appendChild(acoes);
      listaSolicitacoes.appendChild(cartao);
    }
  });
}

// ------------------------------------------------------------
// ABA 3 — REJEITADOS (somente histórico, sem botões)
// ------------------------------------------------------------
function renderizarRejeitados() {
  const rejeitados = cacheSolicitacoes.filter((s) => s.status === "rejeitada");

  if (rejeitados.length === 0) {
    listaSolicitacoes.innerHTML =
      '<p class="texto-ajuda">Nenhuma solicitação rejeitada ainda.</p>';
    return;
  }

  listaSolicitacoes.innerHTML = "";
  rejeitados.forEach((solicitacao) => {
    const cartao = criarCartao(solicitacao, "Rejeitado", "etiqueta-rejeitada");
    listaSolicitacoes.appendChild(cartao);
  });
}

// ------------------------------------------------------------
// GERAR CÓDIGO DE ADESÃO
// ------------------------------------------------------------
function sortearCodigo() {
  const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 8; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

if (botaoGerar) {
  botaoGerar.addEventListener("click", async () => {
    botaoGerar.disabled = true;
    try {
      const codigo = sortearCodigo();
      await addDoc(collection(db, "codigosAdesao"), {
        codigo: codigo,
        usado: false,
        criadoEm: serverTimestamp()
      });

      if (areaCodigoGerado) {
        areaCodigoGerado.innerHTML = `
          <span class="codigo-gerado" id="codigo-gerado">${codigo}</span>
          <button type="button" id="botao-copiar-codigo" class="botao-secundario">Copiar código</button>
        `;
        areaCodigoGerado.style.display = "block";

        const botaoCopiar = document.getElementById("botao-copiar-codigo");
        if (botaoCopiar) {
          botaoCopiar.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(codigo);
              botaoCopiar.textContent = "Copiado! ✅";
              setTimeout(() => {
                botaoCopiar.textContent = "Copiar código";
              }, 2000);
            } catch (erro) {
              mostrarMensagem("Não foi possível copiar. Selecione e use Ctrl+C.", "erro");
            }
          });
        }
      }
    } catch (erro) {
      mostrarMensagem("Erro ao gerar o código.", "erro");
    } finally {
      botaoGerar.disabled = false;
    }
  });
}

// ------------------------------------------------------------
// ENVIAR E-MAIL DE RESPOSTA (via EmailJS)
// ------------------------------------------------------------
function enviarEmail(destinatario, nome, aprovado) {
  if (typeof emailjs === "undefined") return;
  emailjs.send(
    EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID,
    {
      to_email: destinatario,
      nome: nome,
      assunto: aprovado
        ? "Projeto Golden — Cadastro aprovado"
        : "Projeto Golden — Cadastro não autorizado",
      mensagem: aprovado
        ? "Seu cadastro foi aprovado! Você já pode acessar a plataforma com o e-mail e a senha que você cadastrou."
        : "Infelizmente sua solicitação de cadastro não foi autorizada pela administração. Em caso de dúvida, procure o administrador."
    },
    EMAILJS_PUBLIC_KEY
  ).catch(() => {
    mostrarMensagem("Ação concluída, mas o e-mail não pôde ser enviado.", "erro");
  });
}

// ------------------------------------------------------------
// APROVAR SOLICITAÇÃO
// ------------------------------------------------------------
async function aprovarSolicitacao(id, dados, seletorCargo) {
  const cargoEscolhido = seletorCargo.value;

  try {
    await createUserWithEmailAndPassword(authSecundario, dados.email, dados.senha);
    await signOut(authSecundario);

    await updateDoc(doc(db, "solicitacoes", id), {
      status: "aprovada",
      cargo: cargoEscolhido,
      aprovadoEm: serverTimestamp()
    });
    enviarEmail(dados.email, dados.nome, true);
    mostrarMensagem("Conta criada e e-mail de liberação enviado.", "sucesso");

  } catch (erro) {
    if (erro.code === "auth/email-already-in-use") {
      try {
        await updateDoc(doc(db, "solicitacoes", id), {
          status: "aprovada",
          cargo: cargoEscolhido,
          aprovadoEm: serverTimestamp()
        });
        enviarEmail(dados.email, dados.nome, true);
        mostrarMensagem(
          "Este e-mail já tinha conta no sistema — acesso reativado. " +
          "O usuário deve entrar com a senha do cadastro anterior.",
          "sucesso"
        );
      } catch (erroInterno) {
        mostrarMensagem("Erro ao reativar o acesso.", "erro");
      }
      return;
    }

    mostrarMensagem("Erro ao aprovar a solicitação.", "erro");
  }
}

// ------------------------------------------------------------
// REJEITAR: marca como rejeitada e avisa por e-mail.
// ------------------------------------------------------------
async function rejeitarSolicitacao(id, dados) {
  try {
    await updateDoc(doc(db, "solicitacoes", id), {
      status: "rejeitada",
      rejeitadoEm: serverTimestamp()
    });
    enviarEmail(dados.email, dados.nome, false);
    mostrarMensagem("Solicitação rejeitada e e-mail enviado.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao rejeitar a solicitação.", "erro");
  }
}

// ------------------------------------------------------------
// ALTERAR CARGO DE USUÁRIO ATIVO
// ------------------------------------------------------------
async function alterarCargo(id, seletorCargo) {
  try {
    await updateDoc(doc(db, "solicitacoes", id), {
      cargo: seletorCargo.value,
      cargoAlteradoEm: serverTimestamp()
    });
    mostrarMensagem("Cargo atualizado com sucesso.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao alterar o cargo.", "erro");
  }
}

// ------------------------------------------------------------
// BLOQUEAR
// ------------------------------------------------------------
async function bloquearUsuario(id) {
  try {
    await updateDoc(doc(db, "solicitacoes", id), {
      status: "bloqueada",
      bloqueadoEm: serverTimestamp()
    });
    mostrarMensagem("Usuário bloqueado. Ele não conseguirá mais entrar.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao bloquear o usuário.", "erro");
  }
}

// ------------------------------------------------------------
// EXCLUIR ACESSO
// ------------------------------------------------------------
async function excluirAcesso(id) {
  try {
    await updateDoc(doc(db, "solicitacoes", id), {
      status: "excluida",
      excluidoEm: serverTimestamp()
    });
    mostrarMensagem("Acesso excluído. O usuário não conseguirá mais entrar.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao excluir o acesso.", "erro");
  }
}

// ------------------------------------------------------------
// REATIVAR
// ------------------------------------------------------------
async function reativarUsuario(id) {
  try {
    await updateDoc(doc(db, "solicitacoes", id), {
      status: "aprovada",
      reativadoEm: serverTimestamp()
    });
    mostrarMensagem("Usuário reativado. Ele já pode entrar novamente.", "sucesso");
  } catch (erro) {
    mostrarMensagem("Erro ao reativar o usuário.", "erro");
  }
}

// ------------------------------------------------------------
// SAIR (logout)
// ------------------------------------------------------------
if (botaoSair) {
  botaoSair.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
  });
}
