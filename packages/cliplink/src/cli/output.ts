/**
 * The stdout/stderr split, in one place because it is a contract rather than a
 * style: stdout carries clip text and nothing else, so `cliplink recv --one |
 * pbcopy` copies the clip and not a room code. Everything addressed to the
 * person — room codes, QR, progress, errors — goes to stderr, which a pipe
 * leaves alone.
 */
export type Reporter = {
  /** Clip text. The data channel. */
  data: (text: string) => void;
  /** Commentary for the person, suppressed by --quiet. */
  note: (text?: string) => void;
  /** Errors and warnings. Never suppressed. */
  warn: (text: string) => void;
  /** True when stderr is a terminal, so decoration is worth printing. */
  readonly interactive: boolean;
};

export function createReporter({
  quiet = false,
  stdout = process.stdout,
  stderr = process.stderr,
}: {
  quiet?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream & { isTTY?: boolean };
} = {}): Reporter {
  return {
    data: (text) => {
      stdout.write(`${text}\n`);
    },
    note: (text = "") => {
      if (!quiet) {
        stderr.write(`${text}\n`);
      }
    },
    warn: (text) => {
      stderr.write(`${text}\n`);
    },
    interactive: Boolean(stderr.isTTY),
  };
}
