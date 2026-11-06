/**
 * 书影架 · 伴读图表（个人二改，思路参考 MoRead 的伴读图表）
 * 规格就是一段 JSON：柱状 / 折线 / 饼图 / 雷达 / 人物关系 / 时间线。
 * 模型只给数据，这里校验、截断、算布局；出场次数这种能数出来的直接本地数，不花调用。
 */

export type ChartSpec =
  | { type: 'bar' | 'line' | 'pie'; title: string; labels: string[]; values: number[]; unit?: string; note?: string }
  | { type: 'radar'; title: string; axes: string[]; series: { name: string; values: number[] }[]; max?: number; note?: string }
  | { type: 'relation'; title: string; nodes: { id: string; label: string; group?: string }[]; edges: { from: string; to: string; label?: string }[]; note?: string }
  | { type: 'timeline'; title: string; events: { when: string; text: string }[]; note?: string };

const str = (v: unknown, max = 40) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 校验 + 截断；不合格返回 null */
export function normalizeChart(raw: any): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title, 30) || '图';
  const note = raw.note ? str(raw.note, 80) : undefined;
  const t = String(raw.type || '').toLowerCase();
  if (t === 'bar' || t === 'line' || t === 'pie') {
    const labels = Array.isArray(raw.labels) ? raw.labels.slice(0, 16).map((x: unknown) => str(x, 12)) : [];
    const values = Array.isArray(raw.values) ? raw.values.slice(0, labels.length).map(num) : [];
    if (labels.length < 2 || values.length !== labels.length) return null;
    if (t === 'pie' && values.every((v: number) => v <= 0)) return null;
    return { type: t, title, labels, values, unit: raw.unit ? str(raw.unit, 6) : undefined, note };
  }
  if (t === 'radar') {
    const axes = Array.isArray(raw.axes) ? raw.axes.slice(0, 8).map((x: unknown) => str(x, 8)) : [];
    const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, 3).map((s: any) => ({ name: str(s?.name, 10), values: (Array.isArray(s?.values) ? s.values : []).slice(0, axes.length).map(num) }))
      .filter((s: any) => s.values.length === axes.length);
    if (axes.length < 3 || !series.length) return null;
    const max = Math.max(num(raw.max) || 0, ...series.flatMap((s: any) => s.values), 1);
    return { type: 'radar', title, axes, series, max, note };
  }
  if (t === 'relation') {
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 14).map((n: any) => ({ id: str(n?.id ?? n?.label, 20), label: str(n?.label ?? n?.id, 8), group: n?.group ? str(n.group, 10) : undefined })).filter((n: any) => n.id);
    const ids = new Set(nodes.map((n: any) => n.id));
    const edges = (Array.isArray(raw.edges) ? raw.edges : []).slice(0, 30).map((e: any) => ({ from: str(e?.from, 20), to: str(e?.to, 20), label: e?.label ? str(e.label, 8) : undefined }))
      .filter((e: any) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    if (nodes.length < 2 || !edges.length) return null;
    return { type: 'relation', title, nodes, edges, note };
  }
  if (t === 'timeline') {
    const events = (Array.isArray(raw.events) ? raw.events : []).slice(0, 14).map((e: any) => ({ when: str(e?.when, 14), text: str(e?.text, 60) })).filter((e: any) => e.text);
    if (events.length < 2) return null;
    return { type: 'timeline', title, events, note };
  }
  return null;
}

/** 从模型回复里抠出 [CHART] 后面的 JSON */
export function extractChart(text: string): { text: string; chart: ChartSpec | null } {
  const at = text.search(/\[CHART\]/i);
  if (at < 0) return { text, chart: null };
  const rest = text.slice(at).replace(/^\[CHART\]\s*/i, '').replace(/```(?:json)?/gi, '');
  const m = rest.match(/\{[\s\S]*\}/);
  let chart: ChartSpec | null = null;
  if (m) { try { chart = normalizeChart(JSON.parse(m[0])); } catch { /* ignore */ } }
  return { text: text.slice(0, at).trim(), chart };
}

/** 给模型看的格式说明 */
export const CHART_FORMAT = `图表格式（只写数据，界面会画；数据只能来自已读部分）：
- 人物关系：{"type":"relation","title":"…","nodes":[{"id":"甲","label":"甲"}],"edges":[{"from":"甲","to":"乙","label":"师徒"}]}（≤12 人，边上写 2～4 字的关系）
- 时间线：{"type":"timeline","title":"…","events":[{"when":"第3章","text":"一句话"}]}（≤12 条，按顺序）
- 柱状 / 折线 / 饼图：{"type":"bar"|"line"|"pie","title":"…","labels":["…"],"values":[数字],"unit":"次"}
- 雷达（人物对比，0～10 分）：{"type":"radar","title":"…","axes":["勇气","心机","…"],"series":[{"name":"甲","values":[…]}]}`;

/* ───── 人物关系图布局：确定性的小力导（同样的数据每次画出来一样） ───── */
export function relationLayout(nodes: { id: string }[], edges: { from: string; to: string }[], W: number, H: number): Map<string, { x: number; y: number }> {
  const deg = new Map<string, number>();
  for (const e of edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
  const order = nodes.slice().sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0) || a.id.localeCompare(b.id));
  const pos = new Map<string, { x: number; y: number }>();
  const cx = W / 2, cy = H / 2;
  order.forEach((n, i) => {
    if (i === 0) { pos.set(n.id, { x: cx, y: cy }); return; }
    const ring = i <= 6 ? 1 : 2;
    const k = ring === 1 ? i - 1 : i - 7;
    const count = ring === 1 ? Math.min(6, order.length - 1) : order.length - 7;
    const a = (k / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (ring === 2 ? Math.PI / count : 0);
    const r = (ring === 1 ? 0.36 : 0.46) * Math.min(W, H);
    pos.set(n.id, { x: cx + Math.cos(a) * r * 1.3, y: cy + Math.sin(a) * r });
  });
  // 少量迭代：有边的拉近一点，太近的推开
  for (let it = 0; it < 60; it++) {
    const f = new Map<string, { x: number; y: number }>(); for (const n of nodes) f.set(n.id, { x: 0, y: 0 });
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = pos.get(nodes[i].id)!, b = pos.get(nodes[j].id)!;
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.max(1, Math.hypot(dx, dy));
      if (d < 82) { const k = (82 - d) / d * 0.5; f.get(nodes[i].id)!.x += dx * k; f.get(nodes[i].id)!.y += dy * k; f.get(nodes[j].id)!.x -= dx * k; f.get(nodes[j].id)!.y -= dy * k; }
    }
    for (const e of edges) {
      const a = pos.get(e.from)!, b = pos.get(e.to)!; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 120) { const k = (d - 120) / d * 0.05; f.get(e.from)!.x += dx * k; f.get(e.from)!.y += dy * k; f.get(e.to)!.x -= dx * k; f.get(e.to)!.y -= dy * k; }
    }
    for (const n of nodes) { if (n.id === order[0].id) continue; const p = pos.get(n.id)!, v = f.get(n.id)!; p.x = Math.max(36, Math.min(W - 36, p.x + v.x)); p.y = Math.max(24, Math.min(H - 24, p.y + v.y)); }
  }
  return pos;
}
