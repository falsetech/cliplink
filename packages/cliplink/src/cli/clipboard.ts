import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join, win32 } from "node:path";

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
    name: "PowerShell",
    read: { file, args: [...flags, POWERSHELL_READ] },
    write: { file, args: [...flags, POWERSHELL_WRITE] },
  };
}

/**
 * Where a command lives, as an absolute path, or null when it is not on PATH.
 * The backends run what this returns rather than a bare name, so the command
 * found is the command run.
 */
export type Locate = (command: string) => string | null;

/**
 * Which tool to use, or what to tell the person when there is none.
 *
 * Pure, given a way to find a command, so every platform's choice can be
 * tested from any one of them.
 */
export function chooseBackend(
  platform: NodeJS.Platform,
  env: Env,
  locate: Locate,
): Backend | string {
  if (platform === "darwin") {
    const pbcopy = locate("pbcopy");
    const pbpaste = locate("pbpaste");
    return pbcopy && pbpaste
      ? { name: "pbcopy", read: { file: pbpaste, args: [] }, write: { file: pbcopy, args: [] } }
      : "pbcopy and pbpaste were not found on PATH.";
  }

  if (platform === "win32") {
    // By its full path: Windows looks for a bare program name in the current
    // directory before PATH, so a powershell.exe in whatever directory this
    // was started from would otherwise be the one run.
    return powershell(
      win32.join(
        env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
    );
  }

  // Under WSL the Linux side usually has no display of its own, and the
  // clipboard worth syncing is Windows'.
  const wsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);

  const wlCopy = locate("wl-copy");
  const wlPaste = locate("wl-paste");
  if (env.WAYLAND_DISPLAY && wlCopy && wlPaste) {
    return {
      name: "wl-clipboard",
      // Without --no-newline wl-paste appends one, and every read would
      // differ from the text that was written.
      read: { file: wlPaste, args: ["--no-newline"] },
      write: { file: wlCopy, args: [] },
      emptyWhenReadFails: true,
    };
  }
  const xclip = locate("xclip");
  if (env.DISPLAY && xclip) {
    return {
      name: "xclip",
      read: { file: xclip, args: ["-selection", "clipboard", "-out"] },
      write: { file: xclip, args: ["-selection", "clipboard", "-in"] },
      emptyWhenReadFails: true,
    };
  }
  const xsel = locate("xsel");
  if (env.DISPLAY && xsel) {
    return {
      name: "xsel",
      read: { file: xsel, args: ["--clipboard", "--output"] },
      write: { file: xsel, args: ["--clipboard", "--input"] },
    };
  }
  const windowsPowershell = locate("powershell.exe");
  if (wsl && windowsPowershell) {
    return powershell(windowsPowershell);
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

/**
 * The absolute path of `command` on `PATH`, or null.
 *
 * Only absolute entries are searched. An empty or relative one — `.`, or the
 * empty entry a stray colon leaves — names the current directory, and running
 * a clipboard tool from wherever this happened to be started is how a
 * checked-out repository gets to run its own `pbpaste`.
 */
async function findOnPath(command: string, env: Env) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(dir)) {
      continue;
    }
    const candidate = join(dir, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return null;
}

/** The clipboard on this machine, or the reason there is not one to use. */
export async function detectClipboard(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): Promise<Clipboard | string> {
  const candidates = ["pbcopy", "pbpaste", "wl-copy", "wl-paste", "xclip", "xsel", "powershell.exe"];
  const found = new Map<string, string>();
  // Windows has one place to look, which chooseBackend names itself.
  if (platform !== "win32") {
    await Promise.all(
      candidates.map(async (command) => {
        const path = await findOnPath(command, env);
        if (path) {
          found.set(command, path);
        }
      }),
    );
  }

  const backend = chooseBackend(platform, env, (command) => found.get(command) ?? null);
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
