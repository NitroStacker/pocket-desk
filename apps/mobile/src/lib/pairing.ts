import type { PairingDetails } from '../types';

const SESSION_PATTERN = /^[a-f0-9-]{36}$/i;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function parsePairingDetails(
  relayValue: string,
  pairingValue: string,
): PairingDetails {
  const relayUrl = normalizeRelayUrl(relayValue);
  const separator = pairingValue.trim().indexOf('.');
  if (separator < 0) {
    throw new Error('The pairing code should contain a session and secure key.');
  }

  const sessionId = pairingValue.trim().slice(0, separator);
  const viewerToken = pairingValue.trim().slice(separator + 1);
  if (!SESSION_PATTERN.test(sessionId) || !TOKEN_PATTERN.test(viewerToken)) {
    throw new Error('That pairing code is incomplete or invalid.');
  }

  return { relayUrl, sessionId, viewerToken };
}

export function buildSocketUrl(details: PairingDetails): string {
  const socketOrigin = details.relayUrl.replace(/^http/, 'ws');
  return `${socketOrigin}/connect/${encodeURIComponent(details.sessionId)}`;
}

export async function checkTrustedDevice(details: PairingDetails): Promise<boolean | null> {
  try {
    const response = await fetch(
      `${details.relayUrl}/api/sessions/${encodeURIComponent(details.sessionId)}/device`,
      {
        headers: {
          Authorization: `Bearer ${details.viewerToken}`,
          'Cache-Control': 'no-store',
        },
      },
    );
    if (response.status === 401 || response.status === 404) return false;
    return response.ok ? true : null;
  } catch {
    return null;
  }
}

export async function enrollPairingCode(
  relayValue: string,
  pairingValue: string,
): Promise<PairingDetails> {
  const enrollment = parsePairingDetails(relayValue, pairingValue);
  const response = await fetch(
    `${enrollment.relayUrl}/api/sessions/${encodeURIComponent(enrollment.sessionId)}/enroll`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pairingToken: enrollment.viewerToken }),
    },
  );

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // The status-specific message below is more useful than a JSON parse failure.
  }
  if (!response.ok) {
    const relayMessage = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : response.status === 409
        ? 'That code has already been used. Reset pairing on the PC to pair again.'
        : 'The relay could not pair this phone.';
    throw new Error(relayMessage);
  }
  if (
    !isRecord(body) ||
    typeof body.viewerToken !== 'string' ||
    !TOKEN_PATTERN.test(body.viewerToken) ||
    typeof body.deviceId !== 'string' ||
    !SESSION_PATTERN.test(body.deviceId) ||
    typeof body.deviceName !== 'string'
  ) {
    throw new Error('The relay returned an invalid trusted-device key.');
  }
  return {
    ...enrollment,
    viewerToken: body.viewerToken,
    deviceId: body.deviceId,
    deviceName: body.deviceName,
  };
}

export function parseStoredPairingDetails(value: string): PairingDetails | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      typeof parsed.relayUrl !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.viewerToken !== 'string'
    ) return null;
    const details = parsePairingDetails(
      parsed.relayUrl,
      `${parsed.sessionId}.${parsed.viewerToken}`,
    );
    if (
      typeof parsed.deviceId !== 'string' ||
      !SESSION_PATTERN.test(parsed.deviceId) ||
      typeof parsed.deviceName !== 'string'
    ) return null;
    return { ...details, deviceId: parsed.deviceId, deviceName: parsed.deviceName };
  } catch {
    return null;
  }
}

function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter the full relay URL, including https://.');
  }

  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('Use a secure https:// relay URL.');
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
