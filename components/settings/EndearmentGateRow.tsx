/** 口癖清洗面板里的一行：称呼频率闸（开关、词表、最近的密度） */
import React, { useEffect, useState } from 'react';
import { DB } from '../../utils/db';
import { getGate, setGate, endearmentStats } from '../../utils/endearmentGate';

const EndearmentGateRow: React.FC<{ charId: string; charName: string }> = ({ charId, charName }) => {
  const [cfg, setCfg] = useState(getGate(charId));
  const [words, setWords] = useState(cfg.words.join('、'));
  const [stat, setStat] = useState<{ n: number; hits: number; ends: number } | null>(null);
  useEffect(() => {
    const c = getGate(charId); setCfg(c); setWords(c.words.join('、')); setStat(null);
    DB.getMessagesByCharId(charId).then((ms: any[]) => {
      const texts = ms.filter(m => m.role === 'assistant' && (m.type || 'text') === 'text').slice(-20).map(m => String(m.content || ''));
      setStat(endearmentStats(charId, texts));
    }).catch(() => {});
  }, [charId]);
  const update = (patch: Partial<typeof cfg>) => { setGate(charId, patch); setCfg(getGate(charId)); };
  return (
    <div className="p-2.5 rounded-xl bg-white border border-slate-100 space-y-1.5">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[11.5px] font-semibold text-slate-600">称呼频率闸</span>
          <span className="block text-[10px] text-slate-400 leading-relaxed">
            {charName}最近 20 条消息里挂着下面这些词的超过 {Math.round(cfg.ratio * 100)}%，那一轮就提醒他一个都别用；没超就什么都不加。
            {stat && stat.n > 0 && <> 现在：{stat.n} 条里 {stat.hits} 条（{stat.ends} 条拿它收尾）{stat.hits / stat.n > cfg.ratio ? '，会触发' : '，不触发'}。</>}
          </span>
        </span>
        <input type="checkbox" className="mt-1" checked={cfg.on} onChange={e => update({ on: e.target.checked })} />
      </label>
      {cfg.on && (
        <>
          <input value={words} onChange={e => { setWords(e.target.value); update({ words: e.target.value.split(/[、,，]+/).map(w => w.trim()).filter(Boolean) }); }}
            className="w-full px-2 py-1 rounded-lg border border-slate-200 text-[11px] outline-none" />
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span className="shrink-0">上限</span>
            <input type="range" min={0.1} max={0.4} step={0.05} value={cfg.ratio} onChange={e => update({ ratio: Number(e.target.value) })} className="flex-1" />
            <span className="w-8 text-right">{Math.round(cfg.ratio * 100)}%</span>
          </div>
        </>
      )}
    </div>
  );
};

export default EndearmentGateRow;
