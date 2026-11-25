"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const whatsappAutomation = require(path.join(__dirname, "..", "whatsapp-automation.js"));
const project = "webhook-test";
const projectNumber = "123456789012";
const secretPrefix = `projects/${project}/secrets/`;
const canonicalPrefix = `projects/${projectNumber}/secrets/`;

const appA = {
  id: "1000001",
  secret: "app-a-secret",
  verifyToken: "app-a-verify",
  wabaId: "2000001",
  phoneNumberId: "3000001",
  cardId: "card-a"
};
const appB = {
  id: "1000002",
  secret: "app-b-secret",
  verifyToken: "app-b-verify",
  wabaId: "2000002",
  phoneNumberId: "3000002",
  cardId: "card-b"
};

function createHarness() {
  const documents = new Map();
  const secrets = new Map();
  const secretResources = new Set();
  const errors = [];
  const warnings = [];
  const calls = [];
  const failures = {};
  const graphCalls = [];
  let nextId = 0;
  let transactionTail = Promise.resolve();
  const timestamp = (millis) => ({ toMillis: () => millis, toDate: () => new Date(millis) });
  const graphPages = new Map([
    [`${appA.wabaId}:`, { data: [{ id: appA.phoneNumberId }] }],
    [`${appB.wabaId}:`, { data: [{ id: appB.phoneNumberId }] }],
    ["6000001:", { data: [{ id: "5000001" }] }]
  ]);
  const graphNumbers = new Map([
    [appA.phoneNumberId, { id: appA.phoneNumberId, display_phone_number: "Número A", verified_name: "Teste A" }],
    [appB.phoneNumberId, { id: appB.phoneNumberId, display_phone_number: "Número B", verified_name: "Teste B" }],
    ["5000001", { id: "5000001", display_phone_number: "Número novo", verified_name: "Teste novo" }],
    ["849591261693565", { id: "849591261693565", display_phone_number: "Número novo", verified_name: "Nome novo" }]
  ]);

  function documentRef(documentPath) {
    const ref = {
      id: documentPath.split("/").at(-1),
      collection: (name) => collection(`${documentPath}/${name}`),
      get: async () => snapshot(documentPath),
      set: async (data, options) => {
        documents.set(documentPath, options && options.merge
          ? { ...documents.get(documentPath), ...data }
          : { ...data });
      },
      update: async (data) => {
        if (failures.update) failures.update(documentPath, data);
        if (!documents.has(documentPath)) throw new Error(`Documento ausente: ${documentPath}`);
        documents.set(documentPath, { ...documents.get(documentPath), ...data });
      }
    };
    return ref;
  }

  function snapshot(documentPath) {
    return {
      id: documentPath.split("/").at(-1),
      exists: documents.has(documentPath),
      data: () => documents.get(documentPath),
      ref: documentRef(documentPath)
    };
  }

  function collection(collectionPath, filter, ordering, maxCount) {
    return {
      doc: (id) => documentRef(`${collectionPath}/${id || `generated-${++nextId}`}`),
      where: (field, operator, value) => {
        assert.equal(operator, "==");
        return collection(collectionPath, { field, value }, ordering, maxCount);
      },
      orderBy: (field, direction = "asc") =>
        collection(collectionPath, filter, { field, direction }, maxCount),
      limit: (count) => collection(collectionPath, filter, ordering, count),
      get: async () => {
        const prefix = `${collectionPath}/`;
        let docs = [...documents.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .filter((key) => !filter || documents.get(key)[filter.field] === filter.value)
          .map(snapshot);
        if (ordering) {
          docs.sort((a, b) => {
            const left = a.data()[ordering.field] && a.data()[ordering.field].toMillis
              ? a.data()[ordering.field].toMillis()
              : 0;
            const right = b.data()[ordering.field] && b.data()[ordering.field].toMillis
              ? b.data()[ordering.field].toMillis()
              : 0;
            return (ordering.direction === "desc" ? right - left : left - right);
          });
        }
        if (maxCount !== undefined) docs = docs.slice(0, maxCount);
        return { docs, empty: docs.length === 0 };
      }
    };
  }

  const db = {
    collection,
    runTransaction: async (callback) => {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        const writes = [];
        const result = await callback({
          get: (ref) => ref.get(),
          set: (ref, data, options) => writes.push(() => ref.set(data, options)),
          update: (ref, data) => writes.push(() => ref.update(data))
        });
        for (const write of writes) await write();
        return result;
      } finally {
        release();
      }
    }
  };

  class SecretManagerServiceClient {
    async getSecret({ name }) {
      if (!secretResources.has(name)) throw Object.assign(new Error("Secret não encontrado"), { code: 5 });
      return [{ name: name.replace(secretPrefix, canonicalPrefix) }];
    }

    async createSecret({ parent, secretId }) {
      const name = `${parent}/secrets/${secretId}`;
      if (secretResources.has(name)) throw Object.assign(new Error("Secret já existe"), { code: 6 });
      secretResources.add(name);
      calls.push({ operation: "create", name });
      return [{ name: name.replace(secretPrefix, canonicalPrefix) }];
    }

    async addSecretVersion({ parent, payload }) {
      const failure = failures.addSecretVersion && failures.addSecretVersion(parent);
      if (failure) throw failure;
      const prefix = `${parent}/versions/`;
      const versions = [...secrets.keys()]
        .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
        .map((name) => Number(name.slice(prefix.length)));
      const version = Math.max(0, ...versions) + 1;
      const name = `${prefix}${version}`;
      secrets.set(name, payload.data.toString("utf8"));
      calls.push({ operation: "addVersion", name });
      return [{ name: name.replace(secretPrefix, canonicalPrefix) }];
    }

    async accessSecretVersion({ name }) {
      if (!secrets.has(name)) throw new Error(`Segredo ausente: ${name}`);
      return [{
        name: name.replace(secretPrefix, canonicalPrefix),
        payload: { data: Buffer.from(secrets.get(name)) }
      }];
    }
  }

  const exports = {};
  function requireMock(name) {
    switch (name) {
      case "node:crypto":
        return crypto;
      case "./whatsapp-automation":
        return whatsappAutomation;
      case "@google-cloud/secret-manager":
        return { SecretManagerServiceClient };
      case "firebase-admin/app":
        return { initializeApp() {} };
      case "firebase-admin/firestore":
        return {
          getFirestore: () => db,
          FieldValue: { serverTimestamp: () => timestamp(Date.now()), delete: () => null },
          Timestamp: { fromDate: (date) => timestamp(date.getTime()), fromMillis: timestamp }
        };
      case "firebase-functions/v2/https":
        return {
          onCall: (_, handler) => handler,
          onRequest: (_, handler) => handler,
          HttpsError: class HttpsError extends Error {
            constructor(code, message) { super(message); this.code = code; }
          }
        };
      case "firebase-functions/v2/scheduler":
        return { onSchedule: (_, handler) => handler };
      case "firebase-functions/v2/firestore":
        return { onDocumentWritten: (_, handler) => handler };
      default:
        throw new Error(`Módulo não simulado: ${name}`);
    }
  }

  vm.runInNewContext(source, {
    require: requireMock,
    exports,
    Buffer,
    AbortSignal,
    fetch: async (url, options) => {
      const parsed = new URL(url);
      graphCalls.push({
        path: parsed.pathname,
        after: parsed.searchParams.get("after"),
        fields: parsed.searchParams.get("fields"),
        method: options.method || "GET",
        payload: options.body ? JSON.parse(options.body) : null
      });
      if (failures.fetch) await failures.fetch(parsed, options);
      const wabaId = parsed.pathname.split("/")[2];
      const body = parsed.pathname.endsWith("/messages")
        ? { messages: [{ id: "wamid-outgoing" }] }
        : parsed.pathname.endsWith("/phone_numbers")
        ? graphPages.get(`${wabaId}:${parsed.searchParams.get("after") || ""}`)
        : parsed.pathname.endsWith("/subscribed_apps")
          ? { success: true }
          : graphNumbers.get(wabaId);
      return { ok: true, json: async () => body };
    },
    process: { env: { GCLOUD_PROJECT: project } },
    console: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args)
    }
  }, { filename: "functions/index.js" });

  function addApp(app) {
    const secretName = `${secretPrefix}golden-whatsapp-app-${app.id}-secret/versions/1`;
    const verifyName = `${secretPrefix}golden-whatsapp-app-${app.id}-verify-token/versions/1`;
    secrets.set(secretName, app.secret);
    secrets.set(verifyName, app.verifyToken);
    secretResources.add(secretName.replace(/\/versions\/1$/, ""));
    secretResources.add(verifyName.replace(/\/versions\/1$/, ""));
    documents.set(`whatsappNumbers/_apps/apps/${app.id}`, {
      appId: app.id,
      appSecretVersion: secretName.replace(secretPrefix, canonicalPrefix),
      verifyTokenVersion: verifyName.replace(secretPrefix, canonicalPrefix)
    });
    documents.set(`whatsappNumbers/${app.phoneNumberId}`, {
      appId: app.id,
      wabaId: app.wabaId,
      active: true,
      captureEnabled: true
    });
    documents.set(`cards/${app.cardId}`, {
      telefone: "5511999999999",
      whatsappPhoneNumberId: app.phoneNumberId,
      status: "ativa"
    });
  }

  addApp(appA);
  addApp(appB);
  secrets.set(`${secretPrefix}golden-whatsapp-app-secret/versions/latest`, appA.secret);
  secrets.set(`${secretPrefix}golden-whatsapp-verify-token/versions/latest`, "legacy-verify");

  async function webhook({ route = "/", method = "POST", query = {}, body, signature, signingSecret }) {
    const rawBody = body === undefined ? undefined : Buffer.from(body);
    const request = {
      path: route,
      method,
      query,
      rawBody,
      get: (name) => {
        assert.equal(name, "x-hub-signature-256");
        if (signature !== undefined) return signature;
        if (!signingSecret || !rawBody) return "";
        return `sha256=${crypto.createHmac("sha256", signingSecret).update(rawBody).digest("hex")}`;
      }
    };
    const response = {
      statusCode: undefined,
      contentType: undefined,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      type(contentType) { this.contentType = contentType; return this; },
      send(value) { this.body = value; return this; },
      sendStatus(code) { this.statusCode = code; return this; }
    };
    await exports.whatsappWebhook(request, response);
    return response;
  }

  return {
    documents, secrets, secretResources, errors, warnings, calls, failures, graphCalls, graphPages, graphNumbers,
    webhook, connect: exports.connectWhatsAppNumber,
    updateNumber: exports.updateWhatsAppNumber, checkNumber: exports.checkWhatsAppNumberStatus,
    saveAutomation: exports.saveWhatsAppAutomation
  };
}

