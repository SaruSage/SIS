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
const boasVindas = document.getElementById("boas-vindas");
const conteudoAdmin = document.getElementById("conteudo-admin");
const acessoNegado = document.getElementById("acesso-negado");
const botaoGerar = document.getElementById("botao-gerar-codigo");
const blocoCodigoGerado = document.getElementById("bloco-codigo-gerado");
const codigoGerado = document.getElementById("codigo-gerado");
const botaoCopiar = document.getElementById("botao-copiar-codigo");
const listaPendentes = document.getElementById("lista-pendentes");
const listaAprovados = document.getElementById("lista-aprovados");
const listaRejeitados = document.getElementById("lista-rejeitados");
const botaoSair = document.getElementById("botao-sair");
const areaMensagem = document.getElementById("mensagem");

// "Cache" local das solicitações. O onSnapshot o mantém sempre
// atualizado; as funções de renderização apenas o leem.
let cacheSolicitacoes = [];

function mostrarMensagem(texto, tipo) {
  areaMensagem.textContent = texto;
  areaMensagem.className = "mensagem " + tipo;
}

// ------------------------------------------------------------
// PROTEÇÃO DA PÁGINA
// Duas portas de entrada:
// 1. O e-mail está na lista ADMINISTRADORES (dono do sistema).
// 2. O usuário está logado, tem status "aprovada" e cargo
//    "administracao" no banco (admins promovidos pelo dono).
// Qualquer outro caso vê a mensagem de acesso negado.
// O callback virou "async" porque a verificação do cargo
// consulta o banco — usamos "await" para a resposta chegar
// ANTES de decidir o que mostrar na tela.
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
      acessoNegado.style.display = "block";
      return;
    }
  }

  boasVindas.textContent = "Logado como: " + usuario.email;
  conteudoAdmin.style.display = "block";
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
// Para cada botão de aba, registramos um clique que:
// 1. Remove o destaque de todas as abas e aplica só nesta.
// 2. Esconde todos os painéis e mostra apenas o correspondente.
// ------------------------------------------------------------
document.querySelectorAll(".aba").forEach((botao) => {
  botao.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("aba-ativa"));
    botao.classList.add("aba-ativa");

    document.querySelectorAll(".painel-aba").forEach((p) => p.classList.remove("painel-visivel"));
    document.getElementById("painel-" + botao.dataset.aba).classList.add("painel-visivel");
  });
});

// ------------------------------------------------------------
// ESCUTAR O BANCO EM TEMPO REAL
// Um único onSnapshot na coleção inteira. A cada mudança
// (nova solicitação, aprovação, bloqueio...), o cache é
// refeito e as três abas são redesenhadas sozinhas.
// ------------------------------------------------------------
function escutarSolicitacoes() {
  onSnapshot(collection(db, "solicitacoes"), (resultado) => {
    cacheSolicitacoes = [];
    resultado.forEach((documento) => {
      // "...documento.data()" espalha os campos (nome, email,
      // status...) dentro do objeto, junto com o id do documento.
      cacheSolicitacoes.push({ id: documento.id, ...documento.data() });
    });
    renderizarPendentes();
    renderizarAprovados();
    renderizarRejeitados();
  });
}

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR: criar um cartão básico
// Evita repetição: monta a caixa com nome, e-mail, CARGO e
// etiqueta de status. As abas adicionam os botões que lhes cabem.
// ------------------------------------------------------------
function criarCartao(dados, textoStatus, classeStatus) {
  const cartao = document.createElement("div");
  cartao.className = "cartao-solicitacao";

  const etiqueta = document.createElement("span");
  etiqueta.className = "etiqueta-status " + classeStatus;
  etiqueta.textContent = textoStatus;

  cartao.innerHTML =
    "<strong>" + dados.nome + "</strong><br>" +
    dados.email + "<br>" +
    '<span class="texto-ajuda">Cargo: ' + (NOMES_CARGOS[dados.cargo] || "—") + "<br>" +
    "Código usado: " + dados.codigo + "</span>";

  // insertBefore coloca a etiqueta ANTES do texto, no topo do cartão.
  cartao.insertBefore(etiqueta, cartao.firstChild);
  return cartao;
}

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR: criar um botão de ação
// ------------------------------------------------------------
function criarBotao(texto, classe, acao) {
  const botao = document.createElement("button");
  botao.textContent = texto;
  botao.className = classe;
  botao.addEventListener("click", acao);
  return botao;
}

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR: criar um seletor de cargos
// Monta um <select> com as quatro opções e já pré-marcado
// com o cargo atual do usuário. Usado na aba Pendentes
// (na aprovação) e na aba Aprovados (alteração posterior).
// ------------------------------------------------------------
function criarSeletorCargo(cargoAtual) {
  const seletor = document.createElement("select");
  seletor.className = "seletor-cargo";

  CARGOS.forEach((cargo) => {
    const opcao = document.createElement("option");
    opcao.value = cargo.valor;
    opcao.textContent = cargo.nome;
    seletor.appendChild(opcao);
  });

  // Pré-seleciona o cargo informado (ou "vendas" como padrão
  // para documentos antigos que não têm o campo cargo).
  seletor.value = cargoAtual || "vendas";
  return seletor;
}

