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
