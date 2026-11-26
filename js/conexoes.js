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
const botaoAdicionar = document.getElementById("botao-adicionar-numero");
const appsMeta = document.getElementById("apps-meta");
const listaNumeros = document.getElementById("lista-numeros");
const campoBusca = document.getElementById("campo-busca");
const formBot = document.getElementById("form-bot");
const seletorBot = document.getElementById("bot-numero");
const botAtivo = document.getElementById("bot-ativo");
const botMensagem = document.getElementById("bot-mensagem");
const formNovaConversa = document.getElementById("form-nova-conversa");

let ehAdmin = false;
let numeros = [];
let proximoRascunho = 0;
let colunasRoteamento = [];
let editorAberto = null;
let avisoTimer = null;
const estados = new Map();
const cartoes = new Map();

function mostrarAviso(texto, tipo) {
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.className = "conexoes-aviso visivel " + tipo;
  if (avisoTimer) clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => {
    aviso.classList.remove("visivel");
  }, 6000);
}

if (aviso) {
  aviso.addEventListener("click", () => {
    aviso.classList.remove("visivel");
    if (avisoTimer) clearTimeout(avisoTimer);
  });
}

function sincronizarNumero(numeroAtualizado) {
  if (!numeroAtualizado || !numeroAtualizado.phoneNumberId) return;
  const indice = numeros.findIndex((item) => item.phoneNumberId === numeroAtualizado.phoneNumberId);
  if (indice >= 0) numeros[indice] = numeroAtualizado;
  else numeros.push(numeroAtualizado);
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

const INATIVIDADE_PADRAO_MINUTOS = 24 * 60;
const INATIVIDADE_MAX_MINUTOS = 99 * 24 * 60 + 23 * 60 + 59;

function normalizarInatividadeMinutos(valor) {
  return Number.isInteger(valor) && valor >= 0 && valor <= INATIVIDADE_MAX_MINUTOS
    ? valor
    : INATIVIDADE_PADRAO_MINUTOS;
}

function decomporInatividade(minutosTotais) {
  const seguro = normalizarInatividadeMinutos(minutosTotais);
  return {
    dias: Math.floor(seguro / 1440),
    horas: Math.floor((seguro % 1440) / 60),
    minutos: seguro % 60
  };
}

function formatarInatividade(minutosTotais) {
  const { dias, horas, minutos } = decomporInatividade(minutosTotais);
  return String(dias).padStart(2, "0") + " " + String(horas).padStart(2, "0") + " " + String(minutos).padStart(2, "0");
}

function criarEstado(numero, novo = false) {
  const mensagens = Array.isArray(numero.botMessages)
    ? numero.botMessages.map(clonarMensagem)
    : [];
  const inactivityMinutes = normalizarInatividadeMinutos(numero.inactivityMinutes);
  return {
    numero, novo, aberto: novo, contatoAberto: false, automacaoAberta: false,
    confirmando: false, salvando: false, status: novo ? "novo" : "verificando",
    nome: numero.displayName || numero.verifiedName || (novo ? "Novo número" : "WhatsApp Business"),
    nomeOriginal: numero.displayName || numero.verifiedName || (novo ? "Novo número" : "WhatsApp Business"),
    campos: {
      appId: numero.appId || "", phoneNumberId: numero.phoneNumberId || "", wabaId: numero.wabaId || "",
      accessToken: "", verifyToken: "", appSecret: ""
    },
    mensagens,
    mensagemAbertaId: "",
    activeBotMessageId: numero.activeBotMessageId || "",
    onlyRecipientInitiated: numero.onlyRecipientInitiated !== false,
    inactivityMinutes,
    automacaoOriginal: JSON.stringify({
      messages: numero.botMessages || [],
      activeId: numero.activeBotMessageId || "",
      onlyRecipient: numero.onlyRecipientInitiated !== false,
      inactivityMinutes
    })
  };
}

function clonarMensagem(mensagem) {
  return JSON.parse(JSON.stringify(mensagem));
}

function automacaoSerializada(estado) {
  return JSON.stringify({
    messages: estado.mensagens,
    activeId: estado.activeBotMessageId,
    onlyRecipient: estado.onlyRecipientInitiated,
    inactivityMinutes: normalizarInatividadeMinutos(estado.inactivityMinutes)
  });
}

function alterado(estado) {
  const { campos, numero } = estado;
  return estado.nome !== estado.nomeOriginal ||
    campos.appId !== (numero.appId || "") ||
    campos.phoneNumberId !== (numero.phoneNumberId || "") ||
    campos.wabaId !== (numero.wabaId || "") ||
    !!(campos.accessToken || campos.verifyToken || campos.appSecret) ||
    automacaoSerializada(estado) !== estado.automacaoOriginal;
}

function atualizarContagem() {
  statusIntegracao.textContent = numeros.length
    ? numeros.length + (numeros.length === 1 ? " número vinculado" : " números vinculados")
    : "Nenhum número vinculado";
  statusIntegracao.classList.toggle("vazio", numeros.length === 0);
}

function atualizarRodape(estado, cartao) {
  const sujo = alterado(estado);
  const botaoSalvar = cartao.querySelector(".numero-salvar");
  const botaoDeletar = cartao.querySelector(".numero-deletar");
  const confirmacao = cartao.querySelector(".numero-confirmacao");
  if (botaoSalvar) {
    botaoSalvar.hidden = estado.confirmando;
    botaoSalvar.disabled = !ehAdmin || estado.salvando || !sujo;
    botaoSalvar.classList.toggle("pendente", sujo && ehAdmin && !estado.salvando);
  }
  if (botaoDeletar) botaoDeletar.hidden = estado.confirmando;
  if (confirmacao) confirmacao.hidden = !estado.confirmando;
}

function atualizarStatus(estado) {
  const cartao = cartoes.get(estado);
  if (!cartao) return;
  const linha = cartao.querySelector(".numero-status");
  const detalhe = cartao.querySelector(".numero-status-detalhe");
  linha.title = "Verificação de acesso à Meta; não garante entrega de mensagens.";
  const falha = estado.status === "falha";
  const desconhecido = estado.status === "verificando" || estado.status === "desconhecido" || estado.status === "novo";
  linha.className = "numero-status " + (falha ? "falha" : desconhecido ? "desconhecido" : estado.numero.active ? "operando" : "suspenso");
  linha.textContent = "STATUS: " + (falha ? "NÃO OPERANTE" : desconhecido
    ? (estado.status === "verificando" ? "VERIFICANDO" : "NÃO VERIFICADO") : estado.numero.active ? "OPERANDO" : "SUSPENSO");
  detalhe.textContent = falha
    ? "Este número não está mais conectado ao sistema por algum problema de comunicação entre a plataforma e o whatsapp"
    : !desconhecido && !estado.numero.active
      ? "No momento o número foi desativado para uso. Reative-o para utilização."
      : desconhecido ? "A verificação não confirma a entrega de mensagens." : "";
}

async function verificarNumero(estado) {
  if (estado.novo) return;
  estado.status = "verificando";
  atualizarStatus(estado);
  try {
    const resultado = await executarCallable("checkWhatsAppNumberStatus", { phoneNumberId: estado.numero.phoneNumberId });
    if (!resultado || typeof resultado.operational !== "boolean") throw new Error("Resposta de status inválida.");
    estado.status = resultado.operational ? "operando" : "falha";
  } catch (erro) {
    console.error("Falha ao verificar status do WhatsApp:", erro);
    estado.status = "desconhecido";
    mostrarAviso("Não foi possível verificar o status deste número: " + (erro.message || "erro de comunicação."), "erro");
  }
  atualizarStatus(estado);
}

function urlWebhook(appId) {
  const projeto = functions.app.options.projectId;
  const regiao = functions.region;
  return !functions.customDomain && /^\d{6,25}$/.test(appId) &&
    typeof projeto === "string" && /^[a-z0-9-]+$/.test(projeto) &&
    typeof regiao === "string" && /^[a-z0-9-]+$/.test(regiao)
    ? `https://${regiao}-${projeto}.cloudfunctions.net/whatsappWebhook/${appId}` : "";
}

function adicionarCampo(form, estado, nome, rotulo, opcoes = {}) {
  const label = criarElemento("label", "numero-campo", rotulo);
  const input = document.createElement("input");
  input.name = nome;
  input.type = "text";
  input.value = estado.campos[nome];
  input.autocomplete = opcoes.segredo ? "new-password" : "off";
  input.readOnly = !ehAdmin || estado.salvando || !!opcoes.somenteLeitura;
  if (opcoes.id) {
    input.inputMode = "numeric";
    input.pattern = "[0-9]{6,25}";
    input.maxLength = 25;
    input.required = true;
  }
  if (opcoes.lista) input.setAttribute("list", "apps-meta");
  if (opcoes.segredo) input.placeholder = estado.novo ? "Digite a credencial" : "Salvo no Secret Manager; informe para alterar";
  input.classList.toggle("alterado", estado.campos[nome] !== (estado.numero[nome] || ""));
  input.addEventListener("input", () => {
    if (nome === "appId" && estado.campos.appId !== input.value) {
      for (const chave of ["accessToken", "appSecret", "verifyToken"]) {
        estado.campos[chave] = "";
        const campo = form.querySelector(`[name="${chave}"]`);
        if (campo) { campo.value = ""; campo.classList.remove("alterado"); }
      }
    }
    estado.campos[nome] = input.value;
    input.classList.toggle("alterado", input.value !== (estado.numero[nome] || ""));
    const url = form.querySelector(".numero-webhook-url");
    if (url) url.value = urlWebhook(estado.campos.appId.trim());
    estado.confirmando = false;
    atualizarRodape(estado, form.closest(".conexoes-numero"));
  });
  label.appendChild(input);
  form.appendChild(label);
}

function editarNome(estado, titulo, cartao) {
  if (!estado.aberto || !ehAdmin || estado.salvando) return;
  const input = document.createElement("input");
  input.className = "numero-nome-edicao";
  input.value = estado.nome;
  input.maxLength = 100;
  titulo.replaceWith(input);
  input.focus();
  input.select();
  let finalizado = false;
  function terminar(cancelar) {
    if (finalizado) return;
    finalizado = true;
    if (!cancelar && input.value.trim()) estado.nome = input.value.trim();
    titulo.textContent = estado.nome;
    input.replaceWith(titulo);
    atualizarRodape(estado, cartao);
  }
  input.addEventListener("blur", () => terminar(false));
  input.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" || evento.key === "Escape") {
      evento.preventDefault();
      terminar(evento.key === "Escape");
    }
  });
}

