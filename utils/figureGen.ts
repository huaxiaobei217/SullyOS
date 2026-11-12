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
  /** 「混着来」：答完再告诉题型 */
  mixed?: boolean;
}
export type FigKind = 'faces' | 'lines' | 'onestroke' | 'strokes' | 'rotate' | 'move' | 'xor' | 'symmetry' | 'count' | 'parts' | 'orbit' | 'mixed';
/** 「混着来」从这些里抽（考场上不会告诉你是哪类） */
const MIX_POOL: FigKind[] = ['faces', 'lines', 'onestroke', 'rotate', 'move', 'xor', 'symmetry', 'count', 'parts', 'orbit'];

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
const cellsSvg = (cells: number[], gray: number[] = [], n = 3) => {
  let b = ''; const w = 72 / n;
  for (let i = 0; i < n * n; i++) { const x = 14 + (i % n) * w, y = 14 + Math.floor(i / n) * w; b += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${w.toFixed(1)}" fill="${cells.includes(i) ? INK : gray.includes(i) ? '#9a968c' : '#fff'}" stroke="${INK}" stroke-width="1.6"/>`; }
  return svg(b);
};
const bitsSvg = (bits: boolean[]) => cellsSvg(bits.map((v, i) => v ? i : -1).filter(i => i >= 0), [], Math.round(Math.sqrt(bits.length)));

/* ═════════ 第二批（更像真题）：面数换成凸多边形 + 对角线、曲直数、元素数量 / 种类、部分数、多个元素绕圈 ═════════ */
type Pt = [number, number];
/** 两条线段严格相交（共端点不算） */
const segCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const o = (p: Pt, q: Pt, s: Pt) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/* —— 面：凸 n 边形里画 k 条互不相交的对角线 —— */
interface PolyFig { pts: Pt[]; diags: Edge[] }
function polyFaces(r: Rng, faces: number): PolyFig | null {
  const k = faces - 1;
  for (let t = 0; t < 80; t++) {
    const lo = Math.max(4, k + 3), n = lo + Math.floor(r() * (10 - lo)); // 凸 n 边形最多 n−3 条不相交对角线
    if (n > 9) continue;
    const rot = r() * Math.PI * 2;
    const pts: Pt[] = Array.from({ length: n }, (_, i) => { const a = rot + (i + (r() - 0.5) * 0.45) * 2 * Math.PI / n; return [50 + 37 * Math.cos(a), 50 + 37 * Math.sin(a)]; });
    const cand: Edge[] = []; for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) cand.push([i, j]);
    const diags: Edge[] = [];
    for (const d of shuffle(r, cand)) { if (diags.length >= k) break; if (diags.every(e => !segCross(pts[d[0]], pts[d[1]], pts[e[0]], pts[e[1]]))) diags.push(d); }
    if (diags.length === k) return { pts, diags };
  }
  return null;
}
const polySvg = (f: PolyFig) => svg(`<polygon points="${f.pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>${f.diags.map(([a, b]) => ln(f.pts[a][0], f.pts[a][1], f.pts[b][0], f.pts[b][1])).join('')}`);
/** 独立数面：先确认对角线两两不交叉，再用欧拉公式（内部面 = 边 − 点 + 1） */
function countFaces(f: PolyFig): number {
  for (let i = 0; i < f.diags.length; i++) for (let j = i + 1; j < f.diags.length; j++) {
    const [a, b] = f.diags[i], [c, d] = f.diags[j];
    if (segCross(f.pts[a], f.pts[b], f.pts[c], f.pts[d])) return -1;
  }
  return (f.pts.length + f.diags.length) - f.pts.length + 1;
}
const polyLines = (f: PolyFig) => f.pts.length + f.diags.length;

