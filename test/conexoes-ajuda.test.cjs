"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const connectionsPage = fs.readFileSync(path.join(root, "conexoes.html"), "utf8");
const helpPage = fs.readFileSync(path.join(root, "conexoes-ajuda.html"), "utf8");

test("o botão de ajuda abre o guia em nova aba com proteção contra acesso à página original", () => {
  const link = connectionsPage.match(/<a\b[^>]*href="conexoes-ajuda\.html"[^>]*>/);
  assert.ok(link);
  assert.match(link[0], /\btarget="_blank"/);
  assert.match(link[0], /\brel="noopener noreferrer"/);
});

test("guia carrega preferências visuais e contém instruções de conexão, automação e Kanban", () => {
  assert.match(helpPage, /lang="pt-BR"/);
  assert.match(helpPage, /Google\+Sans\+Flex/);
  assert.match(helpPage, /Hind\+Guntur/);
  assert.match(helpPage, /golden-tema/);
  assert.match(helpPage, /golden-fonte/);
  assert.match(helpPage, /css\/conexoes-ajuda\.css/);
  for (const section of ["preparacao", "cadastro", "mensagens", "kanban", "solucao-problemas"]) {
    assert.match(helpPage, new RegExp(`id="${section}"`));
  }
  for (const topic of [
    "Secret Manager", "Token de verificação", "Verificar comunicação",
    "não garante", "OPÇÃO SIMPLES", "OPÇÃO OCULTA", "24 horas",
    "colunas", "Entrada vendas*", "número estiver desativado", "Falha"
  ]) {
    assert.ok(helpPage.toLocaleLowerCase("pt-BR").includes(topic.toLocaleLowerCase("pt-BR")), topic);
  }
  assert.doesNotMatch(helpPage, /será disponibilizado em uma próxima etapa/i);
});
