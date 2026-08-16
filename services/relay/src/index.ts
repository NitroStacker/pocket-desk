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
  pairing_hash: string | null;
  expires_at: number;
  persistent: number;
}

interface SocketAttachment {
  role: SocketRole;
  clientId: string;
  connectedAt: number;
  deviceId?: string;
  secureActive?: boolean;
  desktopName?: string;
}

interface TrustedDeviceRow extends Record<string, SqlStorageValue> {
  device_id: string;
  name: string;
  created_at: number;
  last_connected_at: number | null;
}

interface PairingInvitationRow extends Record<string, SqlStorageValue> {
  token_hash: string;
  device_name: string;
  expires_at: number;
}

interface EnrollmentResult {
  viewerToken: string;
  deviceId: string;
  deviceName: string;
}

interface CreateSessionBody {
  expiresInHours: number;
  persistent: boolean;
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
          pairing_hash TEXT,
          expires_at INTEGER NOT NULL,
          persistent INTEGER NOT NULL DEFAULT 0
        );
      `);
      const columns = this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(session_config)")
        .toArray();
      if (!columns.some((column) => column.name === "pairing_hash")) {
        this.ctx.storage.sql.exec("ALTER TABLE session_config ADD COLUMN pairing_hash TEXT");
      }
      if (!columns.some((column) => column.name === "persistent")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE session_config ADD COLUMN persistent INTEGER NOT NULL DEFAULT 0",
        );
      }
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS trusted_devices (
          device_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          last_connected_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS pairing_invitations (
          token_hash TEXT PRIMARY KEY,
          device_name TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    });
  }

  async init(
    sessionId: string,
    hostHash: string,
    viewerHash: string,
    pairingHash: string,
    pairingExpiresAt: number,
    expiresAt: number,
    persistent: boolean,
  ): Promise<boolean> {
    const existing = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM session_config")
      .one().count;
    if (existing > 0) return false;

    this.ctx.storage.sql.exec(
      `INSERT INTO session_config
        (id, session_id, host_hash, viewer_hash, pairing_hash, expires_at, persistent)
        VALUES (1, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      hostHash,
      viewerHash,
      null,
      expiresAt,
      persistent ? 1 : 0,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO pairing_invitations
        (token_hash, device_name, expires_at, created_at)
        VALUES (?, ?, ?, ?)`,
      pairingHash,
      "My phone",
      pairingExpiresAt,
      Date.now(),
    );
    return true;
  }

  async enroll(pairingToken: string): Promise<EnrollmentResult | null> {
    return await this.ctx.blockConcurrencyWhile(async () => {
      const config = this.getConfig();
      if (!config || (config.persistent !== 1 && config.expires_at <= Date.now())) return null;

      const pairingHash = await hashToken(pairingToken);
      const invitation = this.ctx.storage.sql
        .exec<PairingInvitationRow>(
          "SELECT token_hash, device_name, expires_at FROM pairing_invitations WHERE token_hash = ?",
          pairingHash,
        )
        .toArray()[0];
      if (!invitation || invitation.expires_at <= Date.now()) return null;

      const viewerToken = randomToken();
      const viewerHash = await hashToken(viewerToken);
      const deviceId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        "DELETE FROM pairing_invitations WHERE token_hash = ?",
        pairingHash,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO trusted_devices
          (device_id, name, token_hash, created_at, last_connected_at)
          VALUES (?, ?, ?, ?, NULL)`,
        deviceId,
        invitation.device_name,
        viewerHash,
        Date.now(),
      );
      return { viewerToken, deviceId, deviceName: invitation.device_name };
    });
  }

  async createInvitation(hostToken: string, deviceName: string): Promise<{ pairingToken: string; expiresAt: number } | null> {
    const config = this.getConfig();
    if (!config || !(await verifyTokenHash(hostToken, config.host_hash))) return null;
    const pairingToken = randomToken();
    const pairingHash = await hashToken(pairingToken);
    const expiresAt = Date.now() + 15 * 60 * 1_000;
    this.ctx.storage.sql.exec("DELETE FROM pairing_invitations WHERE expires_at <= ?", Date.now());
    this.ctx.storage.sql.exec(
      `INSERT INTO pairing_invitations
        (token_hash, device_name, expires_at, created_at)
        VALUES (?, ?, ?, ?)`,
      pairingHash,
      deviceName,
      expiresAt,
      Date.now(),
    );
    return { pairingToken, expiresAt };
  }

  async listDevices(hostToken: string): Promise<TrustedDeviceRow[] | null> {
    const config = this.getConfig();
    if (!config || !(await verifyTokenHash(hostToken, config.host_hash))) return null;
    return this.ctx.storage.sql
      .exec<TrustedDeviceRow>(
        "SELECT device_id, name, created_at, last_connected_at FROM trusted_devices ORDER BY created_at ASC",
      )
      .toArray();
  }

  async getDevice(viewerToken: string): Promise<{ id: string; name: string } | null> {
    const viewerHash = await hashToken(viewerToken);
    const device = this.ctx.storage.sql
      .exec<{ device_id: string; name: string }>(
        "SELECT device_id, name FROM trusted_devices WHERE token_hash = ?",
        viewerHash,
      )
      .toArray()[0];
    return device ? { id: device.device_id, name: device.name } : null;
  }

  async revokeDevice(hostToken: string, deviceId: string): Promise<boolean | null> {
    const config = this.getConfig();
    if (!config || !(await verifyTokenHash(hostToken, config.host_hash))) return null;
    const existing = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM trusted_devices WHERE device_id = ?",
        deviceId,
      )
      .one().count;
    if (existing === 0) return false;
    this.ctx.storage.sql.exec("DELETE FROM trusted_devices WHERE device_id = ?", deviceId);
    for (const viewer of this.ctx.getWebSockets("viewer")) {
      if (getAttachment(viewer)?.deviceId === deviceId) {
        viewer.close(4003, "Trusted device removed");
      }
    }
    this.broadcastPresence();
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
    if (!config || (config.persistent !== 1 && config.expires_at <= Date.now())) {
      return Response.json({ error: "Session expired" }, { status: 410 });
    }

    let deviceId: string | undefined;
    if (credentials.role === "host" || credentials.role === "secure") {
      if (!(await verifyTokenHash(credentials.token, config.host_hash))) {
        return Response.json({ error: "Invalid socket credentials" }, { status: 401 });
      }
    } else {
      const providedHash = await hashToken(credentials.token);
      const device = this.ctx.storage.sql
        .exec<{ device_id: string }>(
          "SELECT device_id FROM trusted_devices WHERE token_hash = ?",
          providedHash,
        )
        .toArray()[0];
      if (device) {
        deviceId = device.device_id;
        this.ctx.storage.sql.exec(
          "UPDATE trusted_devices SET last_connected_at = ? WHERE device_id = ?",
          Date.now(),
          deviceId,
        );
      } else if (!(await verifyTokenHash(credentials.token, config.viewer_hash))) {
        return Response.json({ error: "Invalid socket credentials" }, { status: 401 });
      }
    }

    if (credentials.role === "host" || credentials.role === "secure") {
      for (const existingHost of this.ctx.getWebSockets(credentials.role)) {
        existingHost.close(4001, `${credentials.role === "host" ? "Host" : "Secure host"} replaced by a newer connection`);
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      role: credentials.role,
      clientId: crypto.randomUUID(),
      connectedAt: Date.now(),
      ...(deviceId ? { deviceId } : {}),
      ...(credentials.role === "secure" ? { secureActive: false } : {}),
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
      if (attachment.role === "host" && !this.getActiveSecureSocket()) {
        this.broadcastTo("viewer", message);
      } else if (
        attachment.role === "secure" &&
        attachment.secureActive === true &&
        this.getActiveSecureSocket() === socket
      ) {
        this.broadcastTo("viewer", message);
      }
      return;
    }

    if (!isAllowedRelayMessage(attachment.role, message)) return;

    if (attachment.role === "secure") {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      if (parsed.type === "secure-status") {
        attachment.secureActive = parsed.active === true;
        attachment.desktopName = typeof parsed.desktopName === "string"
          ? parsed.desktopName.slice(0, 64)
          : "";
        socket.serializeAttachment(attachment);
        this.broadcastPresence();
      } else if (attachment.secureActive === true && this.getActiveSecureSocket() === socket) {
        this.broadcastTo("viewer", message);
      }
      return;
    }

    if (attachment.role === "host") {
      if (!this.getActiveSecureSocket()) this.broadcastTo("viewer", message);
      return;
    }

    const parsed = JSON.parse(message) as Record<string, unknown>;
    const type = parsed.type;
    const hosts = this.ctx.getWebSockets("host");
    const secureHosts = this.ctx.getWebSockets("secure");
    const activeSecure = this.getActiveSecureSocket();

    if (type === "set-stream" || type === "set-quality") {
      for (const host of [...hosts, ...secureHosts]) sendSafely(host, message);
      return;
    }

    if (activeSecure) {
      if (type === "input" || type === "ping") {
        sendSafely(activeSecure, message);
      } else {
        sendSafely(socket, JSON.stringify({
          type: "error",
          code: "SECURE_DESKTOP_ACTIVE",
          message: "Windows is at the sign-in screen. Only desktop input is available.",
        }));
      }
      return;
    }

    if (hosts.length === 0) {
      sendSafely(socket, JSON.stringify({ type: "host-status", online: false }));
      return;
    }
    for (const host of hosts) sendSafely(host, message);
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    const attachment = getAttachment(socket);
    if (attachment?.role === "secure") {
      attachment.secureActive = false;
      socket.serializeAttachment(attachment);
    }
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
    const attachment = getAttachment(socket);
    if (attachment?.role === "secure") {
      attachment.secureActive = false;
      socket.serializeAttachment(attachment);
    }
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
        "SELECT session_id, host_hash, viewer_hash, pairing_hash, expires_at, persistent FROM session_config WHERE id = 1",
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
    const hostOnline = this.ctx.getWebSockets("host").length > 0 || this.getActiveSecureSocket() !== null;
    const viewerCount = this.ctx.getWebSockets("viewer").length;
    const message = JSON.stringify({
      type: "relay-status",
      hostOnline,
      viewerCount,
    });
    for (const socket of this.ctx.getWebSockets()) sendSafely(socket, message);
    this.broadcastSecureStatus();
  }

  private getActiveSecureSocket(): WebSocket | null {
    return this.ctx.getWebSockets("secure").find(
      (socket) => getAttachment(socket)?.secureActive === true,
    ) ?? null;
  }

  private broadcastSecureStatus(): void {
    const active = this.getActiveSecureSocket();
    const attachment = active ? getAttachment(active) : null;
    const message = JSON.stringify({
      type: "secure-status",
      active: active !== null,
      available: this.ctx.getWebSockets("secure").length > 0,
      desktopName: attachment?.desktopName ?? "",
    });
    for (const socket of [
      ...this.ctx.getWebSockets("viewer"),
      ...this.ctx.getWebSockets("host"),
    ]) sendSafely(socket, message);
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

      const enrollMatch = /^\/api\/sessions\/([a-f0-9-]{36})\/enroll$/.exec(url.pathname);
      if (request.method === "POST" && enrollMatch) {
        return await enrollViewer(request, env, enrollMatch[1]);
      }

      const invitationsMatch = /^\/api\/sessions\/([a-f0-9-]{36})\/invitations$/.exec(url.pathname);
      if (request.method === "POST" && invitationsMatch) {
        return await createDeviceInvitation(request, env, invitationsMatch[1]);
      }

      const devicesMatch = /^\/api\/sessions\/([a-f0-9-]{36})\/devices$/.exec(url.pathname);
      if (request.method === "GET" && devicesMatch) {
        return await listTrustedDevices(request, env, devicesMatch[1]);
      }

      const viewerDeviceMatch = /^\/api\/sessions\/([a-f0-9-]{36})\/device$/.exec(url.pathname);
      if (request.method === "GET" && viewerDeviceMatch) {
        return await getTrustedDevice(request, env, viewerDeviceMatch[1]);
      }

      const deviceMatch = /^\/api\/sessions\/([a-f0-9-]{36})\/devices\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (request.method === "DELETE" && deviceMatch) {
        return await removeTrustedDevice(request, env, deviceMatch[1], deviceMatch[2]);
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
  const unclaimedViewerToken = randomToken();
  const pairingToken = randomToken();
  const pairingExpiresAt = Date.now() + 15 * 60 * 1_000;
  const expiresAt = body.persistent
    ? 0
    : Date.now() + body.expiresInHours * 60 * 60 * 1_000;
  const [hostHash, viewerHash, pairingHash] = await Promise.all([
    hashToken(hostToken),
    hashToken(unclaimedViewerToken),
    hashToken(pairingToken),
  ]);

  const stub = env.RELAY_SESSION.getByName(sessionId);
  const initialized = await stub.init(
    sessionId,
    hostHash,
    viewerHash,
    pairingHash,
    pairingExpiresAt,
    expiresAt,
    body.persistent,
  );
  if (!initialized) return json({ error: "Session collision; retry" }, 503);

  console.log(
    JSON.stringify({ message: "relay session created", sessionId, expiresAt }),
  );

  return json(
    {
      sessionId,
      hostToken,
      pairingCode: `${sessionId}.${pairingToken}`,
      pairingExpiresAt,
      relayUrl: origin,
      expiresAt,
      persistent: body.persistent,
    },
    201,
    { "Cache-Control": "no-store" },
  );
}

function parseCreateSessionBody(value: unknown): CreateSessionBody | null {
  if (!isRecord(value)) return null;
  const rawHours = value.expiresInHours ?? 12;
  const persistent = value.persistent ?? false;
  if (
    typeof rawHours !== "number" ||
    !Number.isInteger(rawHours) ||
    rawHours < 1 ||
    rawHours > 24
  ) {
    return null;
  }
  if (typeof persistent !== "boolean") return null;
  return { expiresInHours: rawHours, persistent };
}

async function enrollViewer(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 4_096) return json({ error: "Request body too large" }, 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid enrollment request" }, 400);
  }
  if (
    !isRecord(body) ||
    typeof body.pairingToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.pairingToken)
  ) {
    return json({ error: "Invalid enrollment request" }, 400);
  }

  const stub = env.RELAY_SESSION.getByName(sessionId);
  const enrollment = await stub.enroll(body.pairingToken);
  if (!enrollment) {
    return json(
      { error: "This pairing code is invalid, expired, or has already been used" },
      409,
      { "Cache-Control": "no-store" },
    );
  }
  return json(enrollment, 201, { "Cache-Control": "no-store" });
}

