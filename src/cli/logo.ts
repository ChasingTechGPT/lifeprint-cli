/**
 * LifePrint CLI logo rendering
 * Hardcoded Unicode block art with ANSI colors (same approach as Claude Code).
 */

const G = "\x1b[38;2;29;191;115m"; // Brand green
const R = "\x1b[0m"; // Reset
const B = "\x1b[1m"; // Bold

// LifePrint emblem: diamond + 3 nested chevrons
const LOGO = `
${G}                \u2588
               \u2588\u2588\u2588
              \u2588\u2588\u2588\u2588\u2588
               \u2588\u2588\u2588
                \u2588

           \u2588\u2588       \u2588\u2588
            \u2588\u2588     \u2588\u2588
             \u2588\u2588   \u2588\u2588
              \u2588\u2588\u2588\u2588\u2588

         \u2588\u2588           \u2588\u2588
          \u2588\u2588         \u2588\u2588
           \u2588\u2588       \u2588\u2588
            \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588

       \u2588\u2588               \u2588\u2588
        \u2588\u2588             \u2588\u2588
         \u2588\u2588           \u2588\u2588
          \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${R}
`;

/** Print the full banner: logo + title */
export function printBanner(): void {
  const banner = `${LOGO}\n       ${B}LifePrint CLI Setup${R}\n`;
  Deno.stdout.writeSync(new TextEncoder().encode(banner));
}
