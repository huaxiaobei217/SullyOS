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

/** 提醒方式：relapse = 只在他最近又说了时才提（默认，最不容易「越提越想说」）；always = 每次都提；off = 不提 */
export type TropeMode = 'relapse' | 'always' | 'off';
const MODE_KEY = 'sully_trope_ban_mode_v1';
export const getTropeMode = (): TropeMode => { try { const v = localStorage.getItem(MODE_KEY); return v === 'always' || v === 'off' ? v : 'relapse'; } catch { return 'relapse'; } };
export const setTropeMode = (m: TropeMode) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };

/**
 * 提示词里的一段。
 * 「别想大象」：反复把禁词摆在他眼前，反而可能让他更惦记。所以默认只在他最近几条回复里又冒出来时才提醒，
 * 措辞也只说「换新鲜的说法」，不强调、不加粗、不罗列例子。
 */
export function buildTropeBanBlock(charId: string, userName = '对方', recentAssistantTexts: string[] = []): string {
  const list = getBannedTropes(charId);
  const mode = getTropeMode();
  if (!list.length || mode === 'off') return '';
  let shown = list;
  if (mode === 'relapse') {
    const joined = recentAssistantTexts.join('\n');
    shown = list.filter(w => joined.includes(w));
    if (!shown.length) return '';
  }
  return `### 【换点新鲜的说法】
你最近又用了 ${shown.map(t => `「${t}」`).join('')} ——这是以前用多了的老梗，${userName}已经听过很多遍。接下来说点新鲜的，用别的方式表达同样的情绪，也别换个近义词绕回去。这只是口头习惯的事，不影响你的性格和你们的关系。`;
}

/** 在一段文字里数某个词出现几次 */
export const countHits = (text: string, word: string): number => {
  if (!text || !word) return 0;
  let n = 0, i = 0;
  while ((i = text.indexOf(word, i)) >= 0) { n++; i += word.length; }
  return n;
};


/** 让模型改写一条记忆：去掉这些梗，事实和情绪原样保留 */
export async function rewriteMemoryText(
  text: string, words: string[],
  api: { baseUrl: string; apiKey: string; model: string },
): Promise<string> {
  const { safeFetchJson, extractContent } = await import('./safeApi');
  const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
    body: JSON.stringify({
      model: api.model, temperature: 0.3, max_tokens: 4000, stream: false,
      messages: [{
        role: 'user',
        content: `下面是一条角色记忆。请改写它：把「${words.join('」「')}」这些词，以及围绕它们的那个梗/比喻去掉，换成平实的描述；发生了什么事、双方的情绪和关系、时间地点、其他细节都原样保留，不要添加新内容，长度差不多。只输出改写后的记忆正文。\n\n${text}`,
      }],
    }),
  }, 0, 0, { appName: '口癖清洗', purpose: '改写记忆' });
  const out = extractContent(data).trim();
  if (!out) throw new Error('模型没有返回内容');
  return out;
}
