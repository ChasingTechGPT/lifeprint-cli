/**
 * MCP stdio transport implementation
 * Handles JSON-RPC 2.0 over stdin/stdout
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/**
 * Read a JSON-RPC message from stdin
 */
export async function readMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<JsonRpcRequest | null> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return null;
    }

    buffer += decoder.decode(value, { stream: true });

    // Try to parse complete JSON objects
    // MCP uses newline-delimited JSON
    const lines = buffer.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        try {
          const message = JSON.parse(line) as JsonRpcRequest;
          // Remove processed lines from buffer
          buffer = lines.slice(i + 1).join("\n");
          return message;
        } catch {
          // Invalid JSON, skip this line
        }
      }
    }
    // Keep the last incomplete line in buffer
    buffer = lines[lines.length - 1];
  }
}

/**
 * Write a JSON-RPC message to stdout
 */
export function writeMessage(message: JsonRpcResponse | JsonRpcNotification): void {
  const json = JSON.stringify(message);
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(json + "\n"));
}

/**
 * Write an error response
 */
export function writeError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  });
}

/**
 * Write a success response
 */
export function writeResult(id: string | number | null, result: unknown): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

/**
 * Standard JSON-RPC error codes
 */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Custom codes
  AuthRequired: -32001,
  ServerError: -32000,
};
