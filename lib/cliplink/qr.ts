/**
 * A QR encoder, because the room link now carries the room key.
 *
 * The QR image used to come from a third-party HTTP service with the URL in a
 * query string. That is fine for a bare room code and unacceptable for a key:
 * anything in that request is handed to whoever runs the service, which would
 * undo the encryption entirely. Encoding here means the key never leaves the
 * device, and the room stays scannable in one step.
 *
 * Byte mode only — a room URL has lowercase letters and `#`, neither of which
 * alphanumeric mode can represent — at error-correction level M, which is the
 * usual default and leaves ~15% recovery for a screen photographed at an angle.
 */

export type QrMatrix = {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** Row-major; true is dark. */
  modules: boolean[][];
};

/** Error-correction codewords per block, indexed by version, at level M. */
const EC_CODEWORDS_PER_BLOCK = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26,
  26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28,
];

/** Error-correction blocks, indexed by version, at level M. */
const EC_BLOCKS = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
  18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Level M's two-bit identity in the format information. */
const FORMAT_EC_BITS = 0;
const MIN_VERSION = 1;
const MAX_VERSION = 40;
const PAD_BYTES = [0xec, 0x11];

// ---------------------------------------------------------------------------
// GF(256) arithmetic, modulo x^8 + x^4 + x^3 + x^2 + 1

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial's coefficients, highest power omitted. */
function rsDivisor(degree: number) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: Uint8Array, divisor: Uint8Array) {
  const result = new Uint8Array(divisor.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Capacity

/** Modules available for data and EC, before codewords are carved out. */
function rawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    result -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

function dataCodewords(version: number) {
  return (
    Math.floor(rawDataModules(version) / 8) -
    EC_CODEWORDS_PER_BLOCK[version] * EC_BLOCKS[version]
  );
}

/** Byte mode's character-count indicator widens once past version 9. */
function charCountBits(version: number) {
  return version <= 9 ? 8 : 16;
}

function alignmentPositions(version: number) {
  if (version === 1) {
    return [];
  }
  const count = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = version * 4 + 10; positions.length < count; pos -= step) {
    positions.splice(1, 0, pos);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Bit assembly

class BitBuffer {
  readonly bits: number[] = [];

  append(value: number, length: number) {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }
}

function buildCodewords(data: Uint8Array, version: number) {
  const capacityBits = dataCodewords(version) * 8;
  const buffer = new BitBuffer();
  buffer.append(0b0100, 4); // byte mode
  buffer.append(data.length, charCountBits(version));
  for (const byte of data) {
    buffer.append(byte, 8);
  }

  // Terminator, then pad to a whole codeword, then alternating filler.
  buffer.append(0, Math.min(4, capacityBits - buffer.bits.length));
  buffer.append(0, (8 - (buffer.bits.length % 8)) % 8);
  for (
    let i = 0;
    buffer.bits.length < capacityBits;
    i = (i + 1) % PAD_BYTES.length
  ) {
    buffer.append(PAD_BYTES[i], 8);
  }

  const codewords = new Uint8Array(buffer.bits.length / 8);
  buffer.bits.forEach((bit, index) => {
    codewords[index >>> 3] |= bit << (7 - (index & 7));
  });
  return codewords;
}

/**
 * Splits the data into blocks, appends each block's EC codewords, then
 * interleaves — so a scratch across the symbol damages a little of every block
 * rather than destroying one outright.
 */
function interleave(codewords: Uint8Array, version: number) {
  const blockCount = EC_BLOCKS[version];
  const ecLength = EC_CODEWORDS_PER_BLOCK[version];
  const totalCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlockLength = Math.floor(totalCodewords / blockCount);
  const longBlockCount = totalCodewords % blockCount;
  const divisor = rsDivisor(ecLength);

  // Data and error correction are interleaved as two separate passes. Holding
  // each block as one concatenated array instead would misalign them: short
  // and long blocks start their EC at different offsets, so a single pass
  // reads one block's EC against the other's last data byte.
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let i = 0, offset = 0; i < blockCount; i += 1) {
    const dataLength =
      shortBlockLength - ecLength + (i < blockCount - longBlockCount ? 0 : 1);
    const block = codewords.subarray(offset, offset + dataLength);
    offset += dataLength;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, divisor));
  }

  const result = new Uint8Array(totalCodewords);
  let index = 0;
  const longestData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longestData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        result[index] = block[i];
        index += 1;
      }
    }
  }
  for (let i = 0; i < ecLength; i += 1) {
    for (const block of ecBlocks) {
      result[index] = block[i];
      index += 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Symbol layout

class Symbol_ {
  readonly size: number;
  readonly modules: boolean[][];
  /** Function patterns and reserved areas, which data must skip and masks must not touch. */
  readonly reserved: boolean[][];

  readonly version: number;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.reserved = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  set(x: number, y: number, dark: boolean, reserve = true) {
    this.modules[y][x] = dark;
    if (reserve) {
      this.reserved[y][x] = true;
    }
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i += 1) {
      // Timing patterns.
      const dark = i % 2 === 0;
      this.set(6, i, dark);
      this.set(i, 6, dark);
    }

    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = alignmentPositions(this.version);
    for (const cy of positions) {
      for (const cx of positions) {
        // The three finder corners already own these spots.
        const atFinder =
          (cx === 6 && cy === 6) ||
          (cx === 6 && cy === this.size - 7) ||
          (cx === this.size - 7 && cy === 6);
        if (!atFinder) {
          this.drawAlignment(cx, cy);
        }
      }
    }

    this.reserveFormatAreas();
    if (this.version >= 7) {
      this.drawVersionInfo();
    }
  }

  /** Includes the separator ring, hence the radius of 4. */
  private drawFinder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) {
          continue;
        }
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  private drawAlignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  /** Reserved now, filled once the mask is chosen. */
  private reserveFormatAreas() {
    for (let i = 0; i <= 8; i += 1) {
      // Index 6 is the timing pattern crossing this strip, not format space —
      // reserving it here would overwrite a timing module and no scanner would
      // find the symbol.
      if (i === 6) {
        continue;
      }
      this.set(i, 8, false);
      this.set(8, i, false);
    }
    for (let i = 0; i < 8; i += 1) {
      this.set(this.size - 1 - i, 8, false);
      this.set(8, this.size - 1 - i, false);
    }
    // The dark module, which is always set and never masked.
    this.set(8, this.size - 8, true);
  }

  private drawVersionInfo() {
    let remainder = this.version;
    for (let i = 0; i < 12; i += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | remainder;

    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  drawFormatInfo(mask: number) {
    const data = (FORMAT_EC_BITS << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) {
      this.set(8, i, ((bits >>> i) & 1) !== 0);
    }
    this.set(8, 7, ((bits >>> 6) & 1) !== 0);
    this.set(8, 8, ((bits >>> 7) & 1) !== 0);
    this.set(7, 8, ((bits >>> 8) & 1) !== 0);
    for (let i = 9; i < 15; i += 1) {
      this.set(14 - i, 8, ((bits >>> i) & 1) !== 0);
    }

    for (let i = 0; i < 8; i += 1) {
      this.set(this.size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
    }
    for (let i = 8; i < 15; i += 1) {
      this.set(8, this.size - 15 + i, ((bits >>> i) & 1) !== 0);
    }
  }

  /** Upward-then-downward zigzag in two-module columns, right to left. */
  drawCodewords(data: Uint8Array) {
    let index = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      // Column 6 is the vertical timing pattern and is not part of the zigzag.
      const rightColumn = right <= 6 ? right - 1 : right;
      for (let vert = 0; vert < this.size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = rightColumn - j;
          const upward = ((rightColumn + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (this.reserved[y][x]) {
            continue;
          }
          if (index < data.length * 8) {
            this.modules[y][x] = ((data[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
            index += 1;
          }
          // Any remaining modules stay light, as the specification requires.
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (this.reserved[y][x]) {
          continue;
        }
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  /** The four penalty rules; the lowest total wins. */
  penalty() {
    const N1 = 3;
    const N2 = 3;
    const N3 = 40;
    const N4 = 10;
    let score = 0;

    const runScore = (run: number) => (run >= 5 ? N1 + (run - 5) : 0);

    // Rule 1: runs of five or more in a line.
    for (let y = 0; y < this.size; y += 1) {
      let run = 1;
      for (let x = 1; x < this.size; x += 1) {
        if (this.modules[y][x] === this.modules[y][x - 1]) {
          run += 1;
        } else {
          score += runScore(run);
          run = 1;
        }
      }
      score += runScore(run);
    }
    for (let x = 0; x < this.size; x += 1) {
      let run = 1;
      for (let y = 1; y < this.size; y += 1) {
        if (this.modules[y][x] === this.modules[y - 1][x]) {
          run += 1;
        } else {
          score += runScore(run);
          run = 1;
        }
      }
      score += runScore(run);
    }

    // Rule 2: 2x2 blocks of one colour.
    for (let y = 0; y < this.size - 1; y += 1) {
      for (let x = 0; x < this.size - 1; x += 1) {
        const c = this.modules[y][x];
        if (
          c === this.modules[y][x + 1] &&
          c === this.modules[y + 1][x] &&
          c === this.modules[y + 1][x + 1]
        ) {
          score += N2;
        }
      }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules beside.
    const pattern = [true, false, true, true, true, false, true];
    const matchesAt = (get: (i: number) => boolean, start: number) => {
      for (let i = 0; i < 7; i += 1) {
        if (get(start + i) !== pattern[i]) {
          return false;
        }
      }
      const lightBefore = [1, 2, 3, 4].every(
        (d) => start - d < 0 || !get(start - d),
      );
      const lightAfter = [0, 1, 2, 3].every(
        (d) => start + 7 + d >= this.size || !get(start + 7 + d),
      );
      return lightBefore || lightAfter;
    };
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x <= this.size - 7; x += 1) {
        if (matchesAt((i) => this.modules[y][i], x)) {
          score += N3;
        }
      }
    }
    for (let x = 0; x < this.size; x += 1) {
      for (let y = 0; y <= this.size - 7; y += 1) {
        if (matchesAt((i) => this.modules[i][x], y)) {
          score += N3;
        }
      }
    }

    // Rule 4: deviation from an even balance of dark and light.
    let dark = 0;
    for (const row of this.modules) {
      for (const cell of row) {
        if (cell) {
          dark += 1;
        }
      }
    }
    const total = this.size * this.size;
    const k = Math.floor((Math.abs(dark * 20 - total * 10) * 10) / total / 5);
    score += k * N4;

    return score;
  }

  snapshot(): boolean[][] {
    return this.modules.map((row) => [...row]);
  }
}

// ---------------------------------------------------------------------------

/**
 * Encodes text as a QR symbol, choosing the smallest version that fits and the
 * mask the specification's penalty rules prefer.
 *
 * Throws only when the text cannot fit any version, which for a room URL means
 * an absurd origin.
 */
export function encodeQr(text: string): QrMatrix {
  const data = new TextEncoder().encode(text);

  let version = MIN_VERSION;
  for (; version <= MAX_VERSION; version += 1) {
    const capacity = dataCodewords(version) * 8;
    if (4 + charCountBits(version) + data.length * 8 <= capacity) {
      break;
    }
  }
  if (version > MAX_VERSION) {
    throw new Error("Text is too long to encode as a QR code");
  }

  const codewords = interleave(buildCodewords(data, version), version);

  const symbol = new Symbol_(version);
  symbol.drawFunctionPatterns();
  symbol.drawCodewords(codewords);

  // Every mask is drawn and scored; the specification offers no shortcut.
  let best: boolean[][] | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    symbol.applyMask(mask);
    symbol.drawFormatInfo(mask);
    const penalty = symbol.penalty();
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = symbol.snapshot();
    }
    symbol.applyMask(mask); // XOR is its own inverse.
  }

  return { size: symbol.size, modules: best! };
}