function criarSecao(titulo, aberta, aoAlternar) {
  const details = criarElemento("details", "numero-secao");
  details.open = aberta;
  details.addEventListener("toggle", () => aoAlternar(details.open));
  const summary = criarElemento("summary", "", titulo);
  summary.appendChild(criarElemento("span", "numero-triangulo", "▼"));
  details.appendChild(summary);
  return details;
}

function nomePadraoMensagem(mensagens) {
  let numero = 1;
  const nomes = new Set(mensagens.map((mensagem) => mensagem.name));
  while (nomes.has(`MENSAGEM ${numero}`)) numero++;
  return `MENSAGEM ${numero}`;
}

function renderizarTextoMensagem(mensagem) {
  return mensagem.blocks.map((block) => {
    if (!block || block.type === "hidden") return "";
    if (block.type === "text") return String(block.text || "").trim();
    let texto = block.styled && String(block.style || "").trim()
      ? String(block.style).trim() : String(block.trigger || "").trim();
    if (block.bold) texto = "*" + texto + "*";
    const descricao = String(block.description || "").trim();
    return descricao ? texto + " - " + descricao : texto;
  }).filter(Boolean).join("\n");
}

function colunasDaMensagem(mensagem) {
  const nomes = new Map();
  mensagem.blocks.forEach((block) => {
    if (block.type !== "text" && block.columnId && block.columnName) {
      nomes.set(block.columnId, block.columnName);
    }
  });
  return [...nomes.values()];
}

function renderizarMensagens(estado) {
  const lista = criarElemento("div", "mensagens-bot");
  estado.mensagens.forEach((mensagem) => {
    const aberta = estado.mensagemAbertaId === mensagem.id;
    const card = criarElemento("article", "mensagem-card" + (aberta ? " aberta" : ""));
    const topo = criarElemento("div", "mensagem-card-topo");
    const nome = criarElemento("h4", "mensagem-card-nome", mensagem.name);
    nome.addEventListener("dblclick", (evento) => {
      if (!aberta || !ehAdmin) return;
      evento.stopPropagation();
      editarNomeMensagem(estado, mensagem, nome);
    });
    topo.appendChild(nome);
    const ativa = criarElemento("label", "mensagem-ativa con-switch" + (estado.activeBotMessageId === mensagem.id ? " ativo" : ""));
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "con-switch-input con-switch-compacto";
    check.setAttribute("role", "switch");
    check.checked = estado.activeBotMessageId === mensagem.id;
    check.disabled = !ehAdmin;
    check.setAttribute("aria-label", "Ativar " + mensagem.name);
    ativa.addEventListener("click", (evento) => evento.stopPropagation());
    check.addEventListener("change", async (evento) => {
      evento.stopPropagation();
      const anterior = estado.activeBotMessageId;
      const ativando = check.checked;
      estado.activeBotMessageId = ativando ? mensagem.id : "";
      check.disabled = true;
      try {
        await salvarAutomacao(estado);
        mostrarAviso(
          "Salvo: mensagem \"" + mensagem.name + "\" " + (ativando ? "ativada" : "desativada") + " na automação.",
          "sucesso"
        );
      } catch (_) {
        estado.activeBotMessageId = anterior;
        renderizarNumeros();
      }
    });
    ativa.append(check, criarElemento("span", "con-switch-texto", check.checked ? "ATIVA" : "ATIVAR"));
    topo.appendChild(ativa);
    card.appendChild(topo);
    card.addEventListener("dblclick", (evento) => {
      if (evento.target.closest("input, button, label, h4")) return;
      estado.mensagemAbertaId = aberta ? "" : mensagem.id;
      renderizarNumeros();
    });
    if (aberta) {
      const corpo = criarElemento("div", "mensagem-card-corpo");
      const tituloPreview = criarElemento("strong", "", "Pré-visualização");
      const preview = criarElemento("p", "mensagem-preview", renderizarTextoMensagem(mensagem) || "Sem conteúdo visível");
      const colunas = criarElemento("p", "mensagem-colunas",
        "Colunas relacionadas: " + (colunasDaMensagem(mensagem).join(", ") || "nenhuma"));
      const editar = criarBotao("EDITAR", "mensagem-editar", (evento) => {
        evento.stopPropagation();
        abrirEditorMensagem(estado, mensagem, false);
      });
      const rodape = criarElemento("div", "mensagem-card-rodape");
      rodape.appendChild(editar);
      corpo.append(tituloPreview, preview, colunas, rodape);
      card.appendChild(corpo);
    }
    lista.appendChild(card);
  });
  return lista;
}

