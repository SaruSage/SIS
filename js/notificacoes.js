import { auth, db } from "./firebase-config.js";
import { icone } from "./icones.js";
import { badgeNotificacoes, destinoNotificacao } from "./notificacoes-utils.mjs";
import { collection, onSnapshot, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function iniciarNotificacoes() {
  const acoes = document.querySelector(".header-acoes");
  if (!acoes || !auth.currentUser || acoes.dataset.notificacoesIniciadas) return;
  acoes.dataset.notificacoesIniciadas = "true";
  let botao = document.getElementById("botao-notificacoes");
  if (!botao) {
    botao = acoes.querySelector(".botao-header-icone");
    if (!botao) {
      botao = document.createElement("button");
      botao.type = "button";
      botao.className = "botao-header-icone";
      botao.innerHTML = '<span data-icone="sino" data-tamanho="18"></span><span id="selo-notificacao" class="selo-notificacao"></span>';
      acoes.prepend(botao);
    }
    botao.id = "botao-notificacoes";
  }
  botao.title = "Notificações";
  botao.setAttribute("aria-label", "Notificações");
  botao.setAttribute("aria-expanded", "false");
  botao.setAttribute("aria-controls", "caixa-notificacoes");
  let caixa = document.getElementById("caixa-notificacoes");
  if (!caixa) {
    caixa = document.createElement("div");
    caixa.id = "caixa-notificacoes";
    caixa.className = "caixa-header";
    acoes.appendChild(caixa);
  }
  caixa.classList.add("painel-notificacoes");
  caixa.innerHTML = '<div class="notificacoes-topo"><h3>Notificações</h3><button type="button" class="notificacoes-marcar">Marcar todas como lidas</button></div><p class="notificacoes-erro" role="status"></p><ul id="lista-notificacoes"></ul>';
  const lista = caixa.querySelector("ul");
  const erro = caixa.querySelector(".notificacoes-erro");
  const selo = document.getElementById("selo-notificacao");
  let documentos = [];
  const expandidas = new Set();

  function mostrarErro(texto) {
    erro.textContent = texto;
  }

  async function marcar(documento) {
    if (documento.data().lida) return;
    await updateDoc(documento.ref, { lida: true });
  }

  function renderizar() {
    const naoLidas = documentos.filter((documento) => !documento.data().lida);
    const badge = badgeNotificacoes(naoLidas.length);
    selo.textContent = badge.texto;
    selo.className = "selo-notificacao" + (badge.texto ? " visivel " + badge.cor : "");
    botao.setAttribute("aria-label", "Notificações: " + naoLidas.length + " não lidas");
    lista.replaceChildren();
    if (!documentos.length) {
      const vazio = document.createElement("li");
      vazio.textContent = "Nenhuma notificação.";
      lista.appendChild(vazio);
      return;
    }
    documentos.forEach((documento) => {
      const dados = documento.data();
      const item = document.createElement("li");
      item.className = "notificacao-item" + (dados.lida ? "" : " nao-lida");
      const iconeTipo = document.createElement("span");
      iconeTipo.className = "notificacao-icone";
      iconeTipo.innerHTML = icone(dados.tipo === "sistema" ? "config" : dados.tipo === "interna" ? "pessoa" : "acessar", 18);
      const conteudo = document.createElement("div");
      conteudo.className = "notificacao-conteudo";
      const titulo = document.createElement("strong");
      titulo.textContent = dados.tipo === "sistema" ? "Aviso do sistema" :
        dados.tipo === "interna" ? (dados.nome || "Conversa interna") : (dados.nome || "Contato");
      const texto = document.createElement("p");
      texto.className = "notificacao-resumo";
      if (expandidas.has(documento.id)) texto.classList.add("expandido");
      texto.textContent = dados.tipo === "coluna" ? (dados.coluna || "") : (dados.texto || "");
      conteudo.append(titulo, texto);
      const lateral = document.createElement("div");
      lateral.className = "notificacao-lateral";
      if (dados.tipo === "sistema") {
        const expandir = document.createElement("button");
        expandir.type = "button";
        expandir.textContent = "⌄";
        expandir.setAttribute("aria-label", "Expandir aviso");
        expandir.setAttribute("aria-expanded", String(expandidas.has(documento.id)));
        expandir.addEventListener("click", async () => {
          const expandido = texto.classList.toggle("expandido");
          if (expandido) expandidas.add(documento.id);
          else expandidas.delete(documento.id);
          expandir.setAttribute("aria-expanded", String(expandido));
          try { await marcar(documento); } catch (e) { mostrarErro("Não foi possível marcar como lida: " + e.message); }
        });
        lateral.appendChild(expandir);
      }
      const data = document.createElement("time");
      const dataJs = dados.criadoEm && dados.criadoEm.toDate ? dados.criadoEm.toDate() : null;
      data.textContent = dataJs ? dataJs.toLocaleString("pt-BR") : "Data indisponível";
      if (dataJs) data.dateTime = dataJs.toISOString();
      lateral.appendChild(data);
      item.append(iconeTipo, conteudo, lateral);
      const destino = destinoNotificacao(dados);
      if (destino) {
        item.tabIndex = 0;
        item.setAttribute("role", "link");
        const abrir = async () => {
          try { await marcar(documento); location.href = destino; }
          catch (e) { mostrarErro("Não foi possível abrir a notificação: " + e.message); }
        };
        item.addEventListener("click", abrir);
        item.addEventListener("keydown", (evento) => {
          if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); abrir(); }
        });
      }
      lista.appendChild(item);
    });
  }

  caixa.querySelector(".notificacoes-marcar").addEventListener("click", async () => {
    const naoLidas = documentos.filter((documento) => !documento.data().lida);
    try {
      for (let i = 0; i < naoLidas.length; i += 500) {
        const batch = writeBatch(db);
        naoLidas.slice(i, i + 500).forEach((documento) => batch.update(documento.ref, { lida: true }));
        await batch.commit();
      }
      mostrarErro("");
    } catch (e) {
      mostrarErro("Não foi possível marcar todas como lidas: " + e.message);
    }
  });
  onSnapshot(collection(db, "notificacoes", auth.currentUser.uid, "itens"), (snapshot) => {
    documentos = snapshot.docs.slice().sort((a, b) =>
      (b.data().criadoEm?.toMillis() || 0) - (a.data().criadoEm?.toMillis() || 0));
    mostrarErro("");
    renderizar();
  }, (e) => mostrarErro("Não foi possível carregar notificações: " + e.message));
}
