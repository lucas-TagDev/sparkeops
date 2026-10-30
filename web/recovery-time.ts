export function recoveryCountdown(until: number, clockMs: number) {
  const seconds = Math.max(0, Math.ceil(until - clockMs / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

export function recoveryIndicator(
  a: {
    state: string;
    next_eligible_at: number | null;
    waiting_until: number | null;
  },
  clockMs: number,
) {
  const stopped: Record<string, string> = {
    exhausted: "Limite de tentativas do incidente atingido",
    disabled: "Correção desativada",
    unknown: "Resultado indeterminado: verifique o servidor",
    executing: "Tentativa em execução",
  };
  if (stopped[a.state]) return { label: stopped[a.state], deadline: null };
  const restricted = a.state === "cooldown" || a.state === "daily_limit";
  const deadline =
    a.waiting_until !== null
      ? Math.max(a.waiting_until, restricted ? (a.next_eligible_at ?? 0) : 0)
      : restricted
        ? a.next_eligible_at
        : null;
  const remaining = deadline !== null && deadline * 1000 > clockMs;
  return {
    label: remaining
      ? a.state === "daily_limit"
        ? "Limite diário atingido"
        : a.waiting_until !== null
          ? "Aguardando intervalo"
          : "Intervalo entre reinícios"
      : a.waiting_until !== null
        ? "Aguardando verificação para executar"
        : "Nenhuma tentativa agendada",
    deadline: remaining ? deadline : null,
  };
}
