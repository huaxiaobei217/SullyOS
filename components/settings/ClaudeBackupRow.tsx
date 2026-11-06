/** 云备份区里的一行：给小克看的备份（纯文字、删掉密钥） */
import React, { useState } from 'react';
import type { CloudBackupConfig } from '../../types';
import { uploadClaudeBackup, loadClaudeBackupState, setClaudeBackupAuto, isGithubReady } from '../../utils/claudeReadable';

const ClaudeBackupRow: React.FC<{ config: CloudBackupConfig }> = ({ config }) => {
  const [st, setSt] = useState(() => loadClaudeBackupState());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!isGithubReady(config)) return null;
  const last = st.last ? new Date(st.last).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '还没传过';
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-2.5 space-y-1.5">
      <div className="text-[11.5px] font-semibold text-slate-600">给小克看的备份</div>
      <div className="text-[10px] text-slate-400 leading-relaxed">
        纯文字（图片、音频不带），上传前把所有 key、token、密码、服务账号删干净，存到同一个私有仓库的 claude/ 文件夹。跟上面的正式备份分开，不能用来恢复。上次：{last}{st.lastSize ? `（${(st.lastSize / 1024).toFixed(0)}KB）` : ''}
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={async () => { setBusy(true); setMsg('打包、清洗中…'); const r = await uploadClaudeBackup(config); setMsg(r.message); setSt(loadClaudeBackupState()); setBusy(false); }}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 text-white active:scale-95 disabled:opacity-50">{busy ? '上传中…' : '现在上传'}</button>
        <label className="flex items-center gap-1 text-[10.5px] text-slate-500">
          <input type="checkbox" checked={!!st.auto} onChange={e => { setClaudeBackupAuto(e.target.checked); setSt(loadClaudeBackupState()); }} />
          每天自动传一次
        </label>
      </div>
      {(msg || st.lastError) && <div className="text-[10px] text-slate-500">{msg || st.lastError}</div>}
    </div>
  );
};

export default ClaudeBackupRow;
