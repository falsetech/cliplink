import assert from "node:assert/strict";
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
});
