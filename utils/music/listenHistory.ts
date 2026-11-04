/**
 * 最近换过的歌（带时间）：SullyOS 自己放的 + 手机 LX 经 MacroDroid 推给 MCP 的，合在一起。
 * - 本机：每次换歌记一条（不管有没有配同步地址）
 * - MCP：读「同步正在听」那个地址的 GET /update（v5.2 起有 plays，带时间）
 * - 聊天：把最近 24 小时内的前 10 首按「多久以前」注入，角色不用调工具也知道你在听什么
 */
import { loadNowPlayingSyncPrefs } from './musicPrefs';

export interface Play { music: string; player: string; at: number }

const LS_LOCAL = 'sully_listen_plays_v1';
const LS_CACHE = 'sully_listen_plays_mcp_cache_v1';
const LS_INJECT = 'sully_listen_plays_inject_v1';
export const PLAYS_CHANGED_EVENT = 'sully:listen-plays-changed';
const DAY = 24 * 3600 * 1000;

const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const isPlaysInjectOn = () => read<boolean>(LS_INJECT, true);
export const setPlaysInjectOn = (on: boolean) => write(LS_INJECT, on);

export function recordLocalPlay(music: string, player = 'SullyOS') {
  const list = read<Play[]>(LS_LOCAL, []);
  if (list[0]?.music === music && Date.now() - list[0].at < 10 * 60 * 1000) return;
  write(LS_LOCAL, [{ music, player, at: Date.now() }, ...list].slice(0, 30));
  try { window.dispatchEvent(new Event(PLAYS_CHANGED_EVENT)); } catch {}
}

let memo: { at: number; plays: Play[] } | null = null;

/** 读 MCP 那边的记录；60 秒内复用，2.5 秒拿不到就用上次缓存 */
export async function fetchMcpPlays(force = false): Promise<Play[]> {
  const { url, token } = loadNowPlayingSyncPrefs();
  if (!url.trim()) return [];
  if (!force && memo && Date.now() - memo.at < 60_000) return memo.plays;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(url.trim(), { headers: token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}, signal: ctl.signal });
    clearTimeout(timer);
    const j = await res.json();
    const plays: Play[] = (j?.current_data?.plays || []).filter((p: any) => p && p.music && p.at);
    memo = { at: Date.now(), plays };
    write(LS_CACHE, plays);
    return plays;
  } catch {
    return read<Play[]>(LS_CACHE, []);
  }
}

/** 合并两边，同一首歌 5 分钟内只算一次，新→旧取前 n 首 */
export function mergePlays(a: Play[], b: Play[], n = 10): Play[] {
  const all = [...a, ...b].sort((x, y) => y.at - x.at);
  const out: Play[] = [];
  for (const p of all) {
    if (out.some(q => q.music === p.music && Math.abs(q.at - p.at) < 5 * 60 * 1000)) continue;
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

export async function getRecentPlays(force = false): Promise<Play[]> {
  return mergePlays(read<Play[]>(LS_LOCAL, []), await fetchMcpPlays(force));
}

export const agoText = (t: number, now = Date.now()) => {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
};
export const playerText = (p: string) => /sully/i.test(p) ? 'SullyOS' : /lx/i.test(p) ? '手机 LX' : (p || '手机');

export async function buildListenHistoryBlock(userName: string): Promise<string> {
  if (!isPlaysInjectOn()) return '';
  const now = Date.now();
  const plays = (await getRecentPlays()).filter(p => now - p.at < DAY);
  if (!plays.length) return '';
  const who = userName || '她';
  return [
    `### 【${who}最近换过的歌】（新→旧，来自她的播放器）`,
    ...plays.map((p, i) => `${i + 1}. ${agoText(p.at, now)}《${p.music}》（${playerText(p.player)}）`),
    `（这是${who}手机和 SullyOS 上真实的播放记录，你自然知道她最近在听什么。想聊就随口提一句、问一句，别逐条复述，也别每轮都提。）`,
  ].join('\n');
}
