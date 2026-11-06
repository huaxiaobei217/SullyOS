/**
 * 书影架 · 伴读图表卡片：聊天里一张小卡，点开全屏，可以存成图片。
 * 全部用 SVG 自己画（柱状 / 折线 / 饼 / 雷达 / 人物关系 / 时间线），配色跟书影架的纸墨一致。
 */
import React, { useMemo, useRef, useState } from 'react';
import { relationLayout, type ChartSpec } from '../../utils/shelfChart';

const INK = '#2f2a24', MUTED = '#8a7f70', LINE = '#d9cfbd', PAPER = '#fffdf8';
const PALETTE = ['#7a4e3a', '#4f6b58', '#5b6b7a', '#b08a3e', '#8c5a7a', '#3f7d86', '#a3543f', '#6b6f3a'];
const FONT = '"Noto Serif SC","Songti SC",serif';

function ChartSvg({ spec, w, h }: { spec: ChartSpec; w: number; h: number }) {
  const pad = { l: 34, r: 12, t: 20, b: 34 };
  if (spec.type === 'bar' || spec.type === 'line') {
    const max = Math.max(1, ...spec.values);
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const step = iw / spec.labels.length;
    const y = (v: number) => pad.t + ih - (v / max) * ih;
    const ticks = [0, 0.5, 1].map(k => Math.round(max * k));
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ fontFamily: FONT }}>
        {ticks.map(t => <g key={t}><line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={LINE} strokeDasharray="2 3" /><text x={pad.l - 5} y={y(t) + 3} fontSize={9} textAnchor="end" fill={MUTED}>{t}</text></g>)}
        {spec.type === 'bar'
          ? spec.values.map((v, i) => <g key={i}>
              <rect x={pad.l + i * step + step * 0.18} y={y(v)} width={step * 0.64} height={Math.max(0, pad.t + ih - y(v))} rx={2} fill={PALETTE[0]} opacity={0.85} />
              <text x={pad.l + i * step + step / 2} y={y(v) - 3} fontSize={9} textAnchor="middle" fill={INK}>{v}</text>
            </g>)
          : <>
              <polyline fill="none" stroke={PALETTE[1]} strokeWidth={2} points={spec.values.map((v, i) => `${pad.l + i * step + step / 2},${y(v)}`).join(' ')} />
              {spec.values.map((v, i) => <circle key={i} cx={pad.l + i * step + step / 2} cy={y(v)} r={3} fill={PALETTE[1]} />)}
            </>}
        {spec.labels.map((l, i) => <text key={i} x={pad.l + i * step + step / 2} y={h - pad.b + 14} fontSize={spec.labels.length > 8 ? 8 : 10} textAnchor="middle" fill={INK}>{l.length > 5 ? l.slice(0, 5) + '…' : l}</text>)}
        {spec.unit && <text x={w - pad.r} y={10} fontSize={9} textAnchor="end" fill={MUTED}>单位：{spec.unit}</text>}
      </svg>
    );
  }
  if (spec.type === 'pie') {
    const total = spec.values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = w * 0.36, cy = h / 2, r = Math.min(w * 0.3, h * 0.42);
    let a0 = -Math.PI / 2;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ fontFamily: FONT }}>
        {spec.values.map((v, i) => {
          const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
          a0 = a1;
          return <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} opacity={0.88} stroke={PAPER} strokeWidth={1.5} />;
        })}
        {spec.labels.map((l, i) => (
          <g key={i} transform={`translate(${w * 0.7},${cy - spec.labels.length * 8 + i * 16})`}>
            <rect width={8} height={8} y={-7} fill={PALETTE[i % PALETTE.length]} />
            <text x={12} fontSize={10} fill={INK}>{l} {Math.round((Math.max(0, spec.values[i]) / total) * 100)}%</text>
          </g>
        ))}
      </svg>
    );
  }
  if (spec.type === 'radar') {
    const cx = w / 2, cy = h / 2 + 4, r = Math.min(w, h) * 0.34, n = spec.axes.length, max = spec.max || 10;
    const pt = (i: number, v: number) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [cx + Math.cos(a) * r * (v / max), cy + Math.sin(a) * r * (v / max)]; };
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ fontFamily: FONT }}>
        {[0.33, 0.66, 1].map(k => <polygon key={k} points={spec.axes.map((_, i) => pt(i, max * k).join(',')).join(' ')} fill="none" stroke={LINE} />)}
        {spec.axes.map((a, i) => { const [x, y] = pt(i, max * 1.18); return <g key={i}><line x1={cx} y1={cy} x2={pt(i, max)[0]} y2={pt(i, max)[1]} stroke={LINE} /><text x={x} y={y + 3} fontSize={10} textAnchor="middle" fill={INK}>{a}</text></g>; })}
        {spec.series.map((s, k) => <polygon key={k} points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')} fill={PALETTE[k]} fillOpacity={0.18} stroke={PALETTE[k]} strokeWidth={1.8} />)}
        {spec.series.map((s, k) => <g key={k} transform={`translate(${10 + k * 70},${h - 8})`}><rect width={8} height={8} y={-7} fill={PALETTE[k]} /><text x={11} fontSize={9.5} fill={INK}>{s.name}</text></g>)}
      </svg>
    );
  }
  if (spec.type === 'relation') {
    const pos = relationLayout(spec.nodes, spec.edges, w, h);
    const groups = [...new Set(spec.nodes.map(n => n.group || ''))];
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ fontFamily: FONT }}>
        {spec.edges.map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          return <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={MUTED} strokeOpacity={0.6} strokeWidth={1.2} />
            {e.label && <><rect x={mx - e.label.length * 5 - 3} y={my - 7} width={e.label.length * 10 + 6} height={13} rx={3} fill={PAPER} opacity={0.92} /><text x={mx} y={my + 3} fontSize={9.5} textAnchor="middle" fill={PALETTE[0]}>{e.label}</text></>}
          </g>;
        })}
        {spec.nodes.map(n => {
          const p = pos.get(n.id)!; const c = PALETTE[(groups.indexOf(n.group || '') + 1) % PALETTE.length];
          return <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={17} fill={PAPER} stroke={c} strokeWidth={1.6} />
            <text x={p.x} y={p.y + 3.5} fontSize={n.label.length > 3 ? 8.5 : 10.5} textAnchor="middle" fill={INK} fontWeight={600}>{n.label}</text>
          </g>;
        })}
      </svg>
    );
  }
  // timeline
  const ev = spec.events;
  const rowH = 30, top = 10;
  const H = Math.max(h, top + ev.length * rowH + 8);
  return (
    <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H === h ? '100%' : undefined} style={{ fontFamily: FONT }}>
      <line x1={70} x2={70} y1={top} y2={top + (ev.length - 1) * rowH + 6} stroke={LINE} strokeWidth={2} />
      {ev.map((e, i) => (
        <g key={i} transform={`translate(0,${top + i * rowH})`}>
          <text x={62} y={8} fontSize={9.5} textAnchor="end" fill={MUTED}>{e.when}</text>
          <circle cx={70} cy={5} r={4} fill={PALETTE[0]} />
          <foreignObject x={80} y={-4} width={w - 86} height={rowH}>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: INK, fontFamily: FONT, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{e.text}</div>
          </foreignObject>
        </g>
      ))}
    </svg>
  );
}

