import { KeyError } from "./key.ts";

/** Reads one line without echoing it. Injected where tests need a fake. */
export type ReadSecret = (prompt: string) => Promise<string>;

/**
 * Asks on the terminal, echoing nothing — a passphrase on screen is one
 * shoulder away from being someone else's.
 *
 * Only a terminal will do. When stdin is a pipe it is carrying the clip, and
 * a passphrase read from it would be the first line of whatever was piped in.
 */
export const readSecretFromTerminal: ReadSecret = (prompt) => {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return Promise.reject(
      new KeyError(
        "--passphrase asks on the terminal, and stdin is not one. Set CLIPLINK_PASSPHRASE instead.",
      ),
    );
  }

  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";

    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    // Raw mode delivers keys as they are pressed, and a paste as one chunk.
    const onData = (chunk: string) => {
      // An arrow or Home key arrives as an escape sequence. There is no cursor
      // to move in a field that shows nothing, and kept, the sequence would
      // become part of the passphrase.
      if (chunk.startsWith("\u001b")) {
        return;
      }
      for (const char of chunk) {
        switch (char) {
          case "\r":
          case "\n":
            finish();
            return;
          case "\u0003": // Ctrl-C: raw mode swallows the signal, so honour it here.
          case "\u0004": // Ctrl-D
            finish(new KeyError("Cancelled."));
            return;
          case "\u007f":
          case "\b":
            value = [...value].slice(0, -1).join("");
            break;
          default:
            value += char;
        }
      }
    };

    stdin.on("data", onData);
  });
};
