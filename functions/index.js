"use strict";

const crypto = require("node:crypto");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const {
  DEFAULT_INACTIVITY_MINUTES,
  findMatchingOption,
  normalizeAutomation,
  normalizeInactivityMinutes,
  renderMessage,
  shouldSendAutomaticReply,
  timestampMillis,
  validateAutomation
} = require("./whatsapp-automation");

initializeApp();

const db = getFirestore();
const REGION = "southamerica-east1";
const GRAPH_API_VERSION = "v25.0";
const META_GRAPH = "https://graph.facebook.com/" + GRAPH_API_VERSION;
const ADMIN_EMAILS = ["eamgfn4ever@gmail.com"];
const ALLOWED_SALES_ROLES = ["vendas", "administracao"];
const DAY_MS = 24 * 60 * 60 * 1000;
// Longer than the webhook's 120-second execution timeout.
const WEBHOOK_LOCK_MS = 5 * 60 * 1000;
const secretManager = new SecretManagerServiceClient();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isAdmin(request) {
  return ADMIN_EMAILS.includes(normalizeEmail(request.auth && request.auth.token.email));
}

async function assertAuthorized(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Faça login para continuar.");
  }
  if (isAdmin(request)) return;

  const email = normalizeEmail(request.auth.token.email);
  if (!email) throw new HttpsError("permission-denied", "Sua conta não tem e-mail verificado.");
  const snapshot = await db.collection("solicitacoes").get();
  const permitido = snapshot.docs.some((documento) => {
    const dados = documento.data();
    return normalizeEmail(dados.email) === email &&
      dados.status === "aprovada" &&
      ALLOWED_SALES_ROLES.includes(dados.cargo);
  });
  if (!permitido) throw new HttpsError("permission-denied", "Acesso restrito aos setores de Vendas e Administração.");
}

async function assertAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  if (isAdmin(request)) return;
  const email = normalizeEmail(request.auth.token.email);
  const snapshot = await db.collection("solicitacoes").get();
  const ehAdmin = snapshot.docs.some((documento) => {
    const dados = documento.data();
    return normalizeEmail(dados.email) === email &&
      dados.status === "aprovada" &&
      dados.cargo === "administracao";
  });
  if (!ehAdmin) {
    throw new HttpsError("permission-denied", "Somente o administrador pode alterar números vinculados e a captação.");
  }
}

function secretPath(secretId) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) throw new Error("Não foi possível determinar o projeto do Google Cloud.");
  return "projects/" + projectId + "/secrets/" + secretId;
}

async function saveSecret(secretId, value) {
  const path = secretPath(secretId);
  try {
    await secretManager.getSecret({ name: path });
  } catch (erro) {
    if (erro.code !== 5) throw erro;
    try {
      await secretManager.createSecret({
        parent: path.split("/secrets/")[0],
        secretId,
        secret: { replication: { automatic: {} } }
      });
    } catch (criacaoErro) {
      if (criacaoErro.code !== 6) throw criacaoErro;
    }
  }
  const [version] = await secretManager.addSecretVersion({
    parent: path,
    payload: { data: Buffer.from(value, "utf8") }
  });
  return version.name;
}

async function readSecret(secretId, versionName) {
  const path = secretPath(secretId);
  let name = path + "/versions/latest";
  if (versionName) {
    const match = /^projects\/([^/]+)\/secrets\/([^/]+)\/versions\/([1-9]\d*)$/.exec(versionName);
    if (!match || match[2] !== secretId) {
      throw new Error("Versão de segredo inválida para " + secretId + ".");
    }
    name = path + "/versions/" + match[3];
  }
  const [version] = await secretManager.accessSecretVersion({ name });
  if (versionName && versionName !== name && versionName !== version.name) {
    throw new Error("Versão de segredo inválida para " + secretId + ".");
  }
  if (!version.payload || !version.payload.data) throw new Error("O segredo " + secretId + " está vazio.");
  return Buffer.from(version.payload.data).toString("utf8");
}

function tokenSecretId(phoneNumberId) {
  return "golden-whatsapp-token-" + phoneNumberId;
}

function appSecretId(appId, type) {
  return "golden-whatsapp-app-" + appId + "-" + type;
}

function appRef(appId) {
  return db.collection("whatsappNumbers").doc("_apps").collection("apps").doc(appId);
}

async function readAppSecret(appId, app, type) {
  const version = type === "secret" ? app.appSecretVersion : app.verifyTokenVersion;
  if (typeof version !== "string" || !version) {
    throw new Error("Configuração de segredo incompleta para o app WhatsApp " + appId + ".");
  }
  return readSecret(appSecretId(appId, type), version);
}

async function prepareWhatsAppApp(appId, appSecret, verifyToken) {
  const [appSecretVersion, verifyTokenVersion] = await Promise.all([
    saveSecret(appSecretId(appId, "secret"), appSecret),
    saveSecret(appSecretId(appId, "verify-token"), verifyToken)
  ]);
  return { appId, appSecretVersion, verifyTokenVersion };
}

function logSecretError(erro, credentials) {
  const redact = (value) => {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    return credentials.reduce((text, credential) =>
      credential ? text.split(credential).join("[REDACTED]") : text, String(value));
  };
  console.error("Falha ao guardar credenciais no Secret Manager:", {
    code: redact(erro.code),
    message: redact(erro.message),
    details: redact(erro.details)
  });
}

function publicNumber(documento) {
  const dados = documento.data();
  return {
    phoneNumberId: documento.id,
    wabaId: dados.wabaId,
    appId: dados.appId || null,
    displayPhoneNumber: dados.displayPhoneNumber || "",
    verifiedName: dados.verifiedName || "",
    displayName: dados.displayName || "",
    active: dados.active === true,
    captureEnabled: dados.captureEnabled === true,
    preAtendimentoEnabled: dados.preAtendimentoEnabled === true,
    preAtendimentoMessage: dados.preAtendimentoMessage || "",
    botMessages: Array.isArray(dados.botMessages) ? dados.botMessages : [],
    activeBotMessageId: dados.activeBotMessageId || "",
    onlyRecipientInitiated: dados.onlyRecipientInitiated !== false,
    inactivityMinutes: Number.isInteger(dados.inactivityMinutes) ? dados.inactivityMinutes : DEFAULT_INACTIVITY_MINUTES
  };
}

async function loadActiveNumber(phoneNumberId) {
  const snapshot = await db.collection("whatsappNumbers").doc(String(phoneNumberId || "")).get();
  if (!snapshot.exists || snapshot.data().active !== true) {
    throw new HttpsError("failed-precondition", "Este número não está vinculado ou foi desativado.");
  }
  return { id: snapshot.id, ...snapshot.data() };
}

async function graphRequest(url, accessToken, options) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + accessToken,
        ...(options && options.headers ? options.headers : {})
      },
      signal: AbortSignal.timeout(20000)
    });
  } catch (erro) {
    throw new Error("Não foi possível conectar à API da Meta: " + erro.message);
  }
  let body = {};
  try {
    body = await response.json();
  } catch (_) {
    body = {};
  }
  if (!response.ok) {
    const detalhe = body.error && body.error.message;
    const codigo = body.error && body.error.code;
    throw new Error("Meta Graph API (" + (codigo || response.status) + "): " + (detalhe || "a solicitação foi recusada."));
  }
  return body;
}

async function findWhatsAppNumber(wabaId, phoneNumberId, accessToken) {
  const seenCursors = new Set();
  let after = "";
  let paginasConsultadas = 0;
  let numerosRetornados = 0;
  let unicoId = null;
  do {
    const url = META_GRAPH + "/" + wabaId +
      "/phone_numbers?fields=id&limit=100" +
      (after ? "&after=" + encodeURIComponent(after) : "");
    const page = await graphRequest(url, accessToken);
    if (!Array.isArray(page.data)) throw new Error("A Meta retornou uma lista de números inválida.");
    paginasConsultadas++;
    numerosRetornados += page.data.length;
    if (numerosRetornados === 1 && page.data.length === 1) {
      const id = page.data[0] && page.data[0].id;
      if (typeof id === "string" && /^\d{6,25}$/.test(id)) unicoId = id;
    } else if (numerosRetornados > 1) {
      unicoId = null;
    }
    const number = page.data.find((item) => item && item.id === phoneNumberId);
    if (number) return number;
    if (!page.paging || !page.paging.next) {
      console.warn("A Meta não retornou o número na lista da WABA.", {
        wabaId, phoneNumberId, paginasConsultadas, numerosRetornados
      });
      if (unicoId) {
        throw new HttpsError("failed-precondition", "A Meta não retornou o Phone Number ID informado. O único ID retornado para esta WABA é " + unicoId + ". Confira na Meta se ele corresponde ao número desejado.");
      }
      return null;
    }
    after = page.paging.cursors && page.paging.cursors.after;
    if (typeof after !== "string" || !after || seenCursors.has(after)) {
      throw new Error("A Meta retornou uma paginação de números inválida.");
    }
    seenCursors.add(after);
  } while (true);
}

