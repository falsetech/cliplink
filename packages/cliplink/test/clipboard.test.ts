import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chooseBackend, clipboardFor, type Backend } from "../src/cli/clipboard.ts";

/** `has` for a machine with exactly these commands. */
const having =
  (...commands: string[]) =>
  (command: string) =>
    commands.includes(command);

function nameOf(choice: Backend | string) {
  return typeof choice === "string" ? choice : choice.name;
}

describe("chooseBackend", () => {
  it("uses pbcopy and pbpaste on macOS", () => {
    assert.equal(nameOf(chooseBackend("darwin", {}, having("pbcopy", "pbpaste"))), "pbcopy");
  });

  it("uses PowerShell on Windows, with nothing to look for", () => {
    assert.equal(nameOf(chooseBackend("win32", {}, having())), "powershell.exe");
  });

  it("prefers wl-clipboard under Wayland, even with an X server alongside", () => {
    const env = { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" };
    const all = having("wl-copy", "wl-paste", "xclip", "xsel");
    assert.equal(nameOf(chooseBackend("linux", env, all)), "wl-clipboard");
  });

  it("falls back to X under Wayland when wl-clipboard is missing", () => {
    const env = { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" };
    assert.equal(nameOf(chooseBackend("linux", env, having("xsel"))), "xsel");
  });

  it("prefers xclip to xsel under X", () => {
    const env = { DISPLAY: ":0" };
    assert.equal(nameOf(chooseBackend("linux", env, having("xclip", "xsel"))), "xclip");
    assert.equal(nameOf(chooseBackend("linux", env, having("xsel"))), "xsel");
  });

  it("uses the Windows clipboard under WSL", () => {
    const env = { WSL_DISTRO_NAME: "Ubuntu" };
    assert.equal(
      nameOf(chooseBackend("linux", env, having("powershell.exe"))),
      "powershell.exe",
    );
  });

  it("says what to install when the tool is missing", () => {
    assert.match(nameOf(chooseBackend("linux", { DISPLAY: ":0" }, having())), /xclip or xsel/);
    assert.match(
      nameOf(chooseBackend("linux", { WAYLAND_DISPLAY: "wayland-0" }, having())),
      /wl-clipboard/,
    );
    assert.match(nameOf(chooseBackend("darwin", {}, having())), /pbcopy/);
  });

  it("says there is no clipboard on a machine with no display", () => {
    assert.match(nameOf(chooseBackend("linux", {}, having("xclip"))), /DISPLAY/);
  });
});

/**
 * The commands themselves are this Node binary running a line of script, so
 * the spawning is exercised for real on any platform.
 */
function node(script: string) {
  return { file: process.execPath, args: ["-e", script] };
}

describe("clipboardFor", () => {
  it("reads what the read command prints, byte for byte", async () => {
    const board = clipboardFor({
      name: "test",
      read: node('process.stdout.write("héllo\\n  ")'),
      write: node(""),
    });
    assert.equal(await board.read(), "héllo\n  ");
  });

  it("gives the write command the text on stdin", async () => {
    // Asserted inside the child: a mismatch is a non-zero exit, which write reports.
    const board = clipboardFor({
      name: "test",
      read: node(""),
      write: node(
        'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(s==="ünïcode\\nline"?0:3))',
      ),
    });
    await board.write("ünïcode\nline");
  });

  it("reports a failing command with its exit code and first line of stderr", async () => {
    const board = clipboardFor({
      name: "test",
      read: node('console.error("no display\\nmore");process.exit(2)'),
      write: node("process.exit(4)"),
    });
    await assert.rejects(board.read(), /exited with 2: no display$/);
    await assert.rejects(board.write("x"), /exited with 4/);
  });

  it("reads an empty clipboard from a tool that fails on one, when told it does", async () => {
    const board = clipboardFor({
      name: "test",
      read: node('console.error("Nothing is copied");process.exit(1)'),
      write: node(""),
      emptyWhenReadFails: true,
    });
    assert.equal(await board.read(), "");
  });

  it("does not wait for a forked child that keeps stderr open", async () => {
    // What xclip and wl-copy do: exit, leaving a child holding the selection.
    const board = clipboardFor({
      name: "test",
      read: node(""),
      write: node(
        'require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},3000)"],{stdio:["ignore","ignore","inherit"],detached:true}).unref()',
      ),
    });
    const started = performance.now();
    await board.write("x");
    assert.ok(performance.now() - started < 2_500, "returned before the child exited");
  });

  it("rejects when the command does not exist", async () => {
    const board = clipboardFor({
      name: "test",
      read: { file: "cliplink-no-such-command", args: [] },
      write: { file: "cliplink-no-such-command", args: [] },
    });
    await assert.rejects(board.read(), /ENOENT/);
  });
});
