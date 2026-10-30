export type SeriesPoint = { at: number; value: number };
export type Prediction = {
  metric: string;
  type: "anomaly" | "forecast";
  current: number;
  baseline: number;
  threshold: number;
  eta_hours: number | null;
  confidence: "moderate" | "high";
  evidence: string;
  samples: number;
  span_hours: number;
};
export type Observation = {
  generated_at: number;
  fresh: boolean;
  findings: Prediction[];
  learning: string[];
  coverage: { metrics: number; hardware: number; spans: number };
  correlations: {
    from: number;
    until: number;
    relation: string;
    logs: unknown[];
    spans: unknown[];
    processes: unknown[];
  };
  runbooks: unknown[];
  limitations: string[];
};
export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    i = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? sorted[i]
      : (sorted[i - 1] + sorted[i]) / 2
    : 0;
}
export function analyzeSeries(
  metric: string,
  points: SeriesPoint[],
  at: number,
): { finding: Prediction | null; learning: string | null } {
  const sorted = points
    .filter(
      (p) => Number.isFinite(p.value) && p.at <= at && p.at >= at - 30 * 86400,
    )
    .sort((a, b) => a.at - b.at);
  const span = sorted.length ? (sorted.at(-1)!.at - sorted[0].at) / 3600 : 0;
  if (sorted.length < 24 || span < 24)
    return {
      finding: null,
      learning:
        "Histórico insuficiente: são necessárias pelo menos 24 amostras horárias cobrindo 24 horas.",
    };
  if (at - sorted.at(-1)!.at > 7200)
    return {
      finding: null,
      learning: "Coleta desatualizada: previsão suspensa.",
    };
  const recent = sorted.slice(-3),
    prior = sorted.slice(0, -3),
    comparable = prior.filter(
      (p) =>
        Math.abs(
          new Date(p.at * 1000).getUTCHours() -
            new Date(at * 1000).getUTCHours(),
        ) <= 1,
    );
  const reference = comparable.length >= 12 ? comparable : prior;
  const base = median(reference.map((p) => p.value)),
    mad = median(reference.map((p) => Math.abs(p.value - base)));
  const floor =
    metric === "temperature_max_c"
      ? 8
      : metric === "disk_await_ms"
        ? Math.max(10, base * 0.5)
        : 15;
  const threshold = base + Math.max(floor, 4 * 1.4826 * mad);
  const current = recent.at(-1)!.value;
  if (
    recent.every((p) => p.value > threshold) &&
    recent[2].at - recent[0].at <= 3 * 3600
  )
    return {
      finding: {
        metric,
        type: "anomaly",
        current,
        baseline: base,
        threshold,
        eta_hours: null,
        confidence: reference.length >= 72 ? "high" : "moderate",
        evidence:
          "Três médias horárias consecutivas acima da mediana histórica mais a tolerância robusta (MAD). Associação temporal não comprova falha física.",
        samples: sorted.length,
        span_hours: span,
      },
      learning: null,
    };
  if (
    metric === "disk_percent" &&
    sorted.length >= 48 &&
    span >= 48 &&
    current < 90
  ) {
    const window = sorted.filter((p) => p.at >= at - 7 * 86400),
      n = window.length,
      x = window.map((p) => (p.at - window[0].at) / 3600),
      y = window.map((p) => p.value),
      mx = x.reduce((a, b) => a + b, 0) / n,
      my = y.reduce((a, b) => a + b, 0) / n;
    const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0),
      slope = sxx
        ? x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / sxx
        : 0;
    const intercept = my - slope * mx,
      total = y.reduce((s, v) => s + (v - my) ** 2, 0),
      residual = y.reduce(
        (s, v, i) => s + (v - intercept - slope * x[i]) ** 2,
        0,
      ),
      r2 = total > 0 ? 1 - residual / total : 0;
    const eta = slope > 0 ? (90 - current) / slope : Infinity;
    if (slope > 0.01 && r2 >= 0.8 && eta > 0 && eta <= 168)
      return {
        finding: {
          metric,
          type: "forecast",
          current,
          baseline: base,
          threshold: 90,
          eta_hours: Math.round(eta * 10) / 10,
          confidence: r2 >= 0.95 && n >= 72 ? "high" : "moderate",
          evidence: `Tendência linear de ${slope.toFixed(3)} pontos percentuais/h; R²=${r2.toFixed(3)}. Estimativa condicional à continuidade do crescimento; não é probabilidade de falha.`,
          samples: n,
          span_hours: span,
        },
        learning: null,
      };
  }
  return { finding: null, learning: null };
}
