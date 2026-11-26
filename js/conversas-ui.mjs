export function inicial(nome) {
  return String(nome || "?").trim().charAt(0).toLocaleUpperCase("pt-BR") || "?";
}

export function horarioLista(valor, agora = new Date()) {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  if (data >= hoje) return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (data >= ontem) return "ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function criarItemConversa({ nome, resumo, timestamp, ativo, estado }) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "conversa-item" + (ativo ? " ativa" : "");
  item.setAttribute("aria-pressed", String(!!ativo));
  const avatar = document.createElement("span");
  avatar.className = "conversa-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = inicial(nome);
  if (estado) {
    const ponto = document.createElement("span");
    ponto.className = "conversa-ponto " + estado;
    avatar.appendChild(ponto);
  }
  const conteudo = document.createElement("span");
  conteudo.className = "conversa-item-conteudo";
  const titulo = document.createElement("strong");
  titulo.textContent = nome;
  const previa = document.createElement("span");
  previa.className = "conversa-previa";
  previa.textContent = resumo;
  conteudo.append(titulo, previa);
  if (estado) {
    const etiqueta = document.createElement("span");
    etiqueta.className = "conversa-etiqueta " + estado;
    etiqueta.textContent = estado === "para-voce" ? "Não lida para você" : "Não lida na fila";
    conteudo.appendChild(etiqueta);
  }
  const lateral = document.createElement("span");
  lateral.className = "conversa-item-lateral";
  const hora = document.createElement("time");
  hora.textContent = horarioLista(timestamp);
  if (timestamp) hora.dateTime = new Date(timestamp).toISOString();
  lateral.appendChild(hora);
  item.append(avatar, conteudo, lateral);
  return { item, lateral };
}

export function ehAtalhoEnviar(evento) {
  return evento.key === "Enter" && !evento.shiftKey && !evento.isComposing;
}

export function deveRolarAoFim({ scrollHeight, scrollTop, clientHeight, forcar = false }) {
  return forcar || scrollHeight - scrollTop - clientHeight < 60;
}

export function formatarTempoRestante(expiraEm, agora = Date.now()) {
  const segundos = Math.max(0, Math.ceil((expiraEm - agora) / 1000));
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  return `${horas}h ${minutos}m ${segundos % 60}s`;
}

export function classificarArquivo(file) {
  const extensao = String(file.name || "").split(".").pop().toLowerCase();
  const tiposExtensao = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    mp4: "video/mp4",
    "3gp": "video/3gpp",
    aac: "audio/aac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    amr: "audio/amr",
    ogg: "audio/ogg"
  };
  const mimeType = String(file.type || tiposExtensao[extensao] || "application/octet-stream")
    .split(";")[0].toLowerCase();
  const tipo = mimeType === "image/webp" ? "sticker"
    : ["image/jpeg", "image/png"].includes(mimeType) ? "image"
      : ["video/mp4", "video/3gpp"].includes(mimeType) ? "video"
        : ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"].includes(mimeType)
          ? "audio"
          : "document";
  const limites = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
    sticker: 500 * 1024
  };
  return { mimeType, tipo, maxBytes: limites[tipo] };
}

