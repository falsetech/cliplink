import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeQr, type QrMatrix } from "../src/qr.ts";
import { QR_VECTORS } from "./fixtures/qr-vectors.ts";

/**
 * Byte-mode capacity at error-correction level M, per version, from the
 * specification's capacity table (ISO/IEC 18004). The encoder picks the
 * smallest version that fits, so each of these is a boundary: this many bytes
 * fit version N, and one more needs N + 1.
 */
const BYTE_CAPACITY_M: Record<number, number> = {
  1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213,
  20: 666, 30: 1370, 40: 2331,
};

const sizeOf = (version: number) => 17 + 4 * version;

const toRows = ({ modules }: QrMatrix) =>
  modules.map((row) => row.map((dark) => (dark ? "#" : ".")).join(""));

/** A few inputs of the kind this package really encodes, plus the edges. */
const SAMPLES = [
  "",
  "A",
  "https://cliplink.example/room/X7KP2M",
  "https://cliplink.example/room/X7KP2M#k=0C51260Z4RPK8ET29585EQK5DHSQN0C8HYB9V95BPAWW1HYETQE0",
  `https://cliplink.example/room/X7KP2M#k=${"0123456789ABCDEFGHJKMNPQRSTVWXYZ".repeat(2)}${"/".repeat(40)}`,
  "héllo wörld — ✓ 🎉",
  "x".repeat(300),
];

describe("encodeQr known answers", () => {
  for (const vector of QR_VECTORS) {
    it(`reproduces ${vector.name}`, () => {
      const matrix = encodeQr(vector.text);

      assert.equal(matrix.size, sizeOf(vector.version));
      assert.deepEqual(toRows(matrix), vector.rows);
    });
  }
});

describe("encodeQr version selection", () => {
  it("is as wide as the version it chose: 17 + 4 modules per version", () => {
    for (const text of SAMPLES) {
      const { size, modules } = encodeQr(text);
      assert.equal((size - 17) % 4, 0, `${size} is not a valid symbol width`);
      assert.equal(modules.length, size);
      assert.ok(modules.every((row) => row.length === size));
    }
  });

  it("uses the smallest version that holds the text, at every boundary", () => {
    for (const [version, capacity] of Object.entries(BYTE_CAPACITY_M).map(
      ([key, value]) => [Number(key), value] as const,
    )) {
      assert.equal(encodeQr("x".repeat(capacity)).size, sizeOf(version), `${capacity} bytes`);
      if (version < 40) {
        // One byte more spills into a larger version — not necessarily the very
        // next one when the boundary skips, but never the same one.
        assert.ok(encodeQr("x".repeat(capacity + 1)).size > sizeOf(version), `${capacity + 1} bytes`);
      }
    }
  });

  it("moves to the next version exactly one byte past capacity for consecutive versions", () => {
    assert.equal(encodeQr("x".repeat(14)).size, sizeOf(1));
    assert.equal(encodeQr("x".repeat(15)).size, sizeOf(2));
    assert.equal(encodeQr("x".repeat(26)).size, sizeOf(2));
    assert.equal(encodeQr("x".repeat(27)).size, sizeOf(3));
  });

  it("counts bytes, not characters", () => {
    // Seven two-byte characters are 14 bytes and fit version 1; eight are 16 and do not.
    assert.equal(encodeQr("é".repeat(7)).size, sizeOf(1));
    assert.equal(encodeQr("é".repeat(8)).size, sizeOf(2));
    // One four-byte emoji is four bytes, not one or two.
    assert.equal(encodeQr("🎉".repeat(3)).size, sizeOf(1)); // 12 bytes
    assert.equal(encodeQr("🎉".repeat(4)).size, sizeOf(2)); // 16 bytes
  });

  it("encodes the largest text that fits any version and refuses one byte more", () => {
    assert.equal(encodeQr("x".repeat(2331)).size, sizeOf(40));
    assert.throws(() => encodeQr("x".repeat(2332)), /too long/);
  });

  it("encodes the empty string", () => {
    assert.equal(encodeQr("").size, sizeOf(1));
  });
});

describe("encodeQr is deterministic", () => {
  it("gives the same matrix for the same text", () => {
    for (const text of SAMPLES) {
      assert.deepEqual(encodeQr(text).modules, encodeQr(text).modules);
    }
  });

  it("gives a different matrix for different text", () => {
    const a = toRows(encodeQr("https://cliplink.example/room/X7KP2M"));
    const b = toRows(encodeQr("https://cliplink.example/room/X7KP2N"));
    assert.notDeepEqual(a, b);
  });
});

