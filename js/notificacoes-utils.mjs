export function badgeNotificacoes(quantidade) {
  if (!Number.isInteger(quantidade) || quantidade < 0) throw new RangeError("Quantidade inválida.");
  if (!quantidade) return { texto: "", cor: "" };
  return { texto: quantidade > 99 ? "99+" : String(quantidade), cor: quantidade <= 30 ? "amarelo" : "vermelho" };
}

export function destinoNotificacao(item) {
  if (item.tipo === "coluna" && typeof item.cardId === "string" && item.cardId) {
    return "conversas.html?card=" + encodeURIComponent(item.cardId);
  }
  if (item.tipo === "interna" && typeof item.chatId === "string" && item.chatId) {
    return "chats-internos.html?chat=" + encodeURIComponent(item.chatId);
  }
  return null;
}