function editarNomeMensagem(estado, mensagem, titulo) {
  const input = document.createElement("input");
  input.className = "mensagem-nome-edicao";
  input.value = mensagem.name;
  titulo.replaceWith(input);
  input.focus();
  input.select();
  let pronto = false;
  const terminar = async () => {
    if (pronto) return;
    pronto = true;
    const nomeAnterior = mensagem.name;
    mensagem.name = input.value.trim() || mensagem.name;
    titulo.textContent = mensagem.name;
    input.replaceWith(titulo);
    if (mensagem.name !== nomeAnterior) {
      await salvarAutomacao(estado);
      mostrarAviso("Salvo: nome da mensagem atualizado para \"" + mensagem.name + "\".", "sucesso");
    }
  };
  input.addEventListener("blur", terminar);
  input.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") { evento.preventDefault(); terminar(); }
  });
}

function normalizarParaSalvar(mensagem) {
  const copia = clonarMensagem(mensagem);
  copia.name = String(copia.name || "").trim();
  copia.blocks = copia.blocks.map((block) => {
    if (block.type === "text") return { type: "text", text: String(block.text || "").trim() };
    const normalizado = {
      type: block.type,
      trigger: String(block.trigger || "").trim(),
      description: String(block.description || "").trim(),
      columnId: String(block.columnId || ""),
      columnName: String(block.columnName || "")
    };
    if (block.type === "option") {
      normalizado.bold = !!block.bold;
      normalizado.styled = !!block.styled && !!String(block.style || "").trim();
      normalizado.style = normalizado.styled ? String(block.style || "").trim() : "";
    }
    return normalizado;
  });
  return copia;
}

function validarMensagem(mensagem) {
  if (!mensagem.name.trim()) return "Informe o nome da mensagem.";
  if (!mensagem.blocks.length) return "Adicione ao menos um bloco.";
  if (mensagem.blocks.length > 20) return "A mensagem pode ter no máximo 20 blocos.";
  const gatilhos = new Set();
  for (const block of mensagem.blocks) {
    if (block.type === "text") {
      if (!String(block.text || "").trim()) return "Preencha todos os blocos de texto.";
      continue;
    }
    const trigger = String(block.trigger || "").trim();
    if (!trigger || trigger.length > 15) return "Cada gatilho deve ter entre 1 e 15 caracteres.";
    if (gatilhos.has(trigger.toLocaleLowerCase("pt-BR"))) return "Não repita gatilhos na mesma mensagem.";
    gatilhos.add(trigger.toLocaleLowerCase("pt-BR"));
    if (!block.columnId || !String(block.columnName || "").endsWith("*")) {
      return "Selecione o direcionamento de cada opção.";
    }
  }
  if (!renderizarTextoMensagem(mensagem)) return "A mensagem final precisa conter texto visível.";
  return "";
}

async function salvarAutomacao(estado) {
  if (estado.novo || !ehAdmin) return;
  try {
    const resultado = await executarCallable("saveWhatsAppAutomation", {
      phoneNumberId: estado.numero.phoneNumberId,
      botMessages: estado.mensagens,
      activeBotMessageId: estado.activeBotMessageId,
      onlyRecipientInitiated: estado.onlyRecipientInitiated,
      inactivityMinutes: normalizarInatividadeMinutos(estado.inactivityMinutes)
    });
    if (!resultado.number) throw new Error("O backend não retornou a automação salva.");
    estado.numero = resultado.number;
    sincronizarNumero(resultado.number);
    estado.mensagens = (resultado.number.botMessages || []).map(clonarMensagem);
    estado.activeBotMessageId = resultado.number.activeBotMessageId || "";
    estado.onlyRecipientInitiated = resultado.number.onlyRecipientInitiated !== false;
    estado.inactivityMinutes = normalizarInatividadeMinutos(resultado.number.inactivityMinutes);
    estado.automacaoOriginal = automacaoSerializada(estado);
    renderizarNumeros();
  } catch (erro) {
    mostrarAviso(erro.message || "Não foi possível salvar a automação.", "erro");
    throw erro;
  }
}

function campoEditor(rotulo, valor, aoMudar, opcoes = {}) {
  const label = criarElemento("label", "editor-campo", rotulo);
  const campo = document.createElement(opcoes.textarea ? "textarea" : "input");
  campo.value = valor || "";
  if (opcoes.limite) campo.maxLength = opcoes.limite;
  if (opcoes.placeholder) campo.placeholder = opcoes.placeholder;
  if (opcoes.textarea) {
    campo.rows = 2;
    const ajustar = () => {
      campo.style.height = "auto";
      campo.style.height = campo.scrollHeight + "px";
    };
    campo.addEventListener("input", ajustar);
    queueMicrotask(ajustar);
  }
  campo.addEventListener("input", () => aoMudar(campo.value));
  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && !opcoes.textarea) campo.blur();
  });
  label.appendChild(campo);
  return label;
}

function renderizarBlocosEditor(sessao, blocos, atualizarPreview) {
  sessao.replaceChildren();
  blocos.forEach((block) => {
    const area = criarElemento("section", "editor-bloco");
    const remover = criarBotao("−", "editor-remover-bloco", () => {
      blocos.splice(blocos.indexOf(block), 1);
      renderizarBlocosEditor(sessao, blocos, atualizarPreview);
      atualizarPreview();
    });
    remover.setAttribute("aria-label", "Remover bloco");
    area.appendChild(remover);
    if (block.type === "text") {
      area.appendChild(criarElemento("h3", "editor-tipo", "TEXTO"));
      area.appendChild(campoEditor("Conteúdo", block.text, (valor) => { block.text = valor; atualizarPreview(); }, {
        textarea: true, placeholder: "Digite o texto da mensagem"
      }));
    } else {
      let atualizarNota = () => {};
      area.appendChild(criarElemento("h3", "editor-tipo", block.type === "hidden" ? "OPÇÃO OCULTA" : "OPÇÃO SIMPLES"));
      const campos = criarElemento("div", "editor-opcao-campos");
      campos.appendChild(campoEditor("Gatilho (1 a 15 caracteres)", block.trigger, (valor) => {
        block.trigger = valor;
        atualizarNota();
        atualizarPreview();
      }, { limite: 15 }));
      campos.appendChild(campoEditor(block.type === "hidden" ? "Anotação interna" : "Descrição (opcional)", block.description, (valor) => {
        block.description = valor;
        atualizarPreview();
      }, { textarea: true }));
      area.appendChild(campos);
      if (block.type === "option") {
        const formatacao = criarElemento("div", "editor-formatacao");
        for (const [chave, texto] of [["bold", "Negritar a opção"], ["styled", "Estilizar opção"]]) {
          const label = criarElemento("label", "editor-toggle con-switch");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.className = "con-switch-input con-switch-compacto";
          input.setAttribute("role", "switch");
          input.checked = !!block[chave];
          input.addEventListener("change", () => {
            block[chave] = input.checked;
            if (chave === "styled") blocoAlternativo.hidden = !input.checked;
            atualizarPreview();
          });
          label.append(input, criarElemento("span", "con-switch-texto", texto));
          formatacao.appendChild(label);
        }
        const blocoAlternativo = campoEditor("Texto estilizado", block.style, (valor) => {
          block.style = valor;
          atualizarPreview();
        });
        blocoAlternativo.hidden = !block.styled;
        area.append(blocoAlternativo, formatacao);
      }
      const direcionamento = criarElemento("label", "editor-campo", "Direcionamento");
      const seletor = document.createElement("select");
      seletor.appendChild(new Option("Selecione uma coluna", ""));
      colunasRoteamento.forEach((coluna) => seletor.add(new Option(coluna.nome, coluna.id)));
      seletor.value = block.columnId || "";
      const nota = criarElemento("p", "editor-nota");
      atualizarNota = () => {
        const coluna = colunasRoteamento.find((item) => item.id === seletor.value);
        block.columnId = coluna ? coluna.id : "";
        block.columnName = coluna ? coluna.nome : "";
        nota.textContent = coluna && block.trigger
          ? `Quando o cliente digitar "${block.trigger}" a conversa será direcionada para a coluna "${coluna.nome}"`
          : "Apenas colunas cujo nome termina com * podem receber este direcionamento.";
      };
      seletor.addEventListener("change", () => { atualizarNota(); atualizarPreview(); });
      direcionamento.appendChild(seletor);
      atualizarNota();
      area.append(direcionamento, nota);
    }
    sessao.appendChild(area);
  });
}