describe("encodeQr structure", () => {
  // These hold for every symbol whatever the data, so they fail on a broken
  // encoder even for text no vector covers.

  const FINDER = [
    "#######",
    "#.....#",
    "#.###.#",
    "#.###.#",
    "#.###.#",
    "#.....#",
    "#######",
  ];

  const at = ({ modules }: QrMatrix, x: number, y: number) => modules[y][x];

  for (const text of SAMPLES) {
    const label = text.length > 24 ? `${text.slice(0, 24)}… (${text.length} chars)` : JSON.stringify(text);

    describe(label, () => {
      const matrix = encodeQr(text);
      const { size } = matrix;
      const version = (size - 17) / 4;

      it("has a finder pattern in three corners, and none in the fourth", () => {
        const window = (left: number, top: number) =>
          Array.from({ length: 7 }, (_, dy) =>
            Array.from({ length: 7 }, (_, dx) => (at(matrix, left + dx, top + dy) ? "#" : ".")).join(""),
          );

        assert.deepEqual(window(0, 0), FINDER);
        assert.deepEqual(window(size - 7, 0), FINDER);
        assert.deepEqual(window(0, size - 7), FINDER);
        assert.notDeepEqual(window(size - 7, size - 7), FINDER);
      });

      it("keeps a light separator between each finder and the data", () => {
        for (let index = 0; index < 8; index += 1) {
          // Top-left, top-right, bottom-left: the row and column beside each finder.
          assert.equal(at(matrix, index, 7), false);
          assert.equal(at(matrix, 7, index), false);
          assert.equal(at(matrix, size - 8, index), false);
          assert.equal(at(matrix, size - 1 - index, 7), false);
          assert.equal(at(matrix, index, size - 8), false);
          assert.equal(at(matrix, 7, size - 1 - index), false);
        }
      });

      it("alternates dark and light along both timing patterns", () => {
        for (let index = 8; index < size - 8; index += 1) {
          assert.equal(at(matrix, index, 6), index % 2 === 0, `row 6, column ${index}`);
          assert.equal(at(matrix, 6, index), index % 2 === 0, `column 6, row ${index}`);
        }
      });

      it("has the always-dark module beside the bottom-left finder", () => {
        assert.equal(at(matrix, 8, size - 8), true);
      });

      it("has an alignment pattern by the bottom-right corner from version 2 up", () => {
        if (version < 2) {
          return;
        }
        const centre = size - 7;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const ring = Math.max(Math.abs(dx), Math.abs(dy));
            assert.equal(at(matrix, centre + dx, centre + dy), ring !== 1, `(${dx}, ${dy}) from centre`);
          }
        }
      });

      it("carries the same valid format information in both places", () => {
        const first = readFormatFirstCopy(matrix);
        const second = readFormatSecondCopy(matrix);

        assert.equal(first, second);
        const masks = [0, 1, 2, 3, 4, 5, 6, 7].filter((mask) => formatBits(mask) === first);
        assert.equal(masks.length, 1, `${first.toString(2)} is not a level-M format word`);
      });

      it("carries the version in both places, from version 7 up", () => {
        if (version < 7) {
          return;
        }
        const [bottomLeft, topRight] = readVersionCopies(matrix);
        assert.equal(bottomLeft, versionBits(version));
        assert.equal(topRight, versionBits(version));
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Format and version information, computed and read here from the layout in
// the specification rather than through the encoder's own helpers.

/**
 * The 15 format bits for error-correction level M (bits 00) and a mask: the
 * five data bits, a BCH(15,5) remainder over 0x537, XORed with 0x5412.
 */
function formatBits(mask: number) {
  const data = (0b00 << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

/** The 18 version bits: six of version, and a BCH(18,6) remainder over 0x1F25. */
function versionBits(version: number) {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

/** Bit `index` of a copy, read from module `(x, y)` — least significant first. */
function collect(bits: Array<[number, number]>, { modules }: QrMatrix) {
  return bits.reduce((value, [x, y], index) => value | ((modules[y][x] ? 1 : 0) << index), 0);
}

/** Wrapped around the top-left finder. */
function readFormatFirstCopy(matrix: QrMatrix) {
  const bits: Array<[number, number]> = [];
  for (let index = 0; index <= 5; index += 1) bits.push([8, index]);
  bits.push([8, 7], [8, 8], [7, 8]);
  for (let index = 9; index < 15; index += 1) bits.push([14 - index, 8]);
  return collect(bits, matrix);
}

/** Split between the bottom-left and top-right finders. */
function readFormatSecondCopy(matrix: QrMatrix) {
  const { size } = matrix;
  const bits: Array<[number, number]> = [];
  for (let index = 0; index < 8; index += 1) bits.push([size - 1 - index, 8]);
  for (let index = 8; index < 15; index += 1) bits.push([8, size - 15 + index]);
  return collect(bits, matrix);
}

/** The two 6×3 blocks: beside the bottom-left finder, and above the top-right one. */
function readVersionCopies(matrix: QrMatrix) {
  const { size } = matrix;
  const bottomLeft: Array<[number, number]> = [];
  const topRight: Array<[number, number]> = [];
  for (let index = 0; index < 18; index += 1) {
    const across = size - 11 + (index % 3);
    const down = Math.floor(index / 3);
    topRight.push([across, down]);
    bottomLeft.push([down, across]);
  }
  return [collect(bottomLeft, matrix), collect(topRight, matrix)];
}
