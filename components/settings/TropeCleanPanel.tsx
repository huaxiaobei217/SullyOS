/**
 * 设置页 ·「口癖清洗」：给角色列一张用腻了的梗清单（注入提示词），
 * 再扫一遍聊天记录和记忆，看这些词还在哪儿，记忆里的可以就地改掉。
 */
import React, { useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { getBannedTropes, setBannedTropes, countHits, getTropeMode, setTropeMode, rewriteMemoryText, type TropeMode } from '../../utils/tropeBan';
import { resolveDialogueApi } from '../../utils/characterApi';
import { isMoneyOff, setMoneyOff } from '../../utils/moneyOff';
import { MemoryNodeDB } from '../../utils/memoryPalace/db';
import { updateStoredMemoryNode } from '../../utils/memoryPalace/vectorStore';

type Hit = { kind: 'memory' | 'refined' | 'palace'; key: string; label: string; text: string };

const TropeCleanPanel: React.FC = () => {
  const { characters, updateCharacter, addToast, apiConfig, memoryPalaceConfig, remoteVectorConfig } = useOS() as any;
  const [mode, setModeState] = useState<TropeMode>(getTropeMode());
  const [rewriting, setRewriting] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const defaultId = useMemo(() => (characters || []).find((c: any) => /诺亚|Noah/i.test(c.name))?.id || characters?.[0]?.id || '', [characters]);
  const [charId, setCharId] = useState(defaultId);
  const char = (characters || []).find((c: any) => c.id === (charId || defaultId));
  const [list, setList] = useState<string[]>(() => getBannedTropes(charId || defaultId));
  const [draft, setDraft] = useState('');
  const [scan, setScan] = useState<{ chat: Record<string, number>; hits: Hit[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const [moneyOff, setMoneyOffState] = useState(() => isMoneyOff(charId || defaultId));
  const pick = (id: string) => { setCharId(id); setList(getBannedTropes(id)); setScan(null); setEdits({}); setMoneyOffState(isMoneyOff(id)); };
  const save = (next: string[]) => { setList(next); setBannedTropes(char.id, next); };
  const add = () => {
    const words = draft.split(/[，,、\n]/).map(s => s.trim()).filter(Boolean);
    if (!words.length) return;
    save([...list, ...words]); setDraft(''); setScan(null);
  };

  const runScan = async () => {
    if (!char || !list.length) return;
    setScanning(true);
    try {
      const msgs = await DB.getMessagesByCharId(char.id, true);
      const recent = msgs.slice(-800);
      const chat: Record<string, number> = {};
      for (const w of list) chat[w] = recent.reduce((n, m) => n + (m.role === 'assistant' ? countHits(String(m.content || ''), w) : 0), 0);
      const hits: Hit[] = [];
      for (const m of (char.memories || [])) {
        if (list.some(w => countHits(m.summary, w))) hits.push({ kind: 'memory', key: m.id, label: m.date, text: m.summary });
      }
      for (const [k, v] of Object.entries(char.refinedMemories || {})) {
        if (typeof v === 'string' && list.some(w => countHits(v, w))) hits.push({ kind: 'refined', key: k, label: `核心记忆 · ${k}`, text: v });
      }
      try {
        const nodes = await MemoryNodeDB.getByCharId(char.id);
        for (const n of nodes as any[]) {
          if (typeof n.content === 'string' && list.some(w => countHits(n.content, w))) {
            hits.push({ kind: 'palace', key: n.id, label: `记忆宫殿 · ${new Date(n.createdAt).toLocaleDateString()}${n.archived ? ' · 已归档' : ''}`, text: n.content });
          }
        }
      } catch { /* 没开记忆宫殿 */ }
      setScan({ chat, hits }); setEdits({});
    } catch (e: any) { addToast?.(`扫描失败：${e?.message || e}`, 'error'); }
    finally { setScanning(false); }
  };

  const pickApi = () => {
    const l = memoryPalaceConfig?.lightLLM;
    if (l?.baseUrl && l?.model) return l;
    return resolveDialogueApi(apiConfig, char);
  };
  const rewrite = async (h: Hit) => {
    const k = `${h.kind}:${h.key}`;
    const words = list.filter(w => countHits(h.text, w));
    setRewriting(r => ({ ...r, [k]: true }));
    try {
      const out = await rewriteMemoryText(h.text, words, pickApi());
      setEdits(e => ({ ...e, [k]: out }));
    } catch (e: any) { addToast?.(`改写失败：${e?.message || e}`, 'error'); }
    finally { setRewriting(r => { const n = { ...r }; delete n[k]; return n; }); }
  };
  const rewriteAll = async () => { for (const h of scan?.hits || []) { if (edits[`${h.kind}:${h.key}`] == null) await rewrite(h); } };
  const saveAll = async () => { for (const h of scan?.hits || []) if (edits[`${h.kind}:${h.key}`] != null) await saveEdit(h); };

  const saveEdit = async (h: Hit) => {
    const text = edits[`${h.kind}:${h.key}`];
    if (text == null) return;
    if (h.kind === 'palace') {
      try {
        // 记忆宫殿：改正文后顺手重算语义向量，搜得到的就是改过的版本
        await updateStoredMemoryNode(h.key, { content: text.trim() } as any, memoryPalaceConfig?.embedding, remoteVectorConfig);
      } catch (e: any) { addToast?.(`记忆宫殿这条没存上：${e?.message || e}`, 'error'); return; }
    } else if (h.kind === 'memory') updateCharacter(char.id, { memories: (char.memories || []).map((m: any) => m.id === h.key ? { ...m, summary: text } : m) });
    else updateCharacter(char.id, { refinedMemories: { ...(char.refinedMemories || {}), [h.key]: text } });
    setScan(s => s ? { ...s, hits: s.hits.map(x => x.kind === h.kind && x.key === h.key ? { ...x, text } : x) } : s);
    setEdits(e => { const n = { ...e }; delete n[`${h.kind}:${h.key}`]; return n; });
    addToast?.('这条记忆改好了', 'success');
  };
  const mark = (text: string) => {
    const parts: React.ReactNode[] = [];
    let rest = text, k = 0;
    while (rest) {
      let best = -1, word = '';
      for (const w of list) { const i = rest.indexOf(w); if (i >= 0 && (best < 0 || i < best)) { best = i; word = w; } }
      if (best < 0) { parts.push(rest); break; }
      parts.push(rest.slice(0, best), <mark key={k++} className="bg-amber-200/70 rounded px-0.5">{word}</mark>);
      rest = rest.slice(best + word.length);
    }
    return parts;
  };

  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">口癖清洗</h2>
        <button onClick={() => setOpen(v => !v)} className="text-[10px] text-slate-400">{open ? '收起' : '展开'}</button>
      </div>
      {!open ? (
        <div className="text-[10px] text-slate-400 mt-1">角色学来的、用腻了的梗（比如「记账」「包工头」），在这里列出来让他别再说。</div>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="text-[10px] text-slate-400 leading-relaxed">
            模型会模仿聊天记录和记忆里反复出现的说法，越用越多。这里列的词会在每次聊天（以及页脚等小 App）里提醒他「这个用腻了，别再说」。
            再扫一遍记忆：记忆里写着这些梗的地方可以顺手改掉，免得他一直从记忆里学回去。
          </div>
          {(characters || []).length > 1 && (
            <select value={char?.id || ''} onChange={e => pick(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
              {(characters || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {char && (
            <label className="flex items-start justify-between gap-3 p-2.5 rounded-xl bg-white border border-slate-100">
              <span className="min-w-0">
                <span className="block text-[11.5px] font-semibold text-slate-600">关掉{char.name}的转账和记账</span>
                <span className="block text-[10px] text-slate-400">他看不到转账动作，也不会收到你的记账（支出）记录，话题少往钱上带。你还是可以给他转账。</span>
              </span>
              <input type="checkbox" className="mt-1" checked={moneyOff} onChange={e => { setMoneyOff(char.id, e.target.checked); setMoneyOffState(e.target.checked); }} />
            </label>
          )}
          <div className="flex flex-wrap gap-1.5">
            {list.map(w => (
              <span key={w} className="px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                {w}<button className="ml-1 opacity-60" onClick={() => save(list.filter(x => x !== w))}>×</button>
              </span>
            ))}
            {!list.length && <span className="text-[10px] text-slate-400">还没有，比如：记账、连本带利、包工头</span>}
          </div>
          <div className="flex gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="输入用腻的词，逗号隔开" className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
            <button onClick={add} className="px-3 rounded-lg text-xs bg-slate-100 text-slate-600">加上</button>
          </div>
          <div className="flex gap-1.5 text-[10.5px]">
            {([['relapse', '他又说了才提醒'], ['always', '每次都提醒'], ['off', '不提醒']] as const).map(([m, n]) => (
              <button key={m} onClick={() => { setTropeMode(m); setModeState(m); }}
                className={`flex-1 py-1.5 rounded-lg border ${mode === m ? 'bg-primary/10 border-primary/40 text-primary font-semibold' : 'border-slate-200 text-slate-500'}`}>{n}</button>
            ))}
          </div>
          <div className="text-[10px] text-slate-400 -mt-1">
            {mode === 'relapse' ? '推荐。平时不提这些词，免得越提越惦记；只有他最近几条回复里又冒出来时，才轻轻提醒一句。' : mode === 'always' ? '每轮都提醒。效果最直接，但有些模型会因为老看到这些词反而更容易想起来。' : '只做记忆清理，不在聊天里提醒。'}
          </div>
          <button onClick={runScan} disabled={!list.length || scanning} className="w-full py-2 rounded-xl text-xs font-bold bg-primary/10 text-primary disabled:opacity-40">
            {scanning ? '扫描中…' : '扫一遍聊天记录和记忆'}
          </button>
          {scan && (
            <div className="space-y-2">
              <div className="text-[11px] text-slate-500">
                最近 800 条聊天里他说过：{list.map(w => `「${w}」${scan.chat[w] || 0} 次`).join('，')}
                <div className="text-[10px] text-slate-400 mt-0.5">聊天记录不用删：清单生效后他会慢慢换掉；旧消息随着聊天往前推，也会滑出他能看到的范围。</div>
              </div>
              <div className="text-[11px] text-slate-500">记忆里有 {scan.hits.length} 处{scan.hits.length ? '。可以让模型改写（去掉梗、事实不变），你看过再保存' : '，很干净'}</div>
              {scan.hits.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={rewriteAll} disabled={Object.keys(rewriting).length > 0} className="flex-1 py-1.5 rounded-lg text-[11px] bg-primary/10 text-primary disabled:opacity-40">{Object.keys(rewriting).length ? '改写中…' : '全部让模型改写'}</button>
                  <button onClick={saveAll} disabled={!Object.keys(edits).length} className="flex-1 py-1.5 rounded-lg text-[11px] bg-primary text-white disabled:opacity-40">保存全部改好的</button>
                </div>
              )}
              {scan.hits.map(h => {
                const k = `${h.kind}:${h.key}`;
                const editing = edits[k] != null;
                return (
                  <div key={k} className="p-2.5 rounded-xl bg-white border border-slate-100">
                    <div className="text-[10px] text-slate-400 mb-1">{h.label}</div>
                    {editing ? (
                      <textarea value={edits[k]} onChange={e => setEdits(x => ({ ...x, [k]: e.target.value }))} rows={4}
                        className="w-full text-[11.5px] p-1.5 rounded-lg border border-slate-200 outline-none" />
                    ) : <div className="text-[11.5px] text-slate-600 leading-relaxed whitespace-pre-wrap">{mark(h.text)}</div>}
                    <div className="flex justify-end gap-3 mt-1.5 text-[10.5px]">
                      {editing ? (
                        <>
                          <button onClick={() => setEdits(x => { const n = { ...x }; delete n[k]; return n; })} className="text-slate-400">取消</button>
                          <button onClick={() => saveEdit(h)} className="text-primary font-semibold">保存</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEdits(x => ({ ...x, [k]: h.text }))} className="text-slate-500">手动改</button>
                          <button onClick={() => rewrite(h)} disabled={!!rewriting[k]} className="text-primary">{rewriting[k] ? '改写中…' : '让模型改写'}</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="text-[10px] text-slate-400">记忆宫殿里的也扫进来了（标着「记忆宫殿」）；改好保存时会顺手重算语义向量。</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default TropeCleanPanel;
