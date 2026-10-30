export function historicalDateMention(question: string) {
  return /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(question);
}
export function localEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
) {
  const desired = Date.UTC(year, month - 1, day, hour, minute),
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  let value = desired;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(value).map((part) => [part.type, part.value]),
    );
    const displayed = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
    );
    const difference = desired - displayed;
    if (!difference) return value / 1000;
    value += difference;
  }
  throw Error("Horário inexistente ou ambíguo no fuso informado.");
}
export function historicalWindow(question: string, timeZone: string) {
  const br = question.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/),
    iso = question.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!br && !iso)
    throw Error("Informe a data completa, por exemplo 27/10/2026 às 22:00.");
  const year = Number(br?.[3] ?? iso?.[1]),
    month = Number(br?.[2] ?? iso?.[2]),
    day = Number(br?.[1] ?? iso?.[3]);
  const time =
    question.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) ??
    question.match(/\b([01]?\d|2[0-3])h(?:([0-5]\d))?\b/i);
  if (!time && /\b\d{1,2}:\d{2}\b/.test(question))
    throw Error("Horário inválido para investigação.");
  const hour = time ? Number(time[1]) : 12,
    minute = Number(time?.[2] ?? 0),
    check = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    check.getUTCDate() !== day
  )
    throw Error("Data inválida para investigação.");
  const dayFrom = localEpoch(year, month, day, 0, 0, timeZone),
    next = new Date(Date.UTC(year, month - 1, day + 1)),
    dayTo = localEpoch(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      0,
      timeZone,
    ),
    target = localEpoch(year, month, day, hour, minute, timeZone);
  return {
    time_zone: timeZone,
    target,
    day_from: dayFrom,
    day_to: dayTo,
    from: time ? target - 1800 : dayFrom,
    to: time ? target + 1800 : dayTo,
    explicit_time: !!time,
    date: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
  };
}
