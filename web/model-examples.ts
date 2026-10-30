// IDs verificados nos catálogos oficiais em 28/10/2026.
// As descrições são sugestões de uso no FoxOps, não benchmarks entre provedores.
export const MODEL_EXAMPLES: Record<
  string,
  { source: string; items: { id: string; label: string; use: string }[] }
> = {
  openai: {
    source: "https://developers.openai.com/api/docs/models",
    items: [
      {
        id: "gpt-6-luna",
        label: "Para começar",
        use: "Resumos de saúde e perguntas de rotina; opção voltada a eficiência.",
      },
      {
        id: "gpt-6.1-sol",
        label: "Equilibrado",
        use: "Análises mais detalhadas de métricas e incidentes.",
      },
      {
        id: "gpt-6-astra",
        label: "Análise avançada",
        use: "Investigações complexas; avalie o custo antes de usar no dia a dia.",
      },
    ],
  },
  claude: {
    source: "https://platform.claude.com/docs/en/models/overview",
    items: [
      {
        id: "claude-haiku-5-5",
        label: "Para começar",
        use: "Resumos rápidos e consultas frequentes sobre o ambiente.",
      },
      {
        id: "claude-sonnet-5-5",
        label: "Equilibrado",
        use: "Diagnósticos mais detalhados e explicação de incidentes.",
      },
      {
        id: "claude-opus-5-5",
        label: "Análise avançada",
        use: "Casos complexos; confira o custo de utilização na sua conta.",
      },
    ],
  },
  grok: {
    source: "https://docs.x.ai/developers/models",
    items: [
      {
        id: "grok-4.7",
        label: "Uso geral",
        use: "Perguntas sobre métricas, interpretação de alertas e diagnóstico do ambiente.",
      },
    ],
  },
  deepseek: {
    source: "https://api-docs.deepseek.com/",
    items: [
      {
        id: "deepseek-flash",
        label: "Para começar",
        use: "Consultas de rotina e resumos do monitoramento.",
      },
      {
        id: "deepseek-v4-pro",
        label: "Análise avançada",
        use: "Investigações que exigem raciocínio mais detalhado.",
      },
    ],
  },
  gemini: {
    source: "https://ai.google.dev/gemini-api/docs/models",
    items: [
      {
        id: "gemini-3.5-flash-lite",
        label: "Para começar",
        use: "Resumos rápidos e consultas frequentes com foco em eficiência.",
      },
      {
        id: "gemini-3.8-flash",
        label: "Equilibrado",
        use: "Perguntas gerais e análises mais detalhadas do ambiente.",
      },
      {
        id: "gemini-4-argon",
        label: "Análise avançada",
        use: "Investigações complexas; confira a disponibilidade e o custo na sua conta.",
      },
    ],
  },
};