function montarPayloadMensagem(dados) {
  if (dados.mode === "template") {
    const templateName = String(dados.templateName || "").trim();
    const templateLanguage = String(dados.templateLanguage || "pt_BR").trim();
    if (!/^[a-zA-Z0-9_]{1,512}$/.test(templateName)) {
      throw new HttpsError("invalid-argument", "Informe o nome de um modelo aprovado pela Meta.");
    }
    if (!/^[a-zA-Z0-9_-]{2,20}$/.test(templateLanguage)) {
      throw new HttpsError("invalid-argument", "O idioma do modelo é inválido.");
    }
    const rawVariables = Array.isArray(dados.templateVariables)
      ? dados.templateVariables
      : String(dados.templateVariables || "").split(/\r?\n/);
    const variables = rawVariables.map((value) => String(value).trim()).filter(Boolean);
    if (variables.length > 20 || variables.some((value) => value.length > 1024)) {
      throw new HttpsError("invalid-argument", "O modelo aceita até 20 parâmetros de texto, com no máximo 1024 caracteres cada.");
    }
    const template = { name: templateName, language: { code: templateLanguage } };
    if (variables.length) {
      template.components = [{
        type: "body",
        parameters: variables.map((text) => ({ type: "text", text }))
      }];
    }
    return {
      type: "template",
      template
    };
  }
  const text = String(dados.text || dados.message || "").trim();
  if (!text || text.length > 4096) {
    throw new HttpsError("invalid-argument", "A mensagem precisa ter entre 1 e 4096 caracteres.");
  }
  return { type: "text", text: { body: text, preview_url: false } };
}

async function sendGraphMessage(number, recipient, message) {
  const accessToken = await readSecret(tokenSecretId(number.id), number.tokenVersion);
  const response = await graphRequest(
    META_GRAPH + "/" + number.id + "/messages",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        ...message
      })
    }
  );
  const messageId = response.messages && response.messages[0] && response.messages[0].id;
  if (!messageId) throw new Error("A Meta não retornou o identificador da mensagem enviada.");
  return messageId;
}

async function getFirstColumn() {
  const snapshot = await db.collection("colunas").get();
  if (snapshot.empty) {
    throw new HttpsError("failed-precondition", "Crie uma coluna no kanban antes de iniciar uma conversa.");
  }
  const first = snapshot.docs.sort((a, b) => (a.data().ordem || 0) - (b.data().ordem || 0))[0];
  return { id: first.id, ...first.data() };
}

async function assertTextWindow(card, mode) {
  if (mode === "template") return;
  const lastInboundAt = card && card.lastInboundAt;
  const lastInboundMs = lastInboundAt && typeof lastInboundAt.toMillis === "function"
    ? lastInboundAt.toMillis()
    : 0;
  if (!lastInboundMs || Date.now() - lastInboundMs > DAY_MS) {
    throw new HttpsError(
      "failed-precondition",
      "Fora da janela de atendimento de 24 horas da Meta, somente modelos aprovados podem iniciar ou retomar a conversa."
    );
  }
}

async function recordMessage(cardId, message, messageId) {
  const ref = db.collection("cards").doc(cardId).collection("mensagensWhatsapp");
  const target = messageId ? ref.doc(messageId) : ref.doc();
  await target.set({
    ...message,
    criadoEm: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function scheduleCardJob(cardId, programacao) {
  if (!programacao || programacao.status !== "aguardando_envio" || !programacao.dataHora) return;
  const scheduledAt = timestampFrom(programacao.dataHora);
  if (!scheduledAt) return;
  const phoneNumberId = String(programacao.phoneNumberId || "");
  if (!phoneNumberId) {
    await db.collection("cards").doc(cardId).update({
      "programacao.status": "falha",
      "programacao.erro": "Selecione um número do WhatsApp antes de agendar."
    });
    return;
  }
  const jobKey = crypto.createHash("sha1")
    .update(JSON.stringify([cardId, scheduledAt.toMillis(), programacao.tipoMensagem || "text", programacao.texto || "", programacao.templateName || "", phoneNumberId]))
    .digest("hex").slice(0, 24);
  await createJobIfMissing("card-" + jobKey, {
    kind: "card",
    cardId,
    phoneNumberId,
    scheduledAt,
    mode: programacao.tipoMensagem === "template" ? "template" : "text",
    text: programacao.texto || "",
    templateName: programacao.templateName || "",
    templateLanguage: programacao.templateLanguage || "pt_BR",
    templateVariables: programacao.templateVariables || [],
    status: "scheduled"
  });
}

function timestampFrom(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value.toDate === "function") return Timestamp.fromDate(value.toDate());
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Timestamp.fromDate(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

async function createJobIfMissing(id, job) {
  const ref = db.collection("whatsappJobs").doc(id);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data().status === "cancelled" && job.scheduledAt.toMillis() > Date.now()) {
        transaction.update(ref, {
          ...job,
          attempts: 0,
          erro: FieldValue.delete(),
          canceladoEm: FieldValue.delete(),
          atualizadoEm: FieldValue.serverTimestamp()
        });
      }
      return;
    }
    transaction.create(ref, {
      ...job,
      attempts: 0,
      criadoEm: FieldValue.serverTimestamp()
    });
  });
}

async function cancelScheduledJobsForCard(cardId, kind, columnId, scheduledAtMillis) {
  const snapshot = await db.collection("whatsappJobs").where("cardId", "==", cardId).get();
  const batch = db.batch();
  let count = 0;
  snapshot.docs.forEach((job) => {
    const dados = job.data();
    if (dados.status !== "scheduled" || (kind && dados.kind !== kind) ||
      (columnId && dados.columnId !== columnId) ||
      (scheduledAtMillis && (!dados.scheduledAt || dados.scheduledAt.toMillis() !== scheduledAtMillis))) return;
    batch.update(job.ref, { status: "cancelled", canceladoEm: FieldValue.serverTimestamp() });
    count += 1;
  });
  if (count) await batch.commit();
}

async function scheduleColumnJobs(columnId, column, cardDocuments) {
  const config = column.configFuncionaria || {};
  const scheduledAt = timestampFrom(config.dataHoraColuna);
  if (!scheduledAt || scheduledAt.toMillis() <= Date.now() ||
      !config.mensagemWhatsapp && !config.templateName ||
      !config.phoneNumberId) return;
  const mode = config.tipoMensagem === "template" ? "template" : "text";
  for (const cardDocument of cardDocuments) {
    const card = cardDocument.data();
    if (card.excluido || card.colunaId !== columnId || !card.telefone) continue;
    const jobKey = crypto.createHash("sha1")
      .update(JSON.stringify([columnId, cardDocument.id, scheduledAt.toMillis(), mode, config.mensagemWhatsapp || "", config.templateName || "", config.phoneNumberId]))
      .digest("hex").slice(0, 24);
    await createJobIfMissing("column-" + jobKey, {
      kind: "column",
      cardId: cardDocument.id,
      columnId,
      phoneNumberId: String(config.phoneNumberId),
      scheduledAt,
      mode,
      text: config.mensagemWhatsapp || "",
      templateName: config.templateName || "",
      templateLanguage: config.templateLanguage || "pt_BR",
      templateVariables: config.templateVariables || [],
      status: "scheduled"
    });
  }
}

async function syncColumnJobs(columnId) {
  const columnSnapshot = await db.collection("colunas").doc(columnId).get();
  if (!columnSnapshot.exists) return;
  const cards = await db.collection("cards").where("colunaId", "==", columnId).get();
  const active = cards.docs.filter((card) => !card.data().excluido);
  await scheduleColumnJobs(columnId, columnSnapshot.data(), active);
}