function abrirEditorMensagem(estado, mensagem, nova) {
  if (editorAberto || !ehAdmin) return;
  const draft = clonarMensagem(mensagem);
  if (!Array.isArray(draft.blocks)) draft.blocks = [];
  const original = JSON.stringify(draft);
  const overlay = criarElemento("div", "editor-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Editor de bot de resposta automática");
  const modal = criarElemento("div", "editor-bot");
  const fechar = criarBotao("×", "editor-fechar", () => tentarFechar());
  fechar.setAttribute("aria-label", "Fechar editor");
  const nome = document.createElement("input");
  nome.className = "editor-nome";
  nome.value = draft.name;
  nome.readOnly = true;
  nome.addEventListener("click", () => { nome.readOnly = false; nome.focus(); nome.select(); });
  const confirmarNome = () => {
    draft.name = nome.value.trim() || draft.name;
    nome.value = draft.name;
    nome.readOnly = true;
    verificarSujo();
  };
  nome.addEventListener("blur", confirmarNome);
  nome.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") { evento.preventDefault(); nome.blur(); }
  });
  const titulo = criarElemento("header", "editor-cabecalho");
  titulo.append(nome, fechar);
  const instrucoes = criarElemento("p", "editor-instrucoes",
    "Monte a resposta em até 20 áreas. As opções simples aparecem na mensagem; as opções ocultas ficam apenas como gatilhos internos.");
  const previewWrap = criarElemento("section", "editor-preview-wrap");
  const preview = criarElemento("div", "editor-preview");
  const erroEditor = criarElemento("p", "editor-erro");
  erroEditor.setAttribute("role", "alert");
  erroEditor.hidden = true;
  const mostrarErroEditor = (texto) => {
    erroEditor.textContent = texto || "";
    erroEditor.hidden = !texto;
    if (texto) mostrarAviso(texto, "erro");
  };
  const atualizarPreview = () => {
    preview.textContent = renderizarTextoMensagem(draft) || "A pré-visualização aparecerá aqui.";
    erroEditor.hidden = true;
    verificarSujo();
  };
  previewWrap.append(criarElemento("h2", "", "Pré-visualização"), preview);
  const ferramentas = criarElemento("div", "editor-ferramentas");
  const blocos = criarElemento("div", "editor-blocos");
  const adicionarBloco = (tipo) => {
    if (draft.blocks.length >= 20) { mostrarErroEditor("Limite de 20 blocos atingido."); return; }
    const base = tipo === "text" ? { type: tipo, text: "" } : {
      type: tipo, trigger: "", description: "", columnId: "", columnName: ""
    };
    if (tipo === "option") Object.assign(base, { bold: false, styled: false, style: "" });
    draft.blocks.push(base);
    renderizarBlocosEditor(blocos, draft.blocks, atualizarPreview);
    atualizarPreview();
  };
  ferramentas.append(
    criarBotao("+TEXTO", "editor-adicionar", () => adicionarBloco("text")),
    criarBotao("+OPÇÃO SIMPLES", "editor-adicionar", () => adicionarBloco("option")),
    criarBotao("+OPÇÃO OCULTA", "editor-adicionar", () => adicionarBloco("hidden"))
  );
  const corpo = criarElemento("div", "editor-conteudo");
  corpo.append(instrucoes, previewWrap, ferramentas, blocos);
  const rodape = criarElemento("footer", "editor-rodape");
  const salvar = criarBotao("Salvar", "editor-salvar", async () => {
    draft.name = nome.value.trim() || draft.name;
    nome.value = draft.name;
    const erro = validarMensagem(draft);
    if (erro) { mostrarErroEditor(erro); return; }
    erroEditor.hidden = true;
    salvar.disabled = true;
    const anteriores = estado.mensagens.map(clonarMensagem);
    try {
      const normalizada = normalizarParaSalvar(draft);
      const indice = estado.mensagens.findIndex((item) => item.id === normalizada.id);
      if (indice >= 0) estado.mensagens[indice] = normalizada;
      else estado.mensagens.push(normalizada);
      estado.aberto = true;
      estado.automacaoAberta = true;
      estado.mensagemAbertaId = normalizada.id;
      await salvarAutomacao(estado);
      fecharSemConfirmar();
      mostrarAviso(
        "Salvo: mensagem \"" + normalizada.name + "\" " + (nova ? "criada" : "atualizada") + " na automação.",
        "sucesso"
      );
    } catch (erroSalvamento) {
      estado.mensagens = anteriores;
      mostrarErroEditor((erroSalvamento && erroSalvamento.message) || "Não foi possível salvar a mensagem.");
    } finally {
      salvar.disabled = false;
    }
  });
  const deletar = criarBotao("DELETAR", "editor-deletar", (evento) => {
    evento.stopPropagation();
    abrirConfirmacaoDelete();
  });
  deletar.disabled = nova;
  const confirmacao = criarElemento("div", "editor-confirmacao");
  confirmacao.hidden = true;
  const manter = criarBotao("Manter", "editor-manter", (evento) => {
    evento.stopPropagation(); confirmacao.hidden = true; deletar.hidden = false;
  });
  confirmacao.append(
    criarBotao("Deletar", "editor-confirmar", async (evento) => {
      evento.stopPropagation();
      const anteriores = estado.mensagens.map(clonarMensagem);
      const ativaAnterior = estado.activeBotMessageId;
      estado.mensagens = estado.mensagens.filter((item) => item.id !== draft.id);
      if (estado.activeBotMessageId === draft.id) estado.activeBotMessageId = "";
      try {
        await salvarAutomacao(estado);
        fecharSemConfirmar();
        mostrarAviso("Salvo: mensagem \"" + draft.name + "\" removida da automação.", "sucesso");
      } catch (_) {
        estado.mensagens = anteriores;
        estado.activeBotMessageId = ativaAnterior;
        renderizarNumeros();
      }
    }),
    manter,
    criarElemento("p", "editor-nota", "Clique fora para cancelar a exclusão.")
  );
  function abrirConfirmacaoDelete() {
    confirmacao.hidden = false;
    deletar.hidden = true;
  }
  rodape.append(erroEditor, salvar, deletar, confirmacao);
  modal.append(titulo, corpo, rodape);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.classList.add("editor-ativo");
  editorAberto = { estado, overlay, draft };
  renderizarBlocosEditor(blocos, draft.blocks, atualizarPreview);
  atualizarPreview();

  function verificarSujo() {
    if (editorAberto) editorAberto.sujo = JSON.stringify(draft) !== original;
  }
  function fecharSemConfirmar() {
    document.removeEventListener("keydown", fecharComEscape);
    overlay.remove();
    document.body.classList.remove("editor-ativo");
    editorAberto = null;
    renderizarNumeros();
  }
  function tentarFechar() {
    if (draft.blocks.some((block) => block.type === "option" && block.styled && !String(block.style || "").trim())) {
      draft.blocks.forEach((block) => {
        if (block.type === "option" && block.styled && !String(block.style || "").trim()) block.styled = false;
      });
    }
    const temAlteracoes = JSON.stringify(draft) !== original;
    if (temAlteracoes &&
        !window.confirm("Há alterações não salvas. Deseja sair sem salvar?")) return;
    if (!temAlteracoes && validarMensagem(draft) &&
        !window.confirm("A mensagem está incompleta. Deseja sair mesmo assim?")) return;
    fecharSemConfirmar();
  }
  overlay.addEventListener("click", (evento) => {
    if (!confirmacao.hidden && !evento.target.closest(".editor-confirmar")) {
      confirmacao.hidden = true;
      deletar.hidden = false;
      return;
    }
    if (evento.target === overlay) tentarFechar();
  });
  document.addEventListener("keydown", fecharComEscape);
  function fecharComEscape(evento) {
    if (evento.key === "Escape" && editorAberto && editorAberto.overlay === overlay) {
      evento.preventDefault();
      document.removeEventListener("keydown", fecharComEscape);
      tentarFechar();
    }
  }
}

