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

export function criarMensagem({ saida, autor, texto, horario }) {
  const grupo = document.createElement("div");
  grupo.className = "mensagem-grupo " + (saida ? "saida" : "entrada");
  const nome = document.createElement("strong");
  nome.className = "whatsapp-mensagem-atendente";
  nome.textContent = autor;
  const bolha = document.createElement("div");
  bolha.className = "whatsapp-mensagem " + (saida ? "whatsapp-mensagem-saida" : "whatsapp-mensagem-entrada");
  const corpo = document.createElement("p");
  corpo.textContent = texto;
  const hora = document.createElement("small");
  hora.textContent = horario;
  bolha.append(corpo, hora);
  grupo.append(nome, bolha);
  return grupo;
}
