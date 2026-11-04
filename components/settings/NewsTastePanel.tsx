/**
 * 设置页 · 热点口味：每个角色一串感兴趣的关键词，注入热点时优先挑他会点进去看的。
 */
import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { getNewsTaste, setNewsTaste, DEFAULT_NOAH_TASTE } from '../../utils/newsTaste';

const NewsTastePanel: React.FC = () => {
  const { characters, realtimeConfig } = useOS() as any;
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries((characters || []).map((c: any) => [c.id, getNewsTaste(c.id).join('、')])));
  const save = (id: string, text: string) => {
    setDrafts(d => ({ ...d, [id]: text }));
    setNewsTaste(id, text.split(/[、,，\s]+/));
  };
  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">热点口味</h2>
        <button onClick={() => setOpen(v => !v)} className="text-[10px] text-slate-400">{open ? '收起' : '展开'}</button>
      </div>
      {!open ? (
        <div className="text-[10px] text-slate-400 mt-1">让角色从热榜里挑他会点进去看的，像自己刷到一样随口分享</div>
      ) : (
        <div className="mt-2 space-y-2.5">
          {!realtimeConfig?.newsEnabled && <div className="text-[10.5px] text-amber-600">还没开热点：设置 → 实时感知 → 新闻热点。</div>}
          <div className="text-[10px] text-slate-400 leading-relaxed">填他感兴趣的关键词（顿号或逗号隔开）。每轮注入热点时，标题里带这些词的优先，再留一条随手划到的；他会被提示「这是你自己刷到的，想聊就随口分享，别播报」。留空就是原来的随机挑。</div>
          {(characters || []).map((c: any) => (
            <div key={c.id} className="p-2.5 rounded-xl bg-white border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11.5px] font-semibold text-slate-600">{c.name}</span>
                {/诺亚|Noah/i.test(c.name) && !drafts[c.id] && (
                  <button onClick={() => save(c.id, DEFAULT_NOAH_TASTE.join('、'))} className="text-[10.5px] text-primary">填上他的口味</button>
                )}
              </div>
              <textarea rows={2} value={drafts[c.id] || ''} onChange={e => save(c.id, e.target.value)}
                placeholder="音乐、电影、历史、旅行……" className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs outline-none" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default NewsTastePanel;