function messagePayload(app, messageId, wabaId = app.wabaId, phoneNumberId = app.phoneNumberId) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: wabaId,
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{
            id: messageId,
            from: "5511999999999",
            timestamp: "1700000000",
            type: "text",
            text: { body: "Mensagem de teste" }
          }]
        }
      }]
    }]
  };
}

function incomingBody(app, messageId, text, timestamp = Math.floor(Date.now() / 1000)) {
  const payload = messagePayload(app, messageId);
  const message = payload.entry[0].changes[0].value.messages[0];
  message.timestamp = String(timestamp);
  message.text.body = text;
  return JSON.stringify(payload);
}

function statusPayload(app, messageId, wabaId = app.wabaId, phoneNumberId = app.phoneNumberId) {
  return {
    entry: [{
      id: wabaId,
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: phoneNumberId },
          statuses: [{ id: messageId, status: "delivered" }]
        }
      }]
    }]
  };
}

function verifyQuery(token, mode = "subscribe") {
  return { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "test-challenge" };
}

test("regras de 24 horas incluem atividade da equipe e normalizam opções", () => {
  const at = 2_000_000_000_000;
  assert.equal(whatsappAutomation.shouldSendAutomaticReply({
    receivedAt: at,
    lastInboundAt: at - 24 * 60 * 60 * 1000
  }), true);
  assert.equal(whatsappAutomation.shouldSendAutomaticReply({
    receivedAt: at,
    lastOutboundAt: at - 24 * 60 * 60 * 1000 + 1
  }), false);
  assert.equal(whatsappAutomation.shouldSendAutomaticReply({
    onlyRecipientInitiated: false,
    receivedAt: at
  }), true);
  assert.equal(whatsappAutomation.shouldSendAutomaticReply({
    onlyRecipientInitiated: false,
    receivedAt: at,
    lastAutomaticReplyAt: at - 24 * 60 * 60 * 1000
  }), true);
  assert.equal(whatsappAutomation.shouldSendAutomaticReply({
    onlyRecipientInitiated: false,
    receivedAt: at,
    lastAutomaticReplyAt: at - 1
  }), false);
  const active = { blocks: [
    { type: "option", trigger: " 1 ", columnId: "sales" },
    { type: "hidden", trigger: "interno", columnId: "finance" }
  ] };
  assert.deepEqual(whatsappAutomation.findMatchingOption(active, " 1 "), {
    columnId: "sales", trigger: " 1 "
  });
  assert.deepEqual(whatsappAutomation.findMatchingOption(active, "INTERNO"), {
    columnId: "finance", trigger: "interno"
  });
  assert.equal(whatsappAutomation.findMatchingOption(active, "10"), null);
});

