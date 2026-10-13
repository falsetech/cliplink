import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { COMMANDS, FLAGS, SHELLS } from "../src/cli/args.ts";
import { completionScript } from "../src/cli/completions.ts";

describe("completion scripts", () => {
  for (const shell of SHELLS) {
    describe(shell, () => {
      const script = completionScript(shell);

      it("offers every command people run", () => {
        for (const command of COMMANDS.filter((entry) => entry.usage !== null)) {
          assert.match(script, new RegExp(`\\b${command.name}\\b`), command.name);
        }
      });

      it("offers every flag the parser accepts", () => {
        for (const flag of FLAGS) {
          // fish names a long flag without its dashes.
          const name = shell === "fish" ? `-l ${flag.name.slice(2)}` : flag.name;
          assert.ok(script.includes(name), flag.name);
        }
      });

      it("completes room codes from the saved list, and never asks for keys", () => {
        assert.ok(script.includes("cliplink rooms --codes"));
        assert.ok(!script.includes("--show-keys 2>"), "no key listing is run");
      });
    });
  }

  it("leaves no apostrophe unescaped inside a single-quoted word", () => {
    // "machine's" is in a summary; an unescaped quote would end the word early.
    // bash shows no summaries, so only the other two carry one.
    for (const shell of ["zsh", "fish"] as const) {
      const script = completionScript(shell);
      assert.ok(script.includes("machine'\\''s"), shell);
    }
  });

  it("offers bash a command's own flags, and not another's", () => {
    const script = completionScript("bash");
    const recv = /recv\) words='([^']*)'/.exec(script)?.[1] ?? "";
    assert.match(recv, /--timeout/);
    assert.doesNotMatch(recv, /--burn/);
  });

  it("never evaluates what the room list prints, in bash", async (context) => {
    try {
      execFileSync("bash", ["-c", "true"]);
    } catch {
      context.skip("no bash here");
      return;
    }

    // A cliplink that prints a code and a command substitution, as a doctored
    // rooms.json could have made an older version do.
    const dir = await mkdtemp(join(tmpdir(), "cliplink-complete-"));
    try {
      const marker = join(dir, "pwned");
      await writeFile(
        join(dir, "cliplink"),
        `#!/bin/sh\nprintf '%s\\n' X7KP2M '$(touch ${marker})' '\`touch ${marker}\`'\n`,
      );
      await chmod(join(dir, "cliplink"), 0o755);
      await writeFile(join(dir, "c.bash"), completionScript("bash"));

      const out = execFileSync(
        "bash",
        [
          "-c",
          `source c.bash; COMP_WORDS=(cliplink recv --room ""); COMP_CWORD=3; _cliplink; printf '%s\\n' "\${COMPREPLY[@]}"`,
        ],
        { cwd: dir, env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` }, encoding: "utf8" },
      );

      assert.match(out, /^X7KP2M$/m);
      await assert.rejects(stat(marker), "nothing ran");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
