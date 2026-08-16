export interface RelayCredentials {
  sessionId: string;
  hostToken: string;
  viewerToken: string;
  pairingCode: string;
  relayUrl: string;
  expiresAt: number;
}

export async function createRelaySession(
  relayUrl: string,
  adminToken: string,
  expiresInHours: number,
): Promise<RelayCredentials> {
  const response = await fetch(`${relayUrl}/api/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresInHours }),
    signal: AbortSignal.timeout(15_000),
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : `Relay returned HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!isRelayCredentials(body)) {
    throw new Error("Relay returned an invalid session response.");
  }
  return body;
}

function isRelayCredentials(value: unknown): value is RelayCredentials {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.hostToken === "string" &&
    typeof value.viewerToken === "string" &&
    typeof value.pairingCode === "string" &&
    typeof value.relayUrl === "string" &&
    typeof value.expiresAt === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
