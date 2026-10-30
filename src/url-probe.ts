import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";
import { APIError } from "./store.ts";
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const blocked6 = new BlockList();
blocked6.addSubnet("2001::", 23, "ipv6");
blocked6.addSubnet("2001:db8::", 32, "ipv6");
blocked6.addSubnet("2002::", 16, "ipv6");
blocked6.addSubnet("3fff::", 20, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !blocked6.check(address, "ipv6");
}
export function monitoringURL(value: unknown) {
  if (typeof value !== "string" || value.length > 2048)
    throw new APIError(400, "Informe uma URL pública HTTP ou HTTPS válida.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new APIError(400, "Informe uma URL pública HTTP ou HTTPS válida.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) ||
    (!host.includes(".") && !isIP(host)) ||
    /^(localhost|.*\.localhost|.*\.local|.*\.internal)\.?$/i.test(host) ||
    (isIP(host) && !publicAddress(host))
  )
    throw new APIError(
      400,
      "Use um domínio ou IP público HTTP ou HTTPS com uma porta válida.",
    );
  return url;
}
export type ProbeResult = {
  status_code: number | null;
  latency_ms: number;
  error: string | null;
};
export type Lookup = (
  host: string,
) => Promise<{ address: string; family: number }[]>;
export type Hop = (
  url: URL,
  address: { address: string; family: number },
  method: string,
  signal: AbortSignal,
) => Promise<{ status: number; location?: string }>;
const nativeHop: Hop = (url, address, method, signal) =>
  new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method,
      agent: false,
      signal,
      maxHeaderSize: 16384,
      ...(url.protocol === "https:" ? { rejectUnauthorized: true } : {}),
      headers: { "User-Agent": "FoxOps-Uptime/1.0", Accept: "*/*" },
      lookup: (_host, options, callback) => {
        if (typeof options === "object" && options.all)
          callback(null, [
            { address: address.address, family: address.family },
          ]);
        else callback(null, address.address, address.family);
      },
    };
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      options,
      (res) => {
        const status = res.statusCode ?? 0,
          location = res.headers.location;
        res.destroy();
        resolve({ status, location });
      },
    );
    req.on("error", reject);
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      reject(new Error("upgrade"));
    });
    req.end();
  });
export async function probeURL(
  value: string,
  method: string,
  timeout: number,
  resolver: Lookup = (host) => lookup(host, { all: true }),
  hop: Hop = nativeHop,
): Promise<ProbeResult> {
  const started = performance.now(),
    signal = AbortSignal.timeout(timeout * 1000);
  try {
    let url = monitoringURL(value);
    for (let redirects = 0; redirects <= 5; redirects++) {
      const host = url.hostname.replace(/^\[|\]$/g, ""),
        addresses = isIP(host)
          ? [{ address: host, family: isIP(host) }]
          : await Promise.race([
              resolver(host),
              new Promise<never>((_, reject) => {
                signal.addEventListener(
                  "abort",
                  () => reject(new Error("timeout")),
                  { once: true },
                );
              }),
            ]);
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new Error("blocked");
      signal.throwIfAborted();
      const result = await hop(url, addresses[0], method, signal);
      if (
        [301, 302, 303, 307, 308].includes(result.status) &&
        result.location
      ) {
        if (redirects === 5) throw new Error("redirects");
        url = monitoringURL(new URL(result.location, url).href);
        continue;
      }
      return {
        status_code: result.status,
        latency_ms: Math.round(performance.now() - started),
        error: null,
      };
    }
    throw new Error("redirects");
  } catch (error) {
    const message = String((error as Error).message),
      code = String((error as NodeJS.ErrnoException).code ?? "");
    return {
      status_code: null,
      latency_ms: Math.round(performance.now() - started),
      error: signal.aborted
        ? "Tempo limite excedido."
        : message === "blocked" || error instanceof APIError
          ? "Destino não permitido."
          : message === "redirects"
            ? "Limite de redirecionamentos excedido."
            : /CERT|TLS|SSL|SELF_SIGNED|VERIFY/.test(code)
              ? "Falha na validação do certificado HTTPS."
              : /ENOTFOUND|EAI_AGAIN/.test(code)
                ? "Não foi possível resolver o domínio."
                : "Não foi possível conectar ao endereço.",
    };
  }
}