function nomeLegivel(autor) {
  const valor = String(autor || "").trim();
  if (!valor.includes("@")) return valor || "Equipe";
  if (valor.toLowerCase() === "eamgfn4ever@gmail.com") return "Samuel Cáceres";
  return valor.split("@")[0]
    .replace(/[._0-9-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toLocaleUpperCase("pt-BR") + parte.slice(1).toLocaleLowerCase("pt-BR"))
    .join(" ") || "Atendente";
}

function adicionarTextoComLinks(alvo, texto) {
  const valor = String(texto || "");
  const regex = /https?:\/\/[^\s<>()]+/gi;
  let cursor = 0;
  for (const match of valor.matchAll(regex)) {
    let url = match[0];
    let pontuacao = "";
    while (/[.,!?;:]$/.test(url)) {
      pontuacao = url.slice(-1) + pontuacao;
      url = url.slice(0, -1);
    }
    if (!url) continue;
    const inicio = match.index;
    if (inicio > cursor) {
      const trecho = document.createElement("span");
      trecho.textContent = valor.slice(cursor, inicio);
      alvo.appendChild(trecho);
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url;
    alvo.appendChild(link);
    if (pontuacao) {
      const final = document.createElement("span");
      final.textContent = pontuacao;
      alvo.appendChild(final);
    }
    cursor = inicio + match[0].length;
  }
  if (cursor < valor.length) {
    const trecho = document.createElement("span");
    trecho.textContent = valor.slice(cursor);
    alvo.appendChild(trecho);
  }
}

function urlExternaSegura(valor) {
  try {
    const url = new URL(String(valor || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function criarMidia({ tipo, mediaUrl, mediaError, fileName, carregarMidia, aoCarregarMidia, raizHistorico }) {
  const midia = document.createElement("div");
  midia.className = "whatsapp-mensagem-midia" + (tipo === "sticker" ? " whatsapp-figurinha-midia" : "");
  const rotuloFigurinha = tipo === "sticker" ? document.createElement("span") : null;
  if (rotuloFigurinha) {
    rotuloFigurinha.className = "figurinha-legenda";
    rotuloFigurinha.textContent = "Figurinha de WhatsApp";
  }
  if (mediaError || !mediaUrl || typeof carregarMidia !== "function") {
    const aviso = document.createElement("span");
    aviso.className = "midia-indisponivel";
    aviso.textContent = mediaError || "Mídia indisponível.";
    midia.appendChild(aviso);
    if (rotuloFigurinha) midia.appendChild(rotuloFigurinha);
    return midia;
  }

  const isImage = tipo === "image" || tipo === "sticker";
  const isVideo = tipo === "video";
  const isAudio = tipo === "audio";
  let visualizador = null;
  if (isImage) {
    visualizador = document.createElement("img");
    visualizador.alt = tipo === "sticker" ? "Figurinha recebida" : "Imagem recebida";
    if (tipo === "sticker") visualizador.className = "whatsapp-figurinha";
  } else if (isVideo) {
    visualizador = document.createElement("video");
    visualizador.controls = true;
    visualizador.preload = "metadata";
    visualizador.setAttribute("aria-label", "Vídeo da conversa");
  } else if (isAudio) {
    visualizador = document.createElement("audio");
    visualizador.controls = true;
    visualizador.preload = "metadata";
    visualizador.setAttribute("aria-label", "Áudio da conversa");
  }

  const acao = document.createElement("button");
  acao.type = "button";
  acao.className = "midia-carregar";
  acao.textContent = isImage ? "Ver imagem" : isVideo ? "Carregar vídeo" :
    isAudio ? "Carregar áudio" : "Baixar " + (fileName || "arquivo");
  let carregando = false;
  let carregada = false;
  const carregar = async () => {
    if (carregando || carregada) return;
    carregando = true;
    acao.disabled = true;
    acao.textContent = "Carregando...";
    try {
      const url = await carregarMidia(mediaUrl);
      carregada = true;
      if (visualizador) {
        if (typeof aoCarregarMidia === "function") {
          visualizador.addEventListener(isImage ? "load" : "loadedmetadata", aoCarregarMidia, { once: true });
        }
        visualizador.src = url;
        midia.replaceChildren(...[visualizador, rotuloFigurinha].filter(Boolean));
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName || "arquivo";
        link.textContent = "Baixar " + (fileName || "arquivo");
        midia.replaceChildren(link);
      }
    } catch (erro) {
      acao.disabled = false;
      acao.textContent = "Tentar carregar novamente";
      acao.title = erro.message || "Não foi possível carregar a mídia.";
      carregando = false;
    }
  };
  acao.addEventListener("click", carregar);
  midia.appendChild(acao);
  if (visualizador && typeof IntersectionObserver === "function") {
    const raiz = raizHistorico || document.getElementById("historico") ||
      document.getElementById("historico-chat");
    const observer = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) {
        observer.disconnect();
        carregar();
      }
    }, { root: raiz, rootMargin: "160px" });
    observer.observe(midia);
  } else if (visualizador) {
    carregar();
  }
  return midia;
}

export function criarMensagem({
  saida, autor, texto, horario, tipo = "text", mediaUrl = "", mediaError = "",
  fileName = "", caption = "", location = null, contacts = [], details = null,
  carregarMidia, aoCarregarMidia, raizHistorico
}) {
  const grupo = document.createElement("div");
  grupo.className = "mensagem-grupo " + (saida ? "saida" : "entrada");
  const nome = document.createElement("strong");
  nome.className = "whatsapp-mensagem-atendente";
  nome.textContent = nomeLegivel(autor);
  const bolha = document.createElement("div");
  bolha.className = "whatsapp-mensagem " + (saida ? "whatsapp-mensagem-saida" : "whatsapp-mensagem-entrada");
  const tiposMidia = ["image", "video", "audio", "document", "sticker"];
  const temMidia = tiposMidia.includes(tipo);
  if (temMidia) {
    bolha.appendChild(criarMidia({
      tipo, mediaUrl, mediaError, fileName, carregarMidia, aoCarregarMidia, raizHistorico
    }));
  }
  if (caption || (!temMidia && texto) || (temMidia && (!mediaUrl || mediaError) && texto)) {
    const corpo = document.createElement("p");
    adicionarTextoComLinks(corpo, caption || texto);
    bolha.appendChild(corpo);
  }
  if (location) {
    const local = document.createElement("a");
    local.className = "whatsapp-mensagem-local";
    local.href = urlExternaSegura(location.url) || "https://www.google.com/maps?q=" +
      encodeURIComponent(location.latitude + "," + location.longitude);
    local.target = "_blank";
    local.rel = "noopener noreferrer";
    local.textContent = [location.name, location.address, "Abrir localização"]
      .filter(Boolean).join(" · ");
    bolha.appendChild(local);
  }
  contacts.forEach((contact) => {
    const item = document.createElement("div");
    item.className = "whatsapp-mensagem-contato";
    const name = document.createElement("strong");
    name.textContent = contact.name || "Contato";
    item.appendChild(name);
    (contact.phones || []).forEach((phone) => {
      const number = document.createElement("span");
      number.textContent = phone;
      item.appendChild(number);
    });
    bolha.appendChild(item);
  });
  if (details && (details.title || details.emoji)) {
    const detalhe = document.createElement("p");
    detalhe.textContent = details.emoji || details.title;
    bolha.appendChild(detalhe);
  }
  if (!bolha.children.length) {
    const corpo = document.createElement("p");
    corpo.textContent = texto || "[Mensagem sem conteúdo]";
    bolha.appendChild(corpo);
  }
  const hora = document.createElement("small");
  hora.textContent = horario;
  bolha.appendChild(hora);
  grupo.append(nome, bolha);
  return grupo;
}