test("GET valida o verifyToken próprio de cada aplicativo", async () => {
  const h = createHarness();
  for (const [app, other] of [[appA, appB], [appB, appA]]) {
    const valid = await h.webhook({ route: `/${app.id}`, method: "GET", query: verifyQuery(app.verifyToken) });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.contentType, "text/plain");
    assert.equal(valid.body, "test-challenge");

    for (const token of ["incorrect-token", other.verifyToken]) {
      const invalid = await h.webhook({ route: `/${app.id}`, method: "GET", query: verifyQuery(token) });
      assert.equal(invalid.statusCode, 403);
    }
    const wrongMode = await h.webhook({ route: `/${app.id}`, method: "GET", query: verifyQuery(app.verifyToken, "unsubscribe") });
    assert.equal(wrongMode.statusCode, 403);
  }
  assert.equal((await h.webhook({ route: "/9999999", method: "GET", query: verifyQuery("legacy-verify") })).statusCode, 404);
  assert.equal((await h.webhook({ route: `/${appA.id}/extra`, method: "GET" })).statusCode, 404);
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "PUT" })).statusCode, 405);
});

test("POST aceita HMAC do corpo bruto e grava mensagens dos dois aplicativos", async () => {
  const h = createHarness();
  for (const app of [appA, appB]) {
    const id = `wamid-${app.id}`;
    const body = JSON.stringify(messagePayload(app, id), null, 2);
    const result = await h.webhook({ route: `/${app.id}`, body, signingSecret: app.secret });
    assert.equal(result.statusCode, 200);
    const message = h.documents.get(`cards/${app.cardId}/mensagensWhatsapp/${id}`);
    assert.equal(message.text, "Mensagem de teste");
    assert.equal(message.phoneNumberId, app.phoneNumberId);
    assert.equal(h.documents.get(`whatsappWebhookEvents/${id}`).processed, true);
  }
  assert.equal(h.errors.length, 0);
});

test("evento concorrente aguarda nova tentativa e não duplica card, histórico ou resposta", { timeout: 5000 }, async () => {
  const h = createHarness();
  h.documents.delete(`cards/${appA.cardId}`);
  h.documents.set("colunas/entrada", { nome: "Entrada", ordem: 0 });
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    preAtendimentoEnabled: true, preAtendimentoMessage: "Olá"
  });
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token");
  let release;
  let entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const sending = new Promise((resolve) => { entered = resolve; });
  h.failures.fetch = async (url) => {
    if (url.pathname.endsWith("/messages")) {
      entered();
      await waiting;
    }
  };
  const args = { route: `/${appA.id}`, body: JSON.stringify(messagePayload(appA, "wamid-concurrent")), signingSecret: appA.secret };
  const first = h.webhook(args);
  try {
    await sending;
    assert.equal((await h.webhook(args)).statusCode, 500);
  } finally {
    release();
  }
  assert.equal((await first).statusCode, 200);
  assert.equal((await h.webhook(args)).statusCode, 200);
  const cards = [...h.documents.keys()].filter((key) => /^cards\/[^/]+$/.test(key) && key !== `cards/${appB.cardId}`);
  assert.equal(cards.length, 1);
  assert.equal([...h.documents.keys()].filter((key) => key.startsWith("colunas/entrada/historico/")).length, 1);
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages")).length, 1);
  assert.equal(h.documents.get("whatsappWebhookEvents/wamid-concurrent").state, "completed");
});

test("falha antes da criação libera a trava para nova tentativa", async () => {
  const h = createHarness();
  h.documents.delete(`cards/${appA.cardId}`);
  const args = { route: `/${appA.id}`, body: JSON.stringify(messagePayload(appA, "wamid-retry")), signingSecret: appA.secret };
  assert.equal((await h.webhook(args)).statusCode, 500);
  assert.equal(h.documents.get("whatsappWebhookEvents/wamid-retry").state, "failed");
  h.documents.set("colunas/entrada", { nome: "Entrada", ordem: 0 });
  assert.equal((await h.webhook(args)).statusCode, 200);
  assert.equal([...h.documents.keys()].filter((key) => key.startsWith("colunas/entrada/historico/")).length, 1);
});

test("falha após tentativa de envio não repete o envio ou cria outro card", async () => {
  const h = createHarness();
  h.documents.delete(`cards/${appA.cardId}`);
  h.documents.set("colunas/entrada", { nome: "Entrada", ordem: 0 });
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    preAtendimentoEnabled: true, preAtendimentoMessage: "Olá"
  });
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token");
  h.failures.update = (path, data) => {
    if (path.startsWith("cards/") && ("botRespostaApiId" in data || "botRespostaErro" in data)) {
      throw new Error("Falha simulada após envio");
    }
  };
  const args = { route: `/${appA.id}`, body: JSON.stringify(messagePayload(appA, "wamid-ambiguous")), signingSecret: appA.secret };
  assert.equal((await h.webhook(args)).statusCode, 500);
  const event = h.documents.get("whatsappWebhookEvents/wamid-ambiguous");
  assert.equal(event.state, "failed");
  assert.equal(event.replyAttempted, true);
  const cardId = event.cardId;
  delete h.failures.update;
  assert.equal((await h.webhook(args)).statusCode, 200);
  assert.equal(h.documents.get("whatsappWebhookEvents/wamid-ambiguous").cardId, cardId);
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages")).length, 1);
  assert.equal([...h.documents.keys()].filter((key) => key.startsWith("colunas/entrada/historico/")).length, 1);
});

