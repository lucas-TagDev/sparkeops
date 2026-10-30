import type { Platform, Principal, Alert } from "./platform.ts";
import { APIError } from "./store.ts";
export function alertHistory(
  platform: Platform,
  p: Principal,
  input: Record<string, unknown>,
) {
  const db = platform.store.db,
    org = input.organization
      ? platform.authorizeOrg(p, input.organization)
      : undefined,
    orgs = org ? [org] : platform.organizations(p).map((o) => o.id);
  const status = String(input.status ?? "active"),
    severity = String(input.severity ?? "all"),
    kind = String(input.kind ?? "all"),
    server = String(input.server ?? ""),
    q = String(input.q ?? "")
      .trim()
      .slice(0, 160);
  if (
    !["active", "resolved", "all", "acknowledged", "unacknowledged"].includes(
      status,
    ) ||
    !["all", "critical", "warning"].includes(severity) ||
    !["all", "offline", "cpu", "memory", "disk", "service"].includes(kind)
  )
    throw new APIError(400, "Filtros de alertas inválidos.");
  if (server) platform.server(p, server);
  const from = input.from ? Number(input.from) : null,
    to = input.to ? Number(input.to) : null;
  if (
    (from !== null && (!Number.isFinite(from) || from < 0)) ||
    (to !== null && (!Number.isFinite(to) || to < 0)) ||
    (from !== null && to !== null && from > to)
  )
    throw new APIError(400, "Período de alertas inválido.");
  const size = Number(input.limit ?? 10),
    limit = [10, 25, 50].includes(size) ? size : 10;
  const values: (string | number)[] = [...orgs];
  let where = orgs.length
    ? `s.organization IN (${orgs.map(() => "?").join(",")})`
    : "0";
  if (server) {
    where += " AND a.server_id=?";
    values.push(server);
  }
  if (severity !== "all") {
    where += " AND a.severity=?";
    values.push(severity);
  }
  if (kind === "service") where += " AND a.kind LIKE 'service:%'";
  else if (kind !== "all") {
    where += " AND a.kind=?";
    values.push(kind);
  }
  if (q) {
    const term = "%" + q.replace(/[!%_]/g, "!$&") + "%";
    where +=
      " AND (s.name LIKE ? ESCAPE '!' OR a.message LIKE ? ESCAPE '!' OR a.kind LIKE ? ESCAPE '!')";
    values.push(term, term, term);
  }
  if (from !== null) {
    where += " AND a.opened_at>=?";
    values.push(from);
  }
  if (to !== null) {
    where += " AND a.opened_at<=?";
    values.push(to);
  }
  const base =
    " FROM alerts a JOIN servers s ON s.id=a.server_id WHERE " + where;
  const counts = db
    .prepare(
      "SELECT count(*) total,sum(a.resolved_at IS NULL) active,sum(a.resolved_at IS NOT NULL) resolved" +
        base,
    )
    .get(...values) as {
    total: number;
    active: number | null;
    resolved: number | null;
  };
  const state =
    status === "active"
      ? " AND a.resolved_at IS NULL"
      : status === "resolved"
        ? " AND a.resolved_at IS NOT NULL"
        : status === "acknowledged"
          ? " AND a.acknowledged_at IS NOT NULL"
          : status === "unacknowledged"
            ? " AND a.resolved_at IS NULL AND a.acknowledged_at IS NULL"
            : "";
  const total = (
      db.prepare("SELECT count(*) n" + base + state).get(...values) as {
        n: number;
      }
    ).n,
    pages = Math.max(1, Math.ceil(total / limit)),
    page = Math.min(pages, Math.max(1, Math.floor(Number(input.page) || 1)));
  const items = db
    .prepare(
      "SELECT a.*,s.organization,s.name AS server_name" +
        base +
        state +
        " ORDER BY a.opened_at DESC,a.rowid DESC LIMIT ? OFFSET ?",
    )
    .all(...values, limit, (page - 1) * limit) as Alert[];
  const recoveryTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE name='service_recovery_runs'")
    .get();
  const enriched = items.map((a) => ({
    ...a,
    ...(recoveryTable
      ? {
          recovery:
            db
              .prepare(
                "SELECT status,summary,output,finished_at,next_attempt_at FROM service_recovery_runs WHERE alert_id=?",
              )
              .get(a.id) ?? null,
        }
      : {}),
  }));
  return {
    items: enriched,
    server_now: Math.floor(Date.now() / 1000),
    total,
    page,
    pages,
    limit,
    counts: {
      total: counts.total,
      active: counts.active ?? 0,
      resolved: counts.resolved ?? 0,
    },
  };
}