// ------------------------------------------------------------
// ABA 1 — PENDENTES (aprovar / rejeitar)
// Cada cartão traz um SELETOR de cargo, já pré-marcado com o
// cargo que o candidato escolheu. O admin pode trocar antes
// de aprovar — inclusive promovendo a Administração, opção
// que o candidato não teve acesso no cadastro.
// ------------------------------------------------------------
function renderizarPendentes() {
  const pendentes = cacheSolicitacoes.filter((s) => s.status === "pendente");

  if (pendentes.length === 0) {
    listaPendentes.innerHTML =
      '<p class="texto-ajuda">Nenhuma solicitação pendente no momento.</p>';
    return;
  }

  listaPendentes.innerHTML = "";
  pendentes.forEach((solicitacao) => {
    const cartao = criarCartao(solicitacao, "Aguardando decisão", "etiqueta-pendente");

    cartao.appendChild(criarSeletorCargo(solicitacao.cargo));

    cartao.appendChild(
      criarBotao("Aprovar", "botao-aprovar", () =>
        // O seletor é o IRMÃO dentro deste cartão: buscamos ele
        // no cartão para pegar o valor escolhido na hora do clique.
        aprovarSolicitacao(solicitacao.id, solicitacao, cartao.querySelector(".seletor-cargo")))
    );
    cartao.appendChild(
      criarBotao("Rejeitar", "botao-rejeitar", () =>
        rejeitarSolicitacao(solicitacao.id, solicitacao))
    );

    listaPendentes.appendChild(cartao);
  });
}

// ------------------------------------------------------------
// ABA 2 — APROVADOS (alterar cargo / bloquear / excluir / reativar)
// NOVIDADE: usuários ativos ganham um SELETOR de cargo com o
// botão "Salvar cargo". É aqui que o administrador promove
// alguém a Administração (ou rebaixa) DEPOIS da aprovação —
// compensando a opção ter sido retirada do cadastro.
// ------------------------------------------------------------
function renderizarAprovados() {
  const ativos = cacheSolicitacoes.filter((s) =>
    s.status === "aprovada" || s.status === "bloqueada" || s.status === "excluida"
  );

  if (ativos.length === 0) {
    listaAprovados.innerHTML =
      '<p class="texto-ajuda">Nenhum usuário aprovado ainda.</p>';
    return;
  }

  listaAprovados.innerHTML = "";
  ativos.forEach((solicitacao) => {

    // Usuário ATIVO: pode trocar de cargo, ser bloqueado ou excluído.
    if (solicitacao.status === "aprovada") {
      const cartao = criarCartao(solicitacao, "Ativo", "etiqueta-aprovada");

      // Seletor pré-marcado com o cargo atual do usuário.
      cartao.appendChild(criarSeletorCargo(solicitacao.cargo));

      // Grava o cargo escolhido no seletor direto no banco.
      cartao.appendChild(
        criarBotao("Salvar cargo", "botao-reativar", () =>
          alterarCargo(solicitacao.id, cartao.querySelector(".seletor-cargo")))
      );
      cartao.appendChild(
        criarBotao("Bloquear", "botao-bloquear", () => bloquearUsuario(solicitacao.id))
      );
      cartao.appendChild(
        criarBotao("Excluir acesso", "botao-rejeitar", () => excluirAcesso(solicitacao.id))
      );
      listaAprovados.appendChild(cartao);
    }

    // BLOQUEADO: só pode ser reativado.
    if (solicitacao.status === "bloqueada") {
      const cartao = criarCartao(solicitacao, "Bloqueado", "etiqueta-bloqueada");
      cartao.appendChild(
        criarBotao("Reativar", "botao-reativar", () => reativarUsuario(solicitacao.id))
      );
      listaAprovados.appendChild(cartao);
    }

    // ACESSO EXCLUÍDO: só pode ser reativado.
    if (solicitacao.status === "excluida") {
      const cartao = criarCartao(solicitacao, "Acesso excluído", "etiqueta-excluida");
      cartao.appendChild(
        criarBotao("Reativar", "botao-reativar", () => reativarUsuario(solicitacao.id))
      );
      listaAprovados.appendChild(cartao);
    }
  });
}