/* —— 小元素：放在 3×3 的位置上，互不接触，所以线、面、个数都能数得一清二楚 —— */
type ShapeName = 'circle' | 'square' | 'tri' | 'semi' | 'sector' | 'lens' | 'penta';
interface El { shape: ShapeName; black: boolean; slot: number }
/** 每种元素的直线数、曲线数（数线时用） */
const SHAPE_LC: Record<ShapeName, [number, number]> = { circle: [0, 1], square: [4, 0], tri: [3, 0], semi: [1, 1], sector: [2, 1], lens: [0, 2], penta: [5, 0] };
const SHAPE_NAME: Record<ShapeName, string> = { circle: '圆', square: '方块', tri: '三角', semi: '半圆', sector: '扇形', lens: '叶形', penta: '五边形' };
function shapeSvg(e: El): string {
  const cx = 22 + (e.slot % 3) * 28, cy = 22 + Math.floor(e.slot / 3) * 28, s = 9.5;
  const st = `fill="${e.black ? INK : '#fff'}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"`;
  const f = (v: number) => v.toFixed(1);
  switch (e.shape) {
    case 'circle': return `<circle cx="${cx}" cy="${cy}" r="${s}" ${st}/>`;
    case 'square': return `<rect x="${cx - s}" y="${cy - s}" width="${2 * s}" height="${2 * s}" ${st}/>`;
    case 'tri': return `<polygon points="${f(cx)},${f(cy - s)} ${f(cx + s)},${f(cy + s * 0.8)} ${f(cx - s)},${f(cy + s * 0.8)}" ${st}/>`;
    case 'semi': return `<path d="M${cx - s} ${cy + 4} A${s} ${s} 0 0 1 ${cx + s} ${cy + 4} Z" ${st}/>`;
    case 'sector': return `<path d="M${cx - 7} ${cy + 7} L${cx + 9} ${cy + 7} A16 16 0 0 0 ${cx - 7} ${cy - 9} Z" ${st}/>`;
    case 'lens': return `<path d="M${cx - s} ${cy} A${s * 1.2} ${s * 1.2} 0 0 1 ${cx + s} ${cy} A${s * 1.2} ${s * 1.2} 0 0 1 ${cx - s} ${cy}" ${st}/>`;
    case 'penta': return `<polygon points="${Array.from({ length: 5 }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return `${f(cx + s * Math.cos(a))},${f(cy + s * Math.sin(a))}`; }).join(' ')}" ${st}/>`;
  }
}
const elsSvg = (els: El[]) => svg(els.map(shapeSvg).join(''));
type ElMetric = 'lines' | 'curves' | 'total' | 'types' | 'black' | 'diff' | 'sum';
const EL_METRIC_NAME: Record<ElMetric, string> = { lines: '直线数', curves: '曲线数', total: '元素个数', types: '元素种类数', black: '黑色元素个数', diff: '直线数 − 曲线数', sum: '线条总数（直 + 曲）' };
function elMetric(els: El[], m: ElMetric): number {
  let L = 0, C = 0, B = 0; const ty = new Set<string>();
  for (const e of els) { const [l, c] = SHAPE_LC[e.shape]; L += l; C += c; if (e.black) B++; ty.add(e.shape); }
  return m === 'lines' ? L : m === 'curves' ? C : m === 'total' ? els.length : m === 'types' ? ty.size : m === 'black' ? B : m === 'diff' ? L - C : L + C;
}
const ALL_SHAPES = Object.keys(SHAPE_LC) as ShapeName[];
/** 随机摆元素，直到这个指标正好等于 want（blackP：涂黑的概率） */
function elsWith(r: Rng, m: ElMetric, want: number, opt: { minN?: number; maxN?: number; pool?: ShapeName[]; blackP?: number; fixedN?: number } = {}): El[] | null {
  const pool = opt.pool || ALL_SHAPES;
  for (let t = 0; t < 1500; t++) {
    const n = opt.fixedN ?? ((opt.minN ?? 2) + Math.floor(r() * ((opt.maxN ?? 5) - (opt.minN ?? 2) + 1)));
    const slots = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, n);
    const els = slots.map(slot => ({ shape: pick(r, pool), black: r() < (opt.blackP ?? 0.3), slot }));
    if (elMetric(els, m) === want) return els;
  }
  return null;
}

