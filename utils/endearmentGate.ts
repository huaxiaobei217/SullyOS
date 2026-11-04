/**
 * 称呼频率闸：模型会照着自己最近的回复学，称呼和颜文字一旦挂得多，就会越挂越多
 * （babe / 甜心 / my love / ＾＾ 变成每句结尾的固定格式）。
 * 这里只看他最近 20 条消息：挂了称呼的超过两成，这一轮就提醒他一个都别用；没超就什么都不加。
 */
const LS = 'sully_endearment_gate_v1';
export const DEFAULT_ENDEARMENTS = ['babe', 'my love', '甜心', 'honey', 'darling', 'sweetheart', 'sweetie', '宝贝', '＾＾'];

interface GateCfg { on: boolean; words: string[]; ratio: number }
const all = (): Record<string, GateCfg> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
export const getGate = (charId: string): GateCfg => ({ on: true, words: DEFAULT_ENDEARMENTS, ratio: 0.2, ...(all()[charId] || {}) });
export const setGate = (charId: string, patch: Partial<GateCfg>) => {
  const a = all(); a[charId] = { ...getGate(charId), ...patch };
  try { localStorage.setItem(LS, JSON.stringify(a)); } catch { /* ignore */ }
};

export function endearmentStats(charId: string, texts: string[]) {
  const { words } = getGate(charId);
  const list = texts.map(t => String(t || '').trim()).filter(t => t && !t.startsWith('[') && !t.startsWith('<')).slice(-20);
  const lower = words.map(w => w.toLowerCase()).filter(Boolean);
  const has = (t: string) => lower.some(w => t.toLowerCase().includes(w));
  const ends = (t: string) => { const s = t.toLowerCase().replace(/[\s。！？!?.,，~～…]+$/u, ''); return lower.some(w => s.endsWith(w)); };
  return { n: list.length, hits: list.filter(has).length, ends: list.filter(ends).length };
}

export function buildEndearmentBlock(charId: string, recentAssistantTexts: string[]): string {
  const cfg = getGate(charId);
  if (!cfg.on || !cfg.words.length) return '';
  const { n, hits, ends } = endearmentStats(charId, recentAssistantTexts);
  if (n < 8 || hits / n <= cfg.ratio) return '';
  const shown = cfg.words.slice(0, 4).join(' / ');
  return `### 【这一轮：别用称呼和颜文字】
你最近 ${n} 条消息里有 ${hits} 条挂着 ${shown} 这类称呼或颜文字${ends ? `，${ends} 条拿它当结尾` : ''}——已经成了固定格式，听着腻，也不像你。
这一轮一个都别用，直接说事。之后几条里偶尔用一次就够：留给真正想软一下、或者损完她突然认真的时候，别放在句尾当收尾。`;
}

/**
 * 发给模型的历史里，把他句尾挂着的称呼 / 颜文字去掉（只改这次发出去的副本，聊天记录不动）。
 * 模型照着自己最近的回复学；历史里条条挂着 babe，下一轮就还会挂。只去句尾的，句中的称呼原样保留。
 */
export function stripTrailingEndearments(charId: string, text: string): string {
  const cfg = getGate(charId);
  if (!cfg.on || !cfg.words.length) return text;
  const esc = cfg.words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const tail = new RegExp(`(?:[\\s，,、~～]*(?:${esc.join('|')}|\\^\\^|＾＾))+[\\s。.!！]*$`, 'iu');
  return text.split('\n').map(line => {
    const out = line.replace(tail, '');
    return out.trim() ? out : line;
  }).join('\n');
}