async function moveCardAfterDelivery(cardId) {
  const cardRef = db.collection("cards").doc(cardId);
  const result = await db.runTransaction(async (transaction) => {
    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists) return null;
    const card = cardSnapshot.data();
    const columnRef = db.collection("colunas").doc(card.colunaId);
    const columnSnapshot = await transaction.get(columnRef);
    if (!columnSnapshot.exists || columnSnapshot.data().tipo !== "funcionaria") return null;
    const column = columnSnapshot.data();
    const config = column.configFuncionaria || {};
    if (!config.colunaDestinoId) return null;
    const needsColumn = config.moverAposMensagemColuna !== false;
    const needsCard = config.moverAposMensagemCard === true;
    const columnSent = !!card.entregaColunaEm;
    const cardSent = !!(card.programacao && card.programacao.status === "enviado");
    if ((needsColumn && !columnSent) || (needsCard && !cardSent)) return null;

    const destinationRef = db.collection("colunas").doc(config.colunaDestinoId);
    const destinationSnapshot = await transaction.get(destinationRef);
    if (!destinationSnapshot.exists) return null;
    transaction.update(cardRef, {
      colunaId: destinationRef.id,
      entregaColunaEm: null,
      ultimaAtividade: FieldValue.serverTimestamp()
    });
    return {
      card,
      fromId: columnRef.id,
      fromName: column.nome || "—",
      toId: destinationRef.id,
      toName: destinationSnapshot.data().nome || "—"
    };
  });
  if (!result) return;
  const event = {
    tipo: "movimentacao",
    cardId,
    cardResumo: result.card.nomeConta || "—",
    colunaOrigemId: result.fromId,
    colunaDestinoId: result.toId,
    automatico: true,
    autor: null,
    detalhes: { de: result.fromName, para: result.toName },
    timestamp: FieldValue.serverTimestamp()
  };
  await Promise.all([
    db.collection("cards").doc(cardId).collection("historico").add({
      tipo: "movimentacao",
      automatico: true,
      diretrizDe: null,
      autor: null,
      detalhes: { de: result.fromName, para: result.toName },
      timestamp: FieldValue.serverTimestamp()
    }),
    db.collection("colunas").doc(result.fromId).collection("historico").add({ ...event, tipo: "saida" }),
    db.collection("colunas").doc(result.toId).collection("historico").add({ ...event, tipo: "entrada" })
  ]);
}

async function processScheduledJob(jobSnapshot) {
  const jobRef = jobSnapshot.ref;
  const claimed = await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(jobRef);
    if (!latest.exists) return null;
    const current = latest.data();
    if (current.status === "accepted" ||
        (current.status === "finalizing" && current.lockedAt &&
          Date.now() - current.lockedAt.toMillis() > 10 * 60 * 1000)) {
      transaction.update(jobRef, {
        status: "finalizing",
        lockedAt: FieldValue.serverTimestamp()
      });
      return { ...current, accepted: true };
    }
    const staleSending = current.status === "sending" && current.lockedAt &&
      Date.now() - current.lockedAt.toMillis() > 10 * 60 * 1000;
    if (current.status !== "scheduled" && !staleSending) return null;
    const attempts = Number(current.attempts || 0) + 1;
    transaction.update(jobRef, {
      status: "sending",
      attempts,
      iniciadoEm: FieldValue.serverTimestamp(),
      lockedAt: FieldValue.serverTimestamp(),
      erro: FieldValue.delete()
    });
    return { ...current, attempts, accepted: false };
  });
  if (!claimed) return;

  let apiMessageId = claimed.accepted ? claimed.apiMessageId : null;
  try {
    const cardRef = db.collection("cards").doc(claimed.cardId);
    const cardSnapshot = await cardRef.get();
    if (!cardSnapshot.exists || (cardSnapshot.data().excluido && !claimed.accepted)) {
      throw new Error("O card não existe mais ou foi excluído.");
    }
    const card = cardSnapshot.data();
    if (!claimed.accepted && claimed.kind === "column" && card.colunaId !== claimed.columnId) {
      await jobRef.update({ status: "cancelled", erro: "O card saiu da coluna antes do envio." });
      return;
    }
    const number = claimed.accepted
      ? { id: claimed.phoneNumberId }
      : await loadActiveNumber(claimed.phoneNumberId);
    const payload = montarPayloadMensagem(claimed);
    if (!claimed.accepted) {
      await assertTextWindow(card, claimed.mode);
      apiMessageId = await sendGraphMessage(number, normalizePhone(card.telefone), payload);
    }
    if (!claimed.accepted) {
      await jobRef.update({
        status: "accepted",
        apiMessageId,
        aceitoPelaMetaEm: FieldValue.serverTimestamp(),
        lockedAt: FieldValue.serverTimestamp()
      });
    }
    await recordMessage(claimed.cardId, {
      direction: "outgoing",
      type: payload.type,
      text: payload.type === "text" ? payload.text.body : "Modelo: " + payload.template.name,
      apiMessageId,
      status: "sent",
      phoneNumberId: number.id,
      automatico: true,
      origem: claimed.kind
    }, apiMessageId);
    const cardUpdate = {
      ultimaAtividade: FieldValue.serverTimestamp(),
      whatsappLastOutboundAt: FieldValue.serverTimestamp(),
      whatsappPhoneNumberId: number.id
    };
    if (claimed.kind === "card") {
      const programacaoSemErro = { ...(card.programacao || {}) };
      delete programacaoSemErro.erro;
      cardUpdate.programacao = {
        ...programacaoSemErro,
        status: "enviado",
        enviadoEm: FieldValue.serverTimestamp(),
        apiMessageId
      };
    } else {
      cardUpdate.entregaColunaEm = FieldValue.serverTimestamp();
      cardUpdate.entregaColunaErro = FieldValue.delete();
    }
    await cardRef.update(cardUpdate);
    await jobRef.update({
      status: "sent",
      apiMessageId,
      enviadoEm: FieldValue.serverTimestamp()
    });
    await moveCardAfterDelivery(claimed.cardId);
  } catch (erro) {
    if (claimed.accepted || apiMessageId) {
      await jobRef.update({
        status: "accepted",
        apiMessageId,
        erro: erro.message || "Falha ao atualizar o kanban após a aceitação da Meta.",
        atualizadoEm: FieldValue.serverTimestamp()
      }).catch((erroAtualizacao) => {
        console.error("Não foi possível registrar que a mensagem aceita está pendente de sincronização:", erroAtualizacao.message);
      });
      return;
    }
    const canRetry = claimed.attempts < 4 &&
      /429|5\d\d|\((4|17|32|613|80007)\)|conectar à API|timed out|timeout|aborted|network|fetch failed/i.test(erro.message || "");
    const update = {
      status: canRetry ? "scheduled" : "failed",
      erro: erro.message || "Falha ao enviar mensagem.",
      atualizadoEm: FieldValue.serverTimestamp()
    };
    if (canRetry) update.scheduledAt = Timestamp.fromMillis(Date.now() + Math.min(claimed.attempts * 60000, 10 * 60000));
    await jobRef.update(update);
    const cardRef = db.collection("cards").doc(claimed.cardId);
    if (claimed.kind === "card") {
      await cardRef.update({
        "programacao.status": canRetry ? "aguardando_envio" : "falha",
        "programacao.erro": update.erro,
        ultimaAtividade: FieldValue.serverTimestamp()
      }).catch((erroAtualizacao) => {
        console.error("Não foi possível atualizar o card após a falha do envio:", erroAtualizacao.message);
      });
    } else {
      await cardRef.update({ entregaColunaErro: update.erro }).catch((erroAtualizacao) => {
        console.error("Não foi possível exibir a falha do envio da coluna:", erroAtualizacao.message);
      });
    }
  }
}

async function firstColumnId() {
  const snapshot = await db.collection("colunas").get();
  if (snapshot.empty) return null;
  return snapshot.docs.sort((a, b) => (a.data().ordem || 0) - (b.data().ordem || 0))[0].id;
}

exports.getWhatsAppConnections = onCall({ region: REGION }, async (request) => {
  await assertAuthorized(request);
  const snapshot = await db.collection("whatsappNumbers").get();
  return { numbers: snapshot.docs.map(publicNumber).sort((a, b) => a.displayPhoneNumber.localeCompare(b.displayPhoneNumber)) };
});

