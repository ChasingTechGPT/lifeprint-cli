/**
 * Shared browser utility for opening URLs in the default browser.
 */

/**
 * Open a URL in the default browser
 */
export async function openBrowser(url: string): Promise<void> {
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
