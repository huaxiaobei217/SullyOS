/** 书影架 · 目录旁的「人物」页签：按已读章节整理的人物卡，可搜索、跳到首次出场 */
import React, { useEffect, useRef, useState } from 'react';
import type { APIConfig } from '../../types';
import type { ShelfBook } from '../../utils/shelf';
import { loadPeople, scanReadChapters, clearPeople, PEOPLE_EVENT, type PersonCard } from '../../utils/shelfPeople';

const T = { paper: '#f6f1e7', deep: '#ece4d3', ink: '#2f2a24', muted: '#8a7f70', faint: '#b9ae9c', line: '#d9cfbd', accent: '#7a4e3a' };

const PeoplePanel: React.FC<{ book: ShelfBook; api: APIConfig; readCh: number; chapterTitles: string[]; onJump: (ch: number) => void; toast?: (m: string, t?: string) => void }> = ({ book, api, readCh, chapterTitles, onJump, toast }) => {
  const [data, setData] = useState(() => loadPeople(book.id));
  useEffect(() => { const h = () => setData(loadPeople(book.id)); window.addEventListener(PEOPLE_EVENT, h); return () => window.removeEventListener(PEOPLE_EVENT, h); }, [book.id]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const stop = useRef(false);
  const todo = Array.from({ length: readCh + 1 }, (_, i) => i).filter(i => !data.scanned.includes(i)).length;

  const run = async () => {
    stop.current = false; setProg({ done: 0, total: todo });
    try { const n = await scanReadChapters(api, book, readCh, (done, total) => setProg({ done, total }), () => stop.current); if (n) toast?.(`整理了 ${n} 章`, 'success'); }
    catch (e: any) { toast?.(`人物没整理完：${e?.message || e}（下次接着来）`, 'error'); }
    setProg(null);
  };

  const list = data.cards
    .filter(c => !q.trim() || [c.name, ...c.aliases, c.role].some(x => x.includes(q.trim())))
    .sort((a, b) => a.firstCh - b.firstCh);

  return (
    <div className="font-sans">
      <div className="text-[10.5px] leading-relaxed mb-2" style={{ color: T.muted }}>
        只整理你读过的 {readCh + 1} 章，不剧透。已整理 {data.scanned.filter(i => i <= readCh).length} 章{todo ? `，还有 ${todo} 章没整理` : ''}。
      </div>
      {prog ? (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.deep }}><div className="h-full" style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%`, background: T.accent }} /></div>
          <span className="text-[10.5px]" style={{ color: T.muted }}>{prog.done}/{prog.total}</span>
          <button onClick={() => { stop.current = true; }} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: T.deep, color: T.muted }}>停</button>
        </div>
      ) : (
        <div className="flex gap-2 mb-3">
          <button onClick={run} disabled={!todo} className="flex-1 text-[12px] py-1.5 rounded-full disabled:opacity-40" style={{ background: T.accent, color: '#fff' }}>{todo ? (data.cards.length ? `接着整理（${todo} 章）` : `整理人物（${todo} 章）`) : '读到的都整理过了'}</button>
          {data.cards.length > 0 && <button onClick={() => { if (confirm('清空这本书的人物卡，从头整理？')) clearPeople(book.id); }} className="text-[11px] px-2.5 rounded-full" style={{ background: T.deep, color: T.faint }}>重来</button>}
        </div>
      )}
      {data.cards.length > 4 && <input value={q} onChange={e => setQ(e.target.value)} placeholder="找人…" className="w-full mb-2.5 px-3 py-1.5 rounded-xl text-[12px] outline-none" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }} />}
      <div className="space-y-2">
        {list.map((c: PersonCard) => {
          const isOpen = open === c.name;
          return (
            <div key={c.name} className="rounded-xl px-3 py-2" style={{ background: '#fffdf8', border: `1px solid ${T.line}` }}>
              <button onClick={() => setOpen(isOpen ? null : c.name)} className="w-full text-left">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-[14px] font-semibold" style={{ color: T.ink }}>{c.name}</span>
                  {c.aliases.length > 0 && <span className="text-[10px] truncate" style={{ color: T.faint }}>{c.aliases.join(' · ')}</span>}
                </div>
                <div className="text-[11.5px] mt-0.5" style={{ color: T.muted }}>{c.role}</div>
              </button>
              {isOpen && (
                <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: T.line }}>
                  <div className="text-[12px] leading-relaxed" style={{ color: T.ink }}>{c.desc}</div>
                  {c.quote && <div className="text-[11.5px] mt-1.5 font-serif italic" style={{ color: T.muted }}>「{c.quote}」</div>}
                  <button onClick={() => onJump(c.firstCh)} className="mt-1.5 text-[11px]" style={{ color: T.accent }}>首次出场：{chapterTitles[c.firstCh] || `第 ${c.firstCh + 1} 章`} ›</button>
                </div>
              )}
            </div>
          );
        })}
        {!data.cards.length && !prog && <div className="text-[11.5px] text-center py-6" style={{ color: T.faint }}>还没整理过。点上面的按钮，一章一章来，随时可以停。</div>}
      </div>
    </div>
  );
};

export default PeoplePanel;
