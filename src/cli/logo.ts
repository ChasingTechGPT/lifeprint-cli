/**
 * LifePrint CLI logo rendering
 * Renders the emblem via chafa (if available) with ASCII block art fallback.
 */

import { decodeBase64 } from "@std/encoding/base64";

// White-on-transparent PNG of the LifePrint emblem (~100x90px)
const LOGO_PNG_BASE64 =
  "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";

// Hand-crafted ASCII block art fallback
const ASCII_FALLBACK = [
  "",
  "\x1b[38;2;29;191;115m                \u2588",
  "               \u2588\u2588\u2588",
  "              \u2588\u2588\u2588\u2588\u2588",
  "               \u2588\u2588\u2588",
  "                \u2588",
  "",
  "           \u2588\u2588       \u2588\u2588",
  "            \u2588\u2588     \u2588\u2588",
  "             \u2588\u2588   \u2588\u2588",
  "              \u2588\u2588\u2588\u2588\u2588",
  "",
  "         \u2588\u2588           \u2588\u2588",
  "          \u2588\u2588         \u2588\u2588",
  "           \u2588\u2588       \u2588\u2588",
  "            \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "",
  "       \u2588\u2588               \u2588\u2588",
  "        \u2588\u2588             \u2588\u2588",
  "         \u2588\u2588           \u2588\u2588",
  "          \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\x1b[0m",
  "",
].join("\n");

const BRAND_GREEN = "\x1b[38;2;29;191;115m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/** Check if chafa is available on PATH */
async function detectChafa(): Promise<boolean> {
  try {
    const cmd = Deno.build.os === "windows" ? "where" : "which";
    const proc = new Deno.Command(cmd, {
      args: ["chafa"],
      stdout: "null",
      stderr: "null",
    });
    const { success } = await proc.output();
    return success;
  } catch {
    return false;
  }
}

/** Render the logo PNG via chafa, returns colored output string */
async function renderWithChafa(): Promise<string> {
  const pngBytes = decodeBase64(LOGO_PNG_BASE64);
  const tmpPath = await Deno.makeTempFile({ suffix: ".png" });

  try {
    await Deno.writeFile(tmpPath, pngBytes);

    const proc = new Deno.Command("chafa", {
      args: [
        "--size=25x15",
        "--symbols=block+border",
        "--fg-only",
        "--work=9",
        "--center=off",
        tmpPath,
      ],
      stdout: "piped",
      stderr: "null",
    });

    const { success, stdout } = await proc.output();
    if (!success) {
      throw new Error("chafa exited with non-zero status");
    }

    const raw = new TextDecoder().decode(stdout).trimEnd();
    // Wrap in brand green
    return `${BRAND_GREEN}${raw}${RESET}`;
  } finally {
    try {
      await Deno.remove(tmpPath);
    } catch {
      // Silently ignore cleanup failures
    }
  }
}

/** Render the LifePrint logo, preferring chafa with ASCII fallback */
export async function renderLogo(): Promise<string> {
  try {
    if (await detectChafa()) {
      return await renderWithChafa();
    }
  } catch {
    // Fall through to ASCII
  }
  return ASCII_FALLBACK;
}

/** Print the full banner: logo + title */
export async function printBanner(): Promise<void> {
  const logo = await renderLogo();
  console.log(logo);
  console.log(`       ${BOLD}LifePrint CLI Setup${RESET}`);
  console.log("");
}
