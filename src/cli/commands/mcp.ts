/**
 * MCP commands - serve, install, uninstall
 */

import { Command } from "@cliffy/command";
import { join } from "@std/path";
import { startMcpProxy } from "../../mcp/proxy.ts";

/**
 * Get Claude Code config path
 */
function getClaudeConfigPath(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  return join(home, ".claude.json");
}

/**
 * MCP server configuration for Claude Code
 */
interface McpServerConfig {
  type: "stdio";
  command: string;
  args: string[];
}

interface ClaudeConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export const mcpCommand = new Command()
  .description("MCP server commands for Claude Code integration")
  .command("serve", new Command()
    .description("Start the MCP stdio server")
    .action(async () => {
      await startMcpProxy();
    }))
  .command("install", new Command()
    .description("Configure Claude Code to use LifePrint MCP server")
    .option("-g, --global", "Install globally (default)")
    .option("--path <path:string>", "Path to lifeprint binary (auto-detected if not specified)")
    .action(async (options) => {
      const configPath = getClaudeConfigPath();

      // Read existing config or create new
      let config: ClaudeConfig = { mcpServers: {} };
      try {
        const existing = await Deno.readTextFile(configPath);
        config = JSON.parse(existing);
        config.mcpServers = config.mcpServers || {};
      } catch {
        // Config doesn't exist or is invalid, start fresh
      }

      // Determine the lifeprint command path
      let lifeprintPath = options.path;
      if (!lifeprintPath) {
        // Try to find the installed binary
        const paths = [
          join(Deno.env.get("HOME") || "", ".deno", "bin", "lifeprint"),
          "/usr/local/bin/lifeprint",
          "lifeprint", // Assume it's in PATH
        ];

        for (const p of paths) {
          try {
            if (p === "lifeprint") {
              // Check if it's in PATH
              const which = new Deno.Command("which", { args: ["lifeprint"] });
              const { success } = await which.output();
              if (success) {
                lifeprintPath = "lifeprint";
                break;
              }
            } else {
              await Deno.stat(p);
              lifeprintPath = p;
              break;
            }
          } catch {
            continue;
          }
        }

        if (!lifeprintPath) {
          // Use deno run as fallback
          const denoPath = Deno.execPath();
          const srcPath = new URL("../../mod.ts", import.meta.url).pathname;
          console.log("Could not find installed 'lifeprint' binary.");
          console.log("Configuring to use deno run instead.");
          console.log("\nTo install the binary, run:");
          console.log("  deno task install\n");

          config.mcpServers!["lifeprint"] = {
            type: "stdio",
            command: denoPath,
            args: [
              "run",
              "--allow-net",
              "--allow-read",
              "--allow-write",
              "--allow-env",
              "--allow-run",
              srcPath,
              "mcp",
              "serve",
            ],
          };

          await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
          console.log(`Updated ${configPath}`);
          console.log("\nRestart Claude Code for changes to take effect.");
          return;
        }
      }

      // Add LifePrint MCP server config
      config.mcpServers!["lifeprint"] = {
        type: "stdio",
        command: lifeprintPath,
        args: ["mcp", "serve"],
      };

      // Write config
      await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));

      console.log(`LifePrint MCP server configured in ${configPath}`);
      console.log(`Command: ${lifeprintPath} mcp serve`);
      console.log("\nRestart Claude Code for changes to take effect.");
    }))
  .command("uninstall", new Command()
    .description("Remove LifePrint MCP server from Claude Code config")
    .action(async () => {
      const configPath = getClaudeConfigPath();

      try {
        const existing = await Deno.readTextFile(configPath);
        const config: ClaudeConfig = JSON.parse(existing);

        if (config.mcpServers?.["lifeprint"]) {
          delete config.mcpServers["lifeprint"];
          await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
          console.log("LifePrint MCP server removed from Claude Code config.");
          console.log("\nRestart Claude Code for changes to take effect.");
        } else {
          console.log("LifePrint MCP server is not configured.");
        }
      } catch {
        console.log("Claude Code config not found or invalid.");
      }
    }));
