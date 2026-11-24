import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  iniciarLayoutBase,
  aplicarPermissoesSidebar,
  obterDadosUsuario,
  atualizarCabecalhoUsuario
} from "./layout-base.js";

const ADMINISTRADORES = ["eamgfn4ever@gmail.com"];
const conteudoProtegido = document.getElementById("conteudo-protegido");
const conteudoConexoes = document.querySelector(".app-conteudo");
const emailUsuario = document.getElementById("email-usuario");
const botaoSair = document.getElementById("botao-sair");
const contagemUsuarios = document.getElementById("contagem-usuarios");
const contagemPendentes = document.getElementById("contagem-pendentes");
const aviso = document.getElementById("aviso-conexoes");
const statusIntegracao = document.getElementById("status-integracao");
const formConectarWrap = document.getElementById("form-conectar-wrap");
const formConectar = document.getElementById("form-conectar");
const campoAppId = document.getElementById("app-id");
const appsMeta = document.getElementById("apps-meta");
const campoWebhookUrl = document.getElementById("webhook-url");
const botaoCopiarWebhook = document.getElementById("copiar-webhook");
const listaNumeros = document.getElementById("lista-numeros");
const campoBusca = document.getElementById("campo-busca");
const formBot = document.getElementById("form-bot");
const seletorBot = document.getElementById("bot-numero");
const botAtivo = document.getElementById("bot-ativo");
const botMensagem = document.getElementById("bot-mensagem");
const formNovaConversa = document.getElementById("form-nova-conversa");

let ehAdmin = false;
let numeros = [];
let appIdAnterior = "";

function mostrarAviso(texto, tipo) {
  aviso.textContent = texto;
  aviso.className = "conexoes-aviso visivel " + tipo;
}

function executarCallable(nome, dados) {
  return httpsCallable(functions, nome)(dados).then((resultado) => resultado.data);
}

function criarElemento(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto) elemento.textContent = texto;
  return elemento;
}

function criarBotao(texto, classe, acao) {
  const botao = criarElemento("button", classe, texto);
  botao.type = "button";
  botao.addEventListener("click", acao);
  return botao;
}

function atualizarWebhook() {
  const appId = campoAppId.value.trim();
  const projeto = functions.app.options.projectId;
  const regiao = functions.region;
  const configuracaoValida = !functions.customDomain &&
    typeof projeto === "string" && /^[a-z0-9-]+$/.test(projeto) &&
    typeof regiao === "string" && /^[a-z0-9-]+$/.test(regiao);
  campoWebhookUrl.value = /^\d{6,25}$/.test(appId) && configuracaoValida
    ? `https://${regiao}-${projeto}.cloudfunctions.net/whatsappWebhook/${appId}`
    : "";
  botaoCopiarWebhook.disabled = !campoWebhookUrl.value;
  campoWebhookUrl.placeholder = configuracaoValida
    ? "Informe um App ID válido"
    : "Consulte a URL da função após o deploy e acrescente o App ID";
}

function preencherAppsMeta() {
  const apps = [...new Set(numeros.map((numero) => numero.appId).filter((appId) =>
    typeof appId === "string" && /^\d{6,25}$/.test(appId)
  ))].sort();
  appsMeta.replaceChildren(...apps.map((appId) => new Option(appId, appId)));
}

function alterarAppId() {
  const appId = campoAppId.value.trim();
  if (appId !== appIdAnterior) {
    formConectar.elements.accessToken.value = "";
    formConectar.elements.appSecret.value = "";
    formConectar.elements.verifyToken.value = "";
    appIdAnterior = appId;
  }
  atualizarWebhook();
}

campoAppId.addEventListener("input", alterarAppId);
campoAppId.addEventListener("change", alterarAppId);

