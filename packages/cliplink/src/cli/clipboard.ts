import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type { Env } from "./env.ts";

/**
 * The system clipboard, through whichever command-line tool the platform
 * provides. No native module and no dependency: every desktop this runs on
 * ships, or one package away offers, a pair of commands that read and write
 * it, and the cost of shelling out twice a second is nothing next to the cost
 * of carrying a binary per platform.
 */
export type Clipboard = {
  /** The tool in use, for messages. */
  name: string;
  read: () => Promise<string>;
  write: (text: string) => Promise<void>;
};

type Invocation = { file: string; args: readonly string[] };

export type Backend = {
  name: string;
  read: Invocation;
  write: Invocation;
  /**
   * Whether a failed read with nothing on stdout means an empty clipboard.
   * `wl-paste` and `xclip` both exit non-zero when nothing has been copied,
   * which is an ordinary state rather than a broken tool.
   */
  emptyWhenReadFails?: boolean;
};

/** A read or write that has not finished in this long is not going to. */
const COMMAND_TIMEOUT_MS = 5_000;

// PowerShell's console encoding is the system code page unless told otherwise,
// which turns anything outside it into question marks in both directions.
const POWERSHELL_READ =
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $t = Get-Clipboard -Raw; if ($t) { [Console]::Out.Write($t) }";
const POWERSHELL_WRITE =
  "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())";

function powershell(file: string): Backend {
  const flags = ["-NoProfile", "-NonInteractive", "-Command"];
  return {
    name: file,
    read: { file, args: [...flags, POWERSHELL_READ] },
    write: { file, args: [...flags, POWERSHELL_WRITE] },
  };
}

const BACKENDS = {
  pbcopy: {
    name: "pbcopy",
    read: { file: "pbpaste", args: [] },
    write: { file: "pbcopy", args: [] },
  },
  wayland: {
    name: "wl-clipboard",
    // Without --no-newline wl-paste appends one, and every read would differ
    // from the text that was written.
    read: { file: "wl-paste", args: ["--no-newline"] },
    write: { file: "wl-copy", args: [] },
    emptyWhenReadFails: true,
  },
  xclip: {
    name: "xclip",
    read: { file: "xclip", args: ["-selection", "clipboard", "-out"] },
    write: { file: "xclip", args: ["-selection", "clipboard", "-in"] },
    emptyWhenReadFails: true,
  },
  xsel: {
    name: "xsel",
    read: { file: "xsel", args: ["--clipboard", "--output"] },
    write: { file: "xsel", args: ["--clipboard", "--input"] },
  },
} as const satisfies Record<string, Backend>;

/**
 * Which tool to use, or what to tell the person when there is none.
 *
 * Pure, given a way to ask whether a command exists, so every platform's
 * choice can be tested from any one of them.
 */
export function chooseBackend(
  platform: NodeJS.Platform,
  env: Env,
  has: (command: string) => boolean,
): Backend | string {
  if (platform === "darwin") {
    return has("pbcopy") && has("pbpaste")
      ? BACKENDS.pbcopy
      : "pbcopy and pbpaste were not found on PATH.";
  }

  if (platform === "win32") {
    return powershell("powershell.exe");
  }

  // Under WSL the Linux side usually has no display of its own, and the
  // clipboard worth syncing is Windows'.
  const wsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);

  if (env.WAYLAND_DISPLAY && has("wl-copy") && has("wl-paste")) {
    return BACKENDS.wayland;
  }
  if (env.DISPLAY && has("xclip")) {
    return BACKENDS.xclip;
  }
  if (env.DISPLAY && has("xsel")) {
    return BACKENDS.xsel;
  }
  if (wsl && has("powershell.exe")) {
    return powershell("powershell.exe");
  }

  if (env.WAYLAND_DISPLAY) {
    return "No clipboard tool found. Install wl-clipboard (wl-copy and wl-paste).";
  }
  if (env.DISPLAY) {
    return "No clipboard tool found. Install xclip or xsel.";
  }
  return wsl
    ? "No clipboard tool found: powershell.exe is not on PATH."
    : "No clipboard to watch: neither WAYLAND_DISPLAY nor DISPLAY is set.";
}

/** Whether `command` is an executable somewhere on `PATH`. */
async function onPath(command: string, env: Env) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) {
      continue;
    }
    try {
      await access(join(dir, command), constants.X_OK);
      return true;
    } catch {
      // Not here; keep looking.
    }
  }
  return false;
}

/** The clipboard on this machine, or the reason there is not one to use. */
export async function detectClipboard(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): Promise<Clipboard | string> {
  const candidates = ["pbcopy", "pbpaste", "wl-copy", "wl-paste", "xclip", "xsel", "powershell.exe"];
  const found = new Set<string>();
  // Windows resolves commands through PATHEXT, and powershell.exe is always
  // there; there is nothing to look for.
  if (platform !== "win32") {
    await Promise.all(
      candidates.map(async (command) => {
        if (await onPath(command, env)) {
          found.add(command);
        }
      }),
    );
  }

  const backend = chooseBackend(platform, env, (command) => found.has(command));
  return typeof backend === "string" ? backend : clipboardFor(backend);
}

export function clipboardFor(backend: Backend): Clipboard {
  return {
    name: backend.name,
    read: async () => {
      const { code, stdout, stderr } = await run(backend.read, null);
      if (code === 0) {
        return stdout;
      }
      if (backend.emptyWhenReadFails && stdout === "") {
        return "";
      }
      throw new Error(failure(backend.read, code, stderr));
    },
    write: async (text) => {
      const { code, stderr } = await run(backend.write, text);
      if (code !== 0) {
        throw new Error(failure(backend.write, code, stderr));
      }
    },
  };
}

function failure(invocation: Invocation, code: number | null, stderr: string) {
  const detail = stderr.trim().split("\n")[0];
  return `${invocation.file} ${code === null ? "was stopped" : `exited with ${code}`}${
    detail ? `: ${detail}` : ""
  }`;
}

/**
 * Runs one command, writing `input` to its stdin when given.
 *
 * A write settles on the process exiting rather than on its streams closing:
 * `xclip`, `xsel` and `wl-copy` fork a child that keeps the selection — and
 * the inherited stderr — alive until something else is copied, so waiting
 * for the streams would wait for the next copy.
 */
function run(invocation: Invocation, input: string | null) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(invocation.file, invocation.args, {
        stdio: [input === null ? "ignore" : "pipe", input === null ? "pipe" : "ignore", "pipe"],
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);

      const text = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8");

      if (input === null) {
        // A read has no forked child to outlive it, and its output is only
        // complete once stdout has closed.
        child.on("close", (code) => resolve({ code, stdout: text(stdout), stderr: text(stderr) }));
      } else {
        child.on("exit", (code) => {
          child.stderr?.destroy();
          resolve({ code, stdout: "", stderr: text(stderr) });
        });
        // A tool that exits without reading its input closes the pipe under
        // the write; its exit code is the error worth reporting, not EPIPE.
        child.stdin?.on("error", () => {});
        child.stdin?.end(input, "utf8");
      }
    },
  );
}