exports.connectWhatsAppNumber = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  await assertAdmin(request);
  const phoneNumberId = String(request.data.phoneNumberId || "").trim();
  const wabaId = String(request.data.wabaId || "").trim();
  const appId = String(request.data.appId || "").trim();
  const accessToken = String(request.data.accessToken || "").trim();
  const appSecret = String(request.data.appSecret || "").trim();
  const verifyToken = String(request.data.verifyToken || "").trim();
  const displayName = request.data.displayName;
  if (displayName !== undefined && (typeof displayName !== "string" ||
      !displayName.trim() || displayName.trim().length > 100)) {
    throw new HttpsError("invalid-argument", "Informe um nome com até 100 caracteres.");
  }
  if (!/^\d{6,25}$/.test(phoneNumberId) || !/^\d{6,25}$/.test(wabaId)) {
    throw new HttpsError("invalid-argument", "Informe o Phone Number ID e o WABA ID válidos.");
  }
  if (appId && !/^\d{6,25}$/.test(appId)) {
    throw new HttpsError("invalid-argument", "Informe um App ID válido.");
  }
  if (accessToken.length < 20 || appSecret.length < 10 || verifyToken.length < 8) {
    throw new HttpsError("invalid-argument", "Confira o token de acesso, o App Secret e o token de verificação.");
  }

  const numberRef = db.collection("whatsappNumbers").doc(phoneNumberId);
  const existingNumber = await numberRef.get();
  if (existingNumber.exists && existingNumber.data().appId &&
      existingNumber.data().appId !== appId) {
    throw new HttpsError("failed-precondition", "Este número já está vinculado a outro app. Informe o App ID cadastrado.");
  }

  let metaNumber;
  try {
    const linkedNumber = await findWhatsAppNumber(wabaId, phoneNumberId, accessToken);
    if (!linkedNumber) {
      throw new HttpsError("failed-precondition", "A Meta não retornou o Phone Number ID na lista da WABA para este token. Confira os IDs e o acesso do token à conta e ao número.");
    }
    metaNumber = await graphRequest(
      META_GRAPH + "/" + phoneNumberId + "?fields=id,display_phone_number,verified_name",
      accessToken
    );
    if (metaNumber.id !== phoneNumberId) {
      throw new Error("A Meta retornou dados de um número diferente do informado.");
    }
    await graphRequest(
      META_GRAPH + "/" + wabaId + "/subscribed_apps",
      accessToken,
      { method: "POST" }
    );
  } catch (erro) {
    if (erro instanceof HttpsError) throw erro;
    throw new HttpsError("failed-precondition", "A Meta recusou o vínculo: " + erro.message);
  }

  let tokenVersion;
  let appData;
  try {
    if (appId) {
      appData = await prepareWhatsAppApp(appId, appSecret, verifyToken);
      tokenVersion = await saveSecret(tokenSecretId(phoneNumberId), accessToken);
    } else {
      await Promise.all([
        saveSecret(tokenSecretId(phoneNumberId), accessToken),
        saveSecret("golden-whatsapp-app-secret", appSecret),
        saveSecret("golden-whatsapp-verify-token", verifyToken)
      ]);
    }
  } catch (erro) {
    logSecretError(erro, [accessToken, appSecret, verifyToken].sort((a, b) => b.length - a.length));
    if (erro instanceof HttpsError) throw erro;
    throw new HttpsError(
      "failed-precondition",
      "O número foi validado pela Meta, mas não foi possível proteger as credenciais no Secret Manager. Verifique as permissões da conta de execução das Functions."
    );
  }

  const defaultNumberData = {
    wabaId,
    ...(appId ? { appId, tokenVersion } : {}),
    displayPhoneNumber: metaNumber.display_phone_number || "",
    verifiedName: metaNumber.verified_name || "",
    active: true,
    captureEnabled: true,
    preAtendimentoEnabled: false,
    criadoPor: request.auth.uid,
    atualizadoEm: FieldValue.serverTimestamp()
  };
  const numberData = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(numberRef);
    if (current.exists && current.data().appId && current.data().appId !== appId) {
      throw new HttpsError("failed-precondition", "Este número já está vinculado a outro app. Informe o App ID cadastrado.");
    }
    const appDocument = appId ? appRef(appId) : null;
    const currentApp = appDocument ? await transaction.get(appDocument) : null;
    const data = { ...defaultNumberData };
    if (appId && current.exists) {
      const previous = current.data();
      for (const field of [
        "active", "captureEnabled", "preAtendimentoEnabled", "preAtendimentoMessage",
        "displayName", "botMessages", "activeBotMessageId", "onlyRecipientInitiated", "inactivityMinutes", "criadoPor"
      ]) {
        if (previous[field] !== undefined) data[field] = previous[field];
      }
    }
    if (displayName !== undefined) data.displayName = displayName.trim();
    if (appDocument) {
      transaction.set(appDocument, {
        ...appData,
        ...(!currentApp.exists ? { criadoEm: FieldValue.serverTimestamp() } : {}),
        atualizadoEm: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    transaction.set(numberRef, data, { merge: true });
    return data;
  });
  return {
    number: publicNumber({
      id: phoneNumberId,
      data: () => numberData
    })
  };
});

