"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "conexoes.js"), "utf8");
const start = source.indexOf('formConectar.addEventListener("submit"');
const end = source.indexOf('seletorBot.addEventListener("change"', start);
assert.ok(start >= 0 && end > start);
const submitHandler = source.slice(start, end);

function createHarness() {
  const fields = Object.fromEntries(Object.entries({
    appId: "3000000",
    phoneNumberId: "1000001",
    wabaId: "2000000",
    accessToken: "fake-access-token",
    appSecret: "fake-app-secret",
    verifyToken: "fake-verify-token"
  }).map(([name, value]) => [name, { name, value, disabled: false }]));
  const button = { disabled: false, textContent: "Vincular número" };
  const form = {
    elements: [...Object.values(fields), button],
    querySelector: () => button,
    addEventListener: (_, callback) => { form.submit = callback; },
    reset: () => Object.values(fields).forEach((field) => { field.value = ""; })
  };
  const state = {
    numeros: [{ phoneNumberId: "1000000", displayPhoneNumber: "Número antigo" }],
    avisos: [],
    aceita: true,
    busca: { value: "filtro anterior" }
  };
  let resolveCall;
  const context = vm.createContext({
    formConectar: form,
    campoAppId: fields.appId,
    campoBusca: state.busca,
    ehAdmin: true,
    numeros: state.numeros,
    appIdAnterior: "",
    statusIntegracao: { textContent: "", classList: { remove() {} } },
    FormData: class {
      constructor(formElement) { this.form = formElement; }
      entries() {
        return this.form.elements.filter((field) => field.name && !field.disabled)
          .map((field) => [field.name, field.value]).values();
      }
    },
    window: { confirm: (text) => { state.confirmacao = text; return state.aceita; } },
    executarCallable: (name, data) => {
      state.chamada = { name, data };
      return new Promise((resolve) => { resolveCall = resolve; });
    },
    atualizarWebhook() {},
    renderizarNumeros() { state.renderizou = true; },
    preencherSeletores() {},
    mostrarAviso: (texto, tipo) => state.avisos.push({ texto, tipo }),
    console: { error() {} }
  });
  vm.runInContext(submitHandler, context);
  return {
    fields, button, form, state,
    submit: () => form.submit({ preventDefault() {} }),
    resolve: (number) => resolveCall({ number })
  };
}

test("confirma os IDs atuais, bloqueia edição durante envio e mostra o número retornado", async () => {
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
  assert.equal(h.fields.phoneNumberId.disabled, true);
  h.resolve({ phoneNumberId: "1000001", wabaId: "2000000", appId: "3000000", displayPhoneNumber: "Número novo" });
  await pending;
  assert.equal(h.state.numeros.length, 2);
  assert.equal(h.state.numeros[1].displayPhoneNumber, "Número novo");
  assert.equal(h.fields.phoneNumberId.value, "");
  assert.equal(h.fields.appId.value, "3000000");
  assert.equal(h.fields.phoneNumberId.disabled, false);
  assert.equal(h.state.busca.value, "");
  assert.equal(h.state.avisos.at(-1).tipo, "sucesso");
});

test("resposta com IDs diferentes não exibe sucesso nem apaga o formulário", async () => {
  const h = createHarness();
  const pending = h.submit();
  h.resolve({ phoneNumberId: "1000000", wabaId: "2000000", appId: "3000000" });
  await pending;
  assert.equal(h.state.numeros.length, 1);
  assert.equal(h.fields.phoneNumberId.value, "1000001");
  assert.equal(h.fields.phoneNumberId.disabled, false);
  assert.equal(h.state.avisos.at(-1).tipo, "erro");
  assert.match(h.state.avisos.at(-1).texto, /IDs diferentes/);
});