/** 存成 PNG：SVG 画到 canvas 再下载 */
async function savePng(svg: SVGSVGElement, title: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal; const W = vb.width * 3, H = vb.height * 3;
  clone.setAttribute('width', String(W)); clone.setAttribute('height', String(H));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H + 90;
  const g = cv.getContext('2d')!;
  g.fillStyle = PAPER; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = INK; g.font = `bold 42px ${FONT}`; g.fillText(title, 36, 62);
  g.drawImage(img, 0, 90, W, H);
  const a = document.createElement('a'); a.download = `${title}.png`; a.href = cv.toDataURL('image/png'); a.click();
}

const ChartCard: React.FC<{ spec: ChartSpec }> = ({ spec }) => {
  const [big, setBig] = useState(false);
  const bigRef = useRef<HTMLDivElement>(null);
  const size = useMemo(() => {
    if (spec.type === 'relation') return { w: 320, h: 260 };
    if (spec.type === 'timeline') return { w: 320, h: Math.max(140, spec.events.length * 30 + 20) };
    if (spec.type === 'radar') return { w: 300, h: 240 };
    return { w: 320, h: 190 };
  }, [spec]);
  const icon = { bar: '▥', line: '⟋', pie: '◔', radar: '✳', relation: '☍', timeline: '┊' }[spec.type];
  return (
    <>
      <button onClick={() => setBig(true)} className="mt-1.5 block w-full text-left rounded-xl overflow-hidden" style={{ background: PAPER, border: `1px solid ${LINE}` }}>
        <div className="px-3 pt-2 text-[11.5px] font-semibold flex items-center gap-1.5" style={{ color: INK, fontFamily: FONT }}><span style={{ color: PALETTE[0] }}>{icon}</span>{spec.title}</div>
        <div style={{ height: Math.min(size.h, 200), overflow: 'hidden' }}><ChartSvg spec={spec} w={size.w} h={size.h} /></div>
        {spec.note && <div className="px-3 pb-2 text-[10.5px]" style={{ color: MUTED }}>{spec.note}</div>}
      </button>
      {big && (
        <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'rgba(250,246,238,0.98)' }} onClick={() => setBig(false)}>
          <div className="flex items-center justify-between px-4 pb-2" style={{ paddingTop: 'calc(var(--chrome-top, 0px) + 0.8rem)' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setBig(false)} className="text-sm" style={{ color: MUTED }}>‹ 返回</button>
            <div className="text-[14px] font-semibold" style={{ color: INK, fontFamily: FONT }}>{spec.title}</div>
            <button onClick={() => { const svg = bigRef.current?.querySelector('svg'); if (svg) void savePng(svg as SVGSVGElement, spec.title); }} className="text-[12px] px-2.5 py-1 rounded-full" style={{ background: '#ece4d3', color: PALETTE[0] }}>存图</button>
          </div>
          <div ref={bigRef} className="flex-1 overflow-auto px-3" onClick={e => e.stopPropagation()}>
            <div style={{ width: '100%', maxWidth: 520, margin: '0 auto', aspectRatio: spec.type === 'timeline' ? undefined : `${size.w}/${size.h}` }}><ChartSvg spec={spec} w={size.w} h={size.h} /></div>
            {spec.note && <div className="text-[12px] text-center mt-3 px-4" style={{ color: MUTED, fontFamily: FONT }}>{spec.note}</div>}
          </div>
        </div>
      )}
    </>
  );
};

export default ChartCard;