exports.updateWhatsAppNumber = onCall({ region: REGION }, async (request) => {
  await assertAdmin(request);
  const phoneNumberId = String(request.data.phoneNumberId || "");
  const ref = db.collection("whatsappNumbers").doc(phoneNumberId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Número não encontrado.");
  if (request.data.action === "capture") {
    await ref.update({
      captureEnabled: request.data.captureEnabled === true,
      atualizadoEm: FieldValue.serverTimestamp()
    });
    return { success: true, number: publicNumber(await ref.get()) };
  }
  if (request.data.action === "active") {
    if (typeof request.data.active !== "boolean") {
      throw new HttpsError("invalid-argument", "Informe um estado de ativação válido.");
    }
    await ref.update({ active: request.data.active, atualizadoEm: FieldValue.serverTimestamp() });
    return { success: true, number: publicNumber(await ref.get()) };
  }
  if (request.data.action === "name") {
    if (typeof request.data.displayName !== "string" ||
        !request.data.displayName.trim() || request.data.displayName.trim().length > 100) {
      throw new HttpsError("invalid-argument", "Informe um nome com até 100 caracteres.");
    }
    await ref.update({ displayName: request.data.displayName.trim(), atualizadoEm: FieldValue.serverTimestamp() });
    return { success: true, number: publicNumber(await ref.get()) };
  }
  if (request.data.action !== "remove") {
    throw new HttpsError("invalid-argument", "Ação de administração inválida.");
  }

  const jobs = await db.collection("whatsappJobs").where("phoneNumberId", "==", phoneNumberId).get();
  const batch = db.batch();
  jobs.docs.forEach((job) => {
    if (job.data().status === "scheduled") batch.update(job.ref, { status: "cancelled", erro: "O número foi removido." });
  });
  batch.update(ref, {
    active: false,
    captureEnabled: false,
    atualizadoEm: FieldValue.serverTimestamp()
  });
  await batch.commit();
  try {
    await secretManager.deleteSecret({ name: secretPath(tokenSecretId(phoneNumberId)) });
  } catch (erro) {
    if (erro.code !== 5) {
      console.error("Falha ao remover credencial do Secret Manager:", erro.message);
      throw new HttpsError("internal", "Não foi possível remover com segurança o token do número.");
    }
  }
  await ref.delete();
  return { success: true };
});

exports.checkWhatsAppNumberStatus = onCall({ region: REGION, timeoutSeconds: 30 }, async (request) => {
  await assertAuthorized(request);
  const phoneNumberId = String(request.data.phoneNumberId || "");
  if (!/^\d{6,25}$/.test(phoneNumberId)) {
    throw new HttpsError("invalid-argument", "Informe um Phone Number ID válido.");
  }
  const snapshot = await db.collection("whatsappNumbers").doc(phoneNumberId).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Número não encontrado.");
  try {
    const token = await readSecret(tokenSecretId(phoneNumberId), snapshot.data().tokenVersion);
    const result = await graphRequest(META_GRAPH + "/" + phoneNumberId + "?fields=id", token);
    if (!result || result.id !== phoneNumberId) throw new Error("A Meta retornou um número diferente.");
    return { operational: true };
  } catch (erro) {
    console.error("Falha na verificação de comunicação do número WhatsApp:", phoneNumberId, erro.message);
    return { operational: false };
  }
});

exports.saveWhatsAppSettings = onCall({ region: REGION }, async (request) => {
  await assertAuthorized(request);
  const number = await loadActiveNumber(request.data.phoneNumberId);
  const enabled = request.data.preAtendimentoEnabled === true;
  const message = String(request.data.preAtendimentoMessage || "").trim();
  if (enabled && !number.captureEnabled) {
    throw new HttpsError("failed-precondition", "Ative a captação deste número antes de ativar o pré-atendimento.");
  }
  if (enabled && (!message || message.length > 1000)) {
    throw new HttpsError("invalid-argument", "A mensagem do pré-atendimento precisa ter entre 1 e 1000 caracteres.");
  }
  await db.collection("whatsappNumbers").doc(number.id).update({
    preAtendimentoEnabled: enabled,
    preAtendimentoMessage: message,
    atualizadoEm: FieldValue.serverTimestamp()
  });
  return { success: true };
});

exports.saveWhatsAppAutomation = onCall({ region: REGION }, async (request) => {
  await assertAuthorized(request);
  const data = request.data || {};
  const phoneNumberId = String(data.phoneNumberId || "").trim();
  if (!/^\d{6,25}$/.test(phoneNumberId) ||
      typeof data.onlyRecipientInitiated !== "boolean" ||
      typeof data.activeBotMessageId !== "string") {
    throw new HttpsError("invalid-argument", "Confira a configuração da automação.");
  }
  const numberRef = db.collection("whatsappNumbers").doc(phoneNumberId);
  if (!(await numberRef.get()).exists) throw new HttpsError("not-found", "Número não encontrado.");
  let messages;
  let inactivityMinutes;
  try {
    validateAutomation(data.botMessages, data.activeBotMessageId);
    messages = normalizeAutomation(data.botMessages);
    if (data.inactivityMinutes !== undefined) {
      inactivityMinutes = normalizeInactivityMinutes(data.inactivityMinutes);
    }
  } catch (erro) {
    throw new HttpsError("invalid-argument", erro.message);
  }
  if (Buffer.byteLength(JSON.stringify(messages), "utf8") > 800000) {
    throw new HttpsError("invalid-argument", "As mensagens excedem o limite de armazenamento.");
  }
  const columnIds = [...new Set(messages.flatMap((message) =>
    message.blocks.filter((block) => block.type !== "text").map((block) => block.columnId)
  ))];
  if (columnIds.length > 100) throw new HttpsError("invalid-argument", "Há colunas demais na configuração.");
  const columns = await Promise.all(columnIds.map((id) => db.collection("colunas").doc(id).get()));
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "text") continue;
      const column = columnsById.get(block.columnId);
      if (!column || !column.exists || typeof column.data().nome !== "string" || !column.data().nome.endsWith("*")) {
        throw new HttpsError("failed-precondition", "Selecione uma coluna existente terminada em *.");
      }
      block.columnName = column.data().nome;
    }
  }
  await numberRef.update({
    botMessages: messages,
    activeBotMessageId: data.activeBotMessageId,
    onlyRecipientInitiated: data.onlyRecipientInitiated,
    ...(inactivityMinutes !== undefined ? { inactivityMinutes } : {}),
    atualizadoEm: FieldValue.serverTimestamp()
  });
  return { number: publicNumber(await numberRef.get()) };
});

exports.sendWhatsAppMessage = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  await assertAuthorized(request);
  const data = request.data || {};
  const phoneNumberId = String(data.phoneNumberId || "");
  const number = await loadActiveNumber(phoneNumberId);
  const payload = montarPayloadMensagem(data);
  const cardId = String(data.cardId || "");
  const phone = normalizePhone(data.telefone || data.phone || "");
  let card = null;
  let cardRef = null;
  if (cardId) {
    cardRef = db.collection("cards").doc(cardId);
    const cardSnapshot = await cardRef.get();
    if (!cardSnapshot.exists || cardSnapshot.data().excluido) {
      throw new HttpsError("not-found", "Conversa ou card não encontrado.");
    }
    card = cardSnapshot.data();
    if (!phone) {
      const cardPhone = normalizePhone(card.telefone);
      if (!/^\d{8,15}$/.test(cardPhone)) throw new HttpsError("failed-precondition", "O card não tem um telefone válido.");
    }
  }
  const recipient = phone || normalizePhone(card.telefone);
  if (!/^\d{8,15}$/.test(recipient)) {
    throw new HttpsError("invalid-argument", "Informe um telefone com código do país e DDD.");
  }
  await assertTextWindow(card, payload.type === "template" ? "template" : "text");

  let firstColumn = null;
  if (!card) firstColumn = await getFirstColumn();
  let apiMessageId;
  try {
    apiMessageId = await sendGraphMessage(number, recipient, payload);
  } catch (erro) {
    throw new HttpsError("failed-precondition", erro.message);
  }

  if (!card) {
    const now = FieldValue.serverTimestamp();
    const dataCard = {
      colunaId: firstColumn.id,
      nomeConta: String(data.nome || "").trim() || recipient,
      telefone: recipient,
      descricao: "Conversa iniciada pela equipe via WhatsApp Business.",
      iniciadoEm: now,
      criadoEm: now,
      ultimaAtividade: now,
      status: "ativa",
      excluido: false,
      whatsappPhoneNumberId: number.id,
      criadoPor: { uid: request.auth.uid, email: request.auth.token.email || "" }
    };
    cardRef = await db.collection("cards").add(dataCard);
    card = { ...dataCard, nomeConta: dataCard.nomeConta };
    await db.collection("colunas").doc(firstColumn.id).collection("historico").add({
      tipo: "entrada",
      cardId: cardRef.id,
      cardResumo: card.nomeConta,
      automatico: true,
      timestamp: FieldValue.serverTimestamp()
    });
  }
  await recordMessage(cardRef.id, {
    direction: "outgoing",
    type: payload.type,
    text: payload.type === "text" ? payload.text.body : "Modelo: " + payload.template.name,
    apiMessageId,
    status: "sent",
    phoneNumberId: number.id,
    automatico: false
  }, apiMessageId);
  await cardRef.update({
    whatsappPhoneNumberId: number.id,
    ultimaAtividade: FieldValue.serverTimestamp(),
    whatsappLastOutboundAt: FieldValue.serverTimestamp()
  });
  return { success: true, cardId: cardRef.id, apiMessageId };
});

exports.scheduleWhatsAppMessage = onCall({ region: REGION }, async (request) => {
  await assertAuthorized(request);
  const data = request.data || {};
  const cardId = String(data.cardId || "");
  const number = await loadActiveNumber(data.phoneNumberId);
  const payload = montarPayloadMensagem(data);
  const scheduledAt = timestampFrom(data.scheduledAt);
  if (!scheduledAt || scheduledAt.toMillis() < Date.now() + 60000 ||
      scheduledAt.toMillis() > Date.now() + 365 * DAY_MS) {
    throw new HttpsError("invalid-argument", "Agende o envio para pelo menos um minuto no futuro e para no máximo um ano.");
  }
  const cardRef = db.collection("cards").doc(cardId);
  const cardSnapshot = await cardRef.get();
  if (!cardSnapshot.exists || cardSnapshot.data().excluido) throw new HttpsError("not-found", "Conversa ou card não encontrado.");
  const card = cardSnapshot.data();
  if (!/^\d{8,15}$/.test(normalizePhone(card.telefone))) throw new HttpsError("failed-precondition", "O card não tem um telefone válido.");

  const programacao = {
    texto: payload.type === "text" ? payload.text.body : "",
    tipoMensagem: payload.type,
    templateName: payload.type === "template" ? payload.template.name : "",
    templateLanguage: payload.type === "template" ? payload.template.language.code : "pt_BR",
    templateVariables: payload.type === "template" ? (payload.template.components || []).flatMap((component) =>
      (component.parameters || []).map((parameter) => parameter.text)
    ) : [],
    phoneNumberId: number.id,
    dataHora: scheduledAt,
    status: "aguardando_envio",
    programadoPor: {
      uid: request.auth.uid,
      email: request.auth.token.email || ""
    }
  };
  await cancelScheduledJobsForCard(cardId, "card");
  await cardRef.update({
    programacao,
    whatsappPhoneNumberId: number.id,
    ultimaAtividade: FieldValue.serverTimestamp()
  });
  await cardRef.collection("historico").add({
    tipo: "programacao",
    automatico: false,
    autor: { uid: request.auth.uid, email: request.auth.token.email || "" },
    detalhes: { dataHora: scheduledAt.toDate().toLocaleString("pt-BR") },
    timestamp: FieldValue.serverTimestamp()
  });
  await scheduleCardJob(cardId, programacao);
  return { success: true };
});

