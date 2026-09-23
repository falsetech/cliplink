#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { parseArgs } from "./args.ts";
import { describeError } from "./errors.ts";
import { HELP } from "./help.ts";
import { link } from "./link.ts";
import { createReporter } from "./output.ts";
import { recv } from "./recv.ts";
import { rooms } from "./rooms.ts";
import { send } from "./send.ts";

async function version() {
  // dist/cli/cli.js → the package root.
  const manifest = new URL("../../package.json", import.meta.url);
  const { version: value } = JSON.parse(await readFile(manifest, "utf8"));
  return value as string;
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, process.env);

  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\nRun cliplink --help.\n`);
    return 2;
  }

  const { args } = parsed;
  const report = createReporter({ quiet: args.quiet });

  if (args.command === "help") {
    process.stderr.write(HELP);
    return 0;
  }
  if (args.command === "version") {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }

  // Neither opens a socket, so both run before the signal handlers the
  // network commands need.
  if (args.command === "rooms" || args.command === "link") {
    try {
      return args.command === "rooms" ? await rooms(args, report) : await link(args, report);
    } catch (error) {
      report.warn(describeError(error));
      return 1;
    }
  }

  // Ctrl-C is how `recv` is meant to end, so it exits cleanly rather than
  // leaving the socket to be torn down by the signal.
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  try {
    return args.command === "send"
      ? await send(args, report)
      : await recv(args, report, controller.signal);
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