// ------------------------------------------------------------
// ABA 3 — REJEITADOS (somente histórico, sem botões)
// Serve para o administrador saber quem tentou cadastrar.
// ------------------------------------------------------------
function renderizarRejeitados() {
  const rejeitados = cacheSolicitacoes.filter((s) => s.status === "rejeitada");

  if (rejeitados.length === 0) {
    listaRejeitados.innerHTML =
      '<p class="texto-ajuda">Nenhuma solicitação rejeitada ainda.</p>';
    return;
  }

  listaRejeitados.innerHTML = "";
  rejeitados.forEach((solicitacao) => {
    // Nenhum botão é adicionado: histórico é imutável.
    listaRejeitados.appendChild(
      criarCartao(solicitacao, "Rejeitado", "etiqueta-excluida")
    );
  });
}

// ------------------------------------------------------------
// GERAR CÓDIGO DE ADESÃO
// Sorteia 8 caracteres de um alfabeto SEM letras ambíguas
// (sem I, O, 0, 1 — que se confundem na leitura). Além de
// gravar no banco, revela o bloco com o código e o botão de
// copiar.
// ------------------------------------------------------------
function sortearCodigo() {
  const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 8; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

botaoGerar.addEventListener("click", async () => {
  botaoGerar.disabled = true;
  try {
    const codigo = sortearCodigo();
    await addDoc(collection(db, "codigosAdesao"), {
      codigo: codigo,
      usado: false,
      criadoEm: serverTimestamp()
    });

    // Mostra o código em destaque junto com o botão de copiar.
    // O parágrafo guarda APENAS o código (sem rótulo), para a
    // cópia sair limpa.
    codigoGerado.textContent = codigo;
    blocoCodigoGerado.style.display = "block";

  } catch (erro) {
    mostrarMensagem("Erro ao gerar o código.", "erro");
  } finally {
    botaoGerar.disabled = false;
  }
});

// ------------------------------------------------------------
// COPIAR CÓDIGO PARA A ÁREA DE TRANSFERÊNCIA
// navigator.clipboard.writeText pede ao navegador para copiar
// o texto. Funciona em endereços seguros — e o Live Server
// (127.0.0.1) é considerado seguro, então está garantido.
// ------------------------------------------------------------
botaoCopiar.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(codigoGerado.textContent);
    botaoCopiar.textContent = "Copiado! ✅";
    // Volta ao texto normal depois de 2 segundos.
    setTimeout(() => {
      botaoCopiar.textContent = "Copiar código";
    }, 2000);
  } catch (erro) {
    mostrarMensagem("Não foi possível copiar. Selecione e use Ctrl+C.", "erro");
  }
});

// ------------------------------------------------------------
// ENVIAR E-MAIL DE RESPOSTA (via EmailJS)
// ------------------------------------------------------------
function enviarEmail(destinatario, nome, aprovado) {
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
// Caso 1 (normal): cria a conta de verdade no Firebase e grava
// o cargo ESCOLHIDO NO SELETOR (não o pedido pelo candidato).
// Caso 2 (e-mail já tem conta): acontece quando o usuário foi
// bloqueado/excluído e tentou se cadastrar de novo. A conta já
// existe no Firebase, então não há o que criar — basta mudar
// o status no banco para "aprovada", o que reativa o acesso.
// OBSERVAÇÃO: no caso 2, a senha válida é a do cadastro
// ANTERIOR (o Firebase não permite trocar a senha por aqui).
// ------------------------------------------------------------
async function aprovarSolicitacao(id, dados, seletorCargo) {
  // O cargo vem do seletor da tela, não do pedido do candidato.
  const cargoEscolhido = seletorCargo.value;

  try {
    // Tentativa normal: criar a conta nova.
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

    // CASO 2 — o e-mail já possui conta no Firebase.
    if (erro.code === "auth/email-already-in-use") {
      try {
        // Reativa o acesso apenas atualizando o status no banco.
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
      return; // encerra aqui: não é um erro de verdade
    }

    // Qualquer outro erro continua sendo reportado.
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
// Grava o cargo escolhido no seletor. O efeito é IMEDIATO na
// próxima sessão do usuário: ele passa a ver as aplicações do
// cargo novo na home. Se rebaixado de "administracao", perde
// o acesso a este painel (a proteção consulta o cargo no banco).
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
// BLOQUEAR: o usuário continua existindo, mas o login.js
// recusará a entrada dele enquanto o status for "bloqueada".
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
// EXCLUIR ACESSO: marca como "excluida". O efeito para o
// usuário é o mesmo do bloqueio (login recusado); a diferença
// é apenas a etiqueta que o administrador vê no painel.
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
// REATIVAR: devolve o status "aprovada", liberando o login
// novamente (o login.js só bloqueia quem está bloqueado/excluído).
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
botaoSair.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});