/* —— 部分数：4×4 点阵上的线段，连在一起的算一部分 —— */
const LP = (i: number): Pt => [17 + (i % 4) * 22, 17 + Math.floor(i / 4) * 22];
const LAT_EDGES: Edge[] = (() => { const e: Edge[] = []; for (let i = 0; i < 16; i++) { const x = i % 4, y = Math.floor(i / 4); if (x < 3) e.push([i, i + 1]); if (y < 3) e.push([i, i + 4]); } return e; })();
const LAT_DIAG: [Edge, Edge][] = Array.from({ length: 9 }, (_, k) => { const i = Math.floor(k / 3) * 4 + (k % 3); return [[i, i + 5], [i + 1, i + 4]] as [Edge, Edge]; });
/** 独立数部分：并查集 */
function countParts(edges: Edge[]): number {
  const p = new Map<number, number>(); const f = (x: number): number => { while (p.get(x)! !== x) x = p.get(x)!; return x; };
  for (const [a, b] of edges) { if (!p.has(a)) p.set(a, a); if (!p.has(b)) p.set(b, b); p.set(f(a), f(b)); }
  return new Set([...p.keys()].map(f)).size;
}
function latticeWith(r: Rng, parts: number): Edge[] | null {
  for (let t = 0; t < 3000; t++) {
    const m = parts + 2 + Math.floor(r() * 6);
    const es = shuffle(r, LAT_EDGES).slice(0, m);
    for (const [d1, d2] of LAT_DIAG) if (r() < 0.15) es.push(r() < 0.5 ? d1 : d2); // 一格最多一条斜线，不会凭空交叉
    if (countParts(es) === parts) return es;
  }
  return null;
}
const latSvg = (es: Edge[]) => svg(es.map(([a, b]) => { const [x1, y1] = LP(a), [x2, y2] = LP(b); return ln(x1, y1, x2, y2, 2.6); }).join(''));

/* —— 绕圈：九宫格外圈 8 格，几个元素各走各的 —— */
const RING = [0, 1, 2, 5, 8, 7, 6, 3]; // 顺时针
type Marker = 'dot' | 'ring' | 'tri';
const MARKER_NAME: Record<Marker, string> = { dot: '黑点', ring: '白圈', tri: '黑三角' };
function orbitSvg(markers: Marker[], pos: number[]): string {
  let b = '';
  for (let i = 0; i < 9; i++) { const x = 14 + (i % 3) * 24, y = 14 + Math.floor(i / 3) * 24; b += `<rect x="${x}" y="${y}" width="24" height="24" fill="#fff" stroke="${INK}" stroke-width="1.4"/>`; }
  markers.forEach((m, k) => {
    const cell = RING[((pos[k] % 8) + 8) % 8]; const cx = 26 + (cell % 3) * 24, cy = 26 + Math.floor(cell / 3) * 24;
    b += m === 'dot' ? `<circle cx="${cx}" cy="${cy}" r="7" fill="${INK}"/>` : m === 'ring' ? `<circle cx="${cx}" cy="${cy}" r="7" fill="#fff" stroke="${INK}" stroke-width="2.2"/>` : `<polygon points="${cx},${cy - 7} ${cx + 7},${cy + 6} ${cx - 7},${cy + 6}" fill="${INK}"/>`;
  });
  return svg(b);
}
const stepWord = (s: number) => `${s > 0 ? '顺时针' : '逆时针'}走 ${Math.abs(s)} 格`;

/* —— 数列型出题：给一个「值 → 图」的函数，按规则排四张，再做三个错的 —— */
type Family = 'el' | 'poly' | 'lat';
type Mode = 'inc' | 'const';
function familyMetrics(fam: Family, o: unknown): Record<string, number> {
  if (fam === 'poly') { const f = o as PolyFig; return { faces: countFaces(f), lines: polyLines(f) }; }
  if (fam === 'lat') { const e = o as Edge[]; return { parts: countParts(e), lines: e.length }; }
  const els = o as El[]; const out: Record<string, number> = {};
  for (const m of Object.keys(EL_METRIC_NAME) as ElMetric[]) out[m] = elMetric(els, m);
  return out;
}
function seqPuzzle<T>(r: Rng, make: (v: number) => T | null, draw: (o: T) => string, vals: number[], ans: number, wrongVals: number[]) {
  const seqO = vals.map(make), right = make(ans), wrong = wrongVals.slice(0, 3).map(make);
  if (seqO.some(x => !x) || !right || wrong.length < 3 || wrong.some(x => !x)) return null;
  const rs = draw(right), ws = wrong.map(w => draw(w!));
  const pl = place(r, rs, ws);
  return { seq: seqO.map(o => draw(o!)), seqObjs: seqO as T[], ...pl, optObjs: pl.options.map(s => s === rs ? right : wrong[ws.indexOf(s)]!) as T[] };
}
const near = (r: Rng, ans: number, lo: number, hi: number) => shuffle(r, [ans - 1, ans + 1, ans - 2, ans + 2, ans + 3].filter(x => x >= lo && x <= hi && x !== ans)).slice(0, 3);