botaoCopiarWebhook.addEventListener("click", async () => {
  if (!campoWebhookUrl.value) {
    mostrarAviso("Informe um App ID válido para obter a URL do webhook.", "erro");
    return;
  }
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error("Área de transferência indisponível.");
    }
    await navigator.clipboard.writeText(campoWebhookUrl.value);
    mostrarAviso("URL do webhook copiada. Confirme a URL da função após o deploy.", "sucesso");
  } catch (erro) {
    campoWebhookUrl.focus();
    campoWebhookUrl.select();
    mostrarAviso("Não foi possível copiar automaticamente. A URL foi selecionada para cópia manual.", "erro");
  }
});

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
    return;
  }

  conteudoProtegido.classList.remove("oculto");
  iniciarLayoutBase();

  try {
    const dadosUsuario = await obterDadosUsuario(usuario, db);
    atualizarCabecalhoUsuario(dadosUsuario);
    const email = (usuario.email || "").toLowerCase();
    let cargo = dadosUsuario.cargo;
    let aprovado = ADMINISTRADORES.includes(email);
    if (!aprovado) {
      const solicitacoes = await getDocs(collection(db, "solicitacoes"));
      solicitacoes.forEach((documento) => {
        const dados = documento.data();
        if ((dados.email || "").toLowerCase() === email && dados.status === "aprovada" &&
            ["vendas", "administracao"].includes(dados.cargo)) {
          aprovado = true;
          cargo = dados.cargo;
        }
      });
    }
    ehAdmin = ADMINISTRADORES.includes(email) || cargo === "administracao";
    aplicarPermissoesSidebar(cargo, ehAdmin);

    if (!aprovado || (!ehAdmin && cargo !== "vendas")) {
      conteudoConexoes.innerHTML = "<p class='mensagem erro'>Esta área é restrita aos setores de Vendas e Administração.</p>";
      conteudoConexoes.querySelector(".mensagem").style.display = "block";
      return;
    }

    if (emailUsuario) emailUsuario.textContent = usuario.email || "";
    formConectarWrap.hidden = !ehAdmin;
    const conexoes = await executarCallable("getWhatsAppConnections", {});
    numeros = conexoes.numbers || [];
    renderizarNumeros();
    preencherSeletores();
    statusIntegracao.textContent = numeros.length
      ? numeros.length + (numeros.length === 1 ? " número vinculado" : " números vinculados")
      : "Nenhum número vinculado";
    statusIntegracao.classList.toggle("vazio", numeros.length === 0);
    await carregarCentroControle();
  } catch (erro) {
    console.error("Erro ao carregar conexões:", erro);
    listaNumeros.replaceChildren(criarElemento("p", "texto-ajuda", erro.message || "Não foi possível carregar as conexões."));
    statusIntegracao.textContent = "Falha ao carregar";
    statusIntegracao.classList.add("vazio");
    mostrarAviso(erro.message || "Não foi possível carregar as conexões.", "erro");
  }
});

function renderizarNumeros() {
  listaNumeros.replaceChildren();
  if (!numeros.length) {
    listaNumeros.appendChild(criarElemento("p", "texto-ajuda", "Nenhum número vinculado. " +
      (ehAdmin ? "Use o formulário acima para conectar o primeiro número." : "Solicite ao administrador a vinculação de um número.")));
    return;
  }

  const termo = campoBusca.value.trim().toLowerCase();
  const filtrados = numeros.filter((numero) =>
    [numero.displayPhoneNumber, numero.verifiedName, numero.phoneNumberId]
      .some((valor) => String(valor || "").toLowerCase().includes(termo))
  );
  if (!filtrados.length) {
    listaNumeros.appendChild(criarElemento("p", "texto-ajuda", "Nenhum número encontrado para a busca."));
    return;
  }

  filtrados.forEach((numero) => {
    const cartao = criarElemento("article", "conexoes-numero");
    const informacoes = criarElemento("div");
    informacoes.appendChild(criarElemento("h3", "", numero.displayPhoneNumber || numero.phoneNumberId));
    informacoes.appendChild(criarElemento("p", "", (numero.verifiedName || "WhatsApp Business") + " · ID " + numero.phoneNumberId));
    informacoes.appendChild(criarElemento("p", "", numero.appId ? "App ID: " + numero.appId : "Vínculo legado sem App ID"));
    informacoes.appendChild(criarElemento("p", "", "Captação de conversas: " + (numero.captureEnabled ? "ativada" : "desativada") +
      (numero.active ? "" : " · número desconectado")));
    const acoes = criarElemento("div", "conexoes-numero-acoes");
    if (numero.active) acoes.appendChild(criarElemento("span", "conexoes-selo", "Conectado"));

    if (ehAdmin) {
      acoes.appendChild(criarBotao(
        numero.captureEnabled ? "Desativar captação" : "Ativar captação",
        "conexoes-botao-secundario",
        () => alterarCaptacao(numero)
      ));
      acoes.appendChild(criarBotao("Remover", "conexoes-botao-perigo", () => removerNumero(numero)));
    }

    cartao.append(informacoes, acoes);
    listaNumeros.appendChild(cartao);
  });
}

campoBusca.addEventListener("input", renderizarNumeros);

function preencherSeletores() {
  preencherAppsMeta();
  [seletorBot, ...document.querySelectorAll(".seletor-numeros")].forEach((seletor) => {
    const atual = seletor.value;
    seletor.replaceChildren(new Option("Selecione um número", ""));
    numeros.filter((numero) => numero.active).forEach((numero) => {
      seletor.add(new Option(numero.displayPhoneNumber || numero.phoneNumberId, numero.phoneNumberId));
    });
    if (numeros.some((numero) => numero.phoneNumberId === atual && numero.active)) seletor.value = atual;
  });
  atualizarConfiguracaoBot();
}

function atualizarConfiguracaoBot() {
  const numero = numeros.find((item) => item.phoneNumberId === seletorBot.value);
  botAtivo.checked = !!(numero && numero.preAtendimentoEnabled);
  botMensagem.value = numero ? (numero.preAtendimentoMessage || "") : "";
  botAtivo.disabled = !numero;
  botMensagem.disabled = !numero;
  formBot.querySelector("button[type='submit']").disabled = !numero;
}

