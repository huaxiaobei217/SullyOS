/** 查手机 · 他的浏览器：浏览记录 / 收藏夹 / 兴趣（个人二改） */
import React, { useEffect, useState } from 'react';
import type { APIConfig, CharacterProfile } from '../../types';
import { getWeb, getWebCfg, setWebCfg, browseOnce, addHerFav, removeFav, CHAR_WEB_EVENT } from '../../utils/charWeb';

const when = (t: number) => {
  const d = new Date(t); const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

const CharWebBrowser: React.FC<{ char: CharacterProfile; api: APIConfig; userName: string; onBack: () => void; toast?: (m: string, t?: string) => void }> = ({ char, api, userName, onBack, toast }) => {
  const [st, setSt] = useState(() => getWeb(char.id));
  const [cfg, setCfg] = useState(() => getWebCfg(char.id));
  const [tab, setTab] = useState<'history' | 'fav' | 'me'>('history');
  const [busy, setBusy] = useState(false);
  const [give, setGive] = useState({ title: '', url: '', note: '' });
  useEffect(() => { const h = () => setSt(getWeb(char.id)); window.addEventListener(CHAR_WEB_EVENT, h); return () => window.removeEventListener(CHAR_WEB_EVENT, h); }, [char.id]);
  const name = char.name.split(/[·・\s]/)[0];
  const interests = Object.entries(st.interests).sort((a, b) => b[1] - a[1]).slice(0, 16);
  const maxI = Math.max(1, ...interests.map(i => i[1]));
  const upd = (p: Partial<typeof cfg>) => { setWebCfg(char.id, p); setCfg(getWebCfg(char.id)); };
  const goNow = async () => {
    setBusy(true);
    try { await browseOnce(char, api, userName); toast?.(`${name}逛完了`, 'success'); setTab('history'); }
    catch (e: any) { toast?.(`没逛成：${e?.message || e}`, 'error'); }
    setBusy(false);
  };
  const open = (url?: string) => { if (url) window.open(url, '_blank', 'noopener'); };

  return (
    <div className="absolute inset-0 flex flex-col text-white" style={{ background: '#0b0d10' }}>
      <div className="shrink-0 px-4 pb-2 flex items-center gap-3" style={{ paddingTop: 'calc(var(--chrome-top, 0px) + 0.6rem)' }}>
        <button onClick={onBack} className="text-white/60 text-lg">‹</button>
        <div className="flex-1">
          <div className="text-[15px] font-semibold">浏览器</div>
          <div className="text-[10px] text-white/40">{name}自己逛的 · 他删掉的看不到</div>
        </div>
        <button onClick={goNow} disabled={busy} className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 text-white/80 disabled:opacity-40">{busy ? '在逛…' : '让他逛一会儿'}</button>
      </div>
      <div className="flex gap-1 mx-4 mb-2 p-1 rounded-full bg-white/[0.06] text-[12px]">
        {([['history', '浏览记录'], ['fav', `收藏 ${st.favs.length}`], ['me', '兴趣 / 设置']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="flex-1 py-1.5 rounded-full" style={{ background: tab === k ? 'rgba(255,255,255,0.14)' : 'transparent', color: tab === k ? '#fff' : 'rgba(255,255,255,0.5)' }}>{l}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-10 space-y-3">
        {tab === 'history' && (st.sessions.length ? st.sessions.map(s => (
          <div key={s.id} className="rounded-2xl p-3 bg-white/[0.04] border border-white/[0.06]">
            <div className="flex justify-between text-[10.5px] text-white/40 mb-1"><span>{when(s.at)}</span><span>{s.items.length} 条</span></div>
            {s.summary && <div className="text-[12px] text-white/70 italic mb-2">「{s.summary}」</div>}
            <div className="space-y-2">
              {s.items.map((it, i) => (
                <button key={i} onClick={() => open(it.url)} className="block w-full text-left">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 mt-0.5">{it.site}</span>
                    <span className="text-[12.5px] leading-snug" style={{ color: it.url ? '#9ec5ff' : '#e8e8ea' }}>{it.mature && <span className="text-[10px] mr-1 text-rose-300">🔞</span>}{it.title}</span>
                  </div>
                  {it.thought && <div className="text-[11.5px] text-white/50 mt-0.5 pl-1">{it.thought}</div>}
                </button>
              ))}
              {s.hidden > 0 && <div className="text-[10.5px] text-white/30">（这一趟有 {s.hidden} 条记录被他删了）</div>}
            </div>
          </div>
        )) : <div className="text-center text-[12px] text-white/40 py-16">{name}还没自己上过网。打开 App 时他会隔一阵自己逛，也可以点右上角让他现在去。</div>)}

        {tab === 'fav' && (
          <>
            <div className="rounded-2xl p-3 bg-white/[0.04] border border-white/[0.06] space-y-1.5">
              <div className="text-[11.5px] text-white/60">往他收藏夹里塞点东西（他下次聊天会知道）</div>
              <input value={give.title} onChange={e => setGive({ ...give, title: e.target.value })} placeholder="标题 / 一句话" className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.06] text-[12px] outline-none" />
              <input value={give.url} onChange={e => setGive({ ...give, url: e.target.value })} placeholder="链接（可不填）" className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.06] text-[12px] outline-none" />
              <div className="flex gap-1.5">
                <input value={give.note} onChange={e => setGive({ ...give, note: e.target.value })} placeholder={`想跟${name}说的（可不填）`} className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] text-[12px] outline-none" />
                <button onClick={() => { if (!give.title.trim()) return; addHerFav(char.id, { title: give.title.trim(), url: give.url.trim() || undefined, note: give.note.trim() || undefined }); setGive({ title: '', url: '', note: '' }); toast?.('塞进去了', 'success'); }} className="px-3 rounded-lg bg-white/15 text-[12px]">塞</button>
              </div>
            </div>
            {st.favs.map(f => (
              <div key={f.savedAt} className="rounded-2xl p-3 bg-white/[0.04] border border-white/[0.06]">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded mt-0.5" style={{ background: f.by === 'her' ? 'rgba(244,114,182,0.2)' : 'rgba(255,255,255,0.1)', color: f.by === 'her' ? '#f9a8d4' : 'rgba(255,255,255,0.6)' }}>{f.by === 'her' ? '你塞的' : f.site}</span>
                  <button onClick={() => open(f.url)} className="flex-1 text-left text-[12.5px] leading-snug" style={{ color: f.url ? '#9ec5ff' : '#e8e8ea' }}>{f.mature && '🔞 '}{f.title}</button>
                  <button onClick={() => removeFav(char.id, f.savedAt)} className="text-[10.5px] text-white/30">删</button>
                </div>
                {(f.thought || f.note) && <div className="text-[11.5px] text-white/50 mt-1 pl-1">{f.thought || `你说：${f.note}`}</div>}
                <div className="text-[9.5px] text-white/25 mt-1 pl-1">{when(f.savedAt)}{f.tags?.length ? ` · ${f.tags.join(' · ')}` : ''}</div>
              </div>
            ))}
            {!st.favs.length && <div className="text-center text-[12px] text-white/40 py-10">还没收藏东西</div>}
          </>
        )}

        {tab === 'me' && (
          <>
            <div className="rounded-2xl p-3 bg-white/[0.04] border border-white/[0.06]">
              <div className="text-[11.5px] text-white/60 mb-2">{name}这阵子的兴趣（收藏多的长得快，久不碰会慢慢淡）</div>
              {interests.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {interests.map(([k, v]) => <span key={k} className="px-2 py-0.5 rounded-full bg-white/10" style={{ fontSize: 10 + (v / maxI) * 6, opacity: 0.5 + (v / maxI) * 0.5 }}>{k}</span>)}
                </div>
              ) : <div className="text-[11px] text-white/35">还没长出来</div>}
            </div>
            <label className="flex items-start justify-between gap-3 rounded-2xl p-3 bg-white/[0.04] border border-white/[0.06]">
              <span><span className="block text-[12px]">让他自己上网</span><span className="block text-[10.5px] text-white/40 leading-relaxed">打开 App 时，距上次超过 5 小时就逛一趟（早上 9 点到凌晨 2 点，一天最多 3 次，每次一个请求）。逛过的会进聊天，他会随口提。</span></span>
              <input type="checkbox" checked={cfg.on} onChange={e => upd({ on: e.target.checked })} className="mt-1" />
            </label>
            <label className="flex items-start justify-between gap-3 rounded-2xl p-3 bg-white/[0.04] border border-white/[0.06]">
              <span><span className="block text-[12px]">深夜成人向</span><span className="block text-[10.5px] text-white/40 leading-relaxed">晚上 10 点到凌晨 4 点逛的时候，他偶尔会看成人向的东西（成人小说、R18 同人之类）。只记标题和一句想法，不写露骨内容；删不删记录由他。</span></span>
              <input type="checkbox" checked={cfg.mature} onChange={e => upd({ mature: e.target.checked })} className="mt-1" />
            </label>
          </>
        )}
      </div>
    </div>
  );
};

export default CharWebBrowser;
