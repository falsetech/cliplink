import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_BASE_URL, parseArgs } from "../src/cli/args.ts";
import type { Env } from "../src/cli/env.ts";

/** The parsed args, or a thrown assertion naming why parsing failed. */
function parse(argv: string[], env: Env = {}) {
  const result = parseArgs(argv, env);
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.args;
}

function reject(argv: string[], env: Env = {}) {
  const result = parseArgs(argv, env);
  assert.equal(result.ok, false, "expected parsing to fail");
  return result.ok ? "" : result.message;
}

describe("commands", () => {
  it("defaults to the documented deployment", () => {
    assert.equal(parse(["send", "hi"]).baseUrl, DEFAULT_BASE_URL);
  });

  it("reads send's text from the positionals", () => {
    assert.equal(parse(["send", "hello", "world"]).text, "hello world");
  });

  it("takes no command as an error rather than a default", () => {
    assert.match(reject([]), /Expected a command/);
  });

  it("treats --help as help whatever else was given", () => {
    assert.equal(parse(["send", "hi", "--help"]).command, "help");
  });

  it("accepts -h and -v", () => {
    assert.equal(parse(["-h"]).command, "help");
    assert.equal(parse(["-v"]).command, "version");
  });
});

describe("flags", () => {
  it("accepts a value as a separate token", () => {
    assert.equal(parse(["recv", "--room", "X7KP2M"]).room, "X7KP2M");
  });

  it("accepts a value after an equals sign", () => {
    assert.equal(parse(["recv", "--room=X7KP2M"]).room, "X7KP2M");
  });

  it("maps the short forms", () => {
    const args = parse(["recv", "-r", "X7KP2M", "-k", "KEY", "-1", "-q"]);
    assert.equal(args.room, "X7KP2M");
    assert.equal(args.key, "KEY");
    assert.equal(args.one, true);
    assert.equal(args.quiet, true);
  });

  it("errors when a value-taking flag has no value", () => {
    assert.match(reject(["recv", "--room"]), /--room needs a value/);
  });

  it("errors when a boolean flag is given a value", () => {
    assert.match(reject(["send", "--save=yes"]), /--save does not take a value/);
  });

  it("rejects an unknown flag rather than sending it as text", () => {
    assert.match(reject(["send", "--quite", "oops"]), /Unknown option --quite/);
  });

  it("parses --ttl as an integer", () => {
    assert.equal(parse(["send", "hi", "--ttl", "3600"]).ttlSeconds, 3600);
  });

  it("rejects a --ttl that is not a positive number", () => {
    assert.match(reject(["send", "hi", "--ttl", "soon"]), /--ttl must be/);
    assert.match(reject(["send", "hi", "--ttl", "-5"]), /--ttl must be/);
  });

  it("rejects a --ttl outside the range the server accepts", () => {
    // The bounds the help text advertises, enforced here rather than learned
    // from a rejected request.
    assert.match(reject(["send", "hi", "--ttl", "60"]), /between 3600 and 86400/);
    assert.match(reject(["send", "hi", "--ttl", "86401"]), /between 3600 and 86400/);
    assert.equal(parse(["send", "hi", "--ttl", "86400"]).ttlSeconds, 86400);
  });

  it("stops parsing flags after --, so a clip may start with a dash", () => {
    const args = parse(["send", "--", "--not-a-flag", "-x"]);
    assert.equal(args.text, "--not-a-flag -x");
  });
});

describe("environment", () => {
  it("supplies defaults for room, key and url", () => {
    const args = parse(["recv"], {
      CLIPLINK_ROOM: "X7KP2M",
      CLIPLINK_ROOM_KEY: "SECRET",
      CLIPLINK_URL: "http://localhost:3000",
    });
    assert.equal(args.room, "X7KP2M");
    assert.equal(args.key, "SECRET");
    assert.equal(args.baseUrl, "http://localhost:3000");
  });

  it("is overridden by an explicit flag", () => {
    const args = parse(["recv", "--room", "AAAAAA"], { CLIPLINK_ROOM: "X7KP2M" });
    assert.equal(args.room, "AAAAAA");
  });
});

describe("combinations that cannot mean anything", () => {
  it("refuses --open with --key", () => {
    assert.match(reject(["send", "hi", "--open", "--key", "K"]), /--open derives the key/);
  });

  it("refuses --open with --save, since there is no key to save", () => {
    assert.match(reject(["send", "hi", "--open", "--save"]), /no key to save/);
  });

  it("refuses --one on send", () => {
    assert.match(reject(["send", "hi", "--one"]), /--one applies to recv/);
  });

  it("refuses text on recv", () => {
    assert.match(reject(["recv", "--room", "X7KP2M", "hi"]), /recv takes no text/);
  });

  it("refuses recv with no room to receive from", () => {
    assert.match(reject(["recv"]), /recv needs a room/);
  });

  it("refuses --ttl when joining, since the room's lifetime is already set", () => {
    assert.match(
      reject(["send", "hi", "--room", "X7KP2M", "--ttl", "3600"]),
      /sets the lifetime of a room being created/,
    );
  });

  it("names CLIPLINK_ROOM when that is what --ttl collided with", () => {
    // The command line shows no room at all in this case, so "this run joins
    // one" would leave the person looking for a --room they never typed.
    assert.match(
      reject(["send", "hi", "--ttl", "3600"], { CLIPLINK_ROOM: "X7KP2M" }),
      /CLIPLINK_ROOM already names one/,
    );
  });
});

