/**
 * 设置页最上面的「API 总览」：所有要填模型的地方集中在一页。
 * 每一项显示现在用的是哪个模型，点开从预设里一键换（Vertex 直连也作为一个选项）。
 * 具体字段仍由各自原来的存储负责，这里只是统一的入口。
 */
import React, { useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import type { APIConfig, ApiPreset } from '../../types';
import { configFromPreset } from '../../utils/apiPresetSwitch';
import { visionApiConfigFromPreset } from '../../utils/visionApi';
import { getCheckPhoneApi, setCheckPhoneApi } from '../../utils/checkPhoneApi';
import { loadListenApiConfig, saveListenApiConfig } from '../../utils/music/songListen';
import { loadVertexStore, vertexBaseUrl, isVertexUrl, VERTEX_PLACEHOLDER_KEY } from '../../utils/vertexDirect';
import { loadCloudApiOverride, saveCloudApiOverride } from '../../utils/amsgLlmCredentials';
import { syncAmsgLlmCredentials } from '../../utils/amsgStateSync';
import VertexDirectPanel from './VertexDirectPanel';

type Choice = { id: string; name: string; baseUrl: string; apiKey: string; model: string; apiType?: APIConfig['apiType']; preset?: ApiPreset };

const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return u || ''; } };
const label = (c?: { baseUrl?: string; model?: string } | null) =>
  !c?.baseUrl ? '' : `${c.model || '（没填模型）'} · ${isVertexUrl(c.baseUrl) ? 'Vertex 本机' : host(c.baseUrl)}`;

const readJson = (key: string) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeJson = (key: string, v: any) => { try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* ignore */ } };

const Row: React.FC<{
  title: string; note?: string; current: string; follow?: string;
  choices: Choice[]; onPick: (c: Choice | null) => void; allowFollow?: boolean;
}> = ({ title, note, current, follow, choices, onPick, allowFollow = true }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(v => !v)}>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-700">{title}</div>
          <div className="text-[10px] text-slate-400 truncate">{current || follow || '没设置'}</div>
        </div>
        <span className="text-[10px] text-primary shrink-0">{open ? '收起' : '换'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {note && <div className="w-full text-[10px] text-amber-600 mb-1">{note}</div>}
          {allowFollow && (
            <button onClick={() => { onPick(null); setOpen(false); }}
              className="px-2.5 py-1 rounded-full text-[10px] bg-slate-100 text-slate-600 active:scale-95">{follow ? `跟随：${follow.split(' · ')[0]}` : '不单独设置'}</button>
          )}
          {choices.map(c => (
            <button key={c.id} onClick={() => { onPick(c); setOpen(false); }}
              className="px-2.5 py-1 rounded-full text-[10px] bg-primary/10 text-primary active:scale-95">
              {c.name} <span className="opacity-60">{c.model}</span>
            </button>
          ))}
          {!choices.length && <div className="text-[10px] text-slate-400">还没有预设：先在下面「API 设置」里存一个预设。</div>}
        </div>
      )}
    </div>
  );
};

