/**
 * 考公陪练 · 图形推理题生成（个人二改）。
 * 不让模型画图：先定规则，再按规则用代码画，答案从同一份数据算出来；画完再用独立的检查函数数一遍，
 * 数出来对不上规则的题直接丢掉重出。每张图是 100×100 的 SVG 字符串。
 *
 * 题型：面数、直线数、一笔画、笔画数、旋转、平移、黑白运算（去同存异 / 去异存同 / 叠加）、轴对称
 */

/* ───────── 随机 ───────── */
export type Rng = () => number;
export function rngFrom(seed: number): Rng { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const pick = <T,>(r: Rng, a: T[]) => a[Math.floor(r() * a.length)];
const shuffle = <T,>(r: Rng, a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const INK = '#22231f';
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#fff"/>${body}</svg>`;
const ln = (x1: number, y1: number, x2: number, y2: number, w = 2.2) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;

export interface FigPuzzle {
  kind: FigKind; title: string;
  seq: string[];            // 题干 4 张（最后一个位置是「?」，不在数组里）
  rows?: string[][];        // 黑白运算：两行，每行三张，第二行最后一张是 ?
  options: string[];        // A–D
  answer: 'A' | 'B' | 'C' | 'D';
  steps: string[]; takeaway: string; pointId: string;
}
export type FigKind = 'faces' | 'lines' | 'onestroke' | 'strokes' | 'rotate' | 'move' | 'xor' | 'symmetry';

/* ───────── 面数：矩形 / 圆里画 k 条互不相交的平行弦，面数 = k + 1 ───────── */
function facesFig(r: Rng, k: number): { svg: string; faces: number } {
  const circle = r() < 0.4, vertical = r() < 0.5;
  const cuts = shuffle(r, [22, 32, 42, 50, 58, 68, 78]).slice(0, k).sort((a, b) => a - b);
  let body = circle ? `<circle cx="50" cy="50" r="38" fill="none" stroke="${INK}" stroke-width="2.2"/>` : `<rect x="14" y="14" width="72" height="72" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  for (const c of cuts) {
    if (circle) { const h = Math.sqrt(38 * 38 - (c - 50) ** 2); body += vertical ? ln(c, 50 - h, c, 50 + h) : ln(50 - h, c, 50 + h, c); }
    else body += vertical ? ln(c, 14, c, 86) : ln(14, c, 86, c);
  }
  // 检查：弦都在图形内部且互不重合 → 面数 = 弦数 + 1
  const ok = new Set(cuts).size === cuts.length && cuts.every(c => c > 14 && c < 86);
  return { svg: svg(body), faces: ok ? k + 1 : -1 };
}

/* ───────── 直线数：正 n 边形 ───────── */
function polygonFig(r: Rng, n: number): { svg: string; lines: number } {
  const rot = r() * Math.PI * 2 / n, R = 36;
  const pts = Array.from({ length: n }, (_, i) => [50 + R * Math.cos(rot + i * 2 * Math.PI / n), 50 + R * Math.sin(rot + i * 2 * Math.PI / n)]);
  let body = ''; for (let i = 0; i < n; i++) { const [a, b] = pts[i], [c, d] = pts[(i + 1) % n]; body += ln(a, b, c, d); }
  return { svg: svg(body), lines: n };
}

/* ───────── 一笔画 / 笔画数：3×3 点阵上的连通图，按奇点数算 ───────── */
type Edge = [number, number];
const GP = (i: number) => [20 + (i % 3) * 30, 20 + Math.floor(i / 3) * 30];
function candidateEdges(): Edge[] {
  const e: Edge[] = [];
  for (let i = 0; i < 9; i++) { const x = i % 3, y = Math.floor(i / 3); if (x < 2) e.push([i, i + 1]); if (y < 2) e.push([i, i + 3]); }
  return e;
}
const DIAG: [Edge, Edge][] = [0, 1, 3, 4].map(i => [[i, i + 4], [i + 1, i + 3]]);
export function graphInfo(edges: Edge[]): { connected: boolean; odd: number; strokes: number } {
  const deg = new Array(9).fill(0); const used = new Set<number>();
  for (const [a, b] of edges) { deg[a]++; deg[b]++; used.add(a); used.add(b); }
  const nodes = [...used]; if (!nodes.length) return { connected: false, odd: 0, strokes: 0 };
  const seen = new Set([nodes[0]]); const st = [nodes[0]];
  while (st.length) { const v = st.pop()!; for (const [a, b] of edges) { const w = a === v ? b : b === v ? a : -1; if (w >= 0 && !seen.has(w)) { seen.add(w); st.push(w); } } }
  const odd = deg.filter(d => d % 2).length;
  return { connected: seen.size === nodes.length, odd, strokes: odd === 0 ? 1 : odd / 2 };
}
function randomGraph(r: Rng, want: (g: ReturnType<typeof graphInfo>) => boolean): Edge[] | null {
  for (let t = 0; t < 400; t++) {
    const base = shuffle(r, candidateEdges()).slice(0, 4 + Math.floor(r() * 6));
    for (const [d1, d2] of DIAG) if (r() < 0.3) base.push(r() < 0.5 ? d1 : d2);   // 一个格子最多一条对角线，不产生交叉点
    const g = graphInfo(base);
    if (g.connected && want(g)) return base;
  }
  return null;
}
const graphSvg = (edges: Edge[]) => svg(edges.map(([a, b]) => { const [x1, y1] = GP(a), [x2, y2] = GP(b); return ln(x1, y1, x2, y2, 2.4); }).join(''));
const edgeKey = (e: Edge[]) => e.map(([a, b]) => a < b ? `${a}-${b}` : `${b}-${a}`).sort().join(',');

/* ───────── 对称：检查四条对称轴 ───────── */
const MAPS: Record<string, (i: number) => number> = {
  v: i => Math.floor(i / 3) * 3 + (2 - i % 3),      // 竖轴
  h: i => (2 - Math.floor(i / 3)) * 3 + i % 3,      // 横轴
  d1: i => (i % 3) * 3 + Math.floor(i / 3),         // 主对角线
  d2: i => (2 - i % 3) * 3 + (2 - Math.floor(i / 3)),
};
export function symmetryAxes(edges: Edge[]): string[] {
  const k = edgeKey(edges);
  return Object.entries(MAPS).filter(([, m]) => edgeKey(edges.map(([a, b]) => [m(a), m(b)] as Edge)) === k).map(([n]) => n);
}

/* ───────── 旋转：不对称的字形在方框里每次转 90° ───────── */
const GLYPHS: string[] = [
  // L 形加一个点、旗子、箭头加尾巴：都没有任何对称性，转和翻都能分得清
  `<path d="M30 25 L30 72 L58 72" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="66" cy="34" r="7" fill="${INK}"/>`,
  `<path d="M34 78 L34 22 L70 34 L34 46" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><rect x="58" y="62" width="12" height="12" fill="${INK}"/>`,
  `<path d="M24 50 L66 50 M54 38 L66 50 L54 62" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="30" cy="30" r="6" fill="none" stroke="${INK}" stroke-width="3"/>`,
];
const framed = (inner: string, deg: number, mirror = false) => svg(`<rect x="6" y="6" width="88" height="88" fill="none" stroke="#c9c5ba" stroke-width="1.5"/><g transform="rotate(${deg} 50 50)${mirror ? ' translate(100 0) scale(-1 1)' : ''}">${inner}</g>`);

/* ───────── 平移 / 黑白：3×3 格子 ───────── */
const cellsSvg = (cells: number[], gray: number[] = []) => {
  let b = '';
  for (let i = 0; i < 9; i++) { const x = 14 + (i % 3) * 24, y = 14 + Math.floor(i / 3) * 24; b += `<rect x="${x}" y="${y}" width="24" height="24" fill="${cells.includes(i) ? INK : gray.includes(i) ? '#9a968c' : '#fff'}" stroke="${INK}" stroke-width="1.6"/>`; }
  return svg(b);
};
const bitsSvg = (bits: boolean[]) => cellsSvg(bits.map((v, i) => v ? i : -1).filter(i => i >= 0));

/* ───────── 出题 ───────── */
const LETTERS = ['A', 'B', 'C', 'D'] as const;
function place(r: Rng, right: string, wrong: string[]): { options: string[]; answer: FigPuzzle['answer'] } {
  const opts = shuffle(r, [right, ...wrong.slice(0, 3)]);
  return { options: opts, answer: LETTERS[opts.indexOf(right)] };
}

export function makeFigPuzzle(kind: FigKind, seed = Date.now()): FigPuzzle {
  const r = rngFrom(seed);
  for (let attempt = 0; attempt < 30; attempt++) {
    const p = tryMake(kind, r);
    if (p && checkPuzzle(p.puzzle, p.facts)) return p.puzzle;
  }
  throw new Error('这一题没生成成功，换一题');
}

interface Facts { kind: FigKind; seqVals: unknown[]; optVals: unknown[]; rightIdx: number }

function tryMake(kind: FigKind, r: Rng): { puzzle: FigPuzzle; facts: Facts } | null {
  if (kind === 'faces') {
    const start = 1 + Math.floor(r() * 2);              // 面数 1..2 起
    const seq = [0, 1, 2, 3].map(i => facesFig(r, start + i - 1));
    const ansFaces = start + 4;
    const right = facesFig(r, ansFaces - 1);
    const wrongK = shuffle(r, [ansFaces - 2, ansFaces + 1, ansFaces - 3, ansFaces + 2].filter(x => x >= 1 && x <= 7)).slice(0, 3);
    const wrong = wrongK.map(f => facesFig(r, f - 1));
    const pl = place(r, right.svg, wrong.map(w => w.svg));
    return { puzzle: { kind, title: '面数', seq: seq.map(s => s.svg), ...pl, steps: ['图形线条规整、有封闭区域 → 先数面', `数出来依次是 ${seq.map(s => s.faces).join('、')}，每次多 1 个面`, `下一个应是 ${ansFaces} 个面`], takeaway: '封闭区域多，先数面', pointId: 'pd-face2' },
      facts: { kind, seqVals: seq.map(s => s.faces), optVals: pl.options.map(o => o === right.svg ? right.faces : wrong[wrong.findIndex(w => w.svg === o)].faces), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  if (kind === 'lines') {
    const start = 3;
    const seq = [0, 1, 2, 3].map(i => polygonFig(r, start + i));
    const right = polygonFig(r, 7);
    const wrong = shuffle(r, [5, 6, 8]).map(n => polygonFig(r, n));
    const pl = place(r, right.svg, wrong.map(w => w.svg));
    return { puzzle: { kind, title: '直线数', seq: seq.map(s => s.svg), ...pl, steps: ['图形都由直线围成、边数不同 → 数直线', '依次 3、4、5、6 条，每次多 1 条', '下一个是 7 条直线（七边形）'], takeaway: '全是直线图形，数线条', pointId: 'pd-line2' },
      facts: { kind, seqVals: seq.map(s => s.lines), optVals: pl.options.map(o => o === right.svg ? 7 : wrong.find(w => w.svg === o)!.lines), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  if (kind === 'onestroke' || kind === 'strokes') {
    const target = kind === 'onestroke' ? [1, 1, 1, 1] : [1, 2, 3, 4].slice(0, 4);
    const seqG = target.map(t => randomGraph(r, g => g.strokes === t && (t > 1 || g.odd <= 2)));
    const ans = kind === 'onestroke' ? 1 : 5;
    if (kind === 'strokes') return null as any; // 5 笔画在 3×3 点阵里很难画得自然，暂只出「一笔画」
    const rightG = randomGraph(r, g => g.strokes === ans);
    const wrongG = [2, 2, 3].map(t => randomGraph(r, g => g.strokes === t));
    if (seqG.some(g => !g) || !rightG || wrongG.some(g => !g)) return null;
    const keys = new Set([...seqG, rightG, ...wrongG].map(g => edgeKey(g!))); if (keys.size < 8) return null;
    const pl = place(r, graphSvg(rightG), wrongG.map(g => graphSvg(g!)));
    const all = [rightG, ...wrongG] as Edge[][];
    return { puzzle: { kind, title: '一笔画', seq: seqG.map(g => graphSvg(g!)), ...pl, steps: ['线条连在一起、交点多 → 想到一笔画', '数奇点（连着奇数条线的点）：题干每个图奇点都是 0 或 2 个，都能一笔画成', '选项里只有一个奇点数为 0 或 2 的'], takeaway: '奇点 0 或 2 个 = 一笔画', pointId: 'pd-stroke2' },
      facts: { kind, seqVals: seqG.map(g => graphInfo(g!).strokes), optVals: pl.options.map(o => graphInfo(all[[graphSvg(rightG), ...wrongG.map(g => graphSvg(g!))].indexOf(o)]).strokes), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  if (kind === 'rotate') {
    const g = pick(r, GLYPHS), step = pick(r, [90, -90]), start = pick(r, [0, 90, 180, 270]);
    const seq = [0, 1, 2, 3].map(i => framed(g, start + step * i));
    const ansDeg = start + step * 4;
    const right = framed(g, ansDeg);
    const wrong = [framed(g, ansDeg, true), framed(g, ansDeg + 90), framed(g, ansDeg + 180, true)];
    const pl = place(r, right, wrong);
    const dir = step > 0 ? '顺时针' : '逆时针';
    return { puzzle: { kind, title: '旋转', seq, ...pl, steps: ['元素完全相同、只是方向在变 → 看位置规律', `每次${dir}转 90°`, '第五个转回到和第一个一样的方向；注意排除翻转（镜像）的选项'], takeaway: '元素一样看方向：转还是翻', pointId: 'pd-rot2' },
      facts: { kind, seqVals: seq, optVals: pl.options.map(o => o === right ? 'R' : 'W'), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  if (kind === 'move') {
    const step = pick(r, [1, 2]), start = Math.floor(r() * 9);
    const gstep = pick(r, [-1, 3]), gstart = (start + 4) % 9;
    const posAt = (i: number) => (start + step * i) % 9;
    const gAt = (i: number) => ((gstart + gstep * i) % 9 + 9) % 9;
    const seq = [0, 1, 2, 3].map(i => cellsSvg([posAt(i)], gAt(i) === posAt(i) ? [] : [gAt(i)]));
    const a = posAt(4), ga = gAt(4);
    const right = cellsSvg([a], ga === a ? [] : [ga]);
    const others = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(x => x !== a)).slice(0, 3);
    const wrong = others.map((x, i) => i === 0 ? cellsSvg([a], [(ga + 1) % 9]) : cellsSvg([x], [ga]));
    if (new Set([right, ...wrong]).size < 4) return null;
    const pl = place(r, right, wrong);
    return { puzzle: { kind, title: '平移', seq, ...pl, steps: ['元素相同、位置在变 → 看平移，黑块灰块分开看', `黑块每次按从左到右、从上到下的顺序往后走 ${step} 格（走到头接着从第一格）`, `灰块每次${gstep === 3 ? '往下走 1 行（到底回到顶）' : '往前退 1 格'}`, '两个都对上的只有一个选项'], takeaway: '多个元素分开找各自的走法', pointId: 'pd-move2' },
      facts: { kind, seqVals: [], optVals: pl.options.map(o => o === right ? 'R' : 'W'), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  if (kind === 'xor') {
    const op = pick(r, ['xor', 'and', 'or'] as const);
    const rand = () => Array.from({ length: 9 }, () => r() < 0.45);
    const f = (x: boolean[], y: boolean[]) => x.map((v, i) => op === 'xor' ? v !== y[i] : op === 'and' ? v && y[i] : v || y[i]);
    const A = rand(), B = rand(), D = rand(), E = rand();
    const Cc = f(A, B), F = f(D, E);
    if (F.every(v => !v) || F.every(v => v) || Cc.every(v => !v)) return null;
    // 两行都得只符合这一种运算，免得一题两解
    const ops = ['xor', 'and', 'or'].filter(o => { const g = (x: boolean[], y: boolean[]) => x.map((v, i) => o === 'xor' ? v !== y[i] : o === 'and' ? v && y[i] : v || y[i]); return g(A, B).every((v, i) => v === Cc[i]); });
    if (ops.length !== 1) return null;
    const flip = (bits: boolean[], i: number) => bits.map((v, j) => j === i ? !v : v);
    const idx = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const alt = ['xor', 'and', 'or'].filter(o => o !== op).map(o => D.map((v, i) => o === 'xor' ? v !== E[i] : o === 'and' ? v && E[i] : v || E[i]));
    const wrongBits = [...alt, flip(F, idx[0]), flip(F, idx[1])].filter(b => b.some((v, i) => v !== F[i]));
    const uniq: boolean[][] = []; for (const b of wrongBits) if (!uniq.some(u => u.every((v, i) => v === b[i]))) uniq.push(b);
    if (uniq.length < 3) return null;
    const right = bitsSvg(F);
    const pl = place(r, right, uniq.slice(0, 3).map(bitsSvg));
    const name = op === 'xor' ? '去同存异（相同的去掉，不同的留下）' : op === 'and' ? '去异存同（两张都黑的才留下）' : '叠加（有一张黑就是黑）';
    return { puzzle: { kind, title: '黑白运算', seq: [], rows: [[bitsSvg(A), bitsSvg(B), bitsSvg(Cc)], [bitsSvg(D), bitsSvg(E)]], ...pl, steps: ['每行三张、格子位置一样只是黑白不同 → 前两张运算得第三张', `第一行验证：规则是${name}`, '用同样的规则算第二行'], takeaway: '同位置黑白不同，试三种运算', pointId: 'pd-style' },
      facts: { kind, seqVals: [], optVals: pl.options.map(o => o === right ? 'R' : 'W'), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  if (kind === 'symmetry') {
    const symG = (): Edge[] | null => {
      for (let t = 0; t < 300; t++) {
        const axis = pick(r, ['v', 'h', 'd1', 'd2']); const m = MAPS[axis];
        const half = shuffle(r, [...candidateEdges(), ...DIAG.map(d => d[0])]).slice(0, 3 + Math.floor(r() * 3));
        const all: Edge[] = []; const seen = new Set<string>();
        for (const e of [...half, ...half.map(([a, b]) => [m(a), m(b)] as Edge)]) { const k = edgeKey([e]); if (!seen.has(k)) { seen.add(k); all.push(e); } }
        // 同一格两条对角线会产生交叉点，不要
        if (DIAG.some(([d1, d2]) => seen.has(edgeKey([d1])) && seen.has(edgeKey([d2])))) continue;
        if (graphInfo(all).connected && symmetryAxes(all).length >= 1) return all;
      }
      return null;
    };
    const asymG = () => randomGraph(r, g => g.connected) ;
    const seq = [symG(), symG(), symG(), symG()]; const right = symG();
    const wrong: Edge[][] = []; for (let t = 0; t < 60 && wrong.length < 3; t++) { const g = asymG(); if (g && symmetryAxes(g).length === 0) wrong.push(g); }
    if (seq.some(g => !g) || !right || wrong.length < 3) return null;
    const pl = place(r, graphSvg(right), wrong.map(graphSvg));
    const all = [right, ...wrong];
    return { puzzle: { kind, title: '轴对称', seq: seq.map(g => graphSvg(g!)), ...pl, steps: ['图形各不相同、看着很「规整」 → 看属性：对称', '题干每个图都能找到一条对称轴（竖、横或斜着的）', '选项里只有一个是轴对称图形'], takeaway: '图形乱但规整，先看对称', pointId: 'pd-attr' },
      facts: { kind, seqVals: seq.map(g => symmetryAxes(g!).length), optVals: pl.options.map(o => symmetryAxes(all[[graphSvg(right), ...wrong.map(graphSvg)].indexOf(o)]).length), rightIdx: LETTERS.indexOf(pl.answer) } };
  }
  return null;
}

/** 独立复查：数出来的和规则对不上就不要这题 */
function checkPuzzle(p: FigPuzzle, f: Facts): boolean {
  if (p.options.length !== 4 || new Set(p.options).size !== 4) return false;
  const v = f.optVals, ri = f.rightIdx;
  switch (f.kind) {
    case 'faces': { const s = f.seqVals as number[]; if (s.some(x => x < 1) || s.some((x, i) => i && x - s[i - 1] !== 1)) return false; const want = s[3] + 1; return v[ri] === want && v.filter(x => x === want).length === 1; }
    case 'lines': { const s = f.seqVals as number[]; return s.join() === '3,4,5,6' && v[ri] === 7 && v.filter(x => x === 7).length === 1; }
    case 'onestroke': { const s = f.seqVals as number[]; return s.every(x => x === 1) && v[ri] === 1 && v.filter(x => x === 1).length === 1; }
    case 'symmetry': { const s = f.seqVals as number[]; return s.every(x => x >= 1) && (v[ri] as number) >= 1 && v.filter(x => (x as number) >= 1).length === 1; }
    default: return v[ri] === 'R' && v.filter(x => x === 'R').length === 1;
  }
}

export const FIG_KINDS: { kind: FigKind; name: string; pointId: string }[] = [
  { kind: 'faces', name: '数面', pointId: 'pd-face2' }, { kind: 'lines', name: '数直线', pointId: 'pd-line2' }, { kind: 'onestroke', name: '一笔画', pointId: 'pd-stroke2' },
  { kind: 'rotate', name: '旋转', pointId: 'pd-rot2' }, { kind: 'move', name: '平移', pointId: 'pd-move2' }, { kind: 'xor', name: '黑白运算', pointId: 'pd-style' }, { kind: 'symmetry', name: '轴对称', pointId: 'pd-attr' },
];

/** 整道题拼成一张 SVG（进错题本用） */
export function puzzleSvg(p: FigPuzzle): string {
  const inner = (s: string) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const cell = (s: string, x: number, y: number) => `<g transform="translate(${x} ${y})">${inner(s)}</g>`;
  let body = ''; let y = 0;
  if (p.rows) { p.rows.forEach((row, ri) => { row.forEach((s, i) => { body += cell(s, i * 110, y); }); if (ri === 1) body += `<text x="${2 * 110 + 50}" y="${y + 62}" font-size="40" text-anchor="middle">?</text>`; y += 110; }); }
  else { p.seq.forEach((s, i) => { body += cell(s, i * 110, 0); }); body += `<text x="${4 * 110 + 50}" y="62" font-size="40" text-anchor="middle">?</text>`; y = 110; }
  y += 14;
  p.options.forEach((s, i) => { body += `<text x="${i * 110 + 4}" y="${y + 12}" font-size="14">${'ABCD'[i]}</text>`; body += cell(s, i * 110, y + 16); });
  const W = 5 * 110, H = y + 16 + 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>`;
}
