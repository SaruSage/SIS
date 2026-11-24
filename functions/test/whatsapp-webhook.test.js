"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const project = "webhook-test";
const secretPrefix = `projects/${project}/secrets/`;

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
  const errors = [];

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
    async accessSecretVersion({ name }) {
      if (!secrets.has(name)) throw new Error(`Segredo ausente: ${name}`);
      return [{ payload: { data: Buffer.from(secrets.get(name)) } }];
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
          HttpsError: class HttpsError extends Error {}
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
    documents.set(`whatsappNumbers/_apps/apps/${app.id}`, {
      appId: app.id,
      appSecretVersion: secretName,
      verifyTokenVersion: verifyName
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

  return { documents, secrets, errors, webhook };
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
