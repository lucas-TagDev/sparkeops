import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.env.FOXOPS_ENDPOINT ?? "http://127.0.0.1:8080";
const token = process.env.FOXOPS_MCP_TOKEN;
if (!token)
  throw new Error(
    "Defina FOXOPS_MCP_TOKEN com uma credencial criada no painel.",
  );
const url = new URL("/mcp", origin);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
)
  throw new Error("Use HTTPS para conexões remotas.");
const client = new Client({ name: "foxops-example", version: "1.0.0" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  console.log(
    "Ferramentas:",
    (await client.listTools()).tools.map((tool) => tool.name).join(", "),
  );
  console.log(
    JSON.stringify(
      await client.callTool({ name: "list_organizations", arguments: {} }),
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