function renderizarCartao(estado) {
  const numero = estado.numero;
  const cartao = criarElemento("article", "conexoes-numero" + (estado.aberto ? " aberto" : "") + (!numero.active && !estado.novo ? " desativado" : ""));
  cartoes.set(estado, cartao);
  const topo = criarElemento("div", "numero-topo");
  const identidade = criarElemento("div", "numero-identidade");
  const titulo = criarElemento("h3", "numero-nome", estado.nome);
  titulo.title = estado.aberto && ehAdmin ? "Clique duas vezes para editar" : "";
  titulo.addEventListener("dblclick", (evento) => {
    if (!estado.aberto) return;
    evento.stopPropagation();
    editarNome(estado, titulo, cartao);
  });
  identidade.append(titulo, criarElemento("p", "numero-telefone", numero.displayPhoneNumber || (estado.novo ? "Número ainda não vinculado" : numero.phoneNumberId)));
  const controles = criarElemento("div", "numero-controles");
  if (!estado.novo) {
    const label = criarElemento("label", "numero-ativacao con-switch" + (numero.active ? " ativo" : ""));
    label.addEventListener("click", (evento) => evento.stopPropagation());
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "con-switch-input";
    toggle.setAttribute("role", "switch");
    toggle.checked = numero.active;
    toggle.disabled = !ehAdmin || estado.salvando;
    toggle.setAttribute("aria-label", "Ativar ou desativar " + estado.nome);
    const textoToggle = criarElemento("span", "con-switch-texto", numero.active ? "ATIVADO" : "DESATIVADO");
    toggle.addEventListener("change", async (evento) => {
      evento.stopPropagation();
      if (!ehAdmin || estado.salvando) {
        toggle.checked = estado.numero.active;
        return;
      }
      const ativoAnterior = estado.numero.active;
      const novoAtivo = toggle.checked;
      estado.salvando = true;
      estado.numero.active = novoAtivo;
      sincronizarNumero(estado.numero);
      toggle.disabled = true;
      label.classList.toggle("ativo", novoAtivo);
      textoToggle.textContent = novoAtivo ? "ATIVADO" : "DESATIVADO";
      cartao.classList.toggle("desativado", !novoAtivo);
      atualizarStatus(estado);
      try {
        const resultado = await executarCallable("updateWhatsAppNumber", {
          phoneNumberId: estado.numero.phoneNumberId, action: "active", active: novoAtivo
        });
        if (resultado && resultado.number) {
          estado.numero = resultado.number;
          sincronizarNumero(resultado.number);
        } else {
          estado.numero.active = novoAtivo;
          sincronizarNumero(estado.numero);
        }
        mostrarAviso(
          estado.numero.active
            ? "Salvo: número \"" + estado.nome + "\" ativado para uso na plataforma."
            : "Salvo: número \"" + estado.nome + "\" desativado (uso suspenso na plataforma).",
          "sucesso"
        );
      } catch (erro) {
        estado.numero.active = ativoAnterior;
        sincronizarNumero(estado.numero);
        mostrarAviso(erro.message || "Não foi possível alterar a ativação.", "erro");
      } finally {
        estado.salvando = false;
        preencherSeletores();
        renderizarNumeros();
      }
    });
    label.append(toggle, textoToggle);
    controles.appendChild(label);
  }
  const expandir = criarBotao("⋮", "numero-expandir", () => {
    estado.aberto = !estado.aberto;
    estado.confirmando = false;
    renderizarNumeros();
  });
  expandir.setAttribute("aria-label", estado.aberto ? "Fechar card" : "Abrir card");
  expandir.setAttribute("aria-expanded", String(estado.aberto));
  controles.appendChild(expandir);
  topo.append(identidade, controles);
  cartao.appendChild(topo);
  cartao.appendChild(criarElemento("p", "numero-status"));
  const detalhe = criarElemento("p", "numero-status-detalhe");
  detalhe.hidden = !estado.aberto;
  cartao.appendChild(detalhe);
  cartao.addEventListener("dblclick", (evento) => {
    if (evento.target.closest("button, input, label, details, a")) return;
    estado.aberto = !estado.aberto;
    estado.confirmando = false;
    renderizarNumeros();
  });

  const corpo = criarElemento("div", "numero-corpo");
  corpo.hidden = !estado.aberto;
  const form = criarElemento("form", "numero-form");
  form.noValidate = true;
  form.addEventListener("submit", (evento) => salvarNumero(evento, estado));
  const contato = criarSecao("CADASTRO DE CONTATO", estado.contatoAberto, (aberto) => { estado.contatoAberto = aberto; });
  const campos = criarElemento("div", "numero-campos");
  const exibido = criarElemento("label", "numero-campo", "Número vinculado");
  const telefone = document.createElement("input");
  telefone.value = numero.displayPhoneNumber || "";
  telefone.placeholder = "Obtido da Meta após o vínculo";
  telefone.readOnly = true;
  exibido.appendChild(telefone);
  campos.appendChild(exibido);
  adicionarCampo(campos, estado, "phoneNumberId", "Phone Number ID", { id: true, somenteLeitura: !estado.novo });
  adicionarCampo(campos, estado, "wabaId", "WhatsApp Business Account ID", { id: true, somenteLeitura: !estado.novo });
  adicionarCampo(campos, estado, "appId", "App ID", { id: true, lista: true, somenteLeitura: !estado.novo && !!numero.appId });
  adicionarCampo(campos, estado, "accessToken", "Token de acesso permanente", { segredo: true });
  adicionarCampo(campos, estado, "verifyToken", "Token de verificação do webhook", { segredo: true });
  adicionarCampo(campos, estado, "appSecret", "App Secret", { segredo: true });
  const explicacao = criarElemento("p", "numero-ajuda", "Credenciais salvas não são exibidas. Para alterá-las, informe as três novamente. Alterar o App Secret ou o token de verificação afeta todos os números do aplicativo.");
  campos.appendChild(explicacao);
  if (!estado.novo) {
    campos.appendChild(criarElemento("p", "numero-ajuda", "Os IDs do vínculo existente são somente leitura. Para vincular outro número, crie um novo card."));
  }
  const webhook = criarElemento("label", "numero-campo", "URL do webhook deste app");
  const url = document.createElement("input");
  url.className = "numero-webhook-url";
  url.value = urlWebhook(estado.campos.appId.trim());
  url.readOnly = true;
  webhook.appendChild(url);
  campos.appendChild(webhook);
  campos.appendChild(criarBotao("Copiar URL", "conexoes-botao-secundario", async () => {
    if (!url.value) { mostrarAviso("Informe um App ID válido para obter a URL.", "erro"); return; }
    try {
      await navigator.clipboard.writeText(url.value);
      mostrarAviso("URL do webhook copiada.", "sucesso");
    } catch (erro) {
      url.focus(); url.select();
      mostrarAviso("Não foi possível copiar automaticamente; copie a URL selecionada.", "erro");
    }
  }));
  if (!estado.novo && ehAdmin) {
    campos.appendChild(criarBotao(numero.captureEnabled ? "Desativar captação" : "Ativar captação", "conexoes-botao-secundario", () => alterarCaptacao(estado)));
  }
  if (!estado.novo) {
    campos.appendChild(criarBotao("Verificar comunicação", "conexoes-botao-secundario", () => verificarNumero(estado)));
    campos.appendChild(criarElemento("p", "numero-ajuda", "A verificação consulta a Meta sem enviar mensagem e não garante a entrega."));
  }
  contato.appendChild(campos);
  const automacao = criarSecao("AUTOMAÇÃO DE CONTATO", estado.automacaoAberta, (aberto) => { estado.automacaoAberta = aberto; });
  const painelAutomacao = criarElemento("div", "numero-automacao");
  const opcao = criarElemento("label", "numero-opcao con-switch");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "con-switch-input con-switch-compacto";
  check.setAttribute("role", "switch");
  check.checked = estado.onlyRecipientInitiated;
  check.disabled = estado.novo || !ehAdmin;
  check.addEventListener("change", () => {
    estado.onlyRecipientInitiated = check.checked;
    atualizarRodape(estado, cartao);
  });
  opcao.append(check, criarElemento("span", "con-switch-texto", "ENVIAR SOMENTE QUANDO O CONTATO FOR INICIADO PELO DESTINATÁRIO"));

  const inatividadeWrap = criarElemento("div", "numero-inatividade");
  const tituloInatividade = criarElemento("span", "inatividade-titulo", "TEMPO DE INATIVIDADE");

  const partes = decomporInatividade(estado.inactivityMinutes);
  const criarCampoTempo = (subrotulo, valorInicial, maxValor, ariaLabel) => {
    const campoLabel = criarElemento("label", "inatividade-campo");
    const input = document.createElement("input");
    input.type = "number";
    input.className = "inatividade-input";
    input.min = "0";
    input.max = String(maxValor);
    input.step = "1";
    input.inputMode = "numeric";
    input.value = String(valorInicial).padStart(2, "0");
    input.disabled = estado.novo || !ehAdmin;
    input.setAttribute("aria-label", ariaLabel);
    const span = criarElemento("span", "inatividade-subrotulo", subrotulo);
    campoLabel.append(input, span);
    return { campoLabel, input };
  };
  const campoDias = criarCampoTempo("dias", partes.dias, 99, "Dias de inatividade");
  const campoHoras = criarCampoTempo("horas", partes.horas, 23, "Horas de inatividade");
  const campoMinutos = criarCampoTempo("minutos", partes.minutos, 59, "Minutos de inatividade");
  const limitarInteiro = (input, maxValor) => {
    const bruto = parseInt(String(input.value || "0").replace(/\D/g, ""), 10);
    return Number.isNaN(bruto) ? 0 : Math.max(0, Math.min(maxValor, bruto));
  };
  const textoResumoInatividade = (d, h, m) =>
    "A mensagem será disparada depois de " +
    String(d).padStart(2, "0") + " dias, " +
    String(h).padStart(2, "0") + " horas e " +
    String(m).padStart(2, "0") + " minutos de inatividade no chat";
  const resumoInatividade = criarElemento(
    "p",
    "inatividade-resumo",
    textoResumoInatividade(partes.dias, partes.horas, partes.minutos)
  );
  const atualizarInatividade = (formatarCampos) => {
    const d = limitarInteiro(campoDias.input, 99);
    const h = limitarInteiro(campoHoras.input, 23);
    const m = limitarInteiro(campoMinutos.input, 59);
    if (formatarCampos) {
      campoDias.input.value = String(d).padStart(2, "0");
      campoHoras.input.value = String(h).padStart(2, "0");
      campoMinutos.input.value = String(m).padStart(2, "0");
    }
    estado.inactivityMinutes = d * 1440 + h * 60 + m;
    resumoInatividade.textContent = textoResumoInatividade(d, h, m);
    atualizarRodape(estado, cartao);
  };
  for (const item of [campoDias, campoHoras, campoMinutos]) {
    item.input.addEventListener("input", () => atualizarInatividade(false));
    item.input.addEventListener("blur", () => atualizarInatividade(true));
  }
  const gradeTempo = criarElemento("div", "inatividade-campos");
  gradeTempo.append(campoDias.campoLabel, campoHoras.campoLabel, campoMinutos.campoLabel);
  inatividadeWrap.append(tituloInatividade, gradeTempo, resumoInatividade);

  const criarMensagem = criarBotao("CRIAR MENSAGEM", "conexoes-botao-secundario", () => {
    const mensagem = {
      id: crypto.randomUUID(),
      name: nomePadraoMensagem(estado.mensagens),
      blocks: [{ type: "text", text: "" }]
    };
    abrirEditorMensagem(estado, mensagem, true);
  });
  criarMensagem.disabled = estado.novo || !ehAdmin;
  painelAutomacao.append(opcao, inatividadeWrap, criarMensagem);
  painelAutomacao.appendChild(renderizarMensagens(estado));
  automacao.appendChild(painelAutomacao);
  form.append(contato, automacao);
  const rodape = criarElemento("div", "numero-rodape");
  const salvar = criarElemento("button", "numero-salvar", "Salvar");
  salvar.type = "submit";
  salvar.disabled = !ehAdmin || estado.salvando;
  const deletar = criarBotao("DELETAR NÚMERO", "numero-deletar", (evento) => {
    evento.stopPropagation();
    for (const outro of estados.values()) {
      if (outro !== estado && outro.confirmando) {
        outro.confirmando = false;
        const outroCartao = cartoes.get(outro);
        if (outroCartao) atualizarRodape(outro, outroCartao);
      }
    }
    estado.confirmando = true;
    atualizarRodape(estado, cartao);
  });
  deletar.disabled = !ehAdmin || estado.salvando;
  const confirmacao = criarElemento("div", "numero-confirmacao");
  const confirmar = criarBotao("DELETAR", "numero-confirmar-deletar", (evento) => {
    evento.stopPropagation();
    removerNumero(estado);
  });
  confirmar.disabled = estado.salvando;
  const manter = criarBotao("MANTER NÚMERO", "numero-manter", () => {
    estado.confirmando = false;
    atualizarRodape(estado, cartao);
  });
  confirmacao.append(confirmar, manter, criarElemento("p", "numero-ajuda", "* PARA CANCELAR O DELETE, CLIQUE EM QUALQUER PONTO DA TELA."));
  rodape.append(deletar, salvar, confirmacao);
  form.appendChild(rodape);
  corpo.appendChild(form);
  cartao.appendChild(corpo);
  atualizarRodape(estado, cartao);
  atualizarStatus(estado);
  return cartao;
}

