/**
 * Token refresh logic for LifePrint CLI
 */

import {
  loadCredentials,
  saveCredentials,
  isExpired,
  type StoredCredentials,
} from "./credentials.ts";
import { getApiBaseUrl } from "../api/client.ts";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface UserInfoResponse {
  id: string;
  email: string;
  full_name?: string;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/oauth-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "lifeprint-cli",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data: TokenResponse = await response.json();

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(): Promise<string | null> {
  const credentials = await loadCredentials();
  if (!credentials) {
    return null;
  }

  // If token is still valid, return it
  if (!isExpired(credentials)) {
    return credentials.access_token;
  }

  // Try to refresh
  try {
    const { accessToken, refreshToken, expiresAt } = await refreshAccessToken(
      credentials.refresh_token
    );

    // Update stored credentials
    const updatedCredentials: StoredCredentials = {
      ...credentials,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt.toISOString(),
    };

    await saveCredentials(updatedCredentials);
    return accessToken;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    return null;
  }
}

/**
 * Fetch user info from the API
 */
export async function fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/oauth-userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch user info: ${error}`);
  }

  return response.json();
}
