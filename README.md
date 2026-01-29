# LifePrint CLI

Command-line interface for LifePrint with MCP (Model Context Protocol) support for Claude Code integration.

## Installation

### Using Deno

```bash
# Install globally
cd packages/lifeprint-cli
deno task install

# Or run directly
deno task dev --help
```

### Compile to binary

```bash
# Compile for current platform
deno task compile

# Compile for all platforms
deno task compile:all
```

## Usage

### Authentication

```bash
# Login via browser
lifeprint login

# Check status
lifeprint status

# Logout
lifeprint logout
```

### MCP Integration (Claude Code)

```bash
# Configure Claude Code to use LifePrint MCP
lifeprint mcp install

# Remove configuration
lifeprint mcp uninstall

# Start MCP server manually (used by Claude Code)
lifeprint mcp serve
```

### Commands

```bash
# Agenda
lifeprint agenda today
lifeprint agenda show 2026-01-30

# Recipes
lifeprint recipe generate "healthy breakfast with eggs"
lifeprint recipe search "pasta"

# Meal Plans
lifeprint mealplan week
lifeprint mealplan schedule

# Movement
lifeprint movement generate "10 minute morning stretch"
lifeprint movement search --type yoga

# Meditation
lifeprint meditation generate "stress relief session"
lifeprint meditation search --type breathing

# Household
lifeprint household members
```

## How It Works

### Browser Login Flow

1. `lifeprint login` starts a local HTTP server
2. Opens your browser to LifePrint's OAuth consent page
3. After approval, browser redirects to localhost with auth code
4. CLI exchanges code for tokens using PKCE
5. Credentials stored securely in `~/.lifeprint/credentials.json`

### MCP Proxy

The `lifeprint mcp serve` command acts as a proxy between Claude Code and LifePrint's API:

```
Claude Code <--stdio--> lifeprint mcp serve <--HTTPS--> LifePrint API
```

- Reads JSON-RPC requests from stdin
- Authenticates using stored OAuth tokens
- Forwards requests to remote MCP endpoint
- Writes responses to stdout

### Claude Code Configuration

After running `lifeprint mcp install`, your `~/.claude.json` will include:

```json
{
  "mcpServers": {
    "lifeprint": {
      "type": "stdio",
      "command": "lifeprint",
      "args": ["mcp", "serve"]
    }
  }
}
```

Restart Claude Code to activate the integration.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LIFEPRINT_API_URL` | API base URL | `https://auth.lifeprintpro.com/functions/v1` |

## Development

```bash
# Run in development mode
deno task dev login

# Run tests
deno task test
```

## Troubleshooting

### "Not logged in" error
Run `lifeprint login` to authenticate.

### Token expired
Tokens auto-refresh. If issues persist, run `lifeprint login --force`.

### MCP not working in Claude Code
1. Run `lifeprint mcp install`
2. Restart Claude Code
3. Check `~/.claude.json` for correct configuration

### Port conflicts during login
The CLI tries ports 8080-8084 for the OAuth callback. Ensure at least one is available.
