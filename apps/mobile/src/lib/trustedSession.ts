import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { PairingDetails } from '../types';
import { parseStoredPairingDetails } from './pairing';

const TRUSTED_SESSION_KEY = 'pocketdesk.trusted-session.v1';

export async function loadTrustedSession(): Promise<PairingDetails | null> {
  if (Platform.OS === 'web') return null;
  const stored = await SecureStore.getItemAsync(TRUSTED_SESSION_KEY);
  if (!stored) return null;
  const details = parseStoredPairingDetails(stored);
  if (!details) await SecureStore.deleteItemAsync(TRUSTED_SESSION_KEY);
  return details;
}

export async function saveTrustedSession(details: PairingDetails): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(TRUSTED_SESSION_KEY, JSON.stringify(details), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function forgetTrustedSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(TRUSTED_SESSION_KEY);
}
