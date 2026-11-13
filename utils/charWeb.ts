/**
 * 他的网上生活（个人二改，思路参考 Felly 的「后台生活」）：
 * 他会隔一阵自己上网逛一会儿——热榜、B 站、论坛、小说站……看到什么、怎么想、收藏了什么，都记下来；
 * 收藏多了会慢慢长出兴趣，聊天时他会自然提起「我今天刷到一个……」。
 * 你能在「查手机」里他的浏览器看浏览记录和收藏夹；他不想让你看的会删掉（你只能看到「删了几条」）。
 * 夜里开了「成人向」的话，他偶尔也会逛成人向的东西（只记标题和一句想法，不写露骨内容），删不删由他。
 *
 * 真实的东西（热榜）带链接；没链接的是他自己逛的（站点、标题按他的口味来，不当成真实新闻）。
 * 打开 App 时检查：开着、距上次超过 5 小时、一天最多 3 次，才逛一次（一次请求）。
 */
import type { APIConfig, CharacterProfile } from '../types';
import { callAsChar } from './footnote';
import { fetchHotNews, HOTNEWS_PLATFORM_LABELS, type NewsItem } from './realtimeWorldCore';
import { getDayState } from './charDayState';

const LS = 'sully_char_web_v1';
const LS_CFG = 'sully_char_web_cfg_v1';
export const CHAR_WEB_EVENT = 'sully:char-web-changed';

export interface WebItem { site: string; title: string; thought: string; url?: string; tags?: string[]; mature?: boolean }
export interface WebSession { id: string; at: number; summary: string; items: WebItem[]; hidden: number }
export interface WebFav extends WebItem { savedAt: number; by: 'him' | 'her'; note?: string }
interface WebState { sessions: WebSession[]; favs: WebFav[]; interests: Record<string, number> }
interface WebCfg { on: boolean; mature: boolean }

const loadAll = (): Record<string, WebState> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
export const getWeb = (charId: string): WebState => { const v: Partial<WebState> = loadAll()[charId] || {}; return { sessions: v.sessions || [], favs: v.favs || [], interests: v.interests || {} }; };
const save = (charId: string, v: WebState) => {
  try { const a = loadAll(); a[charId] = v; localStorage.setItem(LS, JSON.stringify(a)); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(CHAR_WEB_EVENT)); } catch { /* ignore */ }
};
const cfgAll = (): Record<string, WebCfg> => { try { return JSON.parse(localStorage.getItem(LS_CFG) || '{}') || {}; } catch { return {}; } };
export const getWebCfg = (charId: string): WebCfg => { const v: Partial<WebCfg> = cfgAll()[charId] || {}; return { on: v.on ?? true, mature: v.mature ?? false }; };
export const setWebCfg = (charId: string, p: Partial<WebCfg>) => { const a = cfgAll(); a[charId] = { ...getWebCfg(charId), ...p }; try { localStorage.setItem(LS_CFG, JSON.stringify(a)); } catch { /* ignore */ } };

const uid = () => `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const topInterests = (st: WebState, n = 8) => Object.entries(st.interests).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

/** 逛一次 */
export async function browseOnce(char: CharacterProfile, api: APIConfig, userName: string): Promise<WebSession> {
  const st = getWeb(char.id);
  const cfg = getWebCfg(char.id);
  let hot: NewsItem[] = [];
  try { hot = (await fetchHotNews(['bilibili', 'zhihu', 'weibo'], 8, 24)).filter(x => x.title); } catch { /* 拿不到热榜就全凭他自己逛 */ }
  const hotList = hot.slice(0, 24).map((h, i) => `[${i}] (${HOTNEWS_PLATFORM_LABELS[h.source || ''] || h.source || '热榜'}) ${h.title}`).join('\n');
  const hour = new Date().getHours();
  const night = hour >= 22 || hour < 4;
  const allowMature = cfg.mature && night && Math.random() < 0.4;
  const day = getDayState(char.id);
  const recentTitles = st.sessions.slice(0, 4).flatMap(s => s.items.map(i => i.title)).slice(0, 20);
  const { text } = await callAsChar(char, api,
    `### 【自己上网逛了会儿】