test("resposta da Meta perdida é registrada e o evento não reenvia", async () => {
  const h = createHarness();
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    preAtendimentoEnabled: true, preAtendimentoMessage: "Olá"
  });
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token");
  h.failures.fetch = async (url) => {
    if (url.pathname.endsWith("/messages")) throw new Error("Conexão encerrada");
  };
  const args = { route: `/${appA.id}`, body: JSON.stringify(messagePayload(appA, "wamid-network")), signingSecret: appA.secret };
  assert.equal((await h.webhook(args)).statusCode, 200);
  assert.equal((await h.webhook(args)).statusCode, 200);
  assert.match(h.documents.get(`cards/${appA.cardId}`).botRespostaErro, /Conexão encerrada/);
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages")).length, 1);
  assert.equal(h.documents.get("whatsappWebhookEvents/wamid-network").replyAttempted, true);
});

test("mensagem ativa dispara, grava a saída e direciona opção simples para coluna elegível", async () => {
  const h = createHarness();
  const numberPath = `whatsappNumbers/${appA.phoneNumberId}`;
  const cardPath = `cards/${appA.cardId}`;
  const now = Date.now();
  h.documents.set("colunas/entrada", { nome: "Entrada", ordem: 0 });
  h.documents.set("colunas/vendas", { nome: "Entrada vendas*", ordem: 1 });
  Object.assign(h.documents.get(numberPath), {
    botMessages: [{
      id: "bot-vendas", name: "Boas-vindas", blocks: [
        { type: "text", text: "Escolha uma opção:" },
        { type: "option", trigger: "1", description: "Vendas", bold: true, styled: false, style: "", columnId: "vendas", columnName: "Entrada vendas*" }
      ]
    }],
    activeBotMessageId: "bot-vendas",
    onlyRecipientInitiated: true,
    preAtendimentoEnabled: true,
    preAtendimentoMessage: "Não deve substituir a mensagem ativa"
  });
  Object.assign(h.documents.get(cardPath), {
    colunaId: "entrada",
    lastInboundAt: new Date(now - 26 * 60 * 60 * 1000)
  });
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token");
  const response = await h.webhook({
    route: `/${appA.id}`,
    body: incomingBody(appA, "wamid-bot-route", " 1 "),
    signingSecret: appA.secret
  });

  assert.equal(response.statusCode, 200);
  const event = h.documents.get("whatsappWebhookEvents/wamid-bot-route");
  const card = h.documents.get(`cards/${event.cardId}`);
  assert.equal(card.colunaId, "vendas");
  assert.equal(event.replyMode, "automation");
  assert.equal(event.replyAttempted, true);
  assert.equal(card.whatsappLastOutboundAt.toMillis() > now, true);
  const sent = h.documents.get(`cards/${event.cardId}/mensagensWhatsapp/wamid-outgoing`);
  assert.equal(sent.direction, "outgoing");
  assert.equal(sent.text, "Escolha uma opção:\n*1* - Vendas");
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages"))[0].payload.text.body, sent.text);
  assert.equal(h.documents.has(`colunas/vendas/historico/wamid-bot-route-route-in`), true);
  assert.equal(h.documents.has(`colunas/entrada/historico/wamid-bot-route-route-out`), true);
});

test("atividade recente da equipe bloqueia mensagem ativa mesmo após inatividade do cliente", async () => {
  const h = createHarness();
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    botMessages: [{ id: "bot-1", name: "Bot", blocks: [{ type: "text", text: "Resposta" }] }],
    activeBotMessageId: "bot-1",
    onlyRecipientInitiated: true,
    preAtendimentoEnabled: true,
    preAtendimentoMessage: "Fallback não deve substituir a mensagem ativa"
  });
  Object.assign(h.documents.get(`cards/${appA.cardId}`), {
    lastInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    whatsappLastOutboundAt: new Date(Date.now() - 60 * 60 * 1000)
  });
  const response = await h.webhook({
    route: `/${appA.id}`,
    body: incomingBody(appA, "wamid-team-activity", "Oi"),
    signingSecret: appA.secret
  });
  assert.equal(response.statusCode, 200);
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages")).length, 0);
  assert.equal(h.documents.get("whatsappWebhookEvents/wamid-team-activity").replyAttempted, false);
});

test("atividade de saída legada é recuperada do histórico de mensagens", async () => {
  const h = createHarness();
  const lastTeamMessage = new Date(Date.now() - 2 * 60 * 60 * 1000);
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    botMessages: [{ id: "bot-1", name: "Bot", blocks: [{ type: "text", text: "Resposta" }] }],
    activeBotMessageId: "bot-1",
    onlyRecipientInitiated: true
  });
  Object.assign(h.documents.get(`cards/${appA.cardId}`), {
    lastInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
  });
  h.documents.set(`cards/${appA.cardId}/mensagensWhatsapp/legacy-out`, {
    direction: "outgoing",
    criadoEm: lastTeamMessage
  });
  const response = await h.webhook({
    route: `/${appA.id}`,
    body: incomingBody(appA, "wamid-legacy-activity", "Oi"),
    signingSecret: appA.secret
  });
  assert.equal(response.statusCode, 200);
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages")).length, 0);
  assert.equal(
    h.documents.get(`cards/${appA.cardId}`).whatsappLastOutboundAt.getTime(),
    lastTeamMessage.getTime()
  );
});

test("backend ignora direcionamento se a coluna deixou de terminar em asterisco", async () => {
  const h = createHarness();
  h.documents.set("colunas/entrada", { nome: "Entrada", ordem: 0 });
  h.documents.set("colunas/vendas", { nome: "Entrada vendas", ordem: 1 });
  Object.assign(h.documents.get(`cards/${appA.cardId}`), { colunaId: "entrada" });
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    botMessages: [{
      id: "bot-vendas", name: "Bot", blocks: [
        { type: "text", text: "Escolha" },
        { type: "option", trigger: "1", description: "", bold: false, styled: false, style: "", columnId: "vendas", columnName: "Entrada vendas*" }
      ]
    }],
    activeBotMessageId: "bot-vendas",
    onlyRecipientInitiated: false
  });
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token");
  const response = await h.webhook({
    route: `/${appA.id}`,
    body: incomingBody(appA, "wamid-invalid-column", "1"),
    signingSecret: appA.secret
  });
  assert.equal(response.statusCode, 200);
  assert.equal(h.documents.get(`cards/${appA.cardId}`).colunaId, "entrada");
  assert.equal(h.documents.has("colunas/vendas/historico/wamid-invalid-column-route-in"), false);
  assert.equal(h.warnings.some(([message]) => /Direcionamento do WhatsApp ignorado/.test(message)), true);
});

