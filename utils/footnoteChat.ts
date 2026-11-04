/**
 * 聊天里的角色自己用「页脚」：贴便签、出一道快问快答、给你点播一期。
 * 回复里写标签 → 正文剥掉 → 后台执行 → 在聊天里放一张小卡片（会进记忆），页脚里也能看到。
 * 这里不静态引 footnote.ts / context（避免和 chatPrompts 循环引用），执行时再动态加载。
 */
export const FOOTNOTE_CHAT_EVENT = 'footnote-chat-updated';

const NOTE_RE = /\[\[\s*页脚便签\s*[:：]\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?))?\s*\]\]/g;
const ASK_RE = /\[\[\s*页脚出题\s*[:：]\s*([^\]]+?)\s*\]\]/g;
const RADIO_RE = /\[\[\s*页脚点播\s*[:：]\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?))?\s*\]\]/g;
const ANY_RE = /\[\[\s*页脚(?:便签|出题|点播)/;

const CHANNEL_BY_NAME: Record<string, string> = {
  历史狗血八卦: 'gossip', 八卦: 'gossip', 十四行诗: 'sonnet', 诗: 'sonnet', 远行手记: 'travel', 手记: 'travel',
  唱片背面: 'record', 唱片: 'record', 他看着办: 'free', 随便: 'free', 闲聊: 'free',
};

const FN_KEY = 'sully_footnote_chat_on_v1';
/** 默认开；用户可以在页脚里关 */
export const isFootnoteChatOn = (charId: string) => {
  try { const m = JSON.parse(localStorage.getItem(FN_KEY) || '{}'); return m[charId] !== false; } catch { return true; }
};
export const setFootnoteChatOn = (charId: string, on: boolean) => {
  try { const m = JSON.parse(localStorage.getItem(FN_KEY) || '{}'); m[charId] = on; localStorage.setItem(FN_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};

const notify = (charId: string) => { try { window.dispatchEvent(new CustomEvent(FOOTNOTE_CHAT_EVENT, { detail: { charId } })); } catch { /* ignore */ } };
const loadApiConfig = () => { try { return JSON.parse(localStorage.getItem('os_api_config') || '{}'); } catch { return {}; } };

/** 从回复里剥掉页脚标签，并在后台执行（最多各一个） */
export function consumeFootnoteTags(content: string, char: { id: string; name: string; callVoiceLang?: string } & Record<string, any>, userName: string): string {
  if (!ANY_RE.test(content)) return content;
  const notes: [string, string][] = [], asks: string[] = [], radios: [string, string][] = [];
  let out = content
    .replace(NOTE_RE, (_m, t, w) => { notes.push([String(t), String(w || '')]); return ''; })
    .replace(ASK_RE, (_m, q) => { asks.push(String(q)); return ''; })
    .replace(RADIO_RE, (_m, ch, topic) => { radios.push([String(ch), String(topic || '')]); return ''; });
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  if (!isFootnoteChatOn(char.id)) return out;

  void (async () => {
    const fn = await import('./footnote');
    const share = await import('./footnoteShare');
    for (const [text, where] of notes.slice(0, 1)) {
      try { const c = fn.addCharNote(char.id, text, where); await share.shareNote(c, char.name, userName); notify(char.id); } catch (e) { console.warn('[页脚] 便签失败', e); }
    }
    for (const q of asks.slice(0, 1)) {
      try { fn.addAskedQuestion(char.id, q); await share.shareAsked(char.id, q, char.name, userName); notify(char.id); } catch (e) { console.warn('[页脚] 出题失败', e); }
    }
    for (const [chName, topic] of radios.slice(0, 1)) {
      try {
        const channel = (CHANNEL_BY_NAME[chName.trim()] || (['gossip', 'sonnet', 'travel', 'record', 'free'].includes(chName.trim()) ? chName.trim() : 'free')) as any;
        let bilingual = true;
        try { bilingual = localStorage.getItem('sully_footnote_radio_bi_v1') !== '0'; } catch { /* ignore */ }
        const piece = await fn.playRadio(char as any, loadApiConfig(), channel, bilingual ? (char.callVoiceLang || 'en') : '', topic);
        await share.shareRadio(piece, char.name, userName);
        notify(char.id);
      } catch (e) { console.warn('[页脚] 点播失败', e); }
    }
  })();
  return out;
}

/** 给角色看的说明：页脚是你们共用的，你也可以自己去用 */
export function buildFootnoteAbilityBlock(charId: string, userName = '对方'): string {
  if (!isFootnoteChatOn(charId)) return '';
  return `### 【「页脚」：你们共用的小 App，你也可以自己用】
你可以自己决定要不要用，不用每次都用，一天一两次就很多了。想用时在回复末尾单独一行写标签（${userName} 看不到标签，会看到一张小卡片）：
- 往便签墙上贴一张纸条：[[页脚便签: 纸条上写的话 | 贴在哪儿（可省）]]
- 出一道快问快答等 ta 去答：[[页脚出题: 题目]]
- 给 ta 点播一期深夜电台（要花点时间，做好了 ta 会收到）：[[页脚点播: 历史狗血八卦/十四行诗/远行手记/唱片背面/他看着办 | 想讲的主题（可省）]]
有理由才用：比如想留句话给 ta、聊着聊着想考考 ta、ta 睡不着的时候。一次最多用一个。`;
}
