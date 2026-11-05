/**
 * 书影架 · 仿真翻页（个人二改）
 * 一页纸从角上卷起来：折线 = 角点 C 和手指 F 连线的中垂线。
 * 折线靠 C 那一侧被翻走（露出下一页），翻走的那块沿折线镜像过来就是纸背（flap）。
 * 全部用 clip-path 多边形 + 两条渐变阴影条完成，不依赖 canvas。
 */
import React, { useLayoutEffect, useRef, useState } from 'react';

export interface Pt { x: number; y: number }
export interface CurlGeom { kept: Pt[]; removed: Pt[]; flap: Pt[]; M: Pt; ux: number; uy: number }

/** 半平面裁剪（Sutherland–Hodgman）：保留 sign*(side) >= 0 的部分 */
function clipHalf(poly: Pt[], side: (p: Pt) => number, sign: 1 | -1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = sign * side(a), db = sign * side(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function curlGeom(W: number, H: number, C: Pt, F: Pt): CurlGeom | null {
  const nx = C.x - F.x, ny = C.y - F.y;
  const len = Math.hypot(nx, ny);
  if (len < 0.5) return null;
  const ux = nx / len, uy = ny / len;
  const M = { x: (C.x + F.x) / 2, y: (C.y + F.y) / 2 };
  const side = (p: Pt) => (p.x - M.x) * ux + (p.y - M.y) * uy; // >0：C 那侧（被翻走）
  const rect: Pt[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const kept = clipHalf(rect, side, -1);
  const removed = clipHalf(rect, side, 1);
  const flap = removed.map(p => { const d = side(p); return { x: p.x - 2 * d * ux, y: p.y - 2 * d * uy }; });
  return { kept, removed, flap, M, ux, uy };
}

export const poly = (pts: Pt[]) => pts.length >= 3 ? `polygon(${pts.map(p => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})` : 'polygon(0 0,0 0,0 0)';

/** 贴着折线的一条渐变阴影；toward=1 往被翻走那侧，-1 往留下那侧 */
export const FoldStrip: React.FC<{ g: CurlGeom; W: number; H: number; toward: 1 | -1; width: number; from: string; to?: string }> = ({ g, W, H, toward, width, from, to = 'rgba(0,0,0,0)' }) => {
  const L = Math.hypot(W, H) * 2;
  // 折线方向 d = (-uy, ux)；div 旋转 α 后「向下」指向 (-ux,-uy)，即留下那侧
  let deg = Math.atan2(g.ux, -g.uy) * 180 / Math.PI;
  if (toward === 1) deg += 180;
  return (
    <div style={{
      position: 'absolute', left: g.M.x - L / 2, top: g.M.y, width: L, height: width,
      transformOrigin: '50% 0', transform: `rotate(${deg}deg)`,
      background: `linear-gradient(to bottom, ${from}, ${to})`, pointerEvents: 'none',
    }} />
  );
};

/**
 * 一张静态的「纸」：整页大小，纸色背景 + 页眉页脚 + 分栏排好的正文，停在第 page 页（'last' = 最后一页）。
 * 和正在读的那页用同一套 children / 尺寸，所以排版一模一样。
 */
export const PageSheet: React.FC<{
  w: number; h: number; gap: number; page: number | 'last'; paper: string; faint: string;
  contentStyle: React.CSSProperties; header: string; fontClass: string; children: React.ReactNode;
}> = ({ w, h, gap, page, paper, faint, contentStyle, header, fontClass, children }) => {
  const colRef = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(1);
  useLayoutEffect(() => {
    if (colRef.current && w) setN(Math.max(1, Math.round((colRef.current.scrollWidth + gap) / (w + gap))));
  }, [w, h, gap, children]);
  const p = page === 'last' ? n - 1 : Math.min(page, n - 1);
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: paper }}>
      <div className="absolute left-0 right-0 px-[26px] text-[10.5px] font-sans truncate" style={{ top: 'calc(var(--chrome-top) + 0.35rem)', color: faint }}>{header}</div>
      <div style={contentStyle} className="overflow-hidden">
        <div ref={colRef} className={fontClass} style={{ height: h, columnWidth: w ? `${w}px` : undefined, columnGap: `${gap}px`, columnFill: 'auto', transform: `translate3d(${-p * (w + gap)}px,0,0)` }}>
          {children}
        </div>
      </div>
      <div className="absolute left-0 right-0 px-[26px] flex justify-end text-[10px] font-sans" style={{ bottom: 'calc(var(--safe-bottom, 0px) + 0.7rem)', color: faint }}>{p + 1} / {n}</div>
    </div>
  );
};
