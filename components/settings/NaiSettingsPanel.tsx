/**
 * 设置页 · NovelAI 生图：Key、模型、画师串、角色外貌、拼车排队、哪些角色能在聊天里拍照。
 * Key 只存本机；生图请求经过自己的代理 Worker（/nai/generate）。
 */
import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { loadNaiConfig, saveNaiConfig, generateNaiImage, activeNaiStyle, type NaiConfig, type NaiStyle } from '../../utils/nai';

const MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-5', 'nai-diffusion-4-full', 'nai-diffusion-3'];

const NaiSettingsPanel: React.FC = () => {
  const { characters } = useOS() as any;
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<NaiConfig>(() => loadNaiConfig());
  const [testing, setTesting] = useState('');
  const [preview, setPreview] = useState('');
  const set = (patch: Partial<NaiConfig>) => { const next = { ...cfg, ...patch }; setCfg(next); saveNaiConfig(next); };
  const style = activeNaiStyle(cfg);
  const setStyle = (patch: Partial<NaiStyle>) => set({ styles: cfg.styles.map(s => s.id === style.id ? { ...s, ...patch } : s) });
  const input = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white outline-none';

  const test = async () => {
    setTesting('准备中…'); setPreview('');
    try {
      const blob = await generateNaiImage('cozy study desk, books, vinyl record player, jasmine flowers in a glass, warm desk lamp, rainy window, night', {
        orient: 'square', onProgress: m => setTesting(m),
      });
      setPreview(URL.createObjectURL(blob)); setTesting('');
    } catch (e: any) { setTesting(`失败：${e?.message || e}`); }
  };

  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">NovelAI 生图</h2>
        <button onClick={() => setOpen(v => !v)} className="text-[10px] text-slate-400">{open ? '收起' : '展开'}</button>
      </div>
      {!open ? (
        <div className="text-[10px] text-slate-400 mt-1">{cfg.key ? `已填 Key · ${cfg.model} · ${activeNaiStyle(cfg).name}${cfg.queueOn ? ' · 拼车排队' : ''}` : '给页脚配图、让角色在聊天里拍照发给你'}</div>
      ) : (
        <div className="mt-2 space-y-2.5 text-[11px] text-slate-600">
          <div className="text-[10px] text-slate-400 leading-relaxed">Key 只存在这台设备上；生图经过你自己的代理 Worker 转发（需要 Worker 是最新代码）。</div>
          <label className="block">NovelAI Key
            <input type="password" className={input} value={cfg.key} onChange={e => set({ key: e.target.value })} placeholder="pst-…" />
          </label>
          <label className="block">模型
            <select className={input} value={cfg.model} onChange={e => set({ model: e.target.value })}>
              {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10.5px] text-slate-400 mr-1">画风</span>
              {cfg.styles.map(st => (
                <button key={st.id} onClick={() => set({ activeStyle: st.id })}
                  className={`px-2 py-0.5 rounded-full text-[10.5px] border ${st.id === cfg.activeStyle ? 'bg-primary/10 border-primary/40 text-primary' : 'border-slate-200 text-slate-500'}`}>{st.name}</button>
              ))}
              <button onClick={() => { const id = `st_${Date.now().toString(36)}`; set({ styles: [...cfg.styles, { ...style, id, name: `画风 ${cfg.styles.length + 1}` }], activeStyle: id }); }}
                className="px-2 py-0.5 rounded-full text-[10.5px] border border-dashed border-slate-300 text-slate-400">+ 复制一份</button>
            </div>
            <div className="flex gap-2">
              <input className={input} value={style.name} onChange={e => setStyle({ name: e.target.value })} placeholder="画风名字" />
              {cfg.styles.length > 1 && <button onClick={() => { const rest = cfg.styles.filter(s => s.id !== style.id); set({ styles: rest, activeStyle: rest[0].id }); }} className="px-2 text-[10.5px] text-rose-400 shrink-0">删掉</button>}
            </div>
            <label className="block">画师串
              <textarea className={input} rows={2} value={style.artist} onChange={e => setStyle({ artist: e.target.value })} placeholder="artist:xxx, 0.8::artist:yyy::, …" />
            </label>
            <label className="block">固定正面（每张图都会加，接在画师串后面）
              <textarea className={input} rows={2} value={style.positive} onChange={e => setStyle({ positive: e.target.value })} placeholder="masterpiece, best quality, …" />
            </label>
            <label className="block">固定负面
              <textarea className={input} rows={2} value={style.negative} onChange={e => setStyle({ negative: e.target.value })} placeholder="lowres, bad anatomy, …" />
            </label>
            <div className="text-[10px] text-slate-400">实际发送：画师串 + 固定正面 + 这张图的场景 tag；负面 = 固定负面。</div>
            <label className="flex items-center justify-between">
              <span>再加官方质量词（固定正面里写了就不用开）</span><input type="checkbox" checked={cfg.quality} onChange={e => set({ quality: e.target.checked })} />
            </label>
          </div>
          <label className="flex items-center justify-between">
            <span>允许画人（不开的话只画随手拍的场景、物件）</span><input type="checkbox" checked={cfg.allowPeople} onChange={e => set({ allowPeople: e.target.checked })} />
          </label>

          <div className="pt-2 border-t border-slate-100">
            <label className="flex items-center justify-between">
              <span>拼车排队（同一个 Key 的人排同一条队）</span><input type="checkbox" checked={cfg.queueOn} onChange={e => set({ queueOn: e.target.checked })} />
            </label>
            {cfg.queueOn && (
              <div className="mt-1.5 space-y-1.5">
                <input className={input} value={cfg.queueUrl} onChange={e => set({ queueUrl: e.target.value })} placeholder="队列服务地址" />
                <div className="flex gap-2">
                  <input className={input} value={cfg.greeting} maxLength={15} onChange={e => set({ greeting: e.target.value })} placeholder="排队招呼（15 字内）" />
                  <input className={`${input} w-20`} type="number" value={cfg.timeout} onChange={e => set({ timeout: Math.max(30, Number(e.target.value) || 180) })} title="最多等几秒" />
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="text-[10px] text-slate-400">角色：外貌 tag（提示词里写 self 时换成它，画他本人时长相稳定），以及能不能在聊天里「拍照」发给你</div>
            {(characters || []).map((c: any) => (
              <div key={c.id} className="p-2 rounded-lg bg-white border border-slate-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">{c.name}</span>
                  <label className="flex items-center gap-1 text-[10.5px]">聊天里拍照
                    <input type="checkbox" checked={!!cfg.chatPhotos[c.id]} onChange={e => set({ chatPhotos: { ...cfg.chatPhotos, [c.id]: e.target.checked } })} />
                  </label>
                </div>
                <textarea className={input} rows={2} value={cfg.characterTags[c.id] || ''} placeholder="1boy, black hair, …（不画他本人可以不填）"
                  onChange={e => set({ characterTags: { ...cfg.characterTags, [c.id]: e.target.value } })} />
              </div>
            ))}
          </div>

          <button onClick={test} disabled={!cfg.key || (!!testing && !testing.startsWith('失败'))} className="w-full py-2 rounded-xl text-xs font-bold bg-primary/10 text-primary disabled:opacity-40">
            {testing && !testing.startsWith('失败') ? testing : '画一张试试'}
          </button>
          {testing.startsWith('失败') && <div className="text-[10.5px] text-rose-500">{testing}</div>}
          {preview && <img src={preview} alt="" className="w-full rounded-xl" />}
        </div>
      )}
    </section>
  );
};

export default NaiSettingsPanel;