exports.getWhatsAppMessages = onCall({ region: REGION }, async (request) => {
  await assertAuthorized(request);
  const cardId = String(request.data.cardId || "");
  const cardSnapshot = await db.collection("cards").doc(cardId).get();
  if (!cardSnapshot.exists) throw new HttpsError("not-found", "Conversa não encontrada.");
  const snapshot = await db.collection("cards").doc(cardId)
    .collection("mensagensWhatsapp").orderBy("criadoEm", "desc").limit(100).get();
  return {
    messages: snapshot.docs.map((documento) => {
      const dados = documento.data();
      return {
        id: documento.id,
        direction: dados.direction || "incoming",
        type: dados.type || "text",
        text: dados.text || "",
        status: dados.status || "",
        timestamp: dados.criadoEm && dados.criadoEm.toMillis ? dados.criadoEm.toMillis() : null
      };
    }).reverse()
  };
});

async function handleInboundMessage(numberId, message, contact, numberData) {
  const sender = normalizePhone(message.from);
  if (!/^\d{8,15}$/.test(sender)) return;
  const receivedDate = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
  const receivedAt = Timestamp.fromDate(Number.isNaN(receivedDate.getTime()) ? new Date() : receivedDate);
  const receivedAtMs = receivedAt.toMillis();
  const messageText = message.text && message.text.body
    ? message.text.body
    : message.type === "image" ? "[Imagem recebida]"
      : message.type === "audio" ? "[Áudio recebido]"
        : message.type === "video" ? "[Vídeo recebido]"
          : message.type === "document" ? "[Documento recebido]"
            : "[Mensagem " + String(message.type || "recebida") + "]";
  const activeBotMessage = Array.isArray(numberData.botMessages)
    ? numberData.botMessages.find((item) => item && item.id === numberData.activeBotMessageId)
    : null;
  const hasActiveBotMessage = !!activeBotMessage;
  const automaticText = activeBotMessage ? renderMessage(activeBotMessage.blocks) : "";
  const matchingOption = message.type === "text"
    ? findMatchingOption(activeBotMessage, message.text && message.text.body)
    : null;
  const legacyReply = !hasActiveBotMessage &&
    numberData.preAtendimentoEnabled === true &&
    typeof numberData.preAtendimentoMessage === "string" &&
    numberData.preAtendimentoMessage.trim()
      ? numberData.preAtendimentoMessage
      : "";
  const conversationId = crypto.createHash("sha256")
    .update(numberId + ":" + sender)
    .digest("hex");
  const conversationRef = db.collection("whatsappWebhookEvents").doc("conversation-" + conversationId);
  const eventRef = db.collection("whatsappWebhookEvents").doc(message.id);
  const owner = crypto.randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    const event = eventSnapshot.exists ? eventSnapshot.data() : {};
    if (event.processed === true || event.state === "completed") return "completed";
    if (event.state === "processing" && event.lockExpiresAt &&
        event.lockExpiresAt.toMillis() > Date.now()) return "busy";
    transaction.set(eventRef, {
      processed: false,
      state: "processing",
      lockOwner: owner,
      lockExpiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_LOCK_MS),
      atualizadoEm: FieldValue.serverTimestamp()
    }, { merge: true });
    return "claimed";
  });
  if (claim === "completed") return;
  if (claim === "busy") throw new Error("Evento WhatsApp já está em processamento.");

  try {
    const candidates = await db.collection("cards")
      .where("whatsappPhoneNumberId", "==", numberId).get();
    const candidate = candidates.docs.find((documento) =>
      normalizePhone(documento.data().telefone) === sender &&
      !documento.data().excluido &&
      documento.data().status !== "perdida" &&
      documento.data().status !== "finalizada"
    ) || null;
    const legacyOutbound = candidate && !candidate.data().whatsappLastOutboundAt
      ? await db.collection("cards").doc(candidate.id).collection("mensagensWhatsapp")
        .where("direction", "==", "outgoing")
        .get()
      : null;
    const legacyOutboundAt = legacyOutbound
      ? legacyOutbound.docs.reduce((latest, document) =>
        timestampMillis(document.data().criadoEm) > timestampMillis(latest)
          ? document.data().criadoEm
          : latest, null)
      : null;
    const newCardRef = db.collection("cards").doc();
    const firstColumn = candidate ? null : await firstColumnId();
    const initialColumnRef = firstColumn ? db.collection("colunas").doc(firstColumn) : null;
    const routeColumnId = matchingOption && typeof matchingOption.columnId === "string"
      ? matchingOption.columnId.trim()
      : "";
    const routeColumnRef = routeColumnId
      ? db.collection("colunas").doc(routeColumnId)
      : null;
    const result = await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      const conversationSnapshot = await transaction.get(conversationRef);
      const event = eventSnapshot.data();
      if (!event || event.state !== "processing" || event.lockOwner !== owner) {
        throw new Error("A trava do evento WhatsApp foi perdida.");
      }
      const mappedCardId = conversationSnapshot.exists && conversationSnapshot.data().cardId;
      const mappedCardRef = mappedCardId ? db.collection("cards").doc(mappedCardId) : null;
      const mappedCardSnapshot = mappedCardRef ? await transaction.get(mappedCardRef) : null;
      const candidateSnapshot = candidate &&
        (!mappedCardRef || candidate.id !== mappedCardRef.id)
          ? await transaction.get(candidate.ref)
          : null;
      const isEligibleCard = (snapshot) => snapshot && snapshot.exists &&
        !snapshot.data().excluido &&
        normalizePhone(snapshot.data().telefone) === sender &&
        snapshot.data().whatsappPhoneNumberId === numberId &&
        snapshot.data().status !== "perdida" &&
        snapshot.data().status !== "finalizada";
      const useMappedCard = isEligibleCard(mappedCardSnapshot);
      const useCandidate = !useMappedCard && isEligibleCard(
        candidateSnapshot || (candidate && mappedCardRef && candidate.id === mappedCardRef.id
          ? mappedCardSnapshot
          : null)
      );
      const ref = useMappedCard
        ? mappedCardRef
        : useCandidate
          ? candidate.ref
          : newCardRef;
      const cardSnapshot = useMappedCard
        ? mappedCardSnapshot
        : useCandidate
          ? candidateSnapshot || mappedCardSnapshot
          : null;
      const isNewCard = !cardSnapshot;
      const firstColumnSnapshot = isNewCard && initialColumnRef
        ? await transaction.get(initialColumnRef)
        : null;
      if (isNewCard && (!firstColumnSnapshot || !firstColumnSnapshot.exists)) {
        throw new Error("Crie uma coluna no kanban antes de receber conversas pelo WhatsApp.");
      }
      const routeColumnSnapshot = routeColumnRef
        ? await transaction.get(routeColumnRef)
        : null;
      const destinationColumn = routeColumnSnapshot && routeColumnSnapshot.exists &&
        typeof routeColumnSnapshot.data().nome === "string" &&
        routeColumnSnapshot.data().nome.endsWith("*")
          ? routeColumnSnapshot.data()
          : null;
      const sourceColumnId = isNewCard
        ? firstColumnSnapshot.id
        : cardSnapshot.data().colunaId;
      const shouldMove = !!destinationColumn &&
        !!sourceColumnId &&
        sourceColumnId !== routeColumnRef.id;
      const sourceColumnRef = shouldMove && !isNewCard
        ? db.collection("colunas").doc(sourceColumnId)
        : null;
      const sourceColumnSnapshot = sourceColumnRef
        ? await transaction.get(sourceColumnRef)
        : null;
      const cardId = ref.id;
      const cardData = cardSnapshot ? cardSnapshot.data() : null;
      const previousInboundAt = cardData && cardData.lastInboundAt;
      const previousOutboundAt = cardData && (
        cardData.whatsappLastOutboundAt || legacyOutboundAt
      );
      const previousAutomaticReplyAt = cardData && cardData.botRespostaEnviadaEm;
      const shouldReply = !event.replyAttempted && (
        hasActiveBotMessage
          ? !!automaticText && shouldSendAutomaticReply({
            onlyRecipientInitiated: numberData.onlyRecipientInitiated !== false,
            inactivityMinutes: numberData.inactivityMinutes,
            receivedAt,
            lastInboundAt: previousInboundAt,
            lastOutboundAt: previousOutboundAt,
            lastAutomaticReplyAt: previousAutomaticReplyAt
          })
          : !!legacyReply && (!previousAutomaticReplyAt ||
            receivedAtMs - timestampMillis(previousAutomaticReplyAt) >= DAY_MS)
      );
      const lastInboundMs = timestampMillis(previousInboundAt);
      const activity = {
        ultimaMensagemWhatsapp: messageText.slice(0, 300),
        whatsappPhoneNumberId: numberId
      };
      if (receivedAtMs >= lastInboundMs) activity.lastInboundAt = receivedAt;
      if (cardData && !cardData.whatsappLastOutboundAt && timestampMillis(legacyOutboundAt)) {
        activity.whatsappLastOutboundAt = legacyOutboundAt;
      }
      const previousUltimaAtividade = cardData && timestampMillis(cardData.ultimaAtividade);
      if (receivedAtMs >= previousUltimaAtividade) activity.ultimaAtividade = receivedAt;

      if (isNewCard) {
        const profileName = contact && contact.profile && contact.profile.name;
        const card = {
          colunaId: shouldMove ? routeColumnRef.id : firstColumnSnapshot.id,
          nomeConta: profileName || sender,
          telefone: sender,
          razaoSocial: "",
          email: "",
          descricao: "",
          valorNegociado: 0,
          iniciadoEm: receivedAt,
          criadoEm: FieldValue.serverTimestamp(),
          status: "ativa",
          excluido: false,
          origem: "whatsapp",
          criadoPor: { sistema: "whatsapp-webhook" },
          ...activity
        };
        transaction.set(ref, card);
        transaction.set(initialColumnRef.collection("historico").doc(message.id), {
          tipo: "entrada",
          cardId: ref.id,
          cardResumo: card.nomeConta,
          automatico: true,
          timestamp: FieldValue.serverTimestamp()
        });
      } else {
        const cardUpdate = { ...activity };
        if (shouldMove) {
          cardUpdate.colunaId = routeColumnRef.id;
          cardUpdate.entregaColunaEm = null;
          cardUpdate.programacao = null;
        }
        if (shouldReply) {
          cardUpdate.botRespostaEnviadaEm = Timestamp.fromMillis(Date.now());
        }
        transaction.update(ref, cardUpdate);
      }
      transaction.set(ref.collection("mensagensWhatsapp").doc(message.id), {
        direction: "incoming",
        type: message.type || "text",
        text: messageText,
        apiMessageId: message.id,
        phoneNumberId: numberId,
        status: "received",
        criadoEm: receivedAt
      });
      if (isNewCard && shouldReply) {
        transaction.update(ref, {
          botRespostaEnviadaEm: Timestamp.fromMillis(Date.now())
        });
      }
      if (shouldMove) {
        const movement = {
          cardId,
          cardResumo: (cardData && cardData.nomeConta) ||
            (contact && contact.profile && contact.profile.name) ||
            sender,
          colunaOrigemId: sourceColumnId,
          colunaDestinoId: routeColumnRef.id,
          automatico: true,
          autor: null,
          detalhes: {
            de: isNewCard
              ? firstColumnSnapshot.data().nome || "—"
              : sourceColumnSnapshot && sourceColumnSnapshot.exists
                ? sourceColumnSnapshot.data().nome || "—"
                : "—",
            para: destinationColumn.nome
          },
          timestamp: FieldValue.serverTimestamp()
        };
        transaction.set(db.collection("colunas").doc(sourceColumnId)
          .collection("historico").doc(message.id + "-route-out"), {
          ...movement, tipo: "saida"
        });
        transaction.set(routeColumnRef.collection("historico")
          .doc(message.id + "-route-in"), {
          ...movement, tipo: "entrada"
        });
        transaction.set(ref.collection("historico").doc(message.id + "-route"), {
          tipo: "movimentacao",
          automatico: true,
          diretrizDe: null,
          autor: null,
          detalhes: movement.detalhes,
          timestamp: FieldValue.serverTimestamp()
        });
      }
      transaction.set(conversationRef, {
        cardId,
        phoneNumberId: numberId,
        sender,
        atualizadoEm: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.update(eventRef, {
        cardId,
        replyAttempted: shouldReply || event.replyAttempted === true,
        replyMode: shouldReply
          ? (hasActiveBotMessage ? "automation" : "pre-atendimento")
          : event.replyMode || null
      });
      return {
        cardRef: ref,
        shouldReply,
        replyText: hasActiveBotMessage ? automaticText : legacyReply,
        invalidRoute: !!matchingOption && !destinationColumn
      };
    });

    if (result.invalidRoute) {
      console.warn("Direcionamento do WhatsApp ignorado porque a coluna não existe ou não termina em *.", {
        phoneNumberId: numberId,
        columnId: matchingOption.columnId
      });
    }
    if (result.shouldReply) {
      let apiMessageId;
      try {
        apiMessageId = await sendGraphMessage(
          { ...numberData, id: numberId },
          sender,
          { type: "text", text: { body: result.replyText, preview_url: false } }
        );
      } catch (erro) {
        console.error("Falha ao enviar resposta automática do WhatsApp:", erro.message);
        await result.cardRef.update({ botRespostaErro: erro.message });
      }
      if (apiMessageId) {
        const sentAt = Timestamp.fromMillis(Date.now());
        await db.runTransaction(async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const cardSnapshot = await transaction.get(result.cardRef);
          const latestEvent = eventSnapshot.data();
          if (!latestEvent || latestEvent.state !== "processing" || latestEvent.lockOwner !== owner) {
            throw new Error("A trava do evento WhatsApp foi perdida após o envio.");
          }
          if (!cardSnapshot.exists) throw new Error("O card da conversa não existe mais após o envio.");
          transaction.set(result.cardRef.collection("mensagensWhatsapp").doc(apiMessageId), {
            direction: "outgoing",
            type: "text",
            text: result.replyText,
            apiMessageId,
            phoneNumberId: numberId,
            status: "sent",
            automatico: true,
            origem: latestEvent.replyMode === "automation" ? "automacao" : "pre-atendimento",
            criadoEm: sentAt
          });
          transaction.update(result.cardRef, {
            botRespostaApiId: apiMessageId,
            botRespostaErro: FieldValue.delete(),
            whatsappLastOutboundAt: sentAt,
            ultimaAtividade: sentAt
          });
          transaction.update(eventRef, {
            replyApiMessageId: apiMessageId,
            replySentAt: sentAt
          });
        });
      }
    } else if (hasActiveBotMessage && !automaticText) {
      console.warn("A mensagem ativa do WhatsApp não contém texto enviável.", {
        phoneNumberId: numberId,
        messageId: activeBotMessage.id
      });
    }
    await db.runTransaction(async (transaction) => {
      const event = (await transaction.get(eventRef)).data();
      if (!event || event.state !== "processing" || event.lockOwner !== owner) {
        throw new Error("A trava do evento WhatsApp foi perdida.");
      }
      transaction.update(eventRef, { processed: true, state: "completed", processadoEm: FieldValue.serverTimestamp() });
    });
  } catch (erro) {
    try {
      await db.runTransaction(async (transaction) => {
        const event = (await transaction.get(eventRef)).data();
        if (event && event.state === "processing" && event.lockOwner === owner) {
          transaction.update(eventRef, { state: "failed", atualizadoEm: FieldValue.serverTimestamp() });
        }
      });
    } catch (lockError) {
      console.error("Falha ao liberar trava do evento WhatsApp:", lockError.message);
    }
    throw erro;
  }
}

