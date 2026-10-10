/* מקודד QR מינימלי — מצב Byte, תיקון שגיאות M, גרסאות 1..10.
   קיבולת אמיתית: 216 בתי-מידע בגרסה 10 (ECB M), בניכוי 4 ביטים למד ה-Byte
   ועוד 16 ביטים לשדה האורך (בגרסה 10) — בפועל עד 213 בתים של טקסט, לא 216.
   "בתים" ולא "תווים": בעברית (UTF-8) כל תו הוא 2 בתים, כך שבפועל מתקבלים
   כ-106 תווי עברית לכל היותר בגרסה 10.
   נכתב מאפס כדי לא לשבור את עקרון אפס בקשות הרשת. מחזיר מטריצה בוליאנית. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);

  // [קודוני תיקון לבלוק, [[מספר בלוקים, קודוני מידע לבלוק], ...]]
  const ECB = {
    1:[10,[[1,16]]], 2:[16,[[1,28]]], 3:[26,[[1,44]]], 4:[18,[[2,32]]], 5:[24,[[2,43]]],
    6:[16,[[4,27]]], 7:[18,[[4,31]]], 8:[22,[[2,38],[2,39]]], 9:[22,[[3,36],[2,37]]],
    10:[26,[[4,43],[1,44]]]
  };
  const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
  const capacity = v => ECB[v][1].reduce((s,[n,d]) => s + n*d, 0);

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const lenBits = v < 10 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= capacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error('QR: הטקסט ארוך מדי');

  /* ---------- שדה גלואה GF(256) ---------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

  function rsGenerator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j]     ^= mul(poly[j], EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(dataBlock, ecLen) {
    // rsGenerator מחזיר מקדמים בסדר עולה; כאן דרוש סדר יורד בלי המקדם המוביל
    const gen = rsGenerator(ecLen).reverse().slice(1);
    const res = new Uint8Array(ecLen);
    for (const b of dataBlock) {
      const factor = b ^ res[0];
      res.copyWithin(0, 1); res[ecLen - 1] = 0;
      for (let i = 0; i < ecLen; i++) res[i] ^= mul(gen[i], factor);
    }
    return res;
  }

  /* ---------- זרם הביטים ---------- */
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const totalData = capacity(version);
  const remaining = totalData * 8 - bits.length;
  push(0, Math.min(4, remaining));
  while (bits.length % 8) bits.push(0);
  const padBytes = [0xEC, 0x11];
  for (let i = 0; bits.length < totalData * 8; i++) push(padBytes[i % 2], 8);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataCodewords.push(v);
  }

  /* ---------- חלוקה לבלוקים ושזירה ---------- */
  const [ecLen, groups] = ECB[version];
  const dataBlocks = [], ecBlocks = [];
  let pos = 0;
  for (const [count, dataLen] of groups) {
    for (let i = 0; i < count; i++) {
      const blk = dataCodewords.slice(pos, pos + dataLen);
      pos += dataLen;
      dataBlocks.push(blk);
      ecBlocks.push(rsEncode(blk, ecLen));
    }
  }
  const finalCodewords = [];
  const maxData = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxData; i++)
    for (const blk of dataBlocks) if (i < blk.length) finalCodewords.push(blk[i]);
  for (let i = 0; i < ecLen; i++)
    for (const blk of ecBlocks) finalCodewords.push(blk[i]);

  /* ---------- בניית המטריצה ---------- */
  const size = version * 4 + 17;
  const m  = Array.from({length: size}, () => new Array(size).fill(null)); // null = עדיין ריק
  const fn = Array.from({length: size}, () => new Array(size).fill(false)); // תבנית קבועה?

  const set = (r, c, dark, isFn) => { m[r][c] = dark; if (isFn) fn[r][c] = true; };

  function finder(r0, c0) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      set(r, c, d !== 2 && d <= 3, true);
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) { const dark = i % 2 === 0; set(6, i, dark, true); set(i, 6, dark, true); }

  const coords = ALIGN[version];
  for (const r0 of coords) for (const c0 of coords) {
    if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === size - 7) || (r0 === size - 7 && c0 === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      set(r0 + dr, c0 + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1, true);
  }

  set(size - 8, 8, true, true); // המודול הכהה הקבוע

  // שמירת מקום למידע הפורמט
  for (let i = 0; i <= 8; i++) { if (m[8][i] === null) set(8, i, false, true); if (m[i][8] === null) set(i, 8, false, true); }
  for (let i = 0; i < 8; i++) { if (m[8][size-1-i] === null) set(8, size-1-i, false, true); if (m[size-1-i][8] === null) set(size-1-i, 8, false, true); }

  // מידע הגרסה (רק מגרסה 7)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1, a = Math.floor(i / 3), b = size - 11 + (i % 3);
      set(a, b, bit, true); set(b, a, bit, true);
    }
  }

  /* ---------- הצבת המידע בזיגזג ---------- */
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (m[r][c] !== null) continue;
        let dark = false;
        if (bitIdx < totalBits) dark = ((finalCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
        m[r][c] = dark;
        bitIdx++;
      }
    }
  }

  /* ---------- מסכות ובחירת הטובה ביותר ---------- */
  const MASKS = [
    (r,c) => (r + c) % 2 === 0,
    (r,c) => r % 2 === 0,
    (r,c) => c % 3 === 0,
    (r,c) => (r + c) % 3 === 0,
    (r,c) => (Math.floor(r/2) + Math.floor(c/3)) % 2 === 0,
    (r,c) => (r*c) % 2 + (r*c) % 3 === 0,
    (r,c) => ((r*c) % 2 + (r*c) % 3) % 2 === 0,
    (r,c) => ((r+c) % 2 + (r*c) % 3) % 2 === 0,
  ];

  function applyMask(grid, maskFn) {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!fn[r][c] && maskFn(r, c)) grid[r][c] = !grid[r][c];
  }

  function drawFormat(grid, mask) {
    const fmt = (0b00 << 3) | mask;                      // 00 = רמת תיקון M
    let rem = fmt;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bitsF = ((fmt << 10) | rem) ^ 0x5412;
    const bit = i => ((bitsF >>> i) & 1) === 1;
    // עותק ראשון: עמודה 8 מלמעלה, ואז שורה 8 משמאל למרכז
    for (let i = 0; i <= 5; i++) grid[i][8] = bit(i);
    grid[7][8] = bit(6);
    grid[8][8] = bit(7);
    grid[8][7] = bit(8);
    for (let i = 9; i < 15; i++) grid[8][14 - i] = bit(i);
    // עותק שני: שורה 8 מימין, ואז עמודה 8 מלמטה
    for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = bit(i);
    grid[size - 8][8] = true;
  }

  function penalty(g) {
    let p = 0;
    // כלל 1: רצפים של 5+ באותו צבע
    for (let i = 0; i < size; i++) {
      for (const line of [g[i], g.map(row => row[i])]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          if (line[j] === line[j-1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else run = 1;
        }
      }
    }
    // כלל 2: ריבועים 2x2 אחידים
    for (let r = 0; r < size-1; r++) for (let c = 0; c < size-1; c++)
      if (g[r][c] === g[r][c+1] && g[r][c] === g[r+1][c] && g[r][c] === g[r+1][c+1]) p += 3;
    // כלל 3: תבנית דמוית סמן איתור
    const P1 = [true,false,true,true,true,false,true,false,false,false,false];
    const P2 = [false,false,false,false,true,false,true,true,true,false,true];
    const match = (line, i, pat) => pat.every((v, k) => line[i+k] === v);
    for (let i = 0; i < size; i++) {
      const row = g[i], col = g.map(r => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (match(row, j, P1) || match(row, j, P2)) p += 40;
        if (match(col, j, P1) || match(col, j, P2)) p += 40;
      }
    }
    // כלל 4: סטייה מאיזון שחור/לבן
    let dark = 0;
    for (const row of g) for (const v of row) if (v) dark++;
    p += Math.floor(Math.abs(dark * 100 / (size*size) - 50) / 5) * 10;
    return p;
  }

  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = m.map(row => row.slice());
    applyMask(g, MASKS[mask]);
    drawFormat(g, mask);
    const s = penalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best;
}

/* ממיר מטריצה ל-SVG קומפקטי (נתיב אחד, ריצה אופקית לכל רצף) */
export function qrSvg(text, { border = 2, dark = '#0f172a', light = '#f8fafc' } = {}) {
  const m = qrMatrix(text);
  const n = m.length, size = n + border * 2, parts = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (m[y][x]) {
        const x0 = x;
        while (x < n && m[y][x]) x++;
        parts.push(`M${x0 + border} ${y + border}h${x - x0}v1h-${x - x0}z`);
      } else x++;
    }
  }
  return { size, light, dark, path: parts.join('') };
}
