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

function isApprovedMediaHost(hostname) {
  const host = hostname.toLowerCase();
  return [
    "chatgpt.com",
    "openai.com",
    "oaiusercontent.com",
    "blob.core.windows.net",
    "amazonaws.com",
  ].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function downloadMedia(fileUrl) {
  let url = new URL(fileUrl);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    if (url.protocol !== "https:" || !isApprovedMediaHost(url.hostname)) {
      throw new Error("Media URL must be an approved HTTPS ChatGPT/OpenAI storage URL.");
    }
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Media download redirect did not include a location.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`Media download failed (${response.status}).`);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 20 * 1024 * 1024) throw new Error("Media exceeds RaceControl's 20 MB limit.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Media exceeds RaceControl's 20 MB limit.");
    return {
      bytes,
      contentType: (response.headers.get("content-type") || "application/octet-stream").split(";")[0],
    };
  }
  throw new Error("Media download redirected too many times.");
}

async function uploadRaceControlMedia({ fileUrl, fileName, content, idempotencyKey }) {
  assertConfiguration();
  const { bytes, contentType } = await downloadMedia(fileUrl);
  const allowedTypes = new Set(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]);
  if (!allowedTypes.has(contentType)) {
    throw new Error(`Unsupported media type: ${contentType}. Use JPEG, PNG, MP4, or MOV.`);
  }
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), fileName);
  if (content) form.append("content", content);
  const response = await fetch(`${apiBase}/chat/media`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": idempotencyKey || randomUUID(),
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  let payload = raw;
  try { payload = raw ? JSON.parse(raw) : { ok: true, status: response.status }; } catch { /* plain text */ }
  if (!response.ok) throw new Error(`RaceControl media upload failed (${response.status}): ${jsonText(payload)}`);
  return payload;
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
        after: z.string().optional().describe("Cursor returned by the previous page"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ after }) => {
      try {
        const suffix = after ? `?after=${encodeURIComponent(after)}` : "";
        return success(await raceControlRequest(`/campaigns${suffix}`));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_racecontrol_campaign",
    {
      title: "Get RaceControl Campaign",
      description: "Read one RaceControl campaign by its returned ID, including destinations and schedule.",
      inputSchema: z.object({ campaignId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ campaignId }) => {
      try { return success(await raceControlRequest(`/campaigns/${encodeURIComponent(campaignId)}`)); }
      catch (error) { return failure(error); }
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
    "upload_racecontrol_media",
    {
      title: "Upload RaceControl Media",
      description:
        "Upload one user-provided JPEG, PNG, MP4, or MOV file to RaceControl team chat from an approved temporary ChatGPT/OpenAI file URL. Maximum 20 MB. Videos may require processing before publication.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("Temporary HTTPS URL for the user-provided file"),
        fileName: z.string().min(1).max(255).describe("Filename including extension"),
        content: z.string().max(8000).optional().describe("Optional team-chat text"),
        idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try { return success(await uploadRaceControlMedia(args)); }
      catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "get_racecontrol_media_status",
    {
      title: "Get RaceControl Media Status",
      description: "Check whether an uploaded RaceControl image or video is visible and ready to publish.",
      inputSchema: z.object({ messageId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ messageId }) => {
      try { return success(await raceControlRequest(`/chat/media/${encodeURIComponent(messageId)}`)); }
      catch (error) { return failure(error); }
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
        caption: z.string().min(1).max(8000).describe("Publication caption approved by the user"),
        destinations: z.array(z.string().min(1)).min(1).describe("Selected RaceControl connection IDs"),
        scheduledAt: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe("Explicit ISO-8601 scheduled timestamp including timezone offset"),
        idempotencyKey: z.string().min(8).optional().describe("Stable key used to prevent duplicate writes"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ campaignId, sourceMessageId, caption, destinations, scheduledAt, idempotencyKey }) => {
      try {
        const body = { campaignId, sourceMessageId, caption, destinations };
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
    "edit_racecontrol_publication",
    {
      title: "Edit RaceControl Publication",
      description: "Edit a RaceControl publication that has not begun publishing. Use only after explicit user approval.",
      inputSchema: z.object({
        publicationId: z.string().min(1),
        caption: z.string().min(1).max(8000).optional(),
        campaignId: z.string().min(1).optional(),
        destinations: z.array(z.string().min(1)).min(1).optional(),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
        idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
      }).refine((value) => value.caption || value.campaignId || value.destinations || value.scheduledAt, {
        message: "Provide at least one publication field to edit",
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ publicationId, idempotencyKey, ...body }) => {
      try {
        return success(await raceControlRequest(`/publications/${encodeURIComponent(publicationId)}`, {
          method: "PUT", body, idempotencyKey: idempotencyKey || randomUUID(),
        }));
      } catch (error) { return failure(error); }
    },
  );

  server.registerTool(
    "cancel_racecontrol_publication",
    {
      title: "Cancel RaceControl Publication",
      description: "Cancel a RaceControl publication that has not begun publishing. Requires explicit user confirmation.",
      inputSchema: z.object({
        publicationId: z.string().min(1),
        idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ publicationId, idempotencyKey }) => {
      try {
        return success(await raceControlRequest(`/publications/${encodeURIComponent(publicationId)}`, {
          method: "DELETE", idempotencyKey: idempotencyKey || randomUUID(),
        }));
      } catch (error) { return failure(error); }
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
