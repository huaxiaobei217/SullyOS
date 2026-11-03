/**
 * 设置页 · Vertex 直连（默认折叠的低调入口）。
 * 导入服务账号 JSON → 只存本机 → 一键把当前 API 设置切到 Vertex。详见 utils/vertexDirect.ts。
 */
import React, { useRef, useState } from 'react';
import {
  loadVertexStore, saveVertexStore, parseServiceAccount, vertexBaseUrl,
  getVertexAccessToken, VERTEX_PLACEHOLDER_KEY, rememberVertexModel,
} from '../../utils/vertexDirect';

const LOCATIONS = ['global', 'us-central1', 'us-east5', 'europe-west1', 'asia-northeast1', 'asia-southeast1'];

const VertexDirectPanel: React.FC<{
  onApply: (patch: { baseUrl: string; apiKey: string; model: string }) => void;
}> = ({ onApply }) => {
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState(() => loadVertexStore());
  const [location, setLocation] = useState(store?.location || 'global');
  const [testModel, setTestModel] = useState('google/gemini-2.5-flash');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const sa = parseServiceAccount(await f.text());
      const next = { sa, location };
      saveVertexStore(next);
      setStore(next);
      setStatus(`已导入：${sa.client_email}（项目 ${sa.project_id}）。密钥只存在这台设备上。`);
    } catch (e: any) {
      setStatus(`导入失败：${e?.message || e}`);
    }
  };

  const changeLocation = (loc: string) => {
    setLocation(loc);
    if (store) { const next = { ...store, location: loc }; saveVertexStore(next); setStore(next); }
  };

  const test = async () => {
    if (!store) return;
    setBusy(true);
    setStatus('① 正在本机签名、向 Google 换 token…');
    try {
      await getVertexAccessToken();
      setStatus('① 换 token 成功\n② 正在请求模型…');
      const res = await fetch(`${vertexBaseUrl(store.sa.project_id, location)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VERTEX_PLACEHOLDER_KEY}` },
        body: JSON.stringify({ model: testModel.trim(), messages: [{ role: 'user', content: '用一句话说你好' }], max_tokens: 2000 }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const err = Array.isArray(j) ? j[0]?.error : j?.error;
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      const text = j?.choices?.[0]?.message?.content || '（空回复）';
      rememberVertexModel(testModel);
      setStatus(`连接成功 ✓\n${testModel}：${String(text).slice(0, 120)}`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      setStatus(`失败：${msg}${/Failed to fetch|NetworkError|Load failed/i.test(msg) ? '\n（多半是浏览器拦了跨域请求，或网络连不上 Google）' : ''}`);
    } finally { setBusy(false); }
  };

  const apply = () => {
    if (!store) return;
    rememberVertexModel(testModel);
    onApply({ baseUrl: vertexBaseUrl(store.sa.project_id, location), apiKey: VERTEX_PLACEHOLDER_KEY, model: testModel.trim() || 'google/gemini-2.5-pro' });
    setStatus('已填进当前 API 设置（地址 + 占位密钥 vertex-local + 模型）。可以在那里「拉取模型」换别的，也可以存成预设。');
  };

  const remove = () => {
    saveVertexStore(null);
    setStore(null);
    setStatus('已从这台设备删除服务账号密钥。');
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full text-center text-[10px] text-slate-300 hover:text-slate-400 py-1 transition-colors">
        · Vertex 直连 ·
      </button>
    );
  }

  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-slate-500">Vertex AI 直连（本机）</h2>
        <button onClick={() => setOpen(false)} className="text-[10px] text-slate-400">收起</button>
      </div>
      <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 mb-3 leading-relaxed">
        导入 Google Cloud <b>服务账号 JSON</b>。密钥<b>只存在这台设备</b>，不进备份、不上云、不经过任何 Worker；
        请求从你自己的网络直接发给 Google。换设备要重新导入。<br />
        主动消息 2.0 是在云端跑的，用不了这个，那边请另配一个 API。
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="flex gap-2 mb-2">
        <button onClick={() => fileRef.current?.click()} className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 active:scale-95">
          {store ? '重新导入 JSON' : '导入服务账号 JSON'}
        </button>
        {store && <button onClick={remove} className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-500 active:scale-95">删除</button>}
      </div>

      {store && (
        <>
          <div className="text-[10px] text-slate-500 mb-2 break-all">账号：{store.sa.client_email}<br />项目：{store.sa.project_id}</div>
          <label className="block text-[10px] text-slate-500 mb-1">区域</label>
          <select value={location} onChange={e => changeLocation(e.target.value)} className="w-full mb-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white">
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <label className="block text-[10px] text-slate-500 mb-1">模型</label>
          <input value={testModel} onChange={e => setTestModel(e.target.value)} className="w-full mb-3 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={test} className="flex-1 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 active:scale-95 disabled:opacity-50">{busy ? '测试中…' : '测试连接'}</button>
            <button onClick={apply} className="flex-1 py-2 rounded-xl text-xs font-bold bg-primary text-white active:scale-95">用到当前 API 设置</button>
          </div>
        </>
      )}
      {status && <div className="mt-3 p-2.5 rounded-xl text-[11px] whitespace-pre-wrap break-words bg-slate-100 text-slate-600">{status}</div>}
    </section>
  );
};

export default VertexDirectPanel;
