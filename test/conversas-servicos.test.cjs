"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const conversas = fs.readFileSync(path.join(root, "js", "conversas.js"), "utf8");
const chats = fs.readFileSync(path.join(root, "js", "chats-internos.js"), "utf8");

function trecho(source, inicio, fim) {
  const start = source.indexOf(inicio);
  const end = source.indexOf(fim, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function elemento() {
  return {
    textContent: "", value: "", hidden: false, style: {}, children: [],
    replaceChildren(...children) { this.children = children; this.value = ""; },
    add(child) { this.children.push(child); }
  };
}

async function criarHarnessConversas() {
  const { descreverErroServico } = await import("../js/erros-servico.mjs");
  const elementos = new Map();
  const estado = { falhas: {}, snapshots: [], avisos: [], renderizacoes: [] };
  const context = vm.createContext({
    console: { error() {} },
    el: (id) => {
      if (!elementos.has(id)) elementos.set(id, elemento());
      return elementos.get(id);
    },
    Option: function (texto, value) { this.text = texto; this.value = value; },
    call: async (name) => {
      if (estado.falhas[name]) throw estado.falhas[name];
      if (name === "listarAcessoConversas") return { data: { completo: true, colunas: [] } };
      return { data: { numbers: [{ active: true, phoneNumberId: "teste", displayName: "Teste" }] } };
    },
    collection: (_, nome) => nome,
    query: (ref) => ref,
    where: () => ({}),
    db: {},
    onSnapshot: (ref, sucesso, erro) => {
      estado.snapshots.push({ ref, sucesso, erro });
      return () => { estado.cancelamentos = (estado.cancelamentos || 0) + 1; };
    },
    aviso: (texto) => {
      estado.avisos.push(texto);
      context.el("conversas-aviso").textContent = texto;
    },
    renderizarLista: () => estado.renderizacoes.push(vm.runInContext("estadoLista", context)),
    atualizarPainel() {},
    carregarHistorico() {},
    descreverErroServico
  });
  vm.runInContext(`
    let numeros = [], cards = [], cancelarCards = [], assinaturaAcesso = "";
    let colunasRelevantes = new Set(), atualizandoAcesso = false;
    let estadoLista = "carregando", mensagemErroAcesso = "";
  `, context);
  vm.runInContext(trecho(conversas, "async function atualizarNumeros()", "onAuthStateChanged(auth"), context);
  return { context, estado, elementos };
}

test("falha dos números não impede a assinatura dos cards e é comunicada separadamente", async () => {
  const h = await criarHarnessConversas();
  h.estado.falhas.getWhatsAppConnections = { code: "functions/internal", message: "internal" };
  await h.context.atualizarAcesso();
  assert.equal(h.estado.snapshots.length, 1);
  h.estado.snapshots[0].sucesso({ docs: [{ id: "card-kanban", data: () => ({ nomeConta: "Cliente" }) }] });
  assert.equal(vm.runInContext("cards[0].id", h.context), "card-kanban");
  assert.equal(vm.runInContext("estadoLista", h.context), "pronta");
  assert.match(h.context.el("conversas-aviso").textContent, /getWhatsAppConnections.*implantação/);
  assert.equal(h.context.el("numero").value, "");
});

test("falha de acesso não é confundida com lista vazia e a tentativa seguinte recupera", async () => {
  const h = await criarHarnessConversas();
  h.estado.falhas.listarAcessoConversas = { code: "functions/internal", message: "internal" };
  await h.context.atualizarAcesso();
  assert.equal(vm.runInContext("estadoLista", h.context), "erro");
  assert.equal(h.estado.snapshots.length, 0);
  assert.match(h.context.el("conversas-aviso").textContent, /listarAcessoConversas.*implantação/);
  delete h.estado.falhas.listarAcessoConversas;
  await h.context.atualizarAcesso();
  h.estado.snapshots[0].sucesso({ docs: [{ id: "novo", data: () => ({}) }] });
  assert.equal(vm.runInContext("cards[0].id", h.context), "novo");
  assert.equal(vm.runInContext("estadoLista", h.context), "pronta");
  assert.equal(h.context.el("conversas-aviso").textContent, "");
});

test("erro terminal na escuta dos cards permite nova assinatura", async () => {
  const h = await criarHarnessConversas();
  await h.context.atualizarAcesso();
  h.estado.snapshots[0].erro({ message: "Permissão negada" });
  assert.equal(vm.runInContext("estadoLista", h.context), "erro");
  await h.context.atualizarAcesso();
  assert.equal(h.estado.snapshots.length, 2);
  h.estado.snapshots[1].sucesso({ docs: [{ id: "recuperado", data: () => ({}) }] });
  assert.equal(vm.runInContext("cards[0].id", h.context), "recuperado");
});

test("falhas iniciais de chats e funcionários saem do estado carregando e permitem recuperação", async () => {
  const { descreverErroServico } = await import("../js/erros-servico.mjs");
  const elementos = new Map();
  let falhar = true;
  const context = vm.createContext({
    console: { error() {} },
    el: (id) => {
      if (!elementos.has(id)) elementos.set(id, elemento());
      return elementos.get(id);
    },
    call: async (nome) => {
      if (falhar) throw { code: "functions/internal", message: "internal" };
      return nome === "listarMembrosChat"
        ? { data: { membros: [{ uid: "u", nome: "Funcionário" }], cadastrosSemConta: 1 } }
        : { data: { chats: [] } };
    },
    renderizarMembros: (membros) => { context.recebidos = membros; },
    renderizarChats: () => { context.el("chats-lista").textContent = "Nenhum chat iniciado."; },
    descreverErroServico,
    usuario: { uid: "atual" },
    aviso() {}
  });
  vm.runInContext(`
    let atualizando = false, atualizandoMembros = false;
    let membrosCarregados = false, chatsCarregados = false;
    let chats = [], selecionado = "", sincronizarChatInicial = false;
  `, context);
  vm.runInContext(trecho(chats, "async function atualizar()", "async function criarChat("), context);
  vm.runInContext(trecho(chats, "async function carregarMembros()", "onAuthStateChanged(auth"), context);
  await Promise.all([context.atualizar(), context.carregarMembros()]);
  assert.match(context.el("chats-lista").textContent, /Não foi possível/);
  assert.match(context.el("membros-lista").textContent, /Não foi possível/);
  assert.match(context.el("chats-erro").textContent, /listarChatsInternos.*implantação/);
  assert.match(context.el("membros-erro").textContent, /listarMembrosChat.*implantação/);
  falhar = false;
  await Promise.all([context.atualizar(), context.carregarMembros()]);
  assert.equal(context.el("chats-lista").textContent, "Nenhum chat iniciado.");
  assert.equal(context.recebidos[0].nome, "Funcionário");
  assert.match(context.el("membros-erro").textContent, /1 cadastro/);
});

test("atualização da equipe preserva seleção de participantes e evita recriar grupo inalterado", () => {
  const grupo = {
    children: [], substituicoes: 0,
    querySelectorAll: () => grupo.children.map((label) => label.children[0]).filter((item) => item.checked),
    replaceChildren() { this.children = []; this.substituicoes++; },
    appendChild(child) { this.children.push(child); }
  };
  const context = vm.createContext({
    usuario: { uid: "atual" },
    el: () => grupo,
    document: {
      createElement: () => ({ children: [], append(...children) { this.children.push(...children); } }),
      createTextNode: (text) => ({ text })
    },
    renderizarListaMembros() {}
  });
  vm.runInContext('let membros = [], membrosCarregados = false, assinaturaMembros = "";', context);
  vm.runInContext(trecho(chats, "function renderizarMembros(", "async function carregarMembros()"), context);
  const lista = [{ uid: "u1", nome: "Ana" }, { uid: "u2", nome: "Bruno" }];
  context.renderizarMembros(lista);
  grupo.children[0].children[0].checked = true;
  context.renderizarMembros(lista);
  assert.equal(grupo.substituicoes, 1);
  context.renderizarMembros([...lista, { uid: "u3", nome: "Carla" }]);
  assert.equal(grupo.substituicoes, 2);
  assert.equal(grupo.children[0].children[0].checked, true);
});