function renderizarNumeros() {
  cartoes.clear();
  const termo = campoBusca.value.trim().toLowerCase();
  const filtrados = [...estados.values()].filter((estado) =>
    [estado.nome, estado.numero.displayPhoneNumber, estado.numero.phoneNumberId]
      .some((valor) => String(valor || "").toLowerCase().includes(termo))
  );
  listaNumeros.replaceChildren(...filtrados.map(renderizarCartao));
  if (!filtrados.length) {
    listaNumeros.appendChild(criarElemento("p", "texto-ajuda",
      estados.size ? "Nenhum número encontrado para a busca." : "Nenhum número vinculado."));
  }
}

botaoAdicionar.addEventListener("click", () => {
  if (!ehAdmin) return;
  const estado = criarEstado({ active: false }, true);
  estados.set("novo-" + (++proximoRascunho), estado);
  campoBusca.value = "";
  renderizarNumeros();
});
campoBusca.addEventListener("input", renderizarNumeros);
window.addEventListener("beforeunload", (evento) => {
  if ([...estados.values()].some(alterado)) {
    evento.preventDefault();
    evento.returnValue = "";
  }
});
document.addEventListener("click", (evento) => {
  if (!editorAberto && !evento.target.closest(".mensagem-card, .editor-overlay")) {
    for (const estado of estados.values()) estado.mensagemAbertaId = "";
    const aberto = document.querySelector(".mensagem-card.aberta");
    if (aberto) renderizarNumeros();
  }
  if (evento.target.closest(".numero-confirmar-deletar")) return;
  for (const estado of estados.values()) {
    if (estado.confirmando) {
      estado.confirmando = false;
      const cartao = cartoes.get(estado);
      if (cartao) atualizarRodape(estado, cartao);
    }
  }
});

