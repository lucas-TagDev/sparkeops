import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Platform, Principal } from "./platform.ts";
import { query, toolDefinitions } from "./queries.ts";
import { APIError } from "./store.ts";
import type { Operations } from "./operations.ts";
import type { AgentTasks } from "./agent-tasks.ts";

export async function handleMCP(
  req: IncomingMessage,
  res: ServerResponse,
  platform: Platform,
  principal: Principal,
  body: unknown,
  operations?: Operations,
  agentTasks?: AgentTasks,
) {
  const mcp = new McpServer({ name: "foxops-monitoring", version: "0.2.0" });
  for (const tool of toolDefinitions) {
    const inputSchema: z.ZodRawShape = [
      "request_process_snapshot",
      "get_process_snapshots",
      "get_observability_context",
      "list_runbooks",
    ].includes(tool.name)
      ? { server_id: z.string().uuid() }
      : tool.name === "request_runbook"
        ? { server_id: z.string().uuid(), runbook_id: z.string().uuid() }
        : tool.name === "request_local_log_check"
          ? {
              server_id: z.string().uuid(),
              service: z.string().max(100),
              since: z.number().int().optional(),
              until: z.number().int().optional(),
            }
          : tool.name === "get_local_log_checks"
            ? { server_id: z.string().uuid() }
            : tool.name === "propose_service_action"
              ? {
                  server_id: z.string().uuid(),
                  service: z.string().max(100),
                  action: z.enum(["status", "configtest", "restart", "reload"]),
                  reason: z.string().max(1000).optional(),
                }
              : tool.name === "get_service_logs"
                ? {
                    server_id: z.string().uuid(),
                    service: z.string().max(100).optional(),
                  }
                : tool.name === "list_organizations"
                  ? {}
                  : tool.name === "query_metrics"
                    ? {
                        server_id: z.string().uuid(),
                        hours: z.number().min(1).max(168).optional(),
                      }
                    : ["get_server_health", "get_service_status"].includes(
                          tool.name,
                        )
                      ? { server_id: z.string().uuid() }
                      : { organization_id: z.string().uuid().optional() };
    mcp.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
        annotations: {
          readOnlyHint: ![
            "request_runbook",
            "propose_service_action",
            "request_local_log_check",
            "request_process_snapshot",
          ].includes(tool.name),
          destructiveHint: false,
          idempotentHint: ![
            "request_runbook",
            "propose_service_action",
            "request_local_log_check",
            "request_process_snapshot",
          ].includes(tool.name),
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = query(
            platform,
            principal,
            tool.name,
            args,
            operations,
            agentTasks,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof APIError
                    ? error.message
                    : "Consulta indisponível.",
              },
            ],
          };
        }
      },
    );
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.once("close", () => {
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}
