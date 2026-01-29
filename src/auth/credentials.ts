/**
 * Credential storage and management for LifePrint CLI
 * Stores OAuth tokens in ~/.lifeprint/credentials.json
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";

export interface StoredCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO timestamp
  scopes: string[];
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface CredentialsFile {
  version: number;
  credentials: StoredCredentials | null;
}

const CREDENTIALS_VERSION = 1;

/**
 * Get the path to the LifePrint config directory
 */
export function getConfigDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  return join(home, ".lifeprint");
}

/**
 * Get the path to the credentials file
 */
export function getCredentialsPath(): string {
  return join(getConfigDir(), "credentials.json");
}

/**
 * Ensure the config directory exists
 */
export async function ensureConfigDir(): Promise<void> {
  await ensureDir(getConfigDir());
}

/**
 * Load credentials from disk
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const path = getCredentialsPath();
    const content = await Deno.readTextFile(path);
    const data: CredentialsFile = JSON.parse(content);

    if (data.version !== CREDENTIALS_VERSION) {
      console.error("Credentials file version mismatch, please login again");
      return null;
    }

    return data.credentials;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * Save credentials to disk
 */
export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await ensureConfigDir();
  const path = getCredentialsPath();

  const data: CredentialsFile = {
    version: CREDENTIALS_VERSION,
    credentials,
  };

  // Write with restricted permissions (owner read/write only)
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));

  // Set file permissions to 0600 (owner read/write only)
  if (Deno.build.os !== "windows") {
    await Deno.chmod(path, 0o600);
  }
}

/**
 * Delete credentials from disk
 */
export async function deleteCredentials(): Promise<void> {
  try {
    const path = getCredentialsPath();
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/**
 * Check if credentials are expired
 */
export function isExpired(credentials: StoredCredentials): boolean {
  const expiresAt = new Date(credentials.expires_at);
  const now = new Date();
  // Consider expired 5 minutes before actual expiration
  const bufferMs = 5 * 60 * 1000;
  return now.getTime() >= expiresAt.getTime() - bufferMs;
}

/**
 * Check if credentials exist and are valid (not expired)
 */
export async function hasValidCredentials(): Promise<boolean> {
  const credentials = await loadCredentials();
  if (!credentials) return false;
  return !isExpired(credentials);
}

/**
 * Get the current user info if logged in
 */
export async function getCurrentUser(): Promise<StoredCredentials["user"] | null> {
  const credentials = await loadCredentials();
  return credentials?.user ?? null;
}