async function createDeviceInvitation(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const hostToken = getBearerToken(request.headers.get("Authorization"));
  if (!hostToken) return json({ error: "Unauthorized" }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid device invitation" }, 400);
  }
  if (!isRecord(body) || typeof body.name !== "string") {
    return json({ error: "A device name is required" }, 400);
  }
  const name = body.name.trim();
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    return json({ error: "Device names must be 1 to 64 characters" }, 400);
  }
  const stub = env.RELAY_SESSION.getByName(sessionId);
  const invitation = await stub.createInvitation(hostToken, name);
  if (!invitation) return json({ error: "Unauthorized" }, 401);
  return json(
    {
      pairingCode: `${sessionId}.${invitation.pairingToken}`,
      expiresAt: invitation.expiresAt,
      name,
    },
    201,
    { "Cache-Control": "no-store" },
  );
}

async function getTrustedDevice(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const viewerToken = getBearerToken(request.headers.get("Authorization"));
  if (!viewerToken) return json({ error: "Unauthorized" }, 401);
  const stub = env.RELAY_SESSION.getByName(sessionId);
  const device = await stub.getDevice(viewerToken);
  if (!device) return json({ error: "Trusted device not found" }, 401);
  return json({ device }, 200, { "Cache-Control": "no-store" });
}