test("eventos concorrentes da mesma conversa criam um card e enviam no máximo uma resposta automática", async () => {
  const h = createHarness();
  h.documents.delete(`cards/${appA.cardId}`);
  h.documents.set("colunas/entrada", { nome: "Entrada", ordem: 0 });
  h.documents.set("colunas/vendas", { nome: "Entrada vendas*", ordem: 1 });
  Object.assign(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`), {
    botMessages: [{
      id: "bot-1", name: "Bot", blocks: [
        { type: "text", text: "Escolha:" },
        { type: "hidden", trigger: "vendas", description: "", columnId: "vendas", columnName: "Entrada vendas*" }
      ]
    }],
    activeBotMessageId: "bot-1",
    onlyRecipientInitiated: false
  });
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token");
  const args = (id) => ({
    route: `/${appA.id}`,
    body: incomingBody(appA, id, "VENDAS"),
    signingSecret: appA.secret
  });
  const [first, second] = await Promise.all([
    h.webhook(args("wamid-same-contact-1")),
    h.webhook(args("wamid-same-contact-2"))
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);

  const cards = [...h.documents.keys()].filter((key) =>
    /^cards\/[^/]+$/.test(key) && key !== `cards/${appB.cardId}`
  );
  assert.equal(cards.length, 1);
  const cardId = cards[0].slice("cards/".length);
  assert.equal(h.documents.get(cards[0]).colunaId, "vendas");
  assert.equal(h.graphCalls.filter((call) => call.path.endsWith("/messages")).length, 1);
  assert.equal([...h.documents.keys()].filter((key) =>
    key.startsWith(`${cards[0]}/mensagensWhatsapp/`) &&
    h.documents.get(key).direction === "incoming"
  ).length, 2);
  assert.equal([...h.documents.keys()].filter((key) =>
    key.startsWith(`colunas/vendas/historico/`) &&
    h.documents.get(key).cardId === cardId
  ).length, 1);
});

test("trava expirada é recuperada e evento legado concluído não é processado novamente", async () => {
  const h = createHarness();
  h.documents.set("whatsappWebhookEvents/wamid-expired", {
    processed: false, state: "processing", lockOwner: "old",
    lockExpiresAt: { toMillis: () => Date.now() - 1 }
  });
  const args = { route: `/${appA.id}`, body: JSON.stringify(messagePayload(appA, "wamid-expired")), signingSecret: appA.secret };
  assert.equal((await h.webhook(args)).statusCode, 200);
  assert.equal(h.documents.get("whatsappWebhookEvents/wamid-expired").state, "completed");
  h.documents.set("whatsappWebhookEvents/wamid-legacy-done", { processed: true });
  args.body = JSON.stringify(messagePayload(appA, "wamid-legacy-done"));
  assert.equal((await h.webhook(args)).statusCode, 200);
  assert.equal(h.documents.has(`cards/${appA.cardId}/mensagensWhatsapp/wamid-legacy-done`), false);
});

test("POST rejeita assinatura ausente, inválida, de outro app ou de outro corpo", async () => {
  const h = createHarness();
  const body = JSON.stringify(messagePayload(appA, "wamid-invalid"));
  const signature = `sha256=${crypto.createHmac("sha256", appA.secret).update(body).digest("hex")}`;
  const attempts = [
    { body },
    { body, signature: "sha256=incorrect" },
    { body, signingSecret: appB.secret },
    { body: `${body} `, signature },
    { signature }
  ];
  for (const attempt of attempts) {
    const result = await h.webhook({ route: `/${appA.id}`, ...attempt });
    assert.equal(result.statusCode, 401);
  }
  assert.equal(h.documents.has("whatsappWebhookEvents/wamid-invalid"), false);
  assert.equal(h.documents.has(`cards/${appA.cardId}/mensagensWhatsapp/wamid-invalid`), false);
});

test("POST isola mensagens e status por app, WABA e número", async () => {
  const h = createHarness();
  h.documents.set("whatsappJobs/job-a", { apiMessageId: "wamid-status", phoneNumberId: appA.phoneNumberId });
  h.documents.set("whatsappJobs/job-b", { apiMessageId: "wamid-status", phoneNumberId: appB.phoneNumberId });

  const foreignApp = JSON.stringify(messagePayload(appA, "wamid-other-app"));
  const foreignWaba = JSON.stringify(messagePayload(appA, "wamid-other-waba", appB.wabaId));
  const foreignNumber = JSON.stringify(messagePayload(appA, "wamid-other-number", appA.wabaId, appB.phoneNumberId));
  for (const attempt of [
    { route: `/${appB.id}`, body: foreignApp, signingSecret: appB.secret },
    { route: `/${appA.id}`, body: foreignWaba, signingSecret: appA.secret },
    { route: `/${appA.id}`, body: foreignNumber, signingSecret: appA.secret }
  ]) {
    assert.equal((await h.webhook(attempt)).statusCode, 200);
  }
  for (const id of ["wamid-other-app", "wamid-other-waba", "wamid-other-number"]) {
    assert.equal(h.documents.has(`whatsappWebhookEvents/${id}`), false);
  }

  const wrongStatus = JSON.stringify(statusPayload(appA, "wamid-status", appB.wabaId));
  assert.equal((await h.webhook({ route: `/${appA.id}`, body: wrongStatus, signingSecret: appA.secret })).statusCode, 200);
  assert.equal(h.documents.get("whatsappJobs/job-a").statusMeta, undefined);
  const validStatus = JSON.stringify(statusPayload(appA, "wamid-status"));
  assert.equal((await h.webhook({ route: `/${appA.id}`, body: validStatus, signingSecret: appA.secret })).statusCode, 200);
  assert.equal(h.documents.get("whatsappJobs/job-a").statusMeta, "delivered");
  assert.equal(h.documents.get("whatsappJobs/job-b").statusMeta, undefined);
});

test("rota legada usa segredos globais e preserva números antigos e migrados compatíveis", async () => {
  const h = createHarness();
  const legacy = { ...appA, phoneNumberId: "3000003", wabaId: "2000003", cardId: "card-legacy" };
  h.documents.set(`whatsappNumbers/${legacy.phoneNumberId}`, {
    wabaId: legacy.wabaId, active: true, captureEnabled: true
  });
  h.documents.set(`cards/${legacy.cardId}`, {
    telefone: "5511999999999", whatsappPhoneNumberId: legacy.phoneNumberId, status: "ativa"
  });

  assert.equal((await h.webhook({ method: "GET", query: verifyQuery("legacy-verify") })).statusCode, 200);
  assert.equal((await h.webhook({ method: "GET", query: verifyQuery(appA.verifyToken) })).statusCode, 403);
  const legacyBody = JSON.stringify(messagePayload(legacy, "wamid-legacy"));
  assert.equal((await h.webhook({ body: legacyBody, signingSecret: appA.secret })).statusCode, 200);
  assert.equal(h.documents.get(`cards/${legacy.cardId}/mensagensWhatsapp/wamid-legacy`).text, "Mensagem de teste");

  const migratedBody = JSON.stringify(messagePayload(appA, "wamid-migrated"));
  assert.equal((await h.webhook({ body: migratedBody, signingSecret: appA.secret })).statusCode, 200);
  assert.equal(h.documents.get(`cards/${appA.cardId}/mensagensWhatsapp/wamid-migrated`).text, "Mensagem de teste");

  h.secrets.set(`${secretPrefix}golden-whatsapp-app-secret/versions/latest`, appB.secret);
  const incompatibleBody = JSON.stringify(messagePayload(appA, "wamid-incompatible"));
  assert.equal((await h.webhook({ body: incompatibleBody, signingSecret: appB.secret })).statusCode, 200);
  assert.equal(h.documents.has("whatsappWebhookEvents/wamid-incompatible"), false);
});

test("segredo ausente de um app não usa os segredos globais como fallback", async () => {
  const h = createHarness();
  h.secrets.delete(`${secretPrefix}golden-whatsapp-app-${appA.id}-verify-token/versions/1`);
  h.secrets.delete(`${secretPrefix}golden-whatsapp-app-${appA.id}-secret/versions/1`);
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "GET", query: verifyQuery("legacy-verify") })).statusCode, 503);
  const body = JSON.stringify(messagePayload(appA, "wamid-missing-secret"));
  assert.equal((await h.webhook({ route: `/${appA.id}`, body, signingSecret: appA.secret })).statusCode, 500);
  assert.equal(h.documents.has("whatsappWebhookEvents/wamid-missing-secret"), false);
  assert.equal(h.errors.length, 2);
});

function connectRequest(app, overrides = {}) {
  const adminEmail = source.match(/const ADMIN_EMAILS = \["([^"]+)"\]/)[1];
  return {
    auth: { uid: "test-admin", token: { email: adminEmail } },
    data: {
      appId: app.id,
      phoneNumberId: app.phoneNumberId,
      wabaId: app.wabaId,
      accessToken: "test-access-token-123456789",
      appSecret: app.secret,
      verifyToken: app.verifyToken,
      ...overrides
    }
  };
}

test("ativação e nome são persistidos somente para administradores", async () => {
  const h = createHarness();
  const request = connectRequest(appA, { action: "active", active: false });
  await h.updateNumber(request);
  assert.equal(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`).active, false);
  request.data = { phoneNumberId: appA.phoneNumberId, action: "name", displayName: "  Equipe  " };
  await h.updateNumber(request);
  assert.equal(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`).displayName, "Equipe");
  request.data.displayName = " ";
  await assert.rejects(h.updateNumber(request), (error) => error.code === "invalid-argument");
  request.data = { phoneNumberId: appA.phoneNumberId, action: "active", active: "false" };
  await assert.rejects(h.updateNumber(request), (error) => error.code === "invalid-argument");
  request.data.active = true;
  request.auth = { uid: "sales", token: { email: "vendas@example.test" } };
  await assert.rejects(h.updateNumber(request), (error) => error.code === "permission-denied");
  request.auth = null;
  await assert.rejects(h.updateNumber(request), (error) => error.code === "unauthenticated");
});

test("verificação não invasiva consulta a Meta e sinaliza falha sem revelar credenciais", async () => {
  const h = createHarness();
  const request = connectRequest(appA);
  h.secrets.set(`${secretPrefix}golden-whatsapp-token-${appA.phoneNumberId}/versions/latest`, "token-secreto");
  const success = await h.checkNumber(request);
  assert.equal(success.operational, true);
  assert.equal(h.graphCalls.at(-1).method, "GET");
  assert.equal(h.graphCalls.at(-1).fields, "id");
  h.failures.fetch = async () => { throw new Error("Meta indisponível"); };
  const failure = await h.checkNumber(request);
  assert.equal(failure.operational, false);
  assert.equal(JSON.stringify(failure).includes("token-secreto"), false);
  request.auth = null;
  await assert.rejects(h.checkNumber(request), (error) => error.code === "unauthenticated");
});

test("automação persiste uma única ativa e resolve nomes confiáveis das colunas", async () => {
  const h = createHarness();
  h.documents.set("colunas/vendas", { nome: "Entrada vendas*", ordem: 0 });
  h.documents.set("colunas/interna", { nome: "Oculta*", ordem: 1 });
  const messages = [{
    id: "mensagem-1", name: "MENSAGEM 1", blocks: [
      { type: "text", text: "Escolha uma opção" },
      { type: "option", trigger: "1", description: "Vendas", columnId: "vendas", columnName: "Nome enviado pelo cliente", bold: true, styled: true, style: "Opção 1" },
      { type: "hidden", trigger: "financeiro", description: "anotação", columnId: "interna", columnName: "Oculta*" }
    ]
  }];
  const result = await h.saveAutomation(connectRequest(appA, {
    phoneNumberId: appA.phoneNumberId, botMessages: messages,
    activeBotMessageId: "mensagem-1", onlyRecipientInitiated: true
  }));
  assert.equal(result.number.activeBotMessageId, "mensagem-1");
  assert.equal(result.number.onlyRecipientInitiated, true);
  assert.equal(result.number.botMessages[0].blocks[1].columnName, "Entrada vendas*");
  assert.equal(whatsappAutomation.renderMessage(result.number.botMessages[0].blocks), "Escolha uma opção\n*Opção 1* - Vendas");
});

test("automação rejeita blocos incompletos, gatilhos repetidos e colunas inválidas", async () => {
  const h = createHarness();
  h.documents.set("colunas/normal", { nome: "Sem asterisco", ordem: 0 });
  const base = {
    phoneNumberId: appA.phoneNumberId, activeBotMessageId: "", onlyRecipientInitiated: false
  };
  const invalid = [
    [{ id: "1", name: "Mensagem", blocks: [{ type: "text", text: " " }] }],
    [{ id: "1", name: "Mensagem", blocks: [
      { type: "option", trigger: "1", description: "", columnId: "normal", columnName: "Sem asterisco", bold: false, styled: false, style: "" },
      { type: "hidden", trigger: " 1 ", description: "", columnId: "normal", columnName: "Sem asterisco" }
    ] }],
    [{ id: "1", name: "Mensagem", blocks: [
      { type: "option", trigger: "1", description: "", columnId: "normal", columnName: "Sem asterisco", bold: false, styled: false, style: "" }
    ] }]
  ];
  for (const botMessages of invalid) {
    await assert.rejects(
      h.saveAutomation(connectRequest(appA, { ...base, botMessages })),
      (error) => error.code === "invalid-argument" || error.code === "failed-precondition"
    );
  }
  await assert.rejects(h.saveAutomation(connectRequest(appA, {
    ...base, activeBotMessageId: "ausente", botMessages: []
  })), (error) => error.code === "invalid-argument");
});

test("versões com ID ou número do projeto funcionam e referências de outro projeto são rejeitadas", async () => {
  const h = createHarness();
  const ref = `whatsappNumbers/_apps/apps/${appA.id}`;
  const app = h.documents.get(ref);
  assert.ok(app.verifyTokenVersion.startsWith(canonicalPrefix));
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "GET", query: verifyQuery(appA.verifyToken) })).statusCode, 200);

  h.documents.set(ref, {
    ...app,
    verifyTokenVersion: app.verifyTokenVersion.replace(canonicalPrefix, secretPrefix)
  });
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "GET", query: verifyQuery(appA.verifyToken) })).statusCode, 200);

  h.documents.set(ref, {
    ...app,
    verifyTokenVersion: app.verifyTokenVersion.replace(canonicalPrefix, "projects/999999999999/secrets/")
  });
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "GET", query: verifyQuery(appA.verifyToken) })).statusCode, 503);
});

test("cadastro atualiza versões existentes sem recriar secrets e mantém as configurações do número", async () => {
  const h = createHarness();
  const appPath = `whatsappNumbers/_apps/apps/${appA.id}`;
  const numberPath = `whatsappNumbers/${appA.phoneNumberId}`;
  h.documents.set(appPath, { ...h.documents.get(appPath), criadoEm: "data-original" });
  h.documents.set(numberPath, {
    ...h.documents.get(numberPath), active: false, captureEnabled: false,
    preAtendimentoEnabled: true, preAtendimentoMessage: "mensagem anterior", displayName: "Nome salvo",
    botMessages: [{ id: "m1", name: "MENSAGEM 1", blocks: [{ type: "text", text: "Texto" }] }],
    activeBotMessageId: "m1", onlyRecipientInitiated: false
  });
  const request = connectRequest(appA, {
    appSecret: "updated-app-secret",
    verifyToken: "updated-verify-token"
  });
  const result = await h.connect(request);

  const app = h.documents.get(appPath);
  const number = h.documents.get(numberPath);
  assert.equal(app.appSecretVersion, `${canonicalPrefix}golden-whatsapp-app-${appA.id}-secret/versions/2`);
  assert.equal(app.verifyTokenVersion, `${canonicalPrefix}golden-whatsapp-app-${appA.id}-verify-token/versions/2`);
  assert.equal(app.criadoEm, "data-original");
  assert.equal(number.captureEnabled, false);
  assert.equal(number.preAtendimentoMessage, "mensagem anterior");
  assert.equal(result.number.active, false);
  assert.equal(result.number.captureEnabled, false);
  assert.equal(result.number.displayName, "Nome salvo");
  assert.equal(result.number.activeBotMessageId, "m1");
  assert.equal(result.number.onlyRecipientInitiated, false);
  assert.equal(h.calls.some((call) => call.operation === "create" && call.name.includes(`app-${appA.id}-`)), false);
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "GET", query: verifyQuery("updated-verify-token") })).statusCode, 200);
  assert.equal((await h.webhook({ route: `/${appA.id}`, method: "GET", query: verifyQuery(appA.verifyToken) })).statusCode, 403);
  const body = JSON.stringify(statusPayload(appA, "updated-status"));
  assert.equal((await h.webhook({ route: `/${appA.id}`, body, signingSecret: "updated-app-secret" })).statusCode, 200);
  assert.equal((await h.webhook({ route: `/${appA.id}`, body, signingSecret: appA.secret })).statusCode, 401);

  await h.connect(request);
  assert.equal(h.documents.get(appPath).appSecretVersion, `${canonicalPrefix}golden-whatsapp-app-${appA.id}-secret/versions/3`);
});

test("novo número do mesmo app usa IDs informados, inclusive na segunda página da WABA", async () => {
  const h = createHarness();
  const newPhoneId = "849591261693565";
  h.graphPages.set(`${appA.wabaId}:`, {
    data: [{ id: appA.phoneNumberId }],
    paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor+2" } }
  });
  h.graphPages.set(`${appA.wabaId}:cursor+2`, {
    data: [{ id: newPhoneId }]
  });
  const result = await h.connect(connectRequest(appA, { phoneNumberId: newPhoneId, displayName: "  Equipe nova  " }));

  assert.equal(result.number.phoneNumberId, newPhoneId);
  assert.equal(result.number.wabaId, appA.wabaId);
  assert.equal(result.number.displayPhoneNumber, "Número novo");
  assert.equal(result.number.displayName, "Equipe nova");
  assert.equal(h.documents.get(`whatsappNumbers/${newPhoneId}`).wabaId, appA.wabaId);
  assert.equal(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`).wabaId, appA.wabaId);
  assert.equal(h.graphCalls[0].fields, "id");
  assert.equal(h.graphCalls[1].fields, "id");
  assert.equal(h.graphCalls[1].after, "cursor+2");
  assert.equal(h.graphCalls[2].path, `/v25.0/${newPhoneId}`);
  assert.equal(h.graphCalls[2].fields, "id,display_phone_number,verified_name");
  assert.equal(h.graphCalls[3].path, `/v25.0/${appA.wabaId}/subscribed_apps`);
});

