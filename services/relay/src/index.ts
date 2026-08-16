import { DurableObject } from "cloudflare:workers";
import {
  hashToken,
  parseSocketProtocols,
  randomToken,
  verifySecret,
  verifyTokenHash,
  type SocketRole,
} from "./auth";
import { isAllowedRelayMessage, isRecord } from "./protocol";

interface SessionConfigRow extends Record<string, SqlStorageValue> {
  session_id: string;
  host_hash: string;
  viewer_hash: string;
  expires_at: number;
}

interface SocketAttachment {
  role: SocketRole;
  clientId: string;
  connectedAt: number;
}

interface CreateSessionBody {
  expiresInHours: number;
}

export class RelaySession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS session_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          session_id TEXT NOT NULL,
          host_hash TEXT NOT NULL,
          viewer_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
    });
  }

  async init(
    sessionId: string,
    hostHash: string,
    viewerHash: string,
    expiresAt: number,
  ): Promise<boolean> {
    const existing = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM session_config")
      .one().count;
    if (existing > 0) return false;

    this.ctx.storage.sql.exec(
      `INSERT INTO session_config
        (id, session_id, host_hash, viewer_hash, expires_at)
        VALUES (1, ?, ?, ?, ?)`,
      sessionId,
      hostHash,
      viewerHash,
      expiresAt,
    );
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "WebSocket upgrade required" }, { status: 426 });
    }

    const credentials = parseSocketProtocols(
      request.headers.get("Sec-WebSocket-Protocol"),
    );
    if (!credentials) {
      return Response.json({ error: "Invalid socket credentials" }, { status: 401 });
    }

    const config = this.getConfig();
    if (!config || config.expires_at <= Date.now()) {
      return Response.json({ error: "Session expired" }, { status: 410 });
    }

    const expectedHash =
      credentials.role === "host" ? config.host_hash : config.viewer_hash;
    if (!(await verifyTokenHash(credentials.token, expectedHash))) {
      return Response.json({ error: "Invalid socket credentials" }, { status: 401 });
    }

    if (credentials.role === "host") {
      for (const existingHost of this.ctx.getWebSockets("host")) {
        existingHost.close(4001, "Host replaced by a newer connection");
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      role: credentials.role,
      clientId: crypto.randomUUID(),
      connectedAt: Date.now(),
    };

    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [credentials.role]);
    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": "pocketdesk-v1" },
      webSocket: client,
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = getAttachment(socket);
    if (!attachment) {
      socket.close(4002, "Missing connection state");
      return;
    }

    if (message instanceof ArrayBuffer) {
      if (attachment.role === "host") {
        this.broadcastTo("viewer", message);
      }
      return;
    }

    if (!isAllowedRelayMessage(attachment.role, message)) return;

    if (attachment.role === "host") {
      this.broadcastTo("viewer", message);
    } else {
      const hosts = this.ctx.getWebSockets("host");
      if (hosts.length === 0) {
        sendSafely(socket, JSON.stringify({ type: "host-status", online: false }));
        return;
      }
      for (const host of hosts) sendSafely(host, message);
    }
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    socket.close(code, reason);
    this.broadcastPresence();
    console.log(
      JSON.stringify({
        message: "relay socket closed",
        code,
        wasClean,
        role: getAttachment(socket)?.role ?? "unknown",
      }),
    );
  }

  webSocketError(socket: WebSocket, error: unknown): void {
    console.error(
      JSON.stringify({
        message: "relay socket error",
        error: error instanceof Error ? error.message : String(error),
        role: getAttachment(socket)?.role ?? "unknown",
      }),
    );
    socket.close(1011, "Relay error");
    this.broadcastPresence();
  }

  private getConfig(): SessionConfigRow | null {
    const rows = this.ctx.storage.sql
      .exec<SessionConfigRow>(
        "SELECT session_id, host_hash, viewer_hash, expires_at FROM session_config WHERE id = 1",
      )
      .toArray();
    return rows[0] ?? null;
  }

  private broadcastTo(role: SocketRole, message: string | ArrayBuffer): void {
    for (const socket of this.ctx.getWebSockets(role)) {
      sendSafely(socket, message);
    }
  }

  private broadcastPresence(): void {
    const hostOnline = this.ctx.getWebSockets("host").length > 0;
    const viewerCount = this.ctx.getWebSockets("viewer").length;
    const message = JSON.stringify({
      type: "relay-status",
      hostOnline,
      viewerCount,
    });
    for (const socket of this.ctx.getWebSockets()) sendSafely(socket, message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "pocketdesk-relay" });
      }

      if (request.method === "GET" && url.pathname === "/open") {
        return openExpoGo(env.EXPO_PROJECT_URL);
      }

      if (request.method === "POST" && url.pathname === "/api/sessions") {
        return await createSession(request, env, url.origin);
      }

      const connectMatch = /^\/connect\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (request.method === "GET" && connectMatch) {
        const stub = env.RELAY_SESSION.getByName(connectMatch[1]);
        return await stub.fetch(request);
      }

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          service: "PocketDesk relay",
          status: "ready",
          health: "/health",
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "unhandled relay request error",
          error: error instanceof Error ? error.message : String(error),
          method: request.method,
          path: url.pathname,
        }),
      );
      return json({ error: "Internal relay error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function createSession(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
    return json({ error: "Relay is missing a strong ADMIN_TOKEN secret" }, 500);
  }

  const providedToken = getBearerToken(request.headers.get("Authorization"));
  if (!providedToken || !(await verifySecret(providedToken, env.ADMIN_TOKEN))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 4_096) {
    return json({ error: "Request body too large" }, 413);
  }

  let parsedBody: unknown = {};
  if (contentLength > 0) parsedBody = await request.json();
  const body = parseCreateSessionBody(parsedBody);
  if (!body) return json({ error: "Invalid session options" }, 400);

  const sessionId = crypto.randomUUID();
  const hostToken = randomToken();
  const viewerToken = randomToken();
  const expiresAt = Date.now() + body.expiresInHours * 60 * 60 * 1_000;
  const [hostHash, viewerHash] = await Promise.all([
    hashToken(hostToken),
    hashToken(viewerToken),
  ]);

  const stub = env.RELAY_SESSION.getByName(sessionId);
  const initialized = await stub.init(
    sessionId,
    hostHash,
    viewerHash,
    expiresAt,
  );
  if (!initialized) return json({ error: "Session collision; retry" }, 503);

  console.log(
    JSON.stringify({ message: "relay session created", sessionId, expiresAt }),
  );

  return json(
    {
      sessionId,
      hostToken,
      viewerToken,
      pairingCode: `${sessionId}.${viewerToken}`,
      relayUrl: origin,
      expiresAt,
    },
    201,
    { "Cache-Control": "no-store" },
  );
}

function parseCreateSessionBody(value: unknown): CreateSessionBody | null {
  if (!isRecord(value)) return null;
  const rawHours = value.expiresInHours ?? 12;
  if (
    typeof rawHours !== "number" ||
    !Number.isInteger(rawHours) ||
    rawHours < 1 ||
    rawHours > 24
  ) {
    return null;
  }
  return { expiresInHours: rawHours };
}

function getBearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

function getAttachment(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (
    !isRecord(value) ||
    (value.role !== "host" && value.role !== "viewer") ||
    typeof value.clientId !== "string" ||
    typeof value.connectedAt !== "number"
  ) {
    return null;
  }
  return {
    role: value.role,
    clientId: value.clientId,
    connectedAt: value.connectedAt,
  };
}

function sendSafely(socket: WebSocket, message: string | ArrayBuffer): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(message);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "failed to relay websocket message",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function openExpoGo(projectUrl: string | undefined): Response {
  if (!projectUrl || !/^exp:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(projectUrl)) {
    return json({ error: "Expo preview is unavailable" }, 503, {
      "Cache-Control": "no-store",
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: projectUrl,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function json(
  value: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