async function listTrustedDevices(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const hostToken = getBearerToken(request.headers.get("Authorization"));
  if (!hostToken) return json({ error: "Unauthorized" }, 401);
  const stub = env.RELAY_SESSION.getByName(sessionId);
  const devices = await stub.listDevices(hostToken);
  if (!devices) return json({ error: "Unauthorized" }, 401);
  return json({
    devices: devices.map((device) => ({
      id: device.device_id,
      name: device.name,
      createdAt: device.created_at,
      lastConnectedAt: device.last_connected_at,
    })),
  }, 200, { "Cache-Control": "no-store" });
}

async function removeTrustedDevice(
  request: Request,
  env: Env,
  sessionId: string,
  deviceId: string,
): Promise<Response> {
  const hostToken = getBearerToken(request.headers.get("Authorization"));
  if (!hostToken) return json({ error: "Unauthorized" }, 401);
  const stub = env.RELAY_SESSION.getByName(sessionId);
  const removed = await stub.revokeDevice(hostToken, deviceId);
  if (removed === null) return json({ error: "Unauthorized" }, 401);
  if (!removed) return json({ error: "Trusted device not found" }, 404);
  return json({ removed: true });
}

function getBearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

function getAttachment(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (
    !isRecord(value) ||
    (value.role !== "host" && value.role !== "secure" && value.role !== "viewer") ||
    typeof value.clientId !== "string" ||
    typeof value.connectedAt !== "number"
  ) {
    return null;
  }
  return {
    role: value.role,
    clientId: value.clientId,
    connectedAt: value.connectedAt,
    ...(typeof value.deviceId === "string" ? { deviceId: value.deviceId } : {}),
    ...(typeof value.secureActive === "boolean" ? { secureActive: value.secureActive } : {}),
    ...(typeof value.desktopName === "string" ? { desktopName: value.desktopName } : {}),
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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