test("cadastro rejeita dados da Meta para um número diferente antes de salvar", async () => {
  const h = createHarness();
  h.graphNumbers.set(appA.phoneNumberId, { id: appB.phoneNumberId });
  await assert.rejects(h.connect(connectRequest(appA)),
    (error) => error.code === "failed-precondition" && /número diferente/.test(error.message));
  assert.equal(h.graphCalls.length, 2);
  assert.equal(h.calls.length, 0);
});

test("cadastro rejeita número fora da WABA antes de assinar ou salvar credenciais", async () => {
  const h = createHarness();
  await assert.rejects(h.connect(connectRequest(appA, { phoneNumberId: "5000003" })),
    (error) => error.code === "failed-precondition" && error.message.includes(`único ID retornado para esta WABA é ${appA.phoneNumberId}`));
  assert.equal(h.graphCalls.length, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.documents.has("whatsappNumbers/5000003"), false);
  assert.equal(h.warnings[0][1].paginasConsultadas, 1);
  assert.equal(h.warnings[0][1].numerosRetornados, 1);
  assert.equal(JSON.stringify(h.warnings).includes("test-access-token"), false);
});

test("diagnóstico conta todas as páginas quando o número não é retornado", async () => {
  const h = createHarness();
  h.graphPages.set(`${appA.wabaId}:`, {
    data: [{ id: "5000004" }, { id: 42 }, { id: "test-access-token-123456789" }],
    paging: { next: "next", cursors: { after: "cursor" } }
  });
  h.graphPages.set(`${appA.wabaId}:cursor`, { data: [] });
  await assert.rejects(h.connect(connectRequest(appA)),
    (error) => error.code === "failed-precondition" && /não retornou o Phone Number ID/.test(error.message));
  assert.equal(h.warnings[0][1].paginasConsultadas, 2);
  assert.equal(h.warnings[0][1].numerosRetornados, 3);
  assert.equal(h.calls.length, 0);
});

