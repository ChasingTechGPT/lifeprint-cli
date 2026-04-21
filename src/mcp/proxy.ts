/**
 * MCP proxy that forwards requests to the remote sage-mcp endpoint.
 *
 * PRD-B02 (2026-04-21): Migrated from /lifeprint-mcp to /sage-mcp.
 *   - sage-mcp is the strategic MCP server per PRD-02 ADR-001
 *   - Exposes all 42 tools from sage_chat_tools registry (vs
 *     lifeprint-mcp's 25 hand-registered UniversalTools)
 *   - New tools ship via DB migration and show up in tools/list
 *     automatically (no hand-registration)
 *   - Supports both Supabase JWT and opaque OAuth bearers
 *     (sage-mcp/auth.ts detects JWT shape; CLI's opaque bearers
 *     are validated against oauth_tokens via _shared/OAuth)
 *   - Scope-gates tools per OAuth session scopes (sage-mcp/scope-map.ts)
 *
 * To roll back: change `MCP_ENDPOINT` below back to `/lifeprint-mcp`.
 * lifeprint-mcp remains deployed for backward-compat during the
 * ~30-day deprecation window.
 */

import { getValidAccessToken } from "../auth/token-refresh.ts";
import { getApiBaseUrl } from "../api/client.ts";
import {
  readMessage,
  writeResult,
  writeError,
  ErrorCodes,
  type JsonRpcRequest,
} from "./stdio.ts";

const MCP_ENDPOINT = "/sage-mcp";

/**
 * Forward a JSON-RPC request to the remote MCP endpoint
 */
async function forwardToRemote(
  request: JsonRpcRequest,
  accessToken: string
): Promise<unknown> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}${MCP_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Remote MCP error: ${response.status} ${error}`);
  }

  const result = await response.json();
  return result;
}

/**
 * Handle the initialize method locally for compatibility
 */
function handleInitialize(id: string | number | null): void {
  writeResult(id, {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
      resources: {},
    },
    serverInfo: {
      name: "lifeprint-cli",
      version: "0.1.0",
    },
  });
}

/**
 * Start the MCP proxy server
 * Reads from stdin, forwards to remote, writes to stdout
 */
export async function startMcpProxy(): Promise<void> {
  // Get stdin reader
  const stdinReader = Deno.stdin.readable.getReader();

  // Log to stderr for debugging (stdout is reserved for JSON-RPC)
  const debug = (msg: string) => {
    const encoder = new TextEncoder();
    Deno.stderr.writeSync(encoder.encode(`[lifeprint-mcp] ${msg}\n`));
  };

  debug("MCP proxy starting...");

  // Get initial access token
  let accessToken = await getValidAccessToken();

  if (!accessToken) {
    debug("Not authenticated. Please run 'lifeprint login' first.");
    Deno.exit(1);
  }

  debug("Authenticated, ready to process requests");

  while (true) {
    try {
      const request = await readMessage(stdinReader);

      if (request === null) {
        // End of input
        debug("End of input, shutting down");
        break;
      }

      debug(`Received: ${request.method}`);

      // Handle some methods locally for better compatibility
      if (request.method === "initialize") {
        handleInitialize(request.id ?? null);
        continue;
      }

      if (request.method === "notifications/initialized") {
        // No response needed for notification
        continue;
      }

      // Refresh token if needed
      const newToken = await getValidAccessToken();
      if (newToken) {
        accessToken = newToken;
      } else {
        writeError(
          request.id ?? null,
          ErrorCodes.AuthRequired,
          "Authentication expired. Please run 'lifeprint login' again."
        );
        continue;
      }

      // Forward to remote
      try {
        const result = await forwardToRemote(request, accessToken);

        // If result is already a JSON-RPC response, extract just the result
        if (
          typeof result === "object" &&
          result !== null &&
          "jsonrpc" in result
        ) {
          const rpcResult = result as { result?: unknown; error?: unknown };
          if (rpcResult.error) {
            const err = rpcResult.error as { code: number; message: string; data?: unknown };
            writeError(request.id ?? null, err.code, err.message, err.data);
          } else {
            writeResult(request.id ?? null, rpcResult.result);
          }
        } else {
          writeResult(request.id ?? null, result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debug(`Error forwarding request: ${message}`);
        writeError(request.id ?? null, ErrorCodes.ServerError, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debug(`Error processing request: ${message}`);
      // Continue processing other requests
    }
  }

  stdinReader.releaseLock();
}
