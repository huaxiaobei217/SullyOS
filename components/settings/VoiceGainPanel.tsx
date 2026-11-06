/** 角色语音音量：100%–300%（大于 100% 走增益 + 限幅，不会爆音） */
import React, { useState } from 'react';
import { getVoiceGain, setVoiceGain } from '../../utils/voiceVolume';

const VoiceGainPanel: React.FC = () => {
  const [g, setG] = useState(getVoiceGain());
  return (
    <div className="group rounded-2xl border border-slate-200/70 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">角色语音音量</label>
        <span className="text-[11px] font-bold text-slate-600">{Math.round(g * 100)}%</span>
      </div>
      <input type="range" min={1} max={3} step={0.1} value={g} className="w-full"
        onChange={e => { const v = Number(e.target.value); setG(v); setVoiceGain(v); }} />
      <p className="text-[10.5px] text-slate-400 mt-1 leading-relaxed">
        音色炼得偏小就往右拉，不用把手机音量开满。只放大角色说话（聊天语音、电话、电台、哄睡、约会），音乐和音效不变；带限幅，拉高也不会破音。改完下一句开始生效，正在念的那句不变。iPhone 上不生效。
      </p>
    </div>
  );
};

export default VoiceGainPanel;