async function processWebhookPayload(payload, appId, legacySecret) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value || {};
      const numberId = String(value.metadata && value.metadata.phone_number_id || "");
      const numberSnapshot = numberId ? await db.collection("whatsappNumbers").doc(numberId).get() : null;
      const number = numberSnapshot && numberSnapshot.exists ? numberSnapshot.data() : null;
      if (appId) {
        if (!number || number.appId !== appId || number.wabaId !== String(entry.id || "")) {
          console.warn("Evento WhatsApp ignorado: número ou WABA não vinculado ao app.", appId, numberId);
          continue;
        }
      } else if (number && number.appId) {
        const appSnapshot = await appRef(number.appId).get();
        if (!appSnapshot.exists) throw new Error("App WhatsApp vinculado ao número não encontrado.");
        const linkedSecret = await readAppSecret(number.appId, appSnapshot.data(), "secret");
        if (linkedSecret !== legacySecret || number.wabaId !== String(entry.id || "")) {
          console.warn("Evento WhatsApp ignorado na rota legada: vínculo incompatível.", numberId);
          continue;
        }
      }
      if (value.messages && numberId) {
        if (number && number.active && number.captureEnabled) {
          const contacts = value.contacts || [];
          for (const message of value.messages) {
            const contact = contacts.find((item) => normalizePhone(item.wa_id) === normalizePhone(message.from)) || contacts[0];
            await handleInboundMessage(numberId, message, contact, number);
          }
        }
      }
      for (const status of value.statuses || []) {
        const jobs = await db.collection("whatsappJobs").where("apiMessageId", "==", status.id).get();
        for (const job of jobs.docs) {
          if ((appId || (number && number.appId)) && job.data().phoneNumberId !== numberId) continue;
          await job.ref.update({ statusMeta: status.status, atualizadoEm: FieldValue.serverTimestamp() });
        }
      }
    }
  }
}