async function salvarNumero(evento, estado) {
  evento.preventDefault();
  if (!ehAdmin || estado.salvando) return;
  const dados = Object.fromEntries(Object.entries(estado.campos).map(([chave, valor]) => [chave, valor.trim()]));
  const alterarCredenciais = estado.novo || estado.campos.accessToken || estado.campos.verifyToken || estado.campos.appSecret ||
    dados.appId !== (estado.numero.appId || "");
  const alterarNome = estado.nome !== estado.nomeOriginal;
  const alterarAutomacao = automacaoSerializada(estado) !== estado.automacaoOriginal;
  let onlyRecipientAnterior = true;
  let inactivityAnterior = 1440;
  try {
    const originalObj = JSON.parse(estado.automacaoOriginal || "{}");
    onlyRecipientAnterior = originalObj.onlyRecipient !== false;
    if (Number.isInteger(originalObj.inactivityMinutes)) inactivityAnterior = originalObj.inactivityMinutes;
  } catch (_) {
    onlyRecipientAnterior = estado.numero.onlyRecipientInitiated !== false;
    if (Number.isInteger(estado.numero.inactivityMinutes)) inactivityAnterior = estado.numero.inactivityMinutes;
  }
  const alterarSomenteDestinatario = estado.onlyRecipientInitiated !== onlyRecipientAnterior;
  const inactivityAtual = Number.isInteger(estado.inactivityMinutes) ? estado.inactivityMinutes : inactivityAnterior;
  const alterarInatividade = inactivityAtual !== inactivityAnterior;
  const automacaoPendente = {
    mensagens: estado.mensagens.map(clonarMensagem),
    activeBotMessageId: estado.activeBotMessageId,
    onlyRecipientInitiated: estado.onlyRecipientInitiated,
    inactivityMinutes: inactivityAtual
  };
  if (estado.novo && numeros.some((numero) => numero.phoneNumberId === dados.phoneNumberId)) {
    mostrarAviso("Este Phone Number ID já está vinculado. Edite o card existente para atualizar as credenciais.", "erro");
    return;
  }
  if (alterarCredenciais && (!/^\d{6,25}$/.test(dados.appId) || !/^\d{6,25}$/.test(dados.phoneNumberId) ||
      !/^\d{6,25}$/.test(dados.wabaId) || dados.accessToken.length < 20 ||
      dados.appSecret.length < 10 || dados.verifyToken.length < 8)) {
    mostrarAviso("Confira os IDs e informe as três credenciais completas para vincular ou atualizar o número.", "erro");
    return;
  }
  if (alterarCredenciais && !window.confirm("Confirme os IDs que serão enviados:\n\nApp ID: " + dados.appId +
      "\nPhone Number ID: " + dados.phoneNumberId + "\nWABA ID: " + dados.wabaId)) return;
  estado.salvando = true;
  renderizarNumeros();
  try {
    if (alterarCredenciais) {
      if (alterarNome) dados.displayName = estado.nome;
      const resultado = await executarCallable("connectWhatsAppNumber", dados);
      if (!resultado.number || resultado.number.phoneNumberId !== dados.phoneNumberId ||
          resultado.number.wabaId !== dados.wabaId || resultado.number.appId !== dados.appId) {
        throw new Error("O backend retornou IDs diferentes dos enviados. Confira os números vinculados antes de tentar novamente.");
      }
      const index = numeros.findIndex((numero) => numero.phoneNumberId === dados.phoneNumberId);
      if (index >= 0) numeros[index] = resultado.number;
      else numeros.push(resultado.number);
      for (const [chave, item] of estados) {
        if (item === estado || (item.numero.phoneNumberId === dados.phoneNumberId && !item.novo)) estados.delete(chave);
      }
      const atualizado = criarEstado(resultado.number);
      atualizado.aberto = true;
      atualizado.contatoAberto = true;
      if (alterarAutomacao) Object.assign(atualizado, automacaoPendente);
      estados.set(resultado.number.phoneNumberId, atualizado);
      preencherSeletores();
      atualizarContagem();
      if (alterarAutomacao) await salvarAutomacao(atualizado);
      verificarNumero(atualizado);
    } else if (alterarNome) {
      await executarCallable("updateWhatsAppNumber", {
        phoneNumberId: estado.numero.phoneNumberId, action: "name", displayName: estado.nome
      });
      estado.numero.displayName = estado.nome;
      estado.nomeOriginal = estado.nome;
    }
    if (alterarAutomacao && !alterarCredenciais) await salvarAutomacao(estado);
    const alteracoesSalvas = [];
    if (alterarCredenciais) alteracoesSalvas.push("vínculo e credenciais do número (configure o webhook na Meta)");
    if (alterarNome) alteracoesSalvas.push("nome do número (\"" + estado.nome + "\")");
    if (alterarSomenteDestinatario) {
      alteracoesSalvas.push(
        "regra \"Enviar somente quando o contato for iniciado pelo destinatário\" (" +
        (estado.onlyRecipientInitiated ? "ativada" : "desativada") + ")"
      );
    }
    if (alterarInatividade) {
      const d = String(Math.floor(inactivityAtual / 1440)).padStart(2, "0");
      const h = String(Math.floor((inactivityAtual % 1440) / 60)).padStart(2, "0");
      const m = String(inactivityAtual % 60).padStart(2, "0");
      alteracoesSalvas.push("tempo de inatividade (" + d + " " + h + " " + m + ")");
    }
    if (alterarAutomacao && !alterarSomenteDestinatario && !alterarInatividade) {
      alteracoesSalvas.push("configurações de automação");
    }
    mostrarAviso(
      alteracoesSalvas.length ? "Salvo: " + alteracoesSalvas.join(", ") + "." : "Alterações salvas.",
      "sucesso"
    );
  } catch (erro) {
    console.error("Erro ao salvar conexão WhatsApp:", erro);
    mostrarAviso(erro.message || "Não foi possível salvar a conexão.", "erro");
  } finally {
    estado.salvando = false;
    renderizarNumeros();
  }
}

