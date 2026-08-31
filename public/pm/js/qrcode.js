// Minimal QR encoder: byte mode, error-correction level M, versions 1-10.
// A phone pointed at the screen is the whole point of the certificate flow, and
// pulling in a QR library would be the only third-party code in this UI, so the
// encoder lives here. Everything derivable (format/version BCH, alignment grid,
// Reed-Solomon) is computed rather than tabled.

// (ecCodewordsPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw)
const EC_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const EXP = new Array(512);
const LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i += 1) {
    EXP[i] = EXP[i - 255];
  }
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

const rsGenerator = (degree) => {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= mul(poly[j], 1);
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
};

const rsEncode = (data, ecLen) => {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i += 1) {
      res[i] ^= mul(gen[i + 1], factor);
    }
  });
  return res;
};

// BCH remainder, used for both the 15-bit format and 18-bit version strings.
const bch = (value, generator, bits) => {
  let rest = value << bits;
  const genBits = 32 - Math.clz32(generator);
  while (32 - Math.clz32(rest) >= genBits) {
    rest ^= generator << ((32 - Math.clz32(rest)) - genBits);
  }
  return rest;
};

const countBits = (version) => (version < 10 ? 8 : 16);

const pickVersion = (byteLength) => {
  for (let v = 1; v <= 10; v += 1) {
    const [ec, g1, g1cw, g2, g2cw] = EC_M[v];
    const dataCw = g1 * g1cw + g2 * g2cw;
    void ec;
    if (4 + countBits(v) + byteLength * 8 <= dataCw * 8) {
      return v;
    }
  }
  return null;
};

const toCodewords = (bytes, version) => {
  const [ecLen, g1, g1cw, g2, g2cw] = EC_M[version];
  const dataCw = g1 * g1cw + g2 * g2cw;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i -= 1) {
      bits.push((value >> i) & 1);
    }
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  bytes.forEach((b) => push(b, 8));
  const capacity = dataCw * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) {
    bits.push(0);
  }
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }
  const pad = [0xec, 0x11];
  while (data.length < dataCw) {
    data.push(pad[(data.length - bits.length / 8) % 2]);
  }

  // Split into blocks, compute EC per block, then interleave both halves.
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1; i += 1) {
    blocks.push(data.slice(offset, offset + g1cw));
    offset += g1cw;
  }
  for (let i = 0; i < g2; i += 1) {
    blocks.push(data.slice(offset, offset + g2cw));
    offset += g2cw;
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    blocks.forEach((b) => {
      if (i < b.length) {
        out.push(b[i]);
      }
    });
  }
  for (let i = 0; i < ecLen; i += 1) {
    ecBlocks.forEach((b) => out.push(b[i]));
  }
  return out;
};

const newMatrix = (size) => Array.from({ length: size }, () => new Array(size).fill(null));

const placeFinder = (m, row, col) => {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) {
        continue; // eslint-disable-line no-continue
      }
      const edge = r === -1 || r === 7 || c === -1 || c === 7;
      const ring = (r === 0 || r === 6) && c >= 0 && c <= 6;
      const side = (c === 0 || c === 6) && r >= 0 && r <= 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = !edge && (ring || side || core) ? 1 : 0;
    }
  }
};

const placeAlignment = (m, version) => {
  const centers = ALIGN[version];
  centers.forEach((r) => centers.forEach((c) => {
    const overlapsFinder = (r <= 8 && c <= 8)
      || (r <= 8 && c >= m.length - 9)
      || (r >= m.length - 9 && c <= 8);
    if (overlapsFinder) {
      return;
    }
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        m[r + dr][c + dc] = ring === 1 ? 0 : 1;
      }
    }
  }));
};

const reserveFormat = (m) => {
  const size = m.length;
  for (let i = 0; i < 9; i += 1) {
    if (m[8][i] === null) m[8][i] = 0;
    if (m[i][8] === null) m[i][8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
  }
  m[size - 8][8] = 1; // the always-dark module
};

const buildBase = (version) => {
  const size = version * 4 + 17;
  const m = newMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) {
    m[6][i] = i % 2 === 0 ? 1 : 0;
    m[i][6] = i % 2 === 0 ? 1 : 0;
  }
  placeAlignment(m, version);
  reserveFormat(m);
  if (version >= 7) {
    const info = (version << 12) | bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i += 1) {
      const bit = (info >> i) & 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      m[r][c] = bit;
      m[c][r] = bit;
    }
  }
  return m;
};

const dataPositions = (m) => {
  const size = m.length;
  const cells = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    const col = right <= 6 ? right - 1 : right; // column 6 is the timing pattern
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      [col, col - 1].forEach((c) => {
        if (m[row][c] === null) {
          cells.push([row, c]);
        }
      });
    }
    upward = !upward;
  }
  return cells;
};

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const penalty = (m) => {
  const size = m.length;
  let score = 0;
  const runScore = (line) => {
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let r = 0; r < size; r += 1) {
    runScore(m[r]);
    runScore(m.map((row) => row[r]));
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) {
        score += 3;
      }
    }
  }
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reverse = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, start, pat) => pat.every((v, i) => line[start + i] === v);
  const scanLine = (line) => {
    for (let i = 0; i + 11 <= line.length; i += 1) {
      if (matches(line, i, pattern) || matches(line, i, reverse)) {
        score += 40;
      }
    }
  };
  for (let r = 0; r < size; r += 1) {
    scanLine(m[r]);
    scanLine(m.map((row) => row[r]));
  }
  const dark = m.flat().filter((v) => v === 1).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
};

const applyFormat = (m, mask) => {
  const size = m.length;
  // 0b00 is EC level M in the format string.
  const info = (((0b00 << 3) | mask) << 10 | bch((0b00 << 3) | mask, 0x537, 10)) ^ 0x5412;
  const bit = (i) => (info >> i) & 1;
  // First copy: down column 8, then left along row 8.
  for (let i = 0; i <= 5; i += 1) {
    m[i][8] = bit(i);
  }
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i <= 14; i += 1) {
    m[8][14 - i] = bit(i);
  }
  // Second copy: right along row 8, then down column 8.
  for (let i = 0; i <= 7; i += 1) {
    m[8][size - 1 - i] = bit(i);
  }
  for (let i = 8; i <= 14; i += 1) {
    m[size - 15 + i][8] = bit(i);
  }
  m[size - 8][8] = 1;
};

// Returns a size x size matrix of 0/1, or null when the text does not fit.
export const encode = (text) => {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  if (!version) {
    return null;
  }
  const codewords = toCodewords(bytes, version);
  const base = buildBase(version);
  const cells = dataPositions(base);
  const bits = [];
  codewords.forEach((cw) => {
    for (let i = 7; i >= 0; i -= 1) {
      bits.push((cw >> i) & 1);
    }
  });

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = base.map((row) => row.slice());
    cells.forEach(([r, c], i) => {
      const bit = i < bits.length ? bits[i] : 0;
      m[r][c] = MASKS[mask](r, c) ? bit ^ 1 : bit;
    });
    applyFormat(m, mask);
    const score = penalty(m);
    if (!best || score < best.score) {
      best = { score, m };
    }
  }
  return best.m;
};

// Renders the matrix as a standalone SVG string (quiet zone included).
export const toSvg = (text, pixels = 200) => {
  const m = encode(text);
  if (!m) {
    return null;
  }
  const quiet = 4;
  const size = m.length + quiet * 2;
  const rects = [];
  m.forEach((row, r) => row.forEach((v, c) => {
    if (v) {
      rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`);
    }
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/>`
    + `<g fill="#000">${rects.join('')}</g></svg>`;
};