exports.whatsappWebhook = onRequest({ region: REGION, timeoutSeconds: 120 }, async (request, response) => {
  const path = request.path || "/";
  const routeMatch = /^\/(\d{6,25})\/?$/.exec(path);
  if (path !== "/" && !routeMatch) {
    response.sendStatus(404);
    return;
  }
  const appId = routeMatch ? routeMatch[1] : null;
  let app;
  if (appId) {
    try {
      const snapshot = await appRef(appId).get();
      if (!snapshot.exists) {
        response.sendStatus(404);
        return;
      }
      app = snapshot.data();
    } catch (erro) {
      console.error("Falha ao carregar app do webhook WhatsApp:", erro.message);
      response.sendStatus(503);
      return;
    }
  }
  if (request.method === "GET") {
    try {
      const verifyToken = appId
        ? await readAppSecret(appId, app, "verify-token")
        : await readSecret("golden-whatsapp-verify-token");
      if (request.query["hub.mode"] === "subscribe" &&
          request.query["hub.verify_token"] === verifyToken &&
          request.query["hub.challenge"]) {
        response.status(200).type("text/plain").send(String(request.query["hub.challenge"]));
        return;
      }
      response.sendStatus(403);
    } catch (erro) {
      console.error("Webhook WhatsApp ainda não configurado:", erro.message);
      response.sendStatus(503);
    }
    return;
  }
  if (request.method !== "POST") {
    response.sendStatus(405);
    return;
  }
  const signature = String(request.get("x-hub-signature-256") || "");
  const rawBody = request.rawBody;
  if (!Buffer.isBuffer(rawBody) || !signature.startsWith("sha256=")) {
    response.sendStatus(401);
    return;
  }
  try {
    const appSecret = appId
      ? await readAppSecret(appId, app, "secret")
      : await readSecret("golden-whatsapp-app-secret");
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      response.sendStatus(401);
      return;
    }
    await processWebhookPayload(JSON.parse(rawBody.toString("utf8")), appId, appId ? null : appSecret);
    response.sendStatus(200);
  } catch (erro) {
    console.error("Falha ao processar webhook do WhatsApp:", erro.message);
    response.sendStatus(500);
  }
});

exports.syncWhatsAppCardJobs = onDocumentWritten(
  { document: "cards/{cardId}", region: REGION, timeoutSeconds: 120 },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const cardId = event.params.cardId;
    const oldProgramacao = before && before.programacao;
    const newProgramacao = after && after.programacao;
    const scheduleChanged = oldProgramacao && oldProgramacao.status === "aguardando_envio" &&
      (      !newProgramacao || newProgramacao.status !== "aguardando_envio" ||
        JSON.stringify([
          timestampFrom(newProgramacao.dataHora) && timestampFrom(newProgramacao.dataHora).toMillis(),
          newProgramacao.phoneNumberId,
          newProgramacao.tipoMensagem,
          newProgramacao.texto,
      newProgramacao.templateName,
      newProgramacao.templateVariables
        ]) !== JSON.stringify([
          timestampFrom(oldProgramacao.dataHora) && timestampFrom(oldProgramacao.dataHora).toMillis(),
          oldProgramacao.phoneNumberId,
          oldProgramacao.tipoMensagem,
          oldProgramacao.texto,
      oldProgramacao.templateName,
      oldProgramacao.templateVariables
        ]));
    if (scheduleChanged) {
      const oldScheduledAt = timestampFrom(oldProgramacao.dataHora);
      await cancelScheduledJobsForCard(cardId, "card", null, oldScheduledAt && oldScheduledAt.toMillis());
    }
    if (!after || after.excluido) {
      await cancelScheduledJobsForCard(cardId);
      return;
    }
    if (after.programacao && after.programacao.status === "aguardando_envio") {
      await scheduleCardJob(cardId, after.programacao);
    }
    if (before && before.colunaId !== after.colunaId) {
      await cancelScheduledJobsForCard(cardId, "column", before.colunaId);
    }
    if (!before || before.colunaId !== after.colunaId) {
      const columnSnapshot = await db.collection("colunas").doc(after.colunaId).get();
      if (columnSnapshot.exists && columnSnapshot.data().tipo === "funcionaria") {
        await scheduleColumnJobs(after.colunaId, columnSnapshot.data(), [{ id: cardId, data: () => after }]);
      }
    }
  }
);

exports.syncWhatsAppColumnJobs = onDocumentWritten(
  { document: "colunas/{columnId}", region: REGION, timeoutSeconds: 120 },
  async (event) => {
    const columnId = event.params.columnId;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const before = event.data.before.exists ? event.data.before.data() : null;
    const oldConfig = before && before.configFuncionaria;
    const newConfig = after && after.configFuncionaria;
    if (JSON.stringify(oldConfig || null) === JSON.stringify(newConfig || null)) return;
    const snapshot = await db.collection("whatsappJobs").where("columnId", "==", columnId).get();
    const batch = db.batch();
    let count = 0;
    snapshot.docs.forEach((job) => {
      if (job.data().status === "scheduled") {
        batch.update(job.ref, { status: "cancelled", erro: "A configuração da coluna foi alterada." });
        count += 1;
      }
    });
    if (count) await batch.commit();
    if (!after || after.tipo !== "funcionaria") return;
    const cards = await db.collection("cards").where("colunaId", "==", columnId).get();
    await scheduleColumnJobs(columnId, after, cards.docs);
  }
);

exports.dispatchWhatsAppJobs = onSchedule(
  { schedule: "every 1 minutes", timeZone: "America/Sao_Paulo", region: REGION, timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const [scheduledSnapshot, acceptedSnapshot, finalizingSnapshot, sendingSnapshot] = await Promise.all([
      db.collection("whatsappJobs").where("status", "==", "scheduled").get(),
      db.collection("whatsappJobs").where("status", "==", "accepted").get(),
      db.collection("whatsappJobs").where("status", "==", "finalizing").get(),
      db.collection("whatsappJobs").where("status", "==", "sending").get()
    ]);
    const dueScheduled = scheduledSnapshot.docs
      .filter((job) => {
        const scheduledAt = job.data().scheduledAt;
        return scheduledAt && scheduledAt.toMillis() <= Date.now();
      })
      .sort((a, b) => a.data().scheduledAt.toMillis() - b.data().scheduledAt.toMillis());
    const recoverFinalizing = finalizingSnapshot.docs.filter((job) =>
      job.data().lockedAt && Date.now() - job.data().lockedAt.toMillis() > 10 * 60 * 1000
    );
    const recoverSending = sendingSnapshot.docs.filter((job) =>
      job.data().lockedAt && Date.now() - job.data().lockedAt.toMillis() > 10 * 60 * 1000
    );
    const due = [
      ...acceptedSnapshot.docs,
      ...recoverFinalizing,
      ...recoverSending,
      ...dueScheduled
    ].slice(0, 100);
    for (const job of due) await processScheduledJob(job);
  }
);
