/**
 * 「给小克看的备份」（个人二改）
 * 纯文字快照：聊天、日程、纸条、记忆、设置……图片 / 音频全部去掉，
 * 所有 key / token / 密码 / 服务账号先删干净，再压缩上传到 GitHub 备份仓库的 claude/latest.json.gz。
 * 跟正式备份（Releases）分开，不参与恢复。git 历史自动保留旧版。
 */
import { DB } from './db';
import { putRepoFile } from './githubClient';
import { APP_VERSION } from './appVersion';
import type { CloudBackupConfig } from '../types';

const LS = 'sully_claude_backup_v1';
const AUTO_EVERY_MS = 20 * 3600 * 1000;
export const CLAUDE_BACKUP_PATH = 'claude/latest.json.gz';

interface State { auto?: boolean; last?: number; lastSize?: number; lastError?: string }
export const loadClaudeBackupState = (): State => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
const saveState = (s: State) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ } };
export const setClaudeBackupAuto = (auto: boolean) => saveState({ ...loadClaudeBackupState(), auto });

const R = '[已删除]';
/** 键名一看就是机密：不管值长什么样都删 */
const ALWAYS_SECRET_KEY = /(api.?key|apikey|secret|passw|credential|private.?key|cookie|authorization|bearer|client_?email|service.?account|refresh)/i;
/** 键名可能是机密（token / xxxKey / session）：值像一串密钥才删，日期 key、计数之类留着 */
const MAYBE_SECRET_KEY = /(token|key$|_key|session|auth)/i;
const SECRET_LOOKING = /^[\w\-.:/+=]{16,}$/;
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[\w-]{16,}/g, /\bAIza[\w-]{20,}/g, /\bgh[pousr]_\w{20,}/g, /\bgithub_pat_\w{20,}/g,
  /\bxai-\w{20,}/g, /\bgsk_\w{20,}/g, /\bhf_\w{20,}/g, /\bpst-[\w-]{20,}/g,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,
  /\b[a-f0-9]{32,}\b/gi,
];
const URL_SECRET = /([?&](?:key|token|api_key|apikey|access_token|auth|sig|signature)=)[^&\s"']+/gi;

const scrubString = (s: string): string => {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, R);
  return out.replace(URL_SECRET, `$1${R}`);
};

const isMediaString = (s: string) =>
  s.startsWith('blobref:') || (s.startsWith('data:') && s.length > 200) || (s.length > 4000 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 4000)));

/** 递归清洗：去媒体、删机密；值是 JSON 字符串的（localStorage 里很多）解开再洗 */
export function redactForClaude(v: any, key = '', depth = 0): any {
  if (depth > 60) return undefined;
  if (typeof v === 'string') {
    if (isMediaString(v)) return '[媒体略]';
    if (key && ALWAYS_SECRET_KEY.test(key) && v) return R;
    if (key && MAYBE_SECRET_KEY.test(key) && SECRET_LOOKING.test(v)) return R;
    const t = v.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && t.length < 5_000_000) {
      try { return JSON.stringify(redactForClaude(JSON.parse(t), key, depth + 1)); } catch { /* 不是 JSON */ }
    }
    return scrubString(v);
  }
  if (Array.isArray(v)) return v.map(x => redactForClaude(x, key, depth + 1));
  if (v && typeof v === 'object') {
    if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[媒体略]';
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) {
      if (ALWAYS_SECRET_KEY.test(k) && x && typeof x === 'object') { out[k] = R; continue; }
      out[k] = redactForClaude(x, k, depth + 1);
    }
    return out;
  }
  return v;
}

const gzipToBase64 = async (text: string): Promise<{ b64: string; size: number }> => {
  let blob: Blob = new Blob([text], { type: 'application/json' });
  if (typeof (window as any).CompressionStream === 'function') {
    const cs = new (window as any).CompressionStream('gzip');
    blob = await new Response(blob.stream().pipeThrough(cs)).blob();
  } else throw new Error('这个浏览器不支持压缩');
  const b64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return { b64, size: blob.size };
};

export const isGithubReady = (c: CloudBackupConfig) => !!(c.githubToken && c.githubOwner);

export async function uploadClaudeBackup(config: CloudBackupConfig): Promise<{ ok: boolean; message: string }> {
  if (!isGithubReady(config)) return { ok: false, message: '先在上面连接 GitHub 备份（填 token）' };
  try {
    const data = await DB.exportFullData({ includeBackendConnection: false });
    const clean = redactForClaude(data);
    const payload = {
      _readme: '给小克看的备份：纯文字，图片音频已去掉，所有密钥已删除。不能用来恢复。',
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      data: clean,
    };
    const { b64, size } = await gzipToBase64(JSON.stringify(payload));
    if (size > 45 * 1024 * 1024) return { ok: false, message: `压缩后还有 ${(size / 1048576).toFixed(1)}MB，太大了传不上去` };
    const res = await putRepoFile(config, CLAUDE_BACKUP_PATH, b64, `给小克看的备份 ${payload.exportedAt}`);
    const s = loadClaudeBackupState();
    saveState(res.ok ? { ...s, last: Date.now(), lastSize: size, lastError: undefined } : { ...s, lastError: res.message });
    return res.ok ? { ok: true, message: `已上传（${(size / 1024).toFixed(0)}KB）` } : res;
  } catch (e: any) {
    const message = `没传成：${e?.message || e}`;
    saveState({ ...loadClaudeBackupState(), lastError: message });
    return { ok: false, message };
  }
}

let running = false;
/** 开了「每天自动」：打开 App 时距上次超过 20 小时就悄悄传一次 */
export async function maybeAutoClaudeBackup(config: CloudBackupConfig): Promise<void> {
  const s = loadClaudeBackupState();
  if (!s.auto || running || !isGithubReady(config)) return;
  if (s.last && Date.now() - s.last < AUTO_EVERY_MS) return;
  running = true;
  try { await uploadClaudeBackup(config); } finally { running = false; }
}
