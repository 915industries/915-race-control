import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const port = Number(process.env.PORT || 3000);
const apiBase = (process.env.RACECONTROL_API_BASE || "").replace(/\/$/, "");
const apiKey = process.env.RACECONTROL_API_KEY || "";
const pathToken = process.env.MCP_PATH_TOKEN || "";

function assertConfiguration() {
  const missing = [];
  if (!apiBase) missing.push("RACECONTROL_API_BASE");
  if (!apiKey) missing.push("RACECONTROL_API_KEY");
  if (!pathToken) missing.push("MCP_PATH_TOKEN");
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);
}

function jsonText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length <= 180_000 ? text : `${text.slice(0, 180_000)}\n[Response truncated]`;
}

async function raceControlRequest(path, { method = "GET", body, idempotencyKey } = {}) {
  assertConfiguration();
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await response.text();
  let payload = raw;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      // RaceControl may return plain text for some errors.
    }
  }

  if (!response.ok) {
    throw new Error(`RaceControl ${method} ${path} failed (${response.status}): ${jsonText(payload)}`);
  }
  return payload || { ok: true, status: response.status };
}

function success(value) {
  return { content: [{ type: "text", text: jsonText(value) }] };
}

function failure(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  };
}

function buildServer() {
  const server = new McpServer({ name: "racecontrol-915", version: "1.0.0" });

  server.registerTool(
    "get_racecontrol_instructions",
    {
      title: "Get RaceControl Instructions",
      description:
        "Read the live RaceControl agent instructions, permissions, expiry, endpoints, and usage rules. Call this before other RaceControl operations and whenever permissions may have changed.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        return success(await raceControlRequest("/instructions"));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_racecontrol_campaigns",
    {
      title: "List RaceControl Campaigns",
      description:
        "List available RaceControl publishing campaigns. Show campaign titles, platforms, account choices, and schedules to the user before choosing one.",
      inputSchema: z.object({
        page: z.number().int().min(1).optional().describe("Page number when paginating results"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ page }) => {
      try {
        const suffix = page ? `?page=${encodeURIComponent(page)}` : "";
        return success(await raceControlRequest(`/campaigns${suffix}`));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_racecontrol_connections",
    {
      title: "List RaceControl Connections",
      description: "List social-media connections available to the authorized RaceControl team.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        return success(await raceControlRequest("/connections"));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "post_racecontrol_chat_message",
    {
      title: "Post RaceControl Team Message",
      description:
        "Post a text message to the RaceControl team chat. Use only when the user explicitly asks to post or send the message.",
      inputSchema: z.object({
        content: z.string().min(1).max(20_000).describe("The exact team-chat message to post"),
        idempotencyKey: z.string().min(8).optional().describe("Stable key used to prevent duplicate writes"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ content, idempotencyKey }) => {
      try {
        return success(
          await raceControlRequest("/chat/messages", {
            method: "POST",
            body: { content },
            idempotencyKey: idempotencyKey || randomUUID(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_racecontrol_publication",
    {
      title: "Create RaceControl Publication",
      description:
        "Create a social publication from an existing RaceControl chat-media message. Confirm the campaign and content with the user before calling. Omit scheduledAt to use the next campaign slot.",
      inputSchema: z.object({
        campaignId: z.string().min(1).describe("Campaign identifier selected by the user"),
        sourceMessageId: z.string().min(1).describe("RaceControl media message identifier"),
        scheduledAt: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe("Explicit ISO-8601 scheduled timestamp including timezone offset"),
        idempotencyKey: z.string().min(8).optional().describe("Stable key used to prevent duplicate writes"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ campaignId, sourceMessageId, scheduledAt, idempotencyKey }) => {
      try {
        const body = { campaignId, sourceMessageId };
        if (scheduledAt) body.scheduledAt = scheduledAt;
        return success(
          await raceControlRequest("/publications", {
            method: "POST",
            body,
            idempotencyKey: idempotencyKey || randomUUID(),
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_racecontrol_publication",
    {
      title: "Get RaceControl Publication",
      description:
        "Check the real RaceControl status of a publication. Pending approval or processing does not mean published.",
      inputSchema: z.object({
        publicationId: z.string().min(1).describe("RaceControl publication identifier"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ publicationId }) => {
      try {
        return success(await raceControlRequest(`/publications/${encodeURIComponent(publicationId)}`));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

// This is a public remote server, so localhost DNS-rebinding allowlists are not
// applicable. Access to the MCP route is instead protected by a 256-bit secret
// path stored separately in Railway and ChatGPT.
const app = createMcpExpressApp({ host: "0.0.0.0" });

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "racecontrol-chatgpt-mcp",
    configured: Boolean(apiBase && apiKey && pathToken),
  });
});

if (!pathToken) {
  console.error("MCP_PATH_TOKEN is required before the MCP endpoint can be used.");
}

const handler = createMcpHandler(buildServer);
const nodeHandler = toNodeHandler(handler);
app.all(`/mcp/${pathToken || "not-configured"}`, (req, res) => void nodeHandler(req, res, req.body));

app.listen(port, "0.0.0.0", () => {
  console.log(`RaceControl MCP bridge listening on port ${port}`);
});
