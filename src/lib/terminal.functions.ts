import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";

// Allow-listed terminal commands. Free-form shell is not exposed.
// On non-Pi runtime (Cloudflare Worker / vite dev on laptop), returns a
// friendly preview reply so the landing demo and local dev still work.

const ALLOWED = new Set([
  "help",
  "docker",
  "df",
  "free",
  "uptime",
  "hostname",
  "vcgencmd",
  "journalctl",
  "ps",
  "clear",
  "ls",
  "cat",
  "tail",
  "grep",
  "ip",
  "ping",
  "whoami",
  "uname",
  "pm2",
]);

function previewReply(input: string): string {
  const t = input.trim().toLowerCase();
  if (t.startsWith("gemini")) {
    return `(preview) gemini reply for "${input.slice(7).trim() || "(empty)"}"\nRun this on the Pi for live AI assistance.`;
  }
  if (t.startsWith("docker ps")) {
    return `CONTAINER ID   IMAGE                              STATUS\n80a91          ghcr.io/home-assistant:stable     Up 12d\nc0092          jc21/nginx-proxy-manager:latest   Up 30d\nd7a44          linuxserver/plex:latest           Up 2h (unhealthy)`;
  }
  if (t.startsWith("df"))
    return `Filesystem  Size  Used  Avail  Use%\n/dev/root   29G   18G   10G   64%`;
  if (t.startsWith("pm2 list")) {
    return `┌────┬─────────┬─────────┬─────────┬─────────┬──────────┬────────┬──────┬──────────┬──────────┬──────────┐\n│ id │ name    │ mode    │ ↺       │ status  │ cpu      │ mem    │ user │ watching │ [v]      │ [p]      │\n├────┼─────────┼─────────┼─────────┼─────────┼──────────┼────────┼──────┼──────────┼──────────┼──────────┤\n│ 0  │ pi-hub  │ fork    │ 0       │ online  │ 0.1%     │ 45.2mb │ pi   │ disabled │ 1.0.0    │ 3000     │\n└────┴─────────┴─────────┴─────────┴─────────┴──────────┴────────┴──────┴──────────┴──────────┴──────────┘`;
  }
  if (t === "help")
    return `available: gemini <prompt>, docker {ps|logs|stats}, pm2 {list|logs|show}, df, free, uptime, hostname, vcgencmd, journalctl, ps, ls, cat, tail, grep, ip, ping, whoami, uname, clear`;
  return `(preview) command not executed — runs live when installed on a Pi.`;
}

async function runGemini(prompt: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return "gemini: LOVABLE_API_KEY not configured";
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are a concise Raspberry Pi sysadmin assistant. Reply with practical shell commands and 1-2 sentence explanations. No markdown fences.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const j = await res.json();
    if (!res.ok) return `gemini error ${res.status}: ${JSON.stringify(j).slice(0, 200)}`;
    return j.choices?.[0]?.message?.content ?? "(no reply)";
  } catch (e: any) {
    return `gemini error: ${e.message}`;
  }
}

async function runShell(argv: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  try {
    const { stdout, stderr } = await exec(argv[0], argv.slice(1), {
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
    return out.trim() || "(no output)";
  } catch (e: any) {
    return `error: ${e.message}`.slice(0, 1024);
  }
}

export const runTerminalCommand = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: { cmd: string }) => {
    if (typeof d.cmd !== "string" || !d.cmd.trim() || d.cmd.length > 512) {
      throw new Error("invalid cmd");
    }
    return d;
  })
  .handler(async ({ data }): Promise<{ output: string }> => {
    const cmd = data.cmd.trim();
    const { hasProcStats } = await import("./pi-runtime.server");

    // Gemini route works in both runtimes when LOVABLE_API_KEY is present
    if (cmd.toLowerCase().startsWith("gemini")) {
      const prompt = cmd.slice(6).trim();
      if (!prompt) return { output: "usage: gemini <your question>" };
      return { output: await runGemini(prompt) };
    }

    if (!hasProcStats()) return { output: previewReply(cmd) };

    if (cmd === "help") {
      return {
        output:
          "Available commands:\n" +
          "  gemini <prompt>          — ask the AI sysadmin\n" +
          "  docker ps|logs|stats     — container info\n" +
          "  pm2 list|logs|show       — process management\n" +
          "  df / free / uptime       — system resource usage\n" +
          "  ls / cat / tail / grep   — file inspection\n" +
          "  ip / ping                — network info\n" +
          "  hostname / vcgencmd ...  — host info\n" +
          "  journalctl -u <unit>     — service logs\n" +
          "  ps aux / whoami / uname  — system info\n",
      };
    }

    const tokens = cmd.split(/\s+/);
    const head = tokens[0];
    if (!ALLOWED.has(head)) {
      return {
        output: `'${head}' not allowed. Try: help, docker ps, df, free, uptime, journalctl, gemini <prompt>`,
      };
    }

    // Lightweight argument sanitation: no shell metas
    for (const t of tokens) {
      if (/[`$;&|<>(){}\\]/.test(t)) {
        return { output: "shell metacharacters not allowed" };
      }
    }

    // Some defaults to keep output sane
    if (head === "journalctl" && !tokens.includes("-n")) tokens.push("-n", "50");
    if (head === "docker" && tokens[1] === "logs" && !tokens.includes("--tail")) {
      tokens.push("--tail", "100");
    }
    if (head === "pm2" && tokens[1] === "logs" && !tokens.includes("--lines")) {
      tokens.push("--lines", "50");
    }
    if (head === "tail" && !tokens.includes("-n")) {
      tokens.push("-n", "50");
    }

    return { output: await runShell(tokens) };
  });
