export function descreverErroServico(erro, servico) {
  const codigo = String(erro?.code || "").replace(/^functions\//, "");
  if (["internal", "unavailable", "deadline-exceeded", "not-found"].includes(codigo) ||
      String(erro?.message || "").toLowerCase() === "internal") {
    return `O serviço ${servico} está indisponível ou falhou. Verifique a implantação das Cloud Functions e os logs, e tente novamente.`;
  }
  if (codigo === "unauthenticated") return "Sua sessão expirou. Entre novamente.";
  if (codigo === "permission-denied") return erro.message || "Você não tem permissão para acessar este recurso.";
  return erro?.message || `Não foi possível acessar o serviço ${servico}.`;
}
