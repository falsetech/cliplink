import { encodeQr } from "../index.ts";

/**
 * A QR rendered with half-block characters, two module rows per text row, so a
 * room link fits a terminal without scrolling.
 *
 * Encoded locally rather than fetched as an image: the link carries the room
 * key, and handing that to an image service would undo the encryption. This is
 * the same reason the web app stopped using one.
 */

const EMPTY = " ";
const UPPER = "▀";
const LOWER = "▄";
const FULL = "█";
/** Modules of margin the spec asks for, so a scanner finds the edges. */
const QUIET_ZONE = 2;

/**
 * Black on white, pinned rather than inherited.
 *
 * Block characters are drawn in the foreground colour, so on the dark terminal
 * most people use, an unstyled QR comes out light-on-dark — inverted, which
 * many scanners will not read. Naming both colours makes the code scannable
 * whatever theme is set.
 */
const DARK_ON_LIGHT = "[30;47m";
const RESET = "[0m";

export function renderQr(text: string, { color = true } = {}): string {
  const { size, modules } = encodeQr(text);
  const span = size + QUIET_ZONE * 2;

  // True is dark. Outside the matrix is the quiet zone, which must be light.
  const dark = (row: number, column: number) => {
    const y = row - QUIET_ZONE;
    const x = column - QUIET_ZONE;
    if (y < 0 || x < 0 || y >= size || x >= size) {
      return false;
    }
    return modules[y][x];
  };

  const lines: string[] = [];
  for (let row = 0; row < span; row += 2) {
    let line = "";
    for (let column = 0; column < span; column += 1) {
      const top = dark(row, column);
      // An odd span leaves the last bottom half in the quiet zone.
      const bottom = row + 1 < span ? dark(row + 1, column) : false;
      if (top && bottom) {
        line += FULL;
      } else if (top) {
        line += UPPER;
      } else if (bottom) {
        line += LOWER;
      } else {
        line += EMPTY;
      }
    }
    lines.push(color ? `${DARK_ON_LIGHT}${line}${RESET}` : line);
  }

  return lines.join("\n");
}