/* ───────── 出题 ───────── */
const LETTERS = ['A', 'B', 'C', 'D'] as const;
function place(r: Rng, right: string, wrong: string[]): { options: string[]; answer: FigPuzzle['answer'] } {
  const opts = shuffle(r, [right, ...wrong.slice(0, 3)]);
  return { options: opts, answer: LETTERS[opts.indexOf(right)] };
}

export function makeFigPuzzle(kind: FigKind, seed = Date.now()): FigPuzzle {
  const r = rngFrom(seed);
  if (kind === 'mixed') { const k = pick(r, MIX_POOL); return { ...makeFigPuzzle(k, Math.floor(r() * 2 ** 31)), mixed: true }; }
  for (let attempt = 0; attempt < 80; attempt++) {
    const p = tryMake(kind, r);
    if (p && checkPuzzle(p.puzzle, p.facts)) return p.puzzle;
  }
  throw new Error('这一题没生成成功，换一题');
}

interface Facts { kind: FigKind; seqVals: unknown[]; optVals: unknown[]; rightIdx: number; rule?: { fam: Family; metric: string; mode: Mode } }

function tryMake(kind: FigKind, r: Rng): { puzzle: FigPuzzle; facts: Facts } | null {
  const fin = (title: string, pointId: string, steps: string[], takeaway: string, q: NonNullable<ReturnType<typeof seqPuzzle<any>>>, rule: NonNullable<Facts['rule']>) =>
    ({ puzzle: { kind, title, seq: q.seq, options: q.options, answer: q.answer, steps, takeaway, pointId }, facts: { kind, seqVals: q.seqObjs, optVals: q.optObjs, rightIdx: LETTERS.indexOf(q.answer), rule } });
  if (kind === 'faces') {
    const mode: Mode = r() < 0.6 ? 'inc' : 'const';
    const make = (v: number) => polyFaces(r, v);
    if (mode === 'inc') {
      const s0 = 1 + Math.floor(r() * 3), vals = [0, 1, 2, 3].map(i => s0 + i), ans = s0 + 4;
      const q = seqPuzzle(r, make, polySvg, vals, ans, near(r, ans, 1, 7)); if (!q) return null;
      return fin('面数', 'pd-face2', ['都是封闭的多边形、里面被线隔成几块 → 数面（封闭区域）', `依次是 ${vals.join('、')} 个面，每次多 1 个`, '多边形是几边形、画了几条线都在变，是干扰；只数被分成几块', `下一个应是 ${ans} 个面`], '封闭区域多，先数面；边数是干扰', q, { fam: 'poly', metric: 'faces', mode });
    }
    const c = 2 + Math.floor(r() * 3);
    const q = seqPuzzle(r, make, polySvg, [c, c, c, c], c, near(r, c, 1, 7)); if (!q) return null;
    return fin('面数', 'pd-face2', ['都是封闭多边形、被线分割 → 数面', `每个图都被分成 ${c} 个面`, '边数和线条数在变，但面数不变（数量规律也有「恒定」）', `选同样是 ${c} 个面的`], '数出来一样多也是规律', q, { fam: 'poly', metric: 'faces', mode });
  }
  if (kind === 'lines') {
    const rules: { m: ElMetric; mode: Mode }[] = [{ m: 'lines', mode: 'inc' }, { m: 'curves', mode: 'inc' }, { m: 'diff', mode: 'const' }, { m: 'sum', mode: 'const' }];
    const { m, mode } = pick(r, rules);
    const make = (v: number) => elsWith(r, m, v, { minN: 2, maxN: 4, blackP: 0.25 });
    let vals: number[], ans: number;
    if (mode === 'inc') { const s0 = m === 'lines' ? 2 + Math.floor(r() * 4) : Math.floor(r() * 2); vals = [0, 1, 2, 3].map(i => s0 + i); ans = s0 + 4; }
    else { const c = m === 'diff' ? 0 : 5 + Math.floor(r() * 4); vals = [c, c, c, c]; ans = c; }
    const q = seqPuzzle(r, make, elsSvg, vals, ans, near(r, ans, m === 'diff' ? -4 : 0, 14)); if (!q) return null;
    const pid = m === 'lines' || m === 'sum' ? 'pd-line2' : 'pd-curve2';
    const steps = m === 'lines' ? ['图形由直线和曲线混着组成 → 曲直分开数', `只数直线：依次 ${vals.join('、')} 条（方块 4、三角 3、半圆 1、扇形 2）`, '曲线数是干扰', `下一个 ${ans} 条直线`]
      : m === 'curves' ? ['有圆、弧这些曲线 → 曲直分开数', `只数曲线：依次 ${vals.join('、')} 条（圆 1、半圆 1、扇形 1、叶形 2）`, '直线数是干扰', `下一个 ${ans} 条曲线`]
      : m === 'diff' ? ['直线、曲线都有，单独数都没规律 → 看两者关系', '每个图里直线数 = 曲线数', '选直线数和曲线数相等的'] : ['直线、曲线单独数都乱 → 加起来看', `每个图直线 + 曲线一共 ${ans} 条`, `选线条总数也是 ${ans} 的`];
    return fin('曲直数', pid, steps, m === 'diff' ? '单独数乱，就比一比、加一加' : m === 'sum' ? '单独数乱，就加起来' : '曲直混着，分开数', q, { fam: 'el', metric: m, mode });
  }
  if (kind === 'count') {
    const rules: { m: ElMetric; mode: Mode }[] = [{ m: 'total', mode: 'inc' }, { m: 'types', mode: 'inc' }, { m: 'types', mode: 'const' }, { m: 'black', mode: 'inc' }];
    const { m, mode } = pick(r, rules);
    const make = (v: number) => m === 'total' ? elsWith(r, m, v, { fixedN: v, blackP: 0.35 })
      : m === 'types' ? elsWith(r, m, v, { minN: Math.max(v, 3), maxN: 7, blackP: 0.3 }) : elsWith(r, m, v, { fixedN: 6, blackP: 0.5 });
    let vals: number[], ans: number;
    if (m === 'types' && mode === 'const') { vals = [3, 3, 3, 3]; ans = 3; }
    else { const s0 = m === 'total' ? 1 + Math.floor(r() * 3) : m === 'types' ? 1 : Math.floor(r() * 2); vals = [0, 1, 2, 3].map(i => s0 + i); ans = s0 + 4; }
    const q = seqPuzzle(r, make, elsSvg, vals, ans, near(r, ans, m === 'black' ? 0 : 1, m === 'black' ? 6 : 8)); if (!q) return null;
    const steps = m === 'total' ? ['图里是一个个分开的小图形 → 先数元素个数', `依次 ${vals.join('、')} 个，每次多 1 个`, '形状、黑白都在变，是干扰', `下一个 ${ans} 个元素`]
      : m === 'types' && mode === 'inc' ? ['小图形个数在变但没规律 → 改数种类（几种不同的形状）', `种类数依次 ${vals.join('、')}，每次多一种`, '同一种形状出现几次都只算一种；黑白不算新种类', `下一个 ${ans} 种`]
      : m === 'types' ? ['个数没规律 → 数种类', '每个图都只有 3 种形状', '选正好 3 种的'] : ['元素个数都一样 → 看黑白', `黑色的依次 ${vals.join('、')} 个`, `下一个 ${ans} 个黑的`];
    return fin('元素数量', 'pd-num', steps, '个数乱就数种类，再看黑白', q, { fam: 'el', metric: m, mode });
  }
  if (kind === 'parts') {
    const mode: Mode = r() < 0.55 ? 'inc' : 'const';
    const make = (v: number) => latticeWith(r, v);
    const vals = mode === 'inc' ? [1, 2, 3, 4] : (() => { const c = 2 + Math.floor(r() * 2); return [c, c, c, c]; })();
    const ans = mode === 'inc' ? 5 : vals[0];
    const q = seqPuzzle(r, make, latSvg, vals, ans, near(r, ans, 1, 6)); if (!q) return null;
    return fin('部分数', 'pd-part2', ['线条散成几块、互相不连 → 数部分（连在一起的算一部分）', mode === 'inc' ? `依次 ${vals.join('、')} 部分，每次多一块` : `每个图都是 ${ans} 部分`, '线条条数在变，是干扰；只看断成几块', `选 ${ans} 部分的`], '图形散开，先数几部分', q, { fam: 'lat', metric: 'parts', mode });
  }
  if (kind === 'orbit') {
    const mk = shuffle(r, ['dot', 'ring', 'tri'] as Marker[]).slice(0, r() < 0.55 ? 2 : 3);
    const steps = mk.map(() => pick(r, [1, 2, 3, -1, -2]));
    if (new Set(steps).size < mk.length && r() < 0.7) return null;
    const start = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7]).slice(0, mk.length);
    const at = (i: number, st = steps) => start.map((s0, k) => ((s0 + st[k] * i) % 8 + 8) % 8);
    const clash = (p: number[]) => new Set(p).size < p.length;
    for (let i = 0; i <= 4; i++) if (clash(at(i))) return null;
    const ans = at(4);
    const wrongPos: number[][] = [];
    const w1 = ans.slice(); w1[0] = (w1[0] + (steps[0] > 0 ? 1 : -1) + 8) % 8; wrongPos.push(w1);                 // 第一个多走一格
    const w2 = ans.slice(); const k2 = mk.length - 1; w2[k2] = at(3)[k2]; wrongPos.push(w2); // 最后一个忘了走
    const w3 = ans.slice(); [w3[0], w3[1]] = [w3[1], w3[0]]; wrongPos.push(w3);                                 // 两个互换
    if (wrongPos.some(clash)) return null;
    const rs = orbitSvg(mk, ans), ws = wrongPos.map(p => orbitSvg(mk, p));
    if (new Set([rs, ...ws]).size < 4) return null;
    const pl = place(r, rs, ws);
    return { puzzle: { kind, title: '多元素绕圈', seq: [0, 1, 2, 3].map(i => orbitSvg(mk, at(i))), ...pl,
      steps: ['几个元素在九宫格外圈换位置 → 平移，每个元素分开看', ...mk.map((m, k) => `${MARKER_NAME[m]}每次${stepWord(steps[k])}`), '把每个元素都往后推一步，全部对上的只有一个'], takeaway: '多个元素，一个一个单独追', pointId: 'pd-move2' },
      facts: { kind, seqVals: [0, 1, 2, 3].map(i => at(i)), optVals: pl.options.map(o => o === rs ? ans : wrongPos[ws.indexOf(o)]), rightIdx: LETTERS.indexOf(pl.answer) } };
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
    const N = r() < 0.6 ? 16 : 9; // 4×4 更像真题，格子多了不好一眼看出
    const rand = () => Array.from({ length: N }, () => r() < 0.45);
    const f = (x: boolean[], y: boolean[]) => x.map((v, i) => op === 'xor' ? v !== y[i] : op === 'and' ? v && y[i] : v || y[i]);
    const A = rand(), B = rand(), D = rand(), E = rand();
    const Cc = f(A, B), F = f(D, E);
    if (F.every(v => !v) || F.every(v => v) || Cc.every(v => !v)) return null;
    // 两行都得只符合这一种运算，免得一题两解
    const ops = ['xor', 'and', 'or'].filter(o => { const g = (x: boolean[], y: boolean[]) => x.map((v, i) => o === 'xor' ? v !== y[i] : o === 'and' ? v && y[i] : v || y[i]); return g(A, B).every((v, i) => v === Cc[i]); });
    if (ops.length !== 1) return null;
    const flip = (bits: boolean[], i: number) => bits.map((v, j) => j === i ? !v : v);
    const idx = shuffle(r, Array.from({ length: N }, (_, i) => i));
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
  if (f.rule) {
    // 意图规则：题干四张必须符合，选项里正好一个符合，而且就是答案
    const pred = (vals: number[], mode: Mode): number | null => mode === 'const' ? (vals.every(x => x === vals[0]) ? vals[0] : null) : (vals.every((x, i) => !i || x - vals[i - 1] === 1) ? vals[3] + 1 : null);
    const seqM = f.seqVals.map(o => familyMetrics(f.rule!.fam, o)), optM = f.optVals.map(o => familyMetrics(f.rule!.fam, o));
    if (seqM.some(x => Object.values(x).some(v => v < -10))) return false;
    if (f.rule.fam === 'poly' && [...seqM, ...optM].some(x => x.faces < 1)) return false;
    const want = pred(seqM.map(x => x[f.rule!.metric]), f.rule.mode);
    if (want === null) return false;
    const hits = optM.map((x, i) => x[f.rule!.metric] === want ? i : -1).filter(i => i >= 0);
    if (hits.length !== 1 || hits[0] !== ri) return false;
    // 防一题两解：别的指标要是也能从题干推出规律，并且指向另一个选项，这题不要
    for (const m of Object.keys(seqM[0])) for (const mode of ['inc', 'const'] as Mode[]) {
      const w = pred(seqM.map(x => x[m]), mode); if (w === null) continue;
      const h = optM.map((x, i) => x[m] === w ? i : -1).filter(i => i >= 0);
      if (h.length && !(h.length === 1 && h[0] === ri)) return false;
    }
    return true;
  }
  if (f.kind === 'orbit') {
    const seq = f.seqVals as number[][]; const n = seq[0].length;
    const st = Array.from({ length: n }, (_, k) => (seq[1][k] - seq[0][k] + 8) % 8);
    if (!seq.every((p, i) => !i || p.every((x, k) => (x - seq[i - 1][k] + 8) % 8 === st[k]))) return false;
    const want = seq[3].map((x, k) => (x + st[k]) % 8).join();
    const hits = (f.optVals as number[][]).map((p, i) => p.join() === want ? i : -1).filter(i => i >= 0);
    return hits.length === 1 && hits[0] === ri;
  }
  switch (f.kind) {
    case 'faces': { const s = f.seqVals as number[]; if (s.some(x => x < 1) || s.some((x, i) => i && x - s[i - 1] !== 1)) return false; const want = s[3] + 1; return v[ri] === want && v.filter(x => x === want).length === 1; }
    case 'lines': { const s = f.seqVals as number[]; return s.join() === '3,4,5,6' && v[ri] === 7 && v.filter(x => x === 7).length === 1; }
    case 'onestroke': { const s = f.seqVals as number[]; return s.every(x => x === 1) && v[ri] === 1 && v.filter(x => x === 1).length === 1; }
    case 'symmetry': { const s = f.seqVals as number[]; return s.every(x => x >= 1) && (v[ri] as number) >= 1 && v.filter(x => (x as number) >= 1).length === 1; }
    default: return v[ri] === 'R' && v.filter(x => x === 'R').length === 1;
  }
}

export const FIG_KINDS: { kind: FigKind; name: string; pointId: string }[] = [
  { kind: 'mixed', name: '混着来（像考场）', pointId: 'pd-num' },
  { kind: 'faces', name: '数面', pointId: 'pd-face2' }, { kind: 'lines', name: '曲直数', pointId: 'pd-line2' }, { kind: 'count', name: '元素数量 / 种类', pointId: 'pd-num' },
  { kind: 'parts', name: '部分数', pointId: 'pd-part2' }, { kind: 'onestroke', name: '一笔画', pointId: 'pd-stroke2' },
  { kind: 'rotate', name: '旋转', pointId: 'pd-rot2' }, { kind: 'move', name: '平移', pointId: 'pd-move2' }, { kind: 'orbit', name: '多元素绕圈', pointId: 'pd-move2' },
  { kind: 'xor', name: '黑白运算', pointId: 'pd-style' }, { kind: 'symmetry', name: '轴对称', pointId: 'pd-attr' },
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
