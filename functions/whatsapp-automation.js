"use strict";

function normalizeReply(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function renderMessage(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (!block || block.type === "hidden") return "";
    if (block.type === "text") return String(block.text || "").trim();
    const original = String(block.trigger || "").trim();
    const displayed = block.styled && String(block.style || "").trim()
      ? String(block.style).trim()
      : original;
    const formatted = block.bold ? `*${displayed}*` : displayed;
    const description = String(block.description || "").trim();
    return description ? `${formatted} - ${description}` : formatted;
  }).filter(Boolean).join("\n");
}

function findMatchingOption(message, text) {
  if (!message || typeof text !== "string") return null;
  const reply = normalizeReply(text);
  if (!reply) return null;
  const block = (Array.isArray(message.blocks) ? message.blocks : []).find((item) =>
    item && (item.type === "option" || item.type === "hidden") &&
    normalizeReply(item.trigger) === reply
  );
  return block ? { columnId: block.columnId, trigger: block.trigger } : null;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value && typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const DEFAULT_INACTIVITY_MINUTES = 24 * 60;
const MAX_INACTIVITY_MINUTES = 99 * 24 * 60 + 23 * 60 + 59;

function normalizeInactivityMinutes(value) {
  if (value === undefined || value === null) return DEFAULT_INACTIVITY_MINUTES;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_INACTIVITY_MINUTES) {
    throw new Error("O tempo de inatividade deve estar entre 00 00 00 e 99 23 59.");
  }
  return value;
}

function shouldSendAutomaticReply({
  onlyRecipientInitiated = true,
  inactivityMinutes = DEFAULT_INACTIVITY_MINUTES,
  receivedAt,
  lastInboundAt,
  lastOutboundAt,
  lastAutomaticReplyAt
}) {
  const receivedAtMs = timestampMillis(receivedAt);
  if (!receivedAtMs) return false;
  const thresholdMinutes = Number.isInteger(inactivityMinutes) &&
    inactivityMinutes >= 0 && inactivityMinutes <= MAX_INACTIVITY_MINUTES
      ? inactivityMinutes
      : DEFAULT_INACTIVITY_MINUTES;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  if (onlyRecipientInitiated !== false) {
    const lastActivity = Math.max(timestampMillis(lastInboundAt), timestampMillis(lastOutboundAt));
    return !lastActivity || receivedAtMs - lastActivity >= thresholdMs;
  }
  const lastAutomatic = timestampMillis(lastAutomaticReplyAt);
  return !lastAutomatic || receivedAtMs - lastAutomatic >= thresholdMs;
}

function validateAutomation(messages, activeMessageId) {
  if (!Array.isArray(messages)) throw new Error("A lista de mensagens é inválida.");
  const messageIds = new Set();
  for (const message of messages) {
    if (!message || typeof message.id !== "string" || !message.id || messageIds.has(message.id) ||
        typeof message.name !== "string" || !message.name.trim() ||
        !Array.isArray(message.blocks) || !message.blocks.length || message.blocks.length > 20) {
      throw new Error("Cada mensagem precisa ter nome, identificador e de 1 a 20 blocos.");
    }
    messageIds.add(message.id);
    const triggers = new Set();
    for (const block of message.blocks) {
      if (!block || !["text", "option", "hidden"].includes(block.type)) {
        throw new Error("Há um tipo de bloco inválido.");
      }
      if (block.type === "text") {
        if (typeof block.text !== "string" || !block.text.trim()) {
          throw new Error("Preencha todos os blocos de texto.");
        }
        continue;
      }
      if (typeof block.trigger !== "string" || !block.trigger.trim() ||
          block.trigger.trim().length > 15 ||
          typeof block.description !== "string" ||
          typeof block.columnId !== "string" || !block.columnId) {
        throw new Error("Preencha o gatilho e selecione uma coluna terminada em *.");
      }
      const trigger = normalizeReply(block.trigger);
      if (triggers.has(trigger)) throw new Error("Não repita gatilhos na mesma mensagem.");
      triggers.add(trigger);
      if (block.type === "option" && (
          typeof block.bold !== "boolean" ||
          typeof block.styled !== "boolean" ||
          typeof block.style !== "string"
      )) {
        throw new Error("Confira a formatação das opções simples.");
      }
    }
    const text = renderMessage(message.blocks);
    if (!text || text.length > 4096) {
      throw new Error("A mensagem visível precisa ter entre 1 e 4096 caracteres.");
    }
  }
  if (activeMessageId && !messageIds.has(activeMessageId)) {
    throw new Error("A mensagem ativa não existe.");
  }
  return messages;
}

function normalizeAutomation(messages) {
  return messages.map((message) => ({
    id: message.id,
    name: message.name.trim(),
    blocks: message.blocks.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text.trim() };
      return {
        type: block.type,
        trigger: block.trigger.trim(),
        description: block.description.trim(),
        columnId: block.columnId,
        columnName: block.columnName,
        ...(block.type === "option" ? {
          bold: block.bold,
          styled: block.styled && !!block.style.trim(),
          style: block.styled ? block.style.trim() : ""
        } : {})
      };
    })
  }));
}

module.exports = {
  DEFAULT_INACTIVITY_MINUTES,
  MAX_INACTIVITY_MINUTES,
  findMatchingOption,
  normalizeInactivityMinutes,
  normalizeReply,
  normalizeAutomation,
  renderMessage,
  shouldSendAutomaticReply,
  timestampMillis,
  validateAutomation
};