describe("rooms", () => {
  it("is a command", () => {
    assert.equal(parse(["rooms"]).command, "rooms");
  });

  it("names it among the commands when none was given", () => {
    assert.match(reject([]), /send, recv, rooms, link, help or version/);
  });

  it("takes the rooms flags", () => {
    const args = parse(["rooms", "--forget", "X7KP2M", "--show-keys"]);
    assert.equal(args.forget, "X7KP2M");
    assert.equal(args.showKeys, true);
  });

  it("defaults the rooms flags off", () => {
    const args = parse(["rooms"]);
    assert.equal(args.forget, null);
    assert.equal(args.forgetAll, false);
    assert.equal(args.prune, false);
    assert.equal(args.showKeys, false);
  });

  it("takes no text", () => {
    assert.match(reject(["rooms", "X7KP2M"]), /rooms takes no text/);
  });

  it("refuses --forget alongside --forget-all", () => {
    assert.match(reject(["rooms", "--forget", "X7KP2M", "--forget-all"]), /pick one/);
  });

  it("refuses a rooms flag on another command, rather than ignoring it", () => {
    assert.match(reject(["send", "hi", "--prune"]), /--prune applies to rooms, not send/);
    assert.match(reject(["recv", "-r", "X7KP2M", "--show-keys"]), /--show-keys applies to rooms/);
    assert.match(reject(["send", "hi", "--forget", "X7KP2M"]), /--forget applies to rooms/);
    assert.match(reject(["send", "hi", "--forget-all"]), /--forget-all applies to rooms/);
  });
});

describe("--json", () => {
  it("is off unless asked for", () => {
    assert.equal(parse(["recv", "-r", "X7KP2M"]).json, false);
  });

  it("applies to recv", () => {
    assert.equal(parse(["recv", "-r", "X7KP2M", "--json"]).json, true);
  });

  it("is an error on send, rather than silently ignored", () => {
    assert.match(reject(["send", "hi", "--json"]), /--json applies to recv, not send/);
  });
});

describe("--last and --all", () => {
  it("default to replaying nothing", () => {
    const args = parse(["recv", "-r", "X7KP2M"]);
    assert.equal(args.last, null);
    assert.equal(args.all, false);
  });

  it("parses a count", () => {
    assert.equal(parse(["recv", "-r", "X7KP2M", "--last", "5"]).last, 5);
    assert.equal(parse(["recv", "-r", "X7KP2M", "--last=0"]).last, 0);
  });

  it("refuses a count that is not a whole number of clips", () => {
    for (const value of ["-1", "2.5", "many", ""]) {
      assert.match(reject(["recv", "-r", "X7KP2M", "--last", value]), /whole number/);
    }
  });

  it("refuses --last alongside --all", () => {
    assert.match(reject(["recv", "-r", "X7KP2M", "--last", "5", "--all"]), /pick one/);
  });

  it("is an error on send, rather than silently ignored", () => {
    assert.match(reject(["send", "hi", "--all"]), /--all applies to recv, not send/);
    assert.match(reject(["send", "hi", "--last", "5"]), /--last applies to recv, not send/);
  });
});

describe("link", () => {
  it("is a command", () => {
    assert.equal(parse(["link", "-r", "X7KP2M"]).command, "link");
  });

  it("needs a room, since it never creates one", () => {
    assert.match(reject(["link"]), /link needs a room/);
  });

  it("takes the room from the environment", () => {
    assert.equal(parse(["link"], { CLIPLINK_ROOM: "X7KP2M" }).room, "X7KP2M");
  });

  it("takes no text", () => {
    assert.match(reject(["link", "X7KP2M"]), /link takes no text/);
  });
});

describe("colour", () => {
  it("is on by default", () => {
    assert.equal(parse(["send", "hi"]).color, true);
  });

  it("is off under --no-color, spelled either way", () => {
    assert.equal(parse(["send", "hi", "--no-color"]).color, false);
    assert.equal(parse(["send", "hi", "--no-colour"]).color, false);
  });

  it("is off when NO_COLOR is set to anything", () => {
    assert.equal(parse(["send", "hi"], { NO_COLOR: "1" }).color, false);
    assert.equal(parse(["send", "hi"], { NO_COLOR: "0" }).color, false);
  });

  it("is on when NO_COLOR is set but empty, as the convention has it", () => {
    assert.equal(parse(["send", "hi"], { NO_COLOR: "" }).color, true);
  });

  it("takes no value", () => {
    assert.match(reject(["send", "hi", "--no-color=1"]), /does not take a value/);
  });
});