async function alterarCaptacao(estado) {
  const numero = estado.numero;
  try {
    const resultado = await executarCallable("updateWhatsAppNumber", {
      phoneNumberId: numero.phoneNumberId, action: "capture", captureEnabled: !numero.captureEnabled
    });
    if (resultado && resultado.number) {
      estado.numero = resultado.number;
      sincronizarNumero(resultado.number);
    } else {
      numero.captureEnabled = !numero.captureEnabled;
      sincronizarNumero(numero);
    }
    renderizarNumeros();
    mostrarAviso("Salvo: captação de mensagens " + (estado.numero.captureEnabled ? "ativada." : "desativada."), "sucesso");
  } catch (erro) {
    mostrarAviso(erro.message || "Não foi possível alterar a captação.", "erro");
  }
}

async function removerNumero(estado) {
  if (!ehAdmin || estado.salvando) return;
  estado.salvando = true;
  renderizarNumeros();
  try {
    if (!estado.novo) {
      await executarCallable("updateWhatsAppNumber", { phoneNumberId: estado.numero.phoneNumberId, action: "remove" });
      numeros = numeros.filter((numero) => numero.phoneNumberId !== estado.numero.phoneNumberId);
    }
    for (const [chave, item] of estados) if (item === estado) estados.delete(chave);
    preencherSeletores();
    atualizarContagem();
    mostrarAviso(estado.novo ? "Novo card removido." : "Número removido da integração.", "sucesso");
  } catch (erro) {
    estado.confirmando = false;
    mostrarAviso(erro.message || "Não foi possível remover o número.", "erro");
  } finally {
    estado.salvando = false;
    renderizarNumeros();
  }
}

function preencherSeletores() {
  const apps = [...new Set(numeros.map((numero) => numero.appId).filter((appId) =>
    typeof appId === "string" && /^\d{6,25}$/.test(appId)
  ))].sort();
  appsMeta.replaceChildren(...apps.map((appId) => new Option(appId, appId)));
  const seletores = [seletorBot, ...document.querySelectorAll(".seletor-numeros")].filter(Boolean);
  seletores.forEach((seletor) => {
    const atual = seletor.value;
    seletor.replaceChildren(new Option("Selecione um número", ""));
    numeros.filter((numero) => numero.active).forEach((numero) => {
      seletor.add(new Option(numero.displayPhoneNumber || numero.phoneNumberId, numero.phoneNumberId));
    });
    if (numeros.some((numero) => numero.phoneNumberId === atual && numero.active)) seletor.value = atual;
  });
  if (formBot && seletorBot && botAtivo && botMensagem) atualizarConfiguracaoBot();
}

function atualizarConfiguracaoBot() {
  if (!formBot || !seletorBot || !botAtivo || !botMensagem) return;
  const numero = numeros.find((item) => item.phoneNumberId === seletorBot.value && item.active);
  botAtivo.checked = !!(numero && numero.preAtendimentoEnabled);
  botMensagem.value = numero ? (numero.preAtendimentoMessage || "") : "";
  botAtivo.disabled = !numero;
  botMensagem.disabled = !numero;
  formBot.querySelector("button[type='submit']").disabled = !numero;
}

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) { window.location.href = "index.html"; return; }
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
    botaoAdicionar.hidden = !ehAdmin;
    const [conexoes, colunas] = await Promise.all([
      executarCallable("getWhatsAppConnections", {}),
      getDocs(collection(db, "colunas"))
    ]);
    colunasRoteamento = colunas.docs
      ? colunas.docs.map((documento) => ({ id: documento.id, ...documento.data() }))
      : [];
    colunasRoteamento.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    colunasRoteamento = colunasRoteamento.filter((coluna) =>
      typeof coluna.nome === "string" && coluna.nome.endsWith("*")
    );
    numeros = conexoes.numbers || [];
    numeros.forEach((numero) => estados.set(numero.phoneNumberId, criarEstado(numero)));
    renderizarNumeros();
    preencherSeletores();
    atualizarContagem();
    for (const estado of estados.values()) verificarNumero(estado);
    await carregarCentroControle();
  } catch (erro) {
    console.error("Erro ao carregar conexões:", erro);
    listaNumeros.replaceChildren(criarElemento("p", "texto-ajuda", erro.message || "Não foi possível carregar as conexões."));
    statusIntegracao.textContent = "Falha ao carregar";
    statusIntegracao.classList.add("vazio");
    mostrarAviso(erro.message || "Não foi possível carregar as conexões.", "erro");
  }
});

if (seletorBot) seletorBot.addEventListener("change", atualizarConfiguracaoBot);
if (formBot) {
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
        phoneNumberId, preAtendimentoEnabled: botAtivo.checked, preAtendimentoMessage
      });
      const numero = numeros.find((item) => item.phoneNumberId === phoneNumberId);
      if (numero) { numero.preAtendimentoEnabled = botAtivo.checked; numero.preAtendimentoMessage = preAtendimentoMessage; }
      mostrarAviso("Configuração do pré-atendimento salva.", "sucesso");
    } catch (erro) {
      mostrarAviso(erro.message || "Não foi possível salvar a configuração do bot.", "erro");
    } finally {
      botao.disabled = false;
    }
  });
}

if (formNovaConversa) {
  formNovaConversa.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const botao = formNovaConversa.querySelector("button[type='submit']");
    const dados = Object.fromEntries(new FormData(formNovaConversa).entries());
    botao.disabled = true;
    try {
      const resultado = await executarCallable("sendWhatsAppMessage", {
        ...dados, mode: "template", templateLanguage: dados.templateLanguage || "pt_BR"
      });
      formNovaConversa.reset();
      mostrarAviso("Modelo enviado pela Meta. Card criado no kanban (" + resultado.cardId + ").", "sucesso");
    } catch (erro) {
      mostrarAviso(erro.message || "Não foi possível iniciar a conversa.", "erro");
    } finally {
      botao.disabled = false;
    }
  });
}

if (botaoSair) {
  botaoSair.addEventListener("click", async () => {
    try { await signOut(auth); window.location.href = "index.html"; }
    catch (erro) { console.error("Erro ao sair:", erro); }
  });
}

async function carregarCentroControle() {
  try {
    const [snapUsuarios, snapPendentes] = await Promise.all([
      getDocs(collection(db, "usuarios")), getDocs(collection(db, "solicitacoes"))
    ]);
    if (contagemUsuarios) contagemUsuarios.textContent = snapUsuarios.size;
    if (contagemPendentes) contagemPendentes.textContent = snapPendentes.size;
  } catch (erro) {
    console.error("Erro ao ler centro de controle:", erro);
  }
}
