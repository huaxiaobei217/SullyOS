/** 设置 · 中文识别（OpenAI 兼容转写：硅基流动 SenseVoice / Groq Whisper…）。配置只存本机 */
import React, { useState } from 'react';
import { getSttOpenAiConfig, setSttOpenAiConfig, STT_OPENAI_PRESETS } from '../../utils/speechToText';

const SttOpenAiPanel: React.FC<{ onSaved?: () => void }> = ({ onSaved }) => {
  const [cfg, setCfg] = useState(getSttOpenAiConfig());
  const [saved, setSaved] = useState(false);
  const inp = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-primary';
  return (
    <div className="mt-2.5 rounded-xl border border-slate-200 bg-white/70 p-2.5 space-y-2">
      <div className="text-[11px] font-semibold text-slate-600">中文识别 · 填地址和 Key</div>
      <div className="flex flex-wrap gap-1.5">
        {STT_OPENAI_PRESETS.map(p => (
          <button key={p.id} type="button" onClick={() => { setCfg(c => ({ ...c, baseUrl: p.baseUrl, model: p.model })); setSaved(false); }}
            className={`text-[10.5px] px-2 py-1 rounded-full border ${cfg.baseUrl === p.baseUrl ? 'border-primary text-primary bg-primary/5' : 'border-slate-200 text-slate-500'}`}>{p.label}</button>
        ))}
      </div>
      <input className={inp} placeholder="地址，如 https://api.siliconflow.cn/v1" value={cfg.baseUrl} onChange={e => { setCfg({ ...cfg, baseUrl: e.target.value.trim() }); setSaved(false); }} />
      <input className={inp} placeholder="模型，如 FunAudioLLM/SenseVoiceSmall" value={cfg.model} onChange={e => { setCfg({ ...cfg, model: e.target.value.trim() }); setSaved(false); }} />
      <input className={inp} type="password" placeholder="API Key（只存在这台手机上）" value={cfg.apiKey} onChange={e => { setCfg({ ...cfg, apiKey: e.target.value.trim() }); setSaved(false); }} />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400 leading-relaxed">硅基流动注册就送额度，SenseVoice 模型免费；Key 在它的控制台「API 密钥」里新建。</span>
        <button type="button" onClick={() => { setSttOpenAiConfig(cfg); setSaved(true); onSaved?.(); }} className="shrink-0 ml-2 text-[11px] px-3 py-1 rounded-full bg-primary text-white">{saved ? '已保存' : '保存'}</button>
      </div>
    </div>
  );
};

export default SttOpenAiPanel;