现在是 ${hour} 点，你一个人拿着手机 / 电脑随便逛了一会儿（不是为了${userName}，是你自己的消遣）。
${hotList ? `今天各平台热榜上有这些（真实的，可以点进去看）：\n${hotList}\n` : ''}${topInterests(st).length ? `你最近感兴趣的：${topInterests(st).join('、')}\n` : ''}${day.threads.length && Math.random() < 0.3 ? `你这阵子在跟进：${day.threads.map(t => `${t.kind}《${t.title}》`).join('、')}（最多一条跟这些有关）\n` : ''}${recentTitles.length ? `最近看过的（别重复）：${recentTitles.join(' / ')}\n` : ''}
写下这一趟逛了什么，4～7 条，按你的口味，但别全是同一个圈子（几条你常逛的，再有一两条是随手刷到的、平时不怎么看的）：可以点热榜（写 ref 编号），也可以逛你自己常去的地方（B 站某类视频、论坛帖子、小说站、播客、维基……这类不写 ref，标题按你会点开的样子写，别冒充真实新闻）。
- thought：你看完的一句真实想法（吐槽、被戳到、想转给${userName}、看不下去关掉……），20～50 字，你的语气。
- fav：真喜欢才收藏，一趟最多 2 条；tags：给这条打 1～3 个兴趣标签（比如 黑胶、冷知识、悬疑、英超）。
${allowMature ? `- 现在是深夜，你一个人，可以逛到成人向的东西（成人小说、R18 同人、成人向的帖子等），这类标 mature:true；只写标题和一句想法，不写露骨内容。\n` : ''}- hide：不想让${userName}在你手机上看到的就 hide:true（会从浏览记录里删掉）。${allowMature ? '成人向的删不删你自己决定。' : ''}
- summary：这一趟用一句话总结（你自己的口气，像跟自己说）。
只输出 JSON：{"summary":"…","items":[{"site":"…","title":"…","ref":编号或null,"thought":"…","fav":false,"hide":false,"tags":["…"]${allowMature ? ',"mature":false' : ''}}]}`,
    '逛吧。', '他的网上生活', 2200);
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('格式没对上');
  const j = JSON.parse(m[0]);
  const raw: any[] = Array.isArray(j.items) ? j.items.slice(0, 8) : [];
  const kept: WebItem[] = []; let hidden = 0;
  const favs: WebFav[] = [];
  for (const x of raw) {
    const ref = Number.isInteger(x?.ref) ? hot[x.ref] : undefined;
    const item: WebItem = {
      site: String(ref ? (HOTNEWS_PLATFORM_LABELS[ref.source || ''] || ref.source || x.site) : x.site || '网上').slice(0, 12),
      title: String(ref ? ref.title : x.title || '').slice(0, 80),
      thought: String(x.thought || '').slice(0, 120),
      ...(ref?.url ? { url: ref.url } : {}),
      ...(Array.isArray(x.tags) ? { tags: x.tags.map((t: unknown) => String(t).slice(0, 8)).slice(0, 3) } : {}),
      ...(x.mature && allowMature ? { mature: true } : {}),
    };
    if (!item.title) continue;
    if (x.hide) { hidden++; continue; }
    kept.push(item);
    if (x.fav && favs.length < 2) favs.push({ ...item, savedAt: Date.now(), by: 'him' });
  }
  // 兴趣：收藏的标签权重高，看过的低；慢慢衰减
  const interests: Record<string, number> = {};
  for (const [k, v] of Object.entries(st.interests)) if (v * 0.95 > 0.3) interests[k] = v * 0.95;
  for (const it of kept) for (const t of it.tags || []) interests[t] = (interests[t] || 0) + 1;
  for (const f of favs) for (const t of f.tags || []) interests[t] = (interests[t] || 0) + 2;
  const session: WebSession = { id: uid(), at: Date.now(), summary: String(j.summary || '').slice(0, 80), items: kept, hidden };
  save(char.id, { sessions: [session, ...st.sessions].slice(0, 40), favs: [...favs, ...st.favs].slice(0, 120), interests });
  return session;
}

const running = new Set<string>();
/** 打开 App 时看看要不要逛一次（白天到深夜 9:00–次日 2:00，距上次 >5 小时，一天最多 3 次） */
export async function maybeBrowse(char: CharacterProfile, api: APIConfig, userName: string): Promise<void> {
  if (!getWebCfg(char.id).on || running.has(char.id) || !api?.baseUrl) return;
  const h = new Date().getHours(); if (h >= 2 && h < 9) return;
  const st = getWeb(char.id);
  const last = st.sessions[0]?.at || 0;
  if (Date.now() - last < 5 * 3600 * 1000) return;
  const today = new Date().toDateString();
  if (st.sessions.filter(s => new Date(s.at).toDateString() === today).length >= 3) return;
  running.add(char.id);
  try { await browseOnce(char, api, userName); } catch { /* 下次再逛 */ } finally { running.delete(char.id); }
}

/** 她往他收藏夹里塞东西 / 删收藏 */
export function addHerFav(charId: string, item: { title: string; url?: string; note?: string }) {
  const st = getWeb(charId);
  save(charId, { ...st, favs: [{ site: '她分享的', title: item.title.slice(0, 80), thought: '', url: item.url, note: item.note?.slice(0, 120), savedAt: Date.now(), by: 'her' }, ...st.favs] });
}
export function removeFav(charId: string, savedAt: number) {
  const st = getWeb(charId); save(charId, { ...st, favs: st.favs.filter(f => f.savedAt !== savedAt) });
}

/** 聊天用：今天逛了什么、最近收藏、兴趣（只给他自己知道的，不让他汇报） */
export function buildCharWebBlock(charId: string, userName: string): string {
  if (!getWebCfg(charId).on) return '';
  const st = getWeb(charId);
  const recent = st.sessions.filter(s => Date.now() - s.at < 10 * 3600 * 1000).slice(0, 2);
  const herFavs = st.favs.filter(f => f.by === 'her' && Date.now() - f.savedAt < 3 * 86400000).slice(0, 2);
  if (!recent.length && !herFavs.length) return '';
  const lines: string[] = [];
  for (const s of recent) lines.push(`- ${new Date(s.at).getHours()} 点那会儿：${s.summary || '随便逛了逛'}。看了 ${s.items.slice(0, 4).map(i => `「${i.title}」（${i.thought.slice(0, 24)}）`).join('、')}${s.hidden ? `；还有 ${s.hidden} 条你删了记录` : ''}`);
  const tops = topInterests(st, 5);
  return `### 你最近在网上看到的（你自己的消遣）
${lines.join('\n')}${herFavs.length ? `\n${userName}往你收藏夹里塞了：${herFavs.map(f => `「${f.title}」${f.note ? `（她说：${f.note}）` : ''}`).join('、')}——你看过了，可以聊。` : ''}${tops.length ? `\n你这阵子的兴趣：${tops.join('、')}` : ''}
聊到相关的可以随口提「我今天刷到一个……」，别汇报浏览记录，删了的别主动提。`;
}
