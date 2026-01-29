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
  <meta name="theme-color" content="#0f172a">
  <title>Login Successful - LifePrint CLI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      background: #0f172a;
      background-image:
        radial-gradient(circle at 30% 20%, rgba(29, 191, 115, 0.12) 0%, transparent 50%),
        radial-gradient(circle at 70% 80%, rgba(18, 184, 178, 0.08) 0%, transparent 50%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .container {
      background: white;
      border-radius: 1.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      padding: 2.5rem 2rem;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    .icon {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #1dbf73, #12b8b2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
    }
    .icon svg { width: 32px; height: 32px; color: white; }
    h1 { font-size: 1.375rem; font-weight: 700; color: #222325; margin-bottom: 0.625rem; }
    p { color: #37393c; margin-bottom: 0.5rem; font-size: 0.9375rem; line-height: 1.5; }
    .note { font-size: 0.8125rem; color: #6b7280; margin-top: 1rem; }
    .emblem { margin-top: 1.5rem; opacity: 0.15; }
    .emblem svg { width: 32px; height: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>You're Connected</h1>
    <p>You can now close this window and return to your terminal.</p>
    <p class="note">The LifePrint CLI is now authenticated.</p>
    <div class="emblem">
      <svg viewBox="0 0 348.5 315.2" xmlns="http://www.w3.org/2000/svg">
        <g fill="#222325" stroke-width="0">
          <path d="M298.62,102.21c13.19,13.19,16.69,33.41,8.29,50.07-5.59,11.08-13,21.47-22.25,30.71l-58.3,58.3c-28.8,28.8-75.48,28.8-104.28,0l-58.3-58.3c-9.25-9.25-16.67-19.65-22.25-30.73-8.39-16.66-4.89-36.87,8.29-50.06l9.46-9.46c-1.58,27.58,8.17,55.69,29.24,76.76l50,50c19.72,19.72,51.69,19.72,71.41,0l50-50c19.6-19.62,29.42-45.31,29.42-71.02,0-1.9-.05-3.82-.17-5.72l9.45,9.45Z"/>
          <path d="M340.28,195.49c-5,6.9-10.58,13.46-16.82,19.65l-65.27,65.27c-46.38,46.38-121.58,46.38-167.96,0L24.96,215.15c-6.11-6.11-11.64-12.57-16.55-19.3-5.67-7.7-8.41-16.77-8.41-25.76,0-11.2,4.29-22.35,12.75-30.81,6.64,22.84,18.94,44.39,36.96,62.41l58.51,58.51c36.47,36.43,95.56,36.43,132.03-.04l58.51-58.47c18.01-18.01,30.32-39.57,36.91-62.41,15.09,15.09,17.17,38.99,4.6,56.21Z"/>
          <path d="M257.89,61.24l-45.38-45.38c-21.15-21.15-55.43-21.15-76.57,0l-45.38,45.38c-15.06,15.06-19,37.06-11.72,55.76,2.54-6.56,6.43-12.69,11.72-17.98l16.54-16.54,45.44-45.44h0c11.98-11.98,31.39-11.98,43.37,0l61.98,61.98c5.29,5.29,9.22,11.42,11.72,17.98,7.28-18.7,3.34-40.7-11.72-55.76Z"/>
          <path d="M245.91,111.01l-1.4-1.44c-.85,1.48-1.9,2.83-3.17,4.1l-61.97,62.01c-2.84,2.84-7.45,2.84-10.29,0l-61.98-62.01c-1.27-1.27-2.33-2.62-3.17-4.1l-1.4,1.44c-.08.04-.13.13-.21.21-9.86,10.03-9.1,26.4.85,36.34l50.78,50.72c11.21,11.2,29.38,11.2,40.59,0l50.75-50.72c9.94-9.94,10.7-26.32.85-36.34-.08-.08-.13-.17-.21-.21Z"/>
        </g>
      </svg>
    </div>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
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
  <meta name="theme-color" content="#0f172a">
  <title>Login Failed - LifePrint CLI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      background: #0f172a;
      background-image: radial-gradient(circle at 30% 20%, rgba(239, 68, 68, 0.08) 0%, transparent 50%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .container {
      background: white;
      border-radius: 1.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      padding: 2.5rem 2rem;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    .icon {
      width: 64px;
      height: 64px;
      background: #fee2e2;
      border-radius: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
    }
    .icon svg { width: 28px; height: 28px; color: #dc2626; }
    h1 { font-size: 1.375rem; font-weight: 700; color: #222325; margin-bottom: 0.5rem; }
    p { color: #37393c; margin-bottom: 1rem; font-size: 0.9375rem; line-height: 1.5; }
    .error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.75rem; padding: 1rem; color: #991b1b; font-size: 0.8125rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </div>
    <h1>Login Failed</h1>
    <p>Please try again from the terminal.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>
`;
}
