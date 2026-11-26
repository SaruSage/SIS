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
    this._textContent = "";
    this.handlers = {};
    this.classList = { add: (value) => { this.className += " " + value; } };
  }
  get textContent() {
    return this._textContent || this.children.map((child) => child.textContent || "").join("");
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
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

test("mensagens formatam links e nunca mostram e-mail como identificação do atendente", async () => {
  const { criarMensagem } = await import("../js/conversas-ui.mjs");
  const previous = global.document;
  global.document = { createElement: (tag) => new Element(tag), getElementById: () => null };
  try {
    const mensagem = criarMensagem({
      saida: true, autor: "samuel.caceres@example.test",
      texto: "Acesse https://example.com/ajuda.", horario: "13:18"
    });
    assert.equal(mensagem.children[0].textContent, "Samuel Caceres");
    const corpo = mensagem.children[1].children[0];
    const link = corpo.children.find((child) => child.tag === "a");
    assert.equal(link.href, "https://example.com/ajuda");
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(mensagem.children[0].textContent.includes("@"), false);
  } finally { global.document = previous; }
});

test("exibe mídia recebida e classifica anexos e envio com Enter", async () => {
  const { criarMensagem, classificarArquivo, ehAtalhoEnviar, deveRolarAoFim, formatarTempoRestante } = await import("../js/conversas-ui.mjs");
  const previous = global.document;
  global.document = { createElement: (tag) => new Element(tag), getElementById: () => null };
  try {
    const tipos = [
      [classificarArquivo({ name: "foto.png", type: "image/png", size: 1024 }).tipo, "image"],
      [classificarArquivo({ name: "video.mp4", type: "video/mp4", size: 1024 }).tipo, "video"],
      [classificarArquivo({ name: "figurinha.webp", type: "image/webp", size: 1024 }).tipo, "sticker"],
      [classificarArquivo({ name: "relatorio.pdf", type: "application/pdf", size: 1024 }).tipo, "document"]
    ];
    assert.deepEqual(tipos, [["image", "image"], ["video", "video"], ["sticker", "sticker"], ["document", "document"]]);
    assert.equal(ehAtalhoEnviar({ key: "Enter", shiftKey: false, isComposing: false }), true);
    assert.equal(ehAtalhoEnviar({ key: "Enter", shiftKey: true, isComposing: false }), false);
    assert.equal(ehAtalhoEnviar({ key: "Enter", shiftKey: false, isComposing: true }), false);
    assert.equal(ehAtalhoEnviar({ key: "a", shiftKey: false, isComposing: false }), false);
    assert.equal(deveRolarAoFim({ scrollHeight: 500, scrollTop: 0, clientHeight: 300 }), false);
    assert.equal(deveRolarAoFim({ scrollHeight: 500, scrollTop: 180, clientHeight: 300 }), true);
    assert.equal(deveRolarAoFim({ scrollHeight: 900, scrollTop: 0, clientHeight: 300, forcar: true }), true);
    assert.equal(formatarTempoRestante(9000, 0), "0h 0m 9s");
    assert.equal(formatarTempoRestante(0, 1000), "0h 0m 0s");

    const mensagem = criarMensagem({
      saida: false, autor: "Cliente", texto: "[Imagem recebida]", tipo: "image",
      mediaUrl: "/media", fileName: "foto.png", horario: "13:18",
      carregarMidia: async (url) => {
        assert.equal(url, "/media");
        return "blob:foto";
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    const midia = mensagem.children[1].children[0];
    assert.equal(midia.children[0].tag, "img");
    assert.equal(midia.children[0].src, "blob:foto");

    let acompanhouRolagem = false;
    const figurinha = criarMensagem({
      saida: false, autor: "Cliente", texto: "", tipo: "sticker", mediaUrl: "/sticker",
      carregarMidia: async () => "blob:figurinha",
      aoCarregarMidia: () => { acompanhouRolagem = true; }
    });
    await new Promise((resolve) => setImmediate(resolve));
    const midiaFigurinha = figurinha.children[1].children[0];
    assert.match(midiaFigurinha.className, /whatsapp-figurinha-midia/);
    assert.equal(midiaFigurinha.children[0].className, "whatsapp-figurinha");
    assert.equal(midiaFigurinha.children[1].textContent, "Figurinha de WhatsApp");
    midiaFigurinha.children[0].handlers.load();
    assert.equal(acompanhouRolagem, true);
  } finally { global.document = previous; }
});

test("compositor inclui clipe e botão de envio visual sem texto", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "conversas.html"), "utf8");
  const internalHtml = fs.readFileSync(path.join(__dirname, "..", "chats-internos.html"), "utf8");
  const conversationScript = fs.readFileSync(path.join(__dirname, "..", "js", "conversas.js"), "utf8");
  const internalScript = fs.readFileSync(path.join(__dirname, "..", "js", "chats-internos.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "css", "conversas.css"), "utf8");
  const storageRules = fs.readFileSync(path.join(__dirname, "..", "storage.rules"), "utf8");
  assert.match(html, /id="anexar-arquivo"[^>]*aria-label="Anexar arquivo"/);
  assert.match(html, /id="arquivo-input"[^>]*type="file"/);
  assert.match(html, /class="botao-primario compositor-enviar"[^>]*aria-label="Enviar mensagem"/);
  assert.match(html, /<details id="config-envio" class="envio-opcoes">[\s\S]*?aria-label="Opções de envio"[\s\S]*?<\/details>/);
  assert.doesNotMatch(conversationScript, /Mensagem aceita pela Meta/);
  assert.match(conversationScript, /window\.alert\("Não foi possível enviar:/);
  assert.match(html, /id="janela-contagem"[^>]*role="timer"/);
  assert.match(internalHtml, /id="chat-arquivo-input"[^>]*type="file"/);
  assert.match(internalHtml, /id="chat-anexar-arquivo"[^>]*aria-label="Anexar arquivo"/);
  assert.match(internalHtml, /id="chat-enviar"[^>]*class="botao-primario compositor-enviar"/);
  assert.match(internalScript, /ehAtalhoEnviar/);
  assert.match(internalScript, /uploadBytes\(/);
  assert.match(internalScript, /internal-chat-media\//);
  assert.match(css, /html\.tema-claro \.conversas-layout/);
  assert.match(css, /#colunas-solicitacao label, #membros-grupo label \{ display: flex/);
  assert.match(css, /\.pagina-conversas #conversas-aviso, \.pagina-chats-internos #chat-aviso \{ position: fixed/);
  assert.match(css, /\.whatsapp-mensagem-midia \.whatsapp-figurinha \{[^\}]*max-height: 170px/);
  assert.match(css, /\.whatsapp-mensagem-midia \.whatsapp-figurinha \{[^\}]*max-width: 180px/);
  const regraChatInterno = /match \/internal-chat-media\/\{uid\}\/\{fileName\} \{([\s\S]*?)\n    \}/.exec(storageRules);
  assert.ok(regraChatInterno);
  assert.match(regraChatInterno[1], /allow read, update, delete: if false;/);
});
