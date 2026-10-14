#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { parseArgs, type Command, type ParsedArgs } from "./args.ts";
import { completionScript } from "./completions.ts";
import { describeError } from "./errors.ts";
import { HELP } from "./help.ts";
import { link } from "./link.ts";
import { createReporter, type Reporter } from "./output.ts";
import { recv } from "./recv.ts";
import { rooms } from "./rooms.ts";
import { send } from "./send.ts";
import { watch } from "./watch.ts";

async function version() {
  // dist/cli/cli.js → the package root.
  const manifest = new URL("../../package.json", import.meta.url);
  const { version: value } = JSON.parse(await readFile(manifest, "utf8"));
  return value as string;
}

type Run = (args: ParsedArgs, report: Reporter, signal: AbortSignal) => Promise<number>;

const COMMANDS: Record<Command, Run> = {
  help: async () => {
    process.stderr.write(HELP);
    return 0;
  },
  version: async () => {
    process.stdout.write(`${await version()}\n`);
    return 0;
  },
  completions: async (args) => {
    // The parser does not let completions through without a shell.
    process.stdout.write(completionScript(args.shell ?? "bash"));
    return 0;
  },
  rooms: (args, report) => rooms(args, report),
  link: (args, report) => link(args, report),
  send: (args, report) => send(args, report),
  recv,
  watch: (args, report, signal) => watch(args, report, signal),
};

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, process.env);

  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\nRun cliplink --help.\n`);
    return 2;
  }

  const { args } = parsed;
  const report = createReporter({ quiet: args.quiet });

  // Ctrl-C is how `recv` and `watch` are meant to end, so they exit cleanly
  // rather than leaving the socket to be torn down by the signal.
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  try {
    return await COMMANDS[args.command](args, report, controller.signal);
  } catch (error) {
    report.warn(describeError(error));
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