async function alterarCaptacao(numero) {
  const novoEstado = !numero.captureEnabled;
  try {
    await executarCallable("updateWhatsAppNumber", {
      phoneNumberId: numero.phoneNumberId,
      action: "capture",
      captureEnabled: novoEstado
    });
    numero.captureEnabled = novoEstado;
    renderizarNumeros();
    mostrarAviso("Captação " + (novoEstado ? "ativada" : "desativada") + " para " + (numero.displayPhoneNumber || numero.phoneNumberId) + ".", "sucesso");
  } catch (erro) {
    mostrarAviso(erro.message || "Não foi possível alterar a captação.", "erro");
  }
}

async function removerNumero(numero) {
  if (!window.confirm("Remover " + (numero.displayPhoneNumber || numero.phoneNumberId) + " da integração?")) return;
  try {
    await executarCallable("updateWhatsAppNumber", {
      phoneNumberId: numero.phoneNumberId,
      action: "remove"
    });
    numeros = numeros.filter((item) => item.phoneNumberId !== numero.phoneNumberId);
    renderizarNumeros();
    preencherSeletores();
    statusIntegracao.textContent = numeros.length
      ? numeros.length + (numeros.length === 1 ? " número vinculado" : " números vinculados")
      : "Nenhum número vinculado";
    statusIntegracao.classList.toggle("vazio", numeros.length === 0);
    mostrarAviso("Número removido da integração.", "sucesso");
  } catch (erro) {
    mostrarAviso(erro.message || "Não foi possível remover o número.", "erro");
  }
}

formConectar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!ehAdmin) return;
  const botao = formConectar.querySelector("button[type='submit']");
  const dados = Object.fromEntries(new FormData(formConectar).entries());
  botao.disabled = true;
  botao.textContent = "Validando e vinculando...";
  try {
    const resultado = await executarCallable("connectWhatsAppNumber", dados);
    const existente = numeros.findIndex((numero) => numero.phoneNumberId === resultado.number.phoneNumberId);
    if (existente >= 0) numeros[existente] = resultado.number;
    else numeros.push(resultado.number);
    formConectar.reset();
    campoAppId.value = dados.appId.trim();
    appIdAnterior = campoAppId.value;
    atualizarWebhook();
    renderizarNumeros();
    preencherSeletores();
    statusIntegracao.textContent = numeros.length + (numeros.length === 1 ? " número vinculado" : " números vinculados");
    statusIntegracao.classList.remove("vazio");
    if (resultado.number.appId === dados.appId.trim()) {
      mostrarAviso("Número vinculado ao app. Confirme a URL da função após o deploy e configure o webhook na Meta.", "sucesso");
    } else {
      mostrarAviso("O número foi vinculado, mas o backend não confirmou o App ID. Atualize as Functions antes de configurar o webhook específico.", "erro");
    }
  } catch (erro) {
    console.error("Erro ao vincular número WhatsApp:", erro);
    mostrarAviso(erro.message || "Não foi possível vincular o número.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = "Vincular número";
  }
});

seletorBot.addEventListener("change", atualizarConfiguracaoBot);
formBot.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = formBot.querySelector("button[type='submit']");
  const phoneNumberId = seletorBot.value;
  const preAtendimentoMessage = botMensagem.value.trim();
  if (!phoneNumberId) return;
  if (botAtivo.checked && !preAtendimentoMessage) {
    mostrarAviso("Escreva a mensagem automática antes de ativar o bot.", "erro");
    return;
  }
  botao.disabled = true;
  try {
    await executarCallable("saveWhatsAppSettings", {
      phoneNumberId,
      preAtendimentoEnabled: botAtivo.checked,
      preAtendimentoMessage
    });
    const numero = numeros.find((item) => item.phoneNumberId === phoneNumberId);
    if (numero) {
      numero.preAtendimentoEnabled = botAtivo.checked;
      numero.preAtendimentoMessage = preAtendimentoMessage;
    }
    mostrarAviso("Configuração do pré-atendimento salva.", "sucesso");
  } catch (erro) {
    mostrarAviso(erro.message || "Não foi possível salvar a configuração do bot.", "erro");
  } finally {
    botao.disabled = false;
  }
});

formNovaConversa.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = formNovaConversa.querySelector("button[type='submit']");
  const dados = Object.fromEntries(new FormData(formNovaConversa).entries());
  botao.disabled = true;
  try {
    const resultado = await executarCallable("sendWhatsAppMessage", {
      ...dados,
      mode: "template",
      templateLanguage: dados.templateLanguage || "pt_BR"
    });
    formNovaConversa.reset();
    mostrarAviso("Modelo enviado pela Meta. Card criado no kanban (" + resultado.cardId + ").", "sucesso");
  } catch (erro) {
    mostrarAviso(erro.message || "Não foi possível iniciar a conversa.", "erro");
  } finally {
    botao.disabled = false;
  }
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
