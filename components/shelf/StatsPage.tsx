/** 书影架 · 阅读统计：热力图（近半年）、封面月历、一天里什么时候读、每本书读了多久 */
import React, { useMemo, useState } from 'react';
import { loadStats, fmtMinutes, dayKeyOf, readingStreak, type ShelfBook } from '../../utils/shelf';

const T = { paper: '#f6f1e7', deep: '#ece4d3', ink: '#2f2a24', muted: '#8a7f70', faint: '#b9ae9c', line: '#d9cfbd', accent: '#7a4e3a' };
const DAY = 86400000;
const shade = (sec: number) => sec <= 0 ? T.deep : sec < 600 ? '#e3c9b5' : sec < 1800 ? '#c99a7c' : sec < 3600 ? '#a8705a' : '#7a4e3a';

const StatsPage: React.FC<{ books: ShelfBook[]; onClose: () => void }> = ({ books, onClose }) => {
  const st = useMemo(() => loadStats(), []);
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [pick, setPick] = useState<string | null>(null);
  const bookById = useMemo(() => new Map(books.map(b => [b.id, b])), [books]);
  const total = Object.values(st.days).reduce((a, x) => a + x, 0);

  // 热力图：最近 26 周，一列一周
  const weeks = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = today.getTime() + (6 - ((today.getDay() + 6) % 7)) * DAY; // 本周日
    const cols: { k: string; sec: number; future: boolean }[][] = [];
    for (let w = 25; w >= 0; w--) {
      const col = [];
      for (let d = 6; d >= 0; d--) { const t = end - (w * 7 + d) * DAY; col.push({ k: dayKeyOf(t), sec: st.days[dayKeyOf(t)] || 0, future: t > today.getTime() }); }
      cols.push(col);
    }
    return cols;
  }, [st]);

  // 月历
  const cal = useMemo(() => {
    const first = new Date(month.y, month.m, 1);
    const lead = (first.getDay() + 6) % 7;
    const n = new Date(month.y, month.m + 1, 0).getDate();
    const cells: ({ d: number; k: string; sec: number; top?: ShelfBook; count: number } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= n; d++) {
      const k = dayKeyOf(new Date(month.y, month.m, d).getTime());
      const per = st.dayBooks?.[k] || {};
      const ids = Object.keys(per).sort((a, b) => per[b] - per[a]);
      cells.push({ d, k, sec: st.days[k] || 0, top: ids[0] ? bookById.get(ids[0]) : undefined, count: ids.length });
    }
    return cells;
  }, [month, st, bookById]);
  const monthSec = cal.reduce((a, c) => a + (c?.sec || 0), 0);

  const hours = st.hours || Array(24).fill(0);
  const hMax = Math.max(1, ...hours);
  const hasHours = hours.some(x => x > 0);
  const peak = hours.indexOf(Math.max(...hours));
  const rank = Object.entries(st.books).filter(([id]) => bookById.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const rMax = Math.max(1, ...rank.map(r => r[1]));

  const card = (title: string, children: React.ReactNode, extra?: React.ReactNode) => (
    <div className="rounded-2xl p-3.5 mb-3" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }}>
      <div className="flex items-center justify-between mb-2.5"><div className="text-[12px] font-serif" style={{ color: T.ink }}>{title}</div>{extra}</div>
      {children}
    </div>
  );

  return (
    <div className="absolute inset-0 z-40 flex flex-col" style={{ background: T.paper, color: T.ink }}>
      <div className="shrink-0 px-5 pb-3 flex items-center justify-between" style={{ paddingTop: 'calc(var(--chrome-top) + 0.5rem)' }}>
        <button onClick={onClose} className="text-sm" style={{ color: T.muted }}>‹ 书架</button>
        <div className="font-serif">阅读统计</div><span className="w-10" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <div className="flex text-center mb-3">
          {[['一共', fmtMinutes(total)], ['读完', `${Object.keys(st.finished).length} 本`], ['连续', `${readingStreak()} 天`], ['读过的天', `${Object.values(st.days).filter(x => x > 0).length} 天`]].map(([k, v]) => (
            <div key={k} className="flex-1"><div className="text-[14px] font-serif">{v}</div><div className="text-[10px]" style={{ color: T.faint }}>{k}</div></div>
          ))}
        </div>

        {card('近半年', (
          <>
            <div className="flex gap-[3px] justify-between">
              {weeks.map((col, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                  {col.map(c => <div key={c.k} title={`${c.k} ${fmtMinutes(c.sec)}`} className="rounded-[2px]" style={{ width: 9, height: 9, background: c.future ? 'transparent' : shade(c.sec) }} />)}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-1 mt-2 text-[9px]" style={{ color: T.faint }}>少{[0, 300, 1200, 2400, 4000].map(s => <div key={s} className="rounded-[2px]" style={{ width: 9, height: 9, background: shade(s) }} />)}多</div>
          </>
        ))}

        {card(`${month.y} 年 ${month.m + 1} 月 · ${fmtMinutes(monthSec)}`, (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[9px] mb-1" style={{ color: T.faint }}>{'一二三四五六日'.split('').map(x => <div key={x}>{x}</div>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {cal.map((c, i) => c ? (
                <button key={i} onClick={() => setPick(pick === c.k ? null : c.k)} className="relative aspect-[3/4] rounded-md overflow-hidden text-[9.5px] flex items-start justify-start p-1"
                  style={{ background: c.top ? c.top.cover : (c.sec ? shade(c.sec) : T.deep), color: c.top ? '#fff' : T.muted, outline: pick === c.k ? `2px solid ${T.accent}` : undefined }}>
                  <span className="font-semibold" style={{ textShadow: c.top ? '0 1px 2px rgba(0,0,0,.4)' : undefined }}>{c.d}</span>
                  {c.count > 1 && <span className="absolute right-0.5 bottom-0.5 text-[8px] px-1 rounded bg-black/35 text-white">{c.count}</span>}
                </button>
              ) : <div key={i} />)}
            </div>
            {pick && (() => {
              const per = st.dayBooks?.[pick] || {};
              const ids = Object.keys(per).sort((a, b) => per[b] - per[a]);
              return (
                <div className="mt-2.5 pt-2 border-t text-[11.5px] space-y-1" style={{ borderColor: T.line }}>
                  <div style={{ color: T.muted }}>{pick} · {fmtMinutes(st.days[pick] || 0)}</div>
                  {ids.length ? ids.map(id => <div key={id} className="flex justify-between"><span className="truncate">《{bookById.get(id)?.title || '已下架的书'}》</span><span style={{ color: T.muted }}>{fmtMinutes(per[id])}</span></div>)
                    : <div style={{ color: T.faint }}>{st.days[pick] ? '这天之前的记录没分书' : '这天没读'}</div>}
                </div>
              );
            })()}
          </>
        ), (
          <div className="flex gap-3 text-[13px]" style={{ color: T.muted }}>
            <button onClick={() => setMonth(m => m.m ? { y: m.y, m: m.m - 1 } : { y: m.y - 1, m: 11 })}>‹</button>
            <button onClick={() => setMonth(m => m.m < 11 ? { y: m.y, m: m.m + 1 } : { y: m.y + 1, m: 0 })}>›</button>
          </div>
        ))}

        {hasHours && card(`什么时候读 · 最常在 ${peak} 点`, (
          <div className="flex items-end gap-[2px] h-16">
            {hours.map((s, h) => (
              <div key={h} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full rounded-sm" style={{ height: `${Math.max(2, (s / hMax) * 52)}px`, background: h >= 22 || h < 6 ? '#5b6b7a' : T.accent, opacity: s ? 0.85 : 0.15 }} />
                {h % 6 === 0 && <div className="text-[8px]" style={{ color: T.faint }}>{h}</div>}
              </div>
            ))}
          </div>
        ))}

        {rank.length > 0 && card('每本书读了多久', (
          <div className="space-y-1.5">
            {rank.map(([id, sec]) => (
              <div key={id} className="flex items-center gap-2 text-[11.5px]">
                <div className="w-4 h-5 rounded-sm shrink-0" style={{ background: bookById.get(id)!.cover }} />
                <span className="w-24 truncate">{bookById.get(id)!.title}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: T.deep }}><div className="h-full" style={{ width: `${(sec / rMax) * 100}%`, background: T.accent }} /></div>
                <span className="w-16 text-right" style={{ color: T.muted }}>{fmtMinutes(sec)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatsPage;
