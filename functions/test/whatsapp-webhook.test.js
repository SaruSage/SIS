"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
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
  const calls = [];
  const failures = {};
  const graphCalls = [];
  const graphPages = new Map([
    [`${appA.wabaId}:`, { data: [{ id: appA.phoneNumberId, display_phone_number: "Número A", verified_name: "Teste A" }] }],
    [`${appB.wabaId}:`, { data: [{ id: appB.phoneNumberId, display_phone_number: "Número B", verified_name: "Teste B" }] }],
    ["6000001:", { data: [{ id: "5000001", display_phone_number: "Número novo", verified_name: "Teste novo" }] }]
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

  function collection(collectionPath, filter) {
    return {
      doc: (id) => documentRef(`${collectionPath}/${id}`),
      where: (field, operator, value) => {
        assert.equal(operator, "==");
        return collection(collectionPath, { field, value });
      },
      get: async () => {
        const prefix = `${collectionPath}/`;
        const docs = [...documents.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .filter((key) => !filter || documents.get(key)[filter.field] === filter.value)
          .map(snapshot);
        return { docs, empty: docs.length === 0 };
      }
    };
  }

  const db = {
    collection,
    runTransaction: async (callback) => callback({
      get: (ref) => ref.get(),
      set: (ref, data, options) => ref.set(data, options),
      update: (ref, data) => ref.update(data)
    })
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
      case "@google-cloud/secret-manager":
        return { SecretManagerServiceClient };
      case "firebase-admin/app":
        return { initializeApp() {} };
      case "firebase-admin/firestore":
        return {
          getFirestore: () => db,
          FieldValue: { serverTimestamp: () => "server-timestamp" },
          Timestamp: { fromDate: (date) => date }
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
      graphCalls.push({ path: parsed.pathname, after: parsed.searchParams.get("after"), method: options.method || "GET" });
      const wabaId = parsed.pathname.split("/")[2];
      const body = parsed.pathname.endsWith("/phone_numbers")
        ? graphPages.get(`${wabaId}:${parsed.searchParams.get("after") || ""}`)
        : { success: true };
      return { ok: true, json: async () => body };
    },
    process: { env: { GCLOUD_PROJECT: project } },
    console: {
      warn() {},
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

  return { documents, secrets, secretResources, errors, calls, failures, graphCalls, graphPages, webhook, connect: exports.connectWhatsAppNumber };
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
    preAtendimentoEnabled: true, preAtendimentoMessage: "mensagem anterior"
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
  const newPhoneId = "5000002";
  h.graphPages.set(`${appA.wabaId}:`, {
    data: [{ id: appA.phoneNumberId, display_phone_number: "Número antigo" }],
    paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor+2" } }
  });
  h.graphPages.set(`${appA.wabaId}:cursor+2`, {
    data: [{ id: newPhoneId, display_phone_number: "Número novo", verified_name: "Nome novo" }]
  });
  const result = await h.connect(connectRequest(appA, { phoneNumberId: newPhoneId }));

  assert.equal(result.number.phoneNumberId, newPhoneId);
  assert.equal(result.number.wabaId, appA.wabaId);
  assert.equal(result.number.displayPhoneNumber, "Número novo");
  assert.equal(h.documents.get(`whatsappNumbers/${newPhoneId}`).wabaId, appA.wabaId);
  assert.equal(h.documents.get(`whatsappNumbers/${appA.phoneNumberId}`).wabaId, appA.wabaId);
  assert.equal(h.graphCalls[1].after, "cursor+2");
  assert.equal(h.graphCalls[2].path, `/v25.0/${appA.wabaId}/subscribed_apps`);
});

test("cadastro rejeita número fora da WABA antes de assinar ou salvar credenciais", async () => {
  const h = createHarness();
  await assert.rejects(h.connect(connectRequest(appA, { phoneNumberId: "5000003" })),
    (error) => error.code === "failed-precondition" && /não pertence à WABA/.test(error.message));
  assert.equal(h.graphCalls.length, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.documents.has("whatsappNumbers/5000003"), false);
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
