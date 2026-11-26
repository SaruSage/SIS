"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.className = "";
    this.classList = { add: (value) => { this.className += " " + value; } };
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    if (selector === ".sidebar-secao") return this.children.find((child) => child.className === "sidebar-secao") || null;
    const href = /^a\[href="([^"]+)"\]$/.exec(selector);
    return href ? this.children.find((child) => child.tag === "a" && child.href === href[1]) || null : null;
  }
  set innerHTML(html) {
    if (this.className !== "sidebar-secao") return;
    for (const match of html.matchAll(/<a href="([^"]+)"/g)) {
      const link = new Element("a");
      link.href = match[1];
      this.appendChild(link);
    }
  }
}

test("menu insere Conversas e Chats Internos entre Kan Ban e Conexões sem duplicar", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "layout-base.js"), "utf8");
  const start = source.indexOf("function iniciarNavegacaoConversas()");
  const end = source.indexOf("// ------------------------------------------------------------", start);
  assert.ok(start >= 0 && end > start);
  for (const pagina of ["conversas.html", "chats-internos.html"]) {
    for (const secaoExistente of [false, true]) {
      const nav = new Element("nav");
      if (secaoExistente) {
        const secao = new Element("div");
        secao.className = "sidebar-secao";
        for (const href of ["vendas.html", "conexoes.html"]) {
          const link = new Element("a");
          link.href = href;
          secao.appendChild(link);
        }
        nav.appendChild(secao);
      }
      const document = {
        querySelector: (selector) => selector === ".sidebar-nav" ? nav : null,
        createElement: (tag) => new Element(tag)
      };
      const context = vm.createContext({ document, window: { location: { pathname: "/" + pagina } } });
      vm.runInContext(source.slice(start, end), context);
      context.iniciarNavegacaoConversas();
      context.iniciarNavegacaoConversas();
      const links = nav.querySelector(".sidebar-secao").children;
      assert.deepEqual(links.map((link) => link.href),
        ["vendas.html", "conversas.html", "chats-internos.html", "conexoes.html"]);
      assert.match(links.find((link) => link.href === pagina).className, /\bativo\b/);
      assert.equal(links.find((link) => link.href === pagina).attributes["aria-current"], "page");
    }
  }
});

test("lista e mensagens exibem prévia, distinção de não lida e autor fora da bolha", async () => {
  const { criarItemConversa, criarMensagem, horarioLista } = await import("../js/conversas-ui.mjs");
  const previous = global.document;
  global.document = { createElement: (tag) => new Element(tag) };
  try {
    const hoje = new Date(2026, 0, 10, 13, 18);
    assert.equal(horarioLista(hoje.getTime(), hoje), "13:18");
    assert.equal(horarioLista(new Date(2026, 0, 9, 13).getTime(), hoje), "ontem");
    assert.equal(horarioLista(new Date(2026, 0, 1).getTime(), hoje), "01/01");
    const { item } = criarItemConversa({
      nome: "Samukah", resumo: "Olá", timestamp: hoje.getTime(), ativo: true, estado: "para-voce"
    });
    assert.equal(item.attributes["aria-pressed"], "true");
    assert.equal(item.children[0].textContent, "S");
    assert.equal(item.children[1].children[1].textContent, "Olá");
    assert.equal(item.children[1].children[2].textContent, "Não lida para você");
    const mensagem = criarMensagem({ saida: true, autor: "Samuel", texto: "Olá", horario: "13:18" });
    assert.equal(mensagem.children[0].textContent, "Samuel");
    assert.equal(mensagem.children[1].children[0].textContent, "Olá");
  } finally { global.document = previous; }
});
