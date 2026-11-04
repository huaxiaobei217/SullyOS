/** 设置页 · 二改数据备份：歌曲解读、听歌日记、页脚等单独导出 / 导入（完整备份里也会带上） */
import React, { useRef, useState } from 'react';
import { downloadNoahBackup, restoreNoahBackupFile, noahBackupSummary } from '../../utils/noahBackup';

const NoahBackupPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const summary = open ? noahBackupSummary() : [];
  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">二改数据备份</h2>
        <button onClick={() => setOpen(v => !v)} className="text-[10px] text-slate-400">{open ? '收起' : '展开'}</button>
      </div>
      {!open ? (
        <div className="text-[10px] text-slate-400 mt-1">歌曲解读、听歌日记、页脚这些也能备份了</div>
      ) : (
        <div className="mt-2 space-y-2.5">
          <div className="text-[10px] text-slate-400 leading-relaxed">
            「设置 → 导出备份」现在会自动带上这些；这里可以单独导出一个小文件，换设备或清缓存前存一份。
            NovelAI Key、Vertex 服务账号、LX 音源脚本不会放进去（换机后重新填 / 导入）。图片和音频跟着完整备份走。
          </div>
          <div className="text-[10.5px] text-slate-500">{summary.length ? `现在有：${summary.join(' · ')}` : '现在还没有数据'}</div>
          <div className="flex gap-2">
            <button onClick={() => { downloadNoahBackup(); setMsg('已导出'); }} className="flex-1 py-2 rounded-xl text-xs font-bold bg-primary/10 text-primary">导出</button>
            <button onClick={() => fileRef.current?.click()} className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-600">导入</button>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            if (!confirm('导入会用文件里的内容覆盖本机同名数据（歌曲解读、页脚等），继续吗？')) return;
            try { const n = await restoreNoahBackupFile(f); setMsg(`已恢复 ${n} 项，刷新页面后生效`); }
            catch (err: any) { setMsg(`导入失败：${err?.message || err}`); }
          }} />
          {msg && <div className="text-[10.5px] text-slate-500">{msg}</div>}
        </div>
      )}
    </section>
  );
};

export default NoahBackupPanel;
