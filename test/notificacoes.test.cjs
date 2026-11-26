"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("badge usa os limites e cores especificados", async () => {
  const { badgeNotificacoes } = await import("../js/notificacoes-utils.mjs");
  assert.deepEqual(badgeNotificacoes(0), { texto: "", cor: "" });
  for (const n of [1, 30]) assert.deepEqual(badgeNotificacoes(n), { texto: String(n), cor: "amarelo" });
  for (const n of [31, 99]) assert.deepEqual(badgeNotificacoes(n), { texto: String(n), cor: "vermelho" });
  assert.deepEqual(badgeNotificacoes(100), { texto: "99+", cor: "vermelho" });
  assert.throws(() => badgeNotificacoes(-1), RangeError);
});

test("notificações usam rotas internas e codificam identificadores", async () => {
  const { destinoNotificacao } = await import("../js/notificacoes-utils.mjs");
  assert.equal(destinoNotificacao({ tipo: "coluna", cardId: "a&b" }), "conversas.html?card=a%26b");
  assert.equal(destinoNotificacao({ tipo: "interna", chatId: "x/y" }), "chats-internos.html?chat=x%2Fy");
  assert.equal(destinoNotificacao({ tipo: "sistema", url: "https://example.test" }), null);
});