test("ID digitado incorretamente mostra o único ID retornado sem vincular outro número", async () => {
  const h = createHarness();
  const correctId = "8495912616936565";
  const incorrectId = "849591261693565";
  h.graphPages.set(`${appA.wabaId}:`, {
    data: [{ id: correctId }],
    paging: { next: "next", cursors: { after: "cursor" } }
  });
  h.graphPages.set(`${appA.wabaId}:cursor`, { data: [] });
  h.graphNumbers.set(correctId, { id: correctId, display_phone_number: "Número novo" });
  await assert.rejects(h.connect(connectRequest(appA, { phoneNumberId: incorrectId })),
    (error) => error.code === "failed-precondition" && error.message.includes(correctId));
  assert.equal(h.documents.has(`whatsappNumbers/${incorrectId}`), false);
  assert.equal(h.calls.length, 0);

  const result = await h.connect(connectRequest(appA, { phoneNumberId: correctId }));
  assert.equal(result.number.phoneNumberId, correctId);
  assert.equal(h.documents.get(`whatsappNumbers/${correctId}`).wabaId, appA.wabaId);
});

test("cadastro rejeita paginação inválida sem gravar credenciais", async () => {
  const h = createHarness();
  h.graphPages.set(`${appA.wabaId}:`, { data: [], paging: { next: "next", cursors: {} } });
  await assert.rejects(h.connect(connectRequest(appA)),
    (error) => error.code === "failed-precondition" && /paginação/.test(error.message));
  assert.equal(h.calls.length, 0);
});

