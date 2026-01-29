/**
 * OAuth browser login flow for LifePrint CLI
 * Implements OAuth 2.0 Authorization Code flow with PKCE
 */

import { encodeBase64Url } from "@std/encoding/base64url";
import { saveCredentials, type StoredCredentials } from "./credentials.ts";
import { getApiBaseUrl } from "../api/client.ts";

const CLIENT_ID = "lifeprint-cli";
const CALLBACK_PORTS = [8080, 8081, 8082, 8083, 8084];
const DEFAULT_SCOPES = [
  "profile:read",
  "agenda:read",
  "agenda:write",
  "meals:read",
  "meals:write",
  "movement:read",
  "movement:write",
  "meditation:read",
  "meditation:write",
  "household:read",
  "memory:read",
];

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
 * Generate a cryptographically secure random string for PKCE
 */
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // RFC 7636: code_verifier is base64url without padding, 43-128 chars
  return encodeBase64Url(bytes);
}

/**
 * Generate code challenge from verifier using S256 method
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return encodeBase64Url(new Uint8Array(hashBuffer));
}

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/**
 * Try to start a local HTTP server on one of the callback ports
 */
async function startCallbackServer(
  onCallback: (code: string | null, error: string | null) => void
): Promise<{ server: Deno.HttpServer; port: number }> {
  for (const port of CALLBACK_PORTS) {
    try {
      const controller = new AbortController();
      const server = Deno.serve(
        {
          port,
          signal: controller.signal,
          onListen: () => {
            // Server started successfully
          },
        },
        (req: Request) => {
          const url = new URL(req.url);

          if (url.pathname === "/callback") {
            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");
            const errorDesc = url.searchParams.get("error_description");

            // Call the callback with result
            onCallback(code, error ? `${error}: ${errorDesc}` : null);

            // Return a success page
            if (code) {
              return new Response(getSuccessHtml(), {
                status: 200,
                headers: { "Content-Type": "text/html" },
              });
            } else {
              return new Response(getErrorHtml(error || "Unknown error"), {
                status: 400,
                headers: { "Content-Type": "text/html" },
              });
            }
          }

          return new Response("Not Found", { status: 404 });
        }
      );

      return { server, port };
    } catch {
      // Port is in use, try the next one
      continue;
    }
  }

  throw new Error(
    `Could not start callback server. Ports ${CALLBACK_PORTS.join(", ")} are all in use.`
  );
}

/**
 * Open a URL in the default browser
 */
async function openBrowser(url: string): Promise<void> {
  const cmd = Deno.build.os === "darwin"
    ? ["open", url]
    : Deno.build.os === "windows"
      ? ["cmd", "/c", "start", url]
      : ["xdg-open", url];

  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "null",
    stderr: "null",
  });

  await command.spawn();
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/oauth-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || error.error || "Token exchange failed");
  }

  return response.json();
}

/**
 * Fetch user info using access token
 */
async function fetchUserInfo(accessToken: string): Promise<UserInfoResponse> {
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

/**
 * Perform the browser-based OAuth login flow
 */
export async function browserLogin(): Promise<StoredCredentials> {
  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Start the callback server
  let receivedCode: string | null = null;
  let receivedError: string | null = null;
  const codeReceived = new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 0); // Will be resolved by callback
  });

  const { server, port } = await startCallbackServer((code, error) => {
    receivedCode = code;
    receivedError = error;
  });

  const redirectUri = `http://localhost:${port}/callback`;

  // Build authorization URL
  const baseUrl = getApiBaseUrl();
  const authParams = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DEFAULT_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${baseUrl}/oauth-authorize?${authParams.toString()}`;

  console.log("\nOpening browser for authentication...");
  console.log(`If the browser doesn't open, visit: ${authUrl}\n`);

  // Open browser
  await openBrowser(authUrl);

  console.log("Waiting for authorization...");

  // Wait for callback (with timeout)
  const timeout = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();

  while (!receivedCode && !receivedError) {
    if (Date.now() - startTime > timeout) {
      await server.shutdown();
      throw new Error("Login timed out. Please try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Shutdown the callback server
  await server.shutdown();

  if (receivedError) {
    throw new Error(`Authorization failed: ${receivedError}`);
  }

  if (!receivedCode) {
    throw new Error("No authorization code received");
  }

  console.log("Authorization received, exchanging for tokens...");

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(receivedCode, codeVerifier, redirectUri);

  // Fetch user info
  const userInfo = await fetchUserInfo(tokens.access_token);

  // Calculate expiration
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Build credentials object
  const credentials: StoredCredentials = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt.toISOString(),
    scopes: tokens.scope.split(" "),
    user: {
      id: userInfo.id,
      email: userInfo.email,
      name: userInfo.full_name || userInfo.email.split("@")[0],
    },
  };

  // Save credentials
  await saveCredentials(credentials);

  return credentials;
}

/**
 * Success page HTML
 */
function getSuccessHtml(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Successful - LifePrint CLI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .container {
      background: white;
      border-radius: 1rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      padding: 3rem;
      text-align: center;
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; color: #111827; margin-bottom: 0.5rem; }
    p { color: #6b7280; margin-bottom: 1.5rem; }
    .note { font-size: 0.875rem; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✓</div>
    <h1>Login Successful!</h1>
    <p>You can now close this window and return to your terminal.</p>
    <p class="note">The LifePrint CLI is now authenticated.</p>
  </div>
  <script>
    // Auto-close after 3 seconds
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>
`;
}

/**
 * Error page HTML
 */
function getErrorHtml(error: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Failed - LifePrint CLI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .container {
      background: white;
      border-radius: 1rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      padding: 3rem;
      text-align: center;
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; color: #111827; margin-bottom: 0.5rem; }
    p { color: #6b7280; margin-bottom: 1rem; }
    .error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 1rem; color: #991b1b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✕</div>
    <h1>Login Failed</h1>
    <p>Please try again from the terminal.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>
`;
}
