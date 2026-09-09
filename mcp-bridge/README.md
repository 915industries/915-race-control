# RaceControl ChatGPT MCP bridge

Private MCP bridge between ChatGPT Work and the 915 Industries RaceControl agent API.

## Required environment variables

- `RACECONTROL_API_BASE`: Team-scoped RaceControl agent API base URL.
- `RACECONTROL_API_KEY`: RaceControl agent connection key. Never commit this value.
- `MCP_PATH_TOKEN`: A strong random token used in the private MCP endpoint path.
- `MCP_ALLOWED_HOSTS`: Optional comma-separated public hostnames. Railway's
  `RAILWAY_PUBLIC_DOMAIN` is picked up automatically.

The connector URL is `https://<host>/mcp/<MCP_PATH_TOKEN>`.

## Safety

The bridge exposes fixed RaceControl operations rather than an unrestricted URL proxy. The
RaceControl credential is injected only through the host's secret manager and is never returned by
the MCP tools.
