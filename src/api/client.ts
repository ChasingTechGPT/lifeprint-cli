/**
 * HTTP API client for LifePrint CLI
 * Handles authenticated requests to LifePrint API
 */

import { getValidAccessToken } from "../auth/token-refresh.ts";

const DEFAULT_API_BASE = "https://auth.lifeprintpro.com/functions/v1";

/**
 * Get the API base URL (can be overridden via environment variable)
 */
export function getApiBaseUrl(): string {
  return Deno.env.get("LIFEPRINT_API_URL") || DEFAULT_API_BASE;
}

/**
 * Error thrown when API requests fail
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Error thrown when authentication is required
 */
export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required. Run 'lifeprint login' first.");
    this.name = "AuthRequiredError";
  }
}

/**
 * Generic API response type
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Make an authenticated API request
 */
export async function apiRequest<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    requireAuth?: boolean;
  } = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, requireAuth = true } = options;

  // Get access token if authentication is required
  let accessToken: string | null = null;
  if (requireAuth) {
    accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new AuthRequiredError();
    }
  }

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${getApiBaseUrl()}/${endpoint.replace(/^\//, "")}`;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (accessToken) {
    requestHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorMessage = `API request failed: ${response.status}`;
    let errorCode: string | undefined;

    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorBody.message || errorMessage;
      errorCode = errorBody.code;
    } catch {
      // Ignore JSON parse errors
    }

    throw new ApiError(errorMessage, response.status, errorCode);
  }

  return response.json();
}

/**
 * Call a LifePrint tool via the API
 */
export async function callTool<T>(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return apiRequest<T>("lifeprint-api", {
    method: "POST",
    body: {
      tool_name: toolName,
      arguments: args,
    },
  });
}

/**
 * Streaming tool call result
 */
export interface StreamChunk {
  type: "text" | "progress" | "complete" | "error";
  content?: string;
  progress?: number;
  data?: unknown;
  error?: string;
}

/**
 * Call a LifePrint tool with streaming response
 */
export async function* callToolStreaming(
  toolName: string,
  args: Record<string, unknown> = {}
): AsyncGenerator<StreamChunk> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new AuthRequiredError();
  }

  const url = `${getApiBaseUrl()}/lifeprint-api`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      tool_name: toolName,
      arguments: args,
      stream: true,
    }),
  });

  if (!response.ok) {
    let errorMessage = `API request failed: ${response.status}`;
    try {
      const errorBody = await response.json();
      errorMessage = errorBody.error || errorBody.message || errorMessage;
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiError(errorMessage, response.status);
  }

  // Check if response is actually a stream
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    // Not a stream, return as complete
    const data = await response.json();
    yield { type: "complete", data };
    return;
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError("No response body", 500);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            yield parsed as StreamChunk;
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
