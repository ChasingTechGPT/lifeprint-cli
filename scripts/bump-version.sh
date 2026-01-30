#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

VERSION="$1"

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be semver (e.g. 0.2.0)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Bumping CLI to v${VERSION}..."

# 1. deno.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$CLI_DIR/deno.json"
echo "  ✓ deno.json"

# 2. src/cli/mod.ts
sed -i '' "s/const VERSION = \"[^\"]*\"/const VERSION = \"${VERSION}\"/" "$CLI_DIR/src/cli/mod.ts"
echo "  ✓ src/cli/mod.ts"

# 3. src/mcp/proxy.ts
sed -i '' "s/version: \"[^\"]*\"/version: \"${VERSION}\"/" "$CLI_DIR/src/mcp/proxy.ts"
echo "  ✓ src/mcp/proxy.ts"

# 4. npm/package.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$CLI_DIR/npm/package.json"
echo "  ✓ npm/package.json"

# 5. homebrew/lifeprint.rb
sed -i '' "s/version \"[^\"]*\"/version \"${VERSION}\"/" "$CLI_DIR/homebrew/lifeprint.rb"
echo "  ✓ homebrew/lifeprint.rb"

# Stage and commit
git add \
  "$CLI_DIR/deno.json" \
  "$CLI_DIR/src/cli/mod.ts" \
  "$CLI_DIR/src/mcp/proxy.ts" \
  "$CLI_DIR/npm/package.json" \
  "$CLI_DIR/homebrew/lifeprint.rb"

git commit -m "Bump CLI to v${VERSION}"
git tag "cli-v${VERSION}"

echo ""
echo "Done. Push with: git push origin development --tags"
