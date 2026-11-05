/** 口癖清洗面板里的一行：旧账本开关 + 看看今天他手里有什么账 */
import React, { useState } from 'react';
import { isOldLedgerOn, setOldLedgerOn, previewOldLedger } from '../../utils/oldLedger';

const OldLedgerRow: React.FC<{ charId: string; charName: string; userName: string }> = ({ charId, charName, userName }) => {
  const [on, setOn] = useState(isOldLedgerOn(charId));
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-2.5 rounded-xl bg-white border border-slate-100 space-y-1.5">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[11.5px] font-semibold text-slate-600">旧账本</span>
          <span className="block text-[10px] text-slate-400 leading-relaxed">
            每天翻一次聊天记录，找出一周前、一个月前、三个月前、半年前、一年前的今天你们说过的原话，给{charName}当翻旧账的真账。他自己决定用不用，一天最多翻一次。
          </span>
        </span>
        <input type="checkbox" className="mt-1" checked={on} onChange={e => { setOn(e.target.checked); setOldLedgerOn(charId, e.target.checked); }} />
      </label>
      {on && (
        <div>
          <button disabled={busy} onClick={async () => { setBusy(true); try { setPreview(await previewOldLedger(charId, userName, charName) || '今天翻不到旧账（那几天没怎么聊）'); } catch { setPreview('没翻成'); } setBusy(false); }}
            className="text-[10.5px] text-indigo-500">{busy ? '在翻…' : '看看今天他手里有什么账'}</button>
          {preview && <pre className="mt-1 text-[10px] text-slate-500 whitespace-pre-wrap leading-relaxed font-sans">{preview.split('\n').filter(l => l.startsWith('- ')).join('\n') || preview}</pre>}
        </div>
      )}
    </div>
  );
};

export default OldLedgerRow;
