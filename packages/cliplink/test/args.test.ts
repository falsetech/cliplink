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
});
