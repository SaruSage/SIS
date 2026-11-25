"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "conexoes.js"), "utf8");
const start = source.indexOf("async function salvarNumero(");
const end = source.indexOf("async function alterarCaptacao(", start);
assert.ok(start >= 0 && end > start);
const saveFunction = source.slice(start, end);
const helpersStart = source.indexOf("function renderizarTextoMensagem(");
const helpersEnd = source.indexOf("async function salvarAutomacao(", helpersStart);
const automationHelpers = source.slice(helpersStart, helpersEnd);

function createHarness() {
  const numero = { phoneNumberId: "", appId: "", wabaId: "" };
  const estado = {
    numero, novo: true, salvando: false, nome: "Novo número", nomeOriginal: "Novo número",
    campos: {
      appId: "3000000", phoneNumberId: "1000001", wabaId: "2000000",
      accessToken: "fake-access-token-123456", appSecret: "fake-app-secret", verifyToken: "fake-verify-token"
    },
    mensagens: [],
    activeBotMessageId: "",
    onlyRecipientInitiated: true,
    automacaoOriginal: JSON.stringify({ messages: [], activeId: "", onlyRecipient: true })
  };
  const state = {
    numeros: [{ phoneNumberId: "1000000", displayPhoneNumber: "Número antigo" }],
    avisos: [], aceita: true, renderizacoes: 0
  };
  let resolveCall;
  const context = vm.createContext({
    ehAdmin: true,
    numeros: state.numeros,
    estados: new Map([["novo-1", estado]]),
    window: { confirm: (text) => { state.confirmacao = text; return state.aceita; } },
    executarCallable: (name, data) => {
      state.chamada = { name, data };
      return new Promise((resolve) => { resolveCall = resolve; });
    },
    criarEstado: (number) => ({ numero: number }),
    clonarMensagem: (value) => JSON.parse(JSON.stringify(value)),
    verificarNumero() {},
    renderizarNumeros() { state.renderizacoes++; },
    preencherSeletores() {},
    atualizarContagem() {},
    mostrarAviso: (texto, tipo) => state.avisos.push({ texto, tipo }),
    console: { error() {} }
  });
  context.automacaoSerializada = (item) => JSON.stringify({
    messages: item.mensagens,
    activeId: item.activeBotMessageId,
    onlyRecipient: item.onlyRecipientInitiated
  });
  context.salvarAutomacao = async () => {};
  vm.runInContext(saveFunction, context);
  return {
    estado, state,
    submit: () => context.salvarNumero({ preventDefault() {} }, estado),
    resolve: (number) => resolveCall({ number })
  };
}

test("confirma os IDs atuais, bloqueia novo envio e mostra o número retornado", async () => {
  const h = createHarness();
  h.state.aceita = false;
  await h.submit();
  assert.equal(h.state.chamada, undefined);
  assert.match(h.state.confirmacao, /Phone Number ID: 1000001/);

  h.state.aceita = true;
  const pending = h.submit();
  assert.equal(h.state.chamada.name, "connectWhatsAppNumber");
  assert.equal(h.state.chamada.data.phoneNumberId, "1000001");
  assert.equal(h.state.chamada.data.wabaId, "2000000");
  assert.equal(h.estado.salvando, true);
  await h.submit();
  h.resolve({ phoneNumberId: "1000001", wabaId: "2000000", appId: "3000000", displayPhoneNumber: "Número novo" });
  await pending;
  assert.equal(h.state.numeros.length, 2);
  assert.equal(h.state.numeros[1].displayPhoneNumber, "Número novo");
  assert.equal(h.estado.salvando, false);
  assert.equal(h.state.avisos.at(-1).tipo, "sucesso");
});

test("resposta com IDs diferentes não exibe sucesso nem apaga o rascunho", async () => {
  const h = createHarness();
  const pending = h.submit();
  h.resolve({ phoneNumberId: "1000000", wabaId: "2000000", appId: "3000000" });
  await pending;
  assert.equal(h.state.numeros.length, 1);
  assert.equal(h.estado.campos.phoneNumberId, "1000001");
  assert.equal(h.estado.salvando, false);
  assert.equal(h.state.avisos.at(-1).tipo, "erro");
  assert.match(h.state.avisos.at(-1).texto, /IDs diferentes/);
});

test("novo card não sobrescreve número já cadastrado", async () => {
  const h = createHarness();
  h.estado.campos.phoneNumberId = "1000000";
  await h.submit();
  assert.equal(h.state.chamada, undefined);
  assert.match(h.state.avisos.at(-1).texto, /já está vinculado/);
});

test("credenciais incompletas não são enviadas", async () => {
  const h = createHarness();
  h.estado.campos.verifyToken = " ";
  await h.submit();
  assert.equal(h.state.chamada, undefined);
  assert.equal(h.state.avisos.at(-1).tipo, "erro");
});

function createAutomationHelpers() {
  const context = vm.createContext({
    clonarMensagem: (value) => JSON.parse(JSON.stringify(value))
  });
  vm.runInContext(automationHelpers, context);
  return context;
}

test("preview formata opção, ignora oculta e respeita estilo/negrito", () => {
  const helpers = createAutomationHelpers();
  const text = helpers.renderizarTextoMensagem({
    blocks: [
      { type: "text", text: "Olá 👋" },
      { type: "option", trigger: "1", description: "Vendas", bold: true, styled: true, style: "VENDAS" },
      { type: "hidden", trigger: "2", description: "Anotação" }
    ]
  });
  assert.equal(text, "Olá 👋\n*VENDAS* - Vendas");
});

test("validação aceita descrições opcionais e desativa estilo vazio ao normalizar", () => {
  const helpers = createAutomationHelpers();
  const message = {
    id: "m1", name: "MENSAGEM 1", blocks: [
      { type: "option", trigger: "1", description: "", columnId: "col", columnName: "Entrada*", bold: false, styled: true, style: "" }
    ]
  };
  assert.equal(helpers.validarMensagem(message), "");
  const normalized = helpers.normalizarParaSalvar(message);
  assert.equal(normalized.blocks[0].styled, false);
  assert.equal(normalized.blocks[0].description, "");
});

test("validação rejeita campos obrigatórios, gatilho longo e gatilho duplicado", () => {
  const helpers = createAutomationHelpers();
  const base = {
    id: "m1", name: "", blocks: [{ type: "text", text: "" }]
  };
  assert.match(helpers.validarMensagem(base), /nome/i);
  base.name = "MENSAGEM 1";
  assert.match(helpers.validarMensagem(base), /texto/i);
  base.blocks = [
    { type: "hidden", trigger: "1", description: "", columnId: "col", columnName: "Entrada*" },
    { type: "hidden", trigger: " 1 ", description: "", columnId: "col", columnName: "Entrada*" }
  ];
  assert.match(helpers.validarMensagem(base), /gatilhos/i);
  base.blocks = [{ type: "hidden", trigger: "1234567890123456", description: "", columnId: "col", columnName: "Entrada*" }];
  assert.match(helpers.validarMensagem(base), /15 caracteres/i);
});
