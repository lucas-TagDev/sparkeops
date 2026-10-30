import { t as tx, getLanguage } from "./i18n.ts";
import { useEffect, useState } from "react";
import {
  Activity,
  CalendarRange,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api, pct, stamp, stampSeconds } from "./api.ts";
import { usePanelState } from "./panel-state.ts";

type Point = {
  timestamp: number;
  samples: number;
  bucket_seconds: number;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  cpu_min: number;
  cpu_max: number;
  memory_min: number;
  memory_max: number;
  disk_min: number;
  disk_max: number;
};
const series = [
  { id: "cpu", label: "CPU", color: "#65dba8" },
  { id: "memory", label: tx("Memória"), color: "#aa8bf1" },
  { id: "disk", label: tx("Disco"), color: "#6daafa" },
] as const;
type Metric = (typeof series)[number]["id"];
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

export function UsageChart({
  serverId,
  lastSeen,
}: {
  serverId: string;
  lastSeen: number | null;
}) {
  const [expanded, setExpanded] = usePanelState(
    "server:" + serverId + ":usage",
  );
  const [preset, setPreset] = useState("1"),
    [start] = useState(() => localInput(new Date(Date.now() - 3600000))),
    [end] = useState(() => localInput(new Date()));
  const [fixed, setFixed] = useState<{ from: number; to: number } | null>(null),
    [windowRange, setWindowRange] = useState({
      from: Date.now() / 1000 - 3600,
      to: Date.now() / 1000,
    });
  const [points, setPoints] = useState<Point[]>([]),
    [enabled, setEnabled] = useState<Metric[]>(["cpu"]),
    [scale, setScale] = useState("auto"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!expanded) return;
    if (preset === "custom" && !fixed) return;
    let cancelled = false;
    const to = Date.now() / 1000,
      range =
        preset === "custom" ? fixed! : { from: to - Number(preset) * 3600, to };
    setLoading(true);
    setError("");
    api<Point[]>(
      `/servers/${serverId}/history?from=${range.from}&to=${range.to}`,
    )
      .then((data) => {
        if (!cancelled) {
          setPoints(data);
          setWindowRange(range);
          setActive(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setPoints([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, lastSeen, preset, fixed, refresh, expanded]);
  const selected = series.filter((s) => enabled.includes(s.id));
  const values = points.flatMap((p) =>
    selected.flatMap((s) => [p[`${s.id}_min`], p[`${s.id}_max`]]),
  );
  let low = 0,
    high = 100;
  if (scale === "auto" && values.length) {
    const min = Math.min(...values),
      max = Math.max(...values),
      padding = Math.max((max - min) * 0.15, 0.1);
    low = Math.max(0, min - padding);
    high = Math.min(100, max + padding);
  }
  const x = (t: number) =>
    60 + ((t - windowRange.from) / (windowRange.to - windowRange.from)) * 820;
  const y = (v: number) => 210 - ((v - low) / (high - low)) * 195;
  const point = active === null ? null : points[active];
  const paths = (metric: Metric) => {
    const groups: Point[][] = [];
    for (const p of points) {
      const last = groups.at(-1)?.at(-1);
      if (
        !last ||
        p.timestamp - last.timestamp > Math.max(p.bucket_seconds * 2, 120)
      )
        groups.push([p]);
      else groups.at(-1)!.push(p);
    }
    return groups.map((g, i) => (
      <polyline
        key={i}
        fill="none"
        strokeWidth="2.2"
        vectorEffect="non-scaling-stroke"
        points={g
          .map((p) => `${x(p.timestamp)},${y(p[`${metric}_percent`])}`)
          .join(" ")}
      />
    ));
  };
  return (
    <section className="panel usage-panel">
      <div className="panel-head">
        <h2>
          <button
            type="button"
            className="usage-collapse-toggle"
            aria-expanded={expanded}
            aria-controls={`usage-content-${serverId}`}
            onClick={() => setExpanded(!expanded)}
          >
            <Activity size={17} />
            {tx("Histórico de utilização")}
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
            <span>{tx(expanded ? "Recolher" : "Expandir")}</span>
          </button>
        </h2>
        <div className="usage-period">
          <select
            aria-label={tx("Período do histórico")}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value === "custom") setFixed(null);
            }}
          >
            <option value="0.25">{tx("Últimos 15 minutos")}</option>
            <option value="1">{tx("Última hora")}</option>
            <option value="6">{tx("Últimas 6 horas")}</option>
            <option value="24">{tx("Últimas 24 horas")}</option>
            <option value="168">{tx("Últimos 7 dias")}</option>
            <option value="custom">
              {tx("Data e horário personalizados")}
            </option>
          </select>
          <button
            className="icon-button"
            title={tx("Atualizar gráfico")}
            aria-label={tx("Atualizar gráfico")}
            disabled={loading || (preset === "custom" && !fixed)}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div id={`usage-content-${serverId}`} hidden={!expanded}>
        <div className="usage-toolbar">
          <div className="usage-metrics" aria-label={tx("Métricas do gráfico")}>
            {series.map((s) => (
              <button
                type="button"
                key={s.id}
                aria-pressed={enabled.includes(s.id)}
                className={enabled.includes(s.id) ? "chosen" : ""}
                onClick={() =>
                  setEnabled((previous) =>
                    previous.includes(s.id)
                      ? previous.length > 1
                        ? previous.filter((id) => id !== s.id)
                        : previous
                      : [...previous, s.id],
                  )
                }
              >
                <i style={{ background: s.color }} />
                {tx(s.label)}
              </button>
            ))}
          </div>
          <label>
            {tx("Escala")}
            <select
              aria-label={tx("Escala do gráfico")}
              value={scale}
              onChange={(e) => setScale(e.target.value)}
            >
              <option value="auto">
                {tx("Automática · ampliar variações")}
              </option>
              <option value="full">{tx("Completa · 0 a 100%")}</option>
            </select>
          </label>
        </div>
        {preset === "custom" && (
          <form
            className="usage-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const from = new Date(String(form.get("from"))).getTime() / 1000,
                to = new Date(String(form.get("to"))).getTime() / 1000;
              if (
                !Number.isFinite(from) ||
                !Number.isFinite(to) ||
                from >= to ||
                to - from > 90 * 86400
              ) {
                setError(
                  tx(
                    "Escolha início anterior ao fim e um intervalo de até 90 dias.",
                  ),
                );
                return;
              }
              setFixed({ from, to });
            }}
          >
            <label>
              {tx("De")}
              <input
                type="datetime-local"
                aria-label={tx("Data e hora inicial")}
                required
                name="from"
                defaultValue={start}
              />
            </label>
            <label>
              {tx("Até")}
              <input
                type="datetime-local"
                aria-label={tx("Data e hora final")}
                required
                name="to"
                defaultValue={end}
              />
            </label>
            <button className="secondary" disabled={loading}>
              <CalendarRange size={15} />
              {tx("Aplicar período")}
            </button>
            <small>
              {tx("Horário local:")}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </small>
          </form>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {preset === "custom" && !fixed ? (
          <div className="empty">
            <CalendarRange size={28} />
            <h3>{tx("Escolha a data e o horário")}</h3>
            <p>{tx("Defina o início e o fim e clique em Aplicar período.")}</p>
          </div>
        ) : !points.length ? (
          <div className="empty">
            <Activity size={28} />
            <h3>
              {loading
                ? tx("Carregando histórico…")
                : tx("Sem coletas neste período")}
            </h3>
            <p>
              {tx(
                "Escolha outro intervalo ou aguarde o envio de métricas pelo agente.",
              )}
            </p>
          </div>
        ) : (
          <div className="chart-area">
            <svg
              className="history-chart"
              viewBox="0 0 900 240"
              role="img"
              aria-label={tx`Histórico de ${selected.map((s) => s.label).join(", ")} com ${points.length} pontos. Escala de ${low.toFixed(2)} a ${high.toFixed(2)} por cento.`}
              preserveAspectRatio="none"
              onPointerLeave={() => setActive(null)}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const time =
                  windowRange.from +
                  ((((e.clientX - rect.left) / rect.width) * 900 - 60) / 820) *
                    (windowRange.to - windowRange.from);
                let closest = 0;
                for (let i = 1; i < points.length; i++)
                  if (
                    Math.abs(points[i].timestamp - time) <
                    Math.abs(points[closest].timestamp - time)
                  )
                    closest = i;
                setActive(closest);
              }}
            >
              {[0, 1, 2, 3, 4].map((i) => {
                const value = low + ((high - low) * i) / 4;
                return (
                  <g key={i}>
                    <line
                      x1="60"
                      x2="880"
                      y1={y(value)}
                      y2={y(value)}
                      stroke="#2a2f3b"
                      strokeDasharray="3 5"
                    />
                    <text x="2" y={y(value) + 4} fill="#8798ad" fontSize="10">
                      {value.toLocaleString(getLanguage(), {
                        maximumFractionDigits: 2,
                      })}
                      %
                    </text>
                  </g>
                );
              })}
              {selected.map((s) => (
                <g key={s.id} stroke={s.color}>
                  {paths(s.id)}
                  {points
                    .filter(
                      (p, i) =>
                        i === 0 ||
                        i === points.length - 1 ||
                        p.timestamp - points[i - 1].timestamp >
                          p.bucket_seconds * 2,
                    )
                    .map((p) => (
                      <circle
                        key={p.timestamp}
                        cx={x(p.timestamp)}
                        cy={y(p[`${s.id}_percent`])}
                        r="2.8"
                        fill={s.color}
                        stroke="none"
                      />
                    ))}
                </g>
              ))}
              {point && (
                <g>
                  <line
                    x1={x(point.timestamp)}
                    x2={x(point.timestamp)}
                    y1="10"
                    y2="210"
                    stroke="#7a8da6"
                    strokeDasharray="3 3"
                  />
                  {selected.map((s) => (
                    <circle
                      key={s.id}
                      cx={x(point.timestamp)}
                      cy={y(point[`${s.id}_percent`])}
                      r="4"
                      fill={s.color}
                    />
                  ))}
                </g>
              )}
              {[0, 1, 2, 3, 4].map((i) => (
                <text
                  key={i}
                  x={60 + (820 * i) / 4}
                  y="234"
                  textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
                  fill="#8798ad"
                  fontSize="9"
                >
                  {new Date(
                    (windowRange.from +
                      ((windowRange.to - windowRange.from) * i) / 4) *
                      1000,
                  ).toLocaleTimeString(getLanguage(), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </text>
              ))}
            </svg>
            <div className="chart-labels">
              <span>{stamp(windowRange.from)}</span>
              <span>{stamp(windowRange.to)}</span>
            </div>
            <div className="usage-readout">
              <strong>
                {point
                  ? stampSeconds(point.timestamp)
                  : tx("Passe o cursor para consultar um ponto")}
              </strong>
              {point &&
                selected.map((s) => (
                  <span key={s.id}>
                    <i style={{ background: s.color }} />
                    {tx(s.label)}: <b>{pct(point[`${s.id}_percent`])}</b>
                    <small>
                      {tx("mín.")}
                      {pct(point[`${s.id}_min`])}
                      {tx("· máx.")} {pct(point[`${s.id}_max`])}
                    </small>
                  </span>
                ))}
            </div>
            <label className="usage-point-slider">
              {tx("Consultar coleta pelo teclado")}
              <input
                type="range"
                aria-label={tx("Ponto do histórico")}
                min={0}
                max={points.length - 1}
                value={active ?? points.length - 1}
                onChange={(e) => setActive(Number(e.target.value))}
              />
            </label>
            <p className="muted">
              {tx("Médias por intervalos de")}
              {points[0].bucket_seconds / 60}
              {tx("minuto(s) ·")} {points.length}
              {tx("pontos ·")} {points.reduce((sum, p) => sum + p.samples, 0)}
              {tx("coletas.")}{" "}
              {scale === "auto"
                ? tx("Escala ampliada: observe os valores do eixo. ")
                : ""}
              {tx("Lacunas não são ligadas por uma linha.")}{" "}
              {loading ? tx("Atualizando…") : ""}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