test("cadastro aproveita secret existente sem documento do app e cria secrets ausentes", async () => {
  const h = createHarness();
  const app = { id: "4000001", phoneNumberId: "5000001", wabaId: "6000001", secret: "new-app-secret", verifyToken: "new-verify-token" };
  const existing = `${secretPrefix}golden-whatsapp-app-${app.id}-secret`;
  h.secretResources.add(existing);
  h.secrets.set(`${existing}/versions/1`, "old-app-secret");

  await h.connect(connectRequest(app));
  const saved = h.documents.get(`whatsappNumbers/_apps/apps/${app.id}`);
  assert.equal(saved.appSecretVersion, `${canonicalPrefix}golden-whatsapp-app-${app.id}-secret/versions/2`);
  assert.equal(saved.verifyTokenVersion, `${canonicalPrefix}golden-whatsapp-app-${app.id}-verify-token/versions/1`);
  assert.equal(h.calls.some((call) => call.operation === "create" && call.name === existing), false);
  assert.equal(h.calls.some((call) => call.operation === "create" && call.name.endsWith(`app-${app.id}-verify-token`)), true);
  assert.equal(h.documents.get(`whatsappNumbers/${app.phoneNumberId}`).appId, app.id);
});

test("falha ao salvar token preserva versões ativas e registra código e detalhes sem credenciais", async () => {
  const h = createHarness();
  const appPath = `whatsappNumbers/_apps/apps/${appA.id}`;
  const previous = h.documents.get(appPath);
  const request = connectRequest(appA, {
    appSecret: "updated-app-secret",
    verifyToken: "updated-verify-token"
  });
  const failure = Object.assign(new Error(`Permission denied: ${request.data.appSecret}`), {
    code: 7,
    details: `Token ${request.data.accessToken}, verificação ${request.data.verifyToken}`
  });
  h.failures.addSecretVersion = (parent) => parent.endsWith(`token-${appA.phoneNumberId}`) ? failure : null;

  await assert.rejects(h.connect(request), (error) => error.code === "failed-precondition");
  assert.equal(h.documents.get(appPath).appSecretVersion, previous.appSecretVersion);
  assert.equal(h.documents.get(appPath).verifyTokenVersion, previous.verifyTokenVersion);
  const logged = JSON.stringify(h.errors);
  assert.match(logged, /Permission denied/);
  assert.match(logged, /"code":"7"/);
  assert.match(logged, /REDACTED/);
  for (const credential of [request.data.accessToken, request.data.appSecret, request.data.verifyToken]) {
    assert.equal(logged.includes(credential), false);
  }
});
