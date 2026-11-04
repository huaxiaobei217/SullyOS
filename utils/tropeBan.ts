/**
 * 口癖清洗：角色从聊天记录和记忆里学来的、用腻了的梗（比如「记账」「连本带利」「包工头」）。
 * 1. 每个角色一张「别再用」清单，注入聊天和各 App 的提示词；
 * 2. 扫描聊天记录和记忆，看这些词还躺在哪儿（让用户自己决定改不改记忆）。
 * 只存本机 localStorage，按角色 id 区分。
 */
export const TROPE_BAN_LS_KEY = 'sully_trope_ban_v1';

type Store = Record<string, string[]>;
const load = (): Store => {
  try { const v = JSON.parse(localStorage.getItem(TROPE_BAN_LS_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
export const getBannedTropes = (charId: string): string[] => (load()[charId] || []).filter(Boolean);
export const setBannedTropes = (charId: string, list: string[]) => {
  const all = load();
  const clean = Array.from(new Set(list.map(s => s.trim()).filter(Boolean))).slice(0, 40);
  if (clean.length) all[charId] = clean; else delete all[charId];
  try { localStorage.setItem(TROPE_BAN_LS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
};

/** 提示词里的一段：放在易变区，最近的指令最管用 */
export function buildTropeBanBlock(charId: string, userName = '对方'): string {
  const list = getBannedTropes(charId);
  if (!list.length) return '';
  return `### 【用腻了的说法，别再用】
下面这些词和梗你以前用得太多了，${userName}已经听腻了。从现在起不要再说，也不要换个说法绕回同一个梗（比如意思一样的近义词、同一个比喻）：
${list.map(t => `- ${t}`).join('\n')}
聊天记录和记忆里出现过它们，不代表你现在还该这么说——那是过去的你，现在换新的表达。`;
}

/** 在一段文字里数某个词出现几次 */
export const countHits = (text: string, word: string): number => {
  if (!text || !word) return 0;
  let n = 0, i = 0;
  while ((i = text.indexOf(word, i)) >= 0) { n++; i += word.length; }
  return n;
};