const ApiOverviewPanel: React.FC<{ onCommitMain: (patch: Partial<APIConfig>) => void }> = ({ onCommitMain }) => {
  const { apiConfig, apiPresets, characters, updateCharacter, updateApiConfig, memoryPalaceConfig, updateMemoryPalaceConfig, addToast } = useOS() as any;
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);

  const choices: Choice[] = useMemo(() => {
    const list: Choice[] = (apiPresets as ApiPreset[] || []).map(p => ({
      id: p.id, name: p.name, baseUrl: p.config.baseUrl, apiKey: p.config.apiKey, model: p.config.model, apiType: p.config.apiType, preset: p,
    }));
    const v = loadVertexStore();
    if (v) {
      const model = (apiConfig?.baseUrl && isVertexUrl(apiConfig.baseUrl) && apiConfig.model) || 'google/gemini-2.5-pro';
      list.unshift({ id: '__vertex', name: 'Vertex 本机', baseUrl: vertexBaseUrl(v.sa.project_id, v.location), apiKey: VERTEX_PLACEHOLDER_KEY, model, apiType: 'openai' });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPresets, apiConfig?.baseUrl, apiConfig?.model, tick]);
  const cloudChoices = choices.filter(c => !isVertexUrl(c.baseUrl));
  const toApi = (c: Choice) => ({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, ...(c.apiType ? { apiType: c.apiType } : {}) });
  const mainLabel = label(apiConfig);
  const ok = (what: string) => addToast?.(`${what}已换好`, 'success');

  const cloud = loadCloudApiOverride();
  const listen = loadListenApiConfig();
  const checkPhone = getCheckPhoneApi();
  const world = readJson('world_home_api');
  const study = readJson('study_api_config');
  const chatsOnVertex = isVertexUrl(apiConfig?.baseUrl || '') || (characters || []).some((c: any) => isVertexUrl(c.dialogueApi?.baseUrl || ''));

  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100 mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 tracking-wider">API 总览</h2>
        <button onClick={() => setOpen(v => !v)} className="text-[10px] text-slate-400">{open ? '收起' : '展开'}</button>
      </div>
      {open && (
        <div className="mt-2" key={tick}>
          <div className="text-[10px] text-slate-400 mb-1">所有要填模型的地方都在这。点「换」从预设里挑；要新增一套 Key，在下面「API 设置」里存成预设。</div>

          <Row title="聊天（全局默认）" current={mainLabel} choices={choices} allowFollow={false}
            onPick={c => { if (!c) return; onCommitMain(c.preset ? configFromPreset(c.preset) : toApi(c)); ok('聊天模型'); refresh(); }} />

          {(characters || []).map((ch: any) => (
            <Row key={ch.id} title={`${ch.name} 的默认对话`} current={label(ch.dialogueApi)} follow={mainLabel} choices={choices}
              onPick={c => {
                updateCharacter(ch.id, { dialogueApi: c ? { ...toApi(c), ...(c.preset?.config.stream != null ? { stream: c.preset.config.stream } : {}) } : undefined });
                syncAmsgLlmCredentials({ ...apiConfig });
                ok(`${ch.name}的模型`); refresh();
              }} />
          ))}

          <Row title="主动消息 · 云端后台" current={cloud ? `${label(cloud)}${cloud.always ? '' : '（只在聊天用 Vertex 时顶上）'}` : ''}
            follow={chatsOnVertex ? '跟随聊天（但聊天在用 Vertex，云端用不了，请选一套）' : '跟随各角色的对话模型'}
            note="主动消息、云端的情绪和记忆整理都在你的 Worker 上跑，用不了本机 Vertex，这里只列能上云的预设。"
            choices={cloudChoices}
            onPick={c => {
              saveCloudApiOverride(c ? { ...toApi(c), always: !chatsOnVertex } : null);
              syncAmsgLlmCredentials({ ...apiConfig });
              ok('主动消息模型'); refresh();
            }} />

          <Row title="识图（图片先转文字）" current={apiConfig?.visionApi?.enabled ? label(apiConfig.visionApi) : ''} follow="关闭（主模型自己看图）" choices={choices}
            onPick={c => { updateApiConfig({ visionApi: c?.preset ? visionApiConfigFromPreset(c.preset) : c ? { enabled: true, ...toApi(c) } : { ...(apiConfig.visionApi || { baseUrl: '', apiKey: '', model: '' }), enabled: false } }); ok('识图模型'); refresh(); }} />

          <Row title="听歌（解读 / 听歌日记）" current={listen.baseUrl ? label(listen) : ''} choices={choices}
            note="解读要把整首歌的音频发给模型，选支持听音频的（比如 Gemini 系）。"
            onPick={c => { saveListenApiConfig({ ...listen, ...(c ? toApi(c) : { baseUrl: '', apiKey: '', model: '' }) }); ok('听歌模型'); refresh(); }} />

          {memoryPalaceConfig && (
            <Row title="记忆宫殿 · 副模型（整理 / 提取）" current={label(memoryPalaceConfig.lightLLM)} follow="没设置" choices={choices}
              onPick={c => { updateMemoryPalaceConfig({ lightLLM: c ? toApi(c) : { baseUrl: '', apiKey: '', model: '' } }); ok('记忆宫殿副模型'); refresh(); }} />
          )}

          <Row title="查手机" current={label(checkPhone)} follow={mainLabel} choices={choices}
            onPick={c => { setCheckPhoneApi(c ? { ...apiConfig, ...toApi(c) } : null); ok('查手机模型'); refresh(); }} />

          <Row title="家园" current={label(world)} follow={mainLabel} choices={choices}
            onPick={c => { writeJson('world_home_api', c ? toApi(c) : null); ok('家园模型'); refresh(); }} />

          <Row title="自习室" current={label(study)} follow={mainLabel} choices={choices}
            onPick={c => { writeJson('study_api_config', c ? { ...(study || {}), ...toApi(c) } : null); ok('自习室模型'); refresh(); }} />

          <div className="pt-3">
            <VertexDirectPanel onApply={(patch) => { onCommitMain({ ...patch, apiType: 'openai' }); refresh(); }} />
          </div>
        </div>
      )}
    </section>
  );
};

export default ApiOverviewPanel;
