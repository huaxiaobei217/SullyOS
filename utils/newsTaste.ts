/**
 * 热点按角色口味挑：每个角色一串「感兴趣的关键词」，注入热点时优先挑命中的，
 * 再留一条随机的当意外收获；框成「他自己刷手机刷到、点进去看了」，让他像随手分享一样聊。
 */
import type { NewsItem } from './realtimeWorldCore';

const KEY = 'sully_news_taste_v1';
export const DEFAULT_NOAH_TASTE = ['音乐', '唱片', '黑胶', '乐队', '专辑', '爵士', '电影', '导演', '影展', '书', '作家', '小说', '诗', '历史', '考古', '博物馆', '展览', '艺术', '伦敦', '英国', '旅行', '探险', '徒步', '航天', '天文', '宇宙'];

export const getNewsTaste = (charId: string): string[] => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}')[charId]; return Array.isArray(v) ? v : []; } catch { return []; }
};
export const setNewsTaste = (charId: string, words: string[]) => {
  try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); m[charId] = Array.from(new Set(words.map(w => w.trim()).filter(Boolean))).slice(0, 60); localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
};

/** 有口味词：命中多的优先（最多 n-1 条），再补一条随机的；没口味词就纯随机 */
export function pickNewsByTaste(pool: NewsItem[], n: number, taste: string[]): { picks: NewsItem[]; matched: number } {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  if (!taste.length) return { picks: shuffled.slice(0, n), matched: 0 };
  const scored = shuffled.map(item => {
    const text = `${item.title || ''} ${(item as any).desc || ''}`;
    return { item, score: taste.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0) };
  });
  const hits = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.item);
  const picks = hits.slice(0, Math.max(1, n - 1));
  for (const x of shuffled) { if (picks.length >= Math.min(n, hits.length + 1) || picks.length >= n) break; if (!picks.includes(x)) picks.push(x); }
  return { picks: picks.length ? picks : shuffled.slice(0, n), matched: Math.min(hits.length, picks.length) };
}

export const TASTE_FRAMING = '（上面这几条热点是你自己刷手机时刷到、点进去看了的——大多是按你的口味挑的，也有一条是顺手划到的。想聊就像真人随手分享那样说，比如「刚刷到…」「你看到没…」，带上你自己的看法和偏见；没兴趣就当没看见。不要播报新闻，不要一次说好几条。）';
