/**
 * 自查：拿角色最近一轮回复，让模型对照完整人设（含世界书）挑「不像他」的地方，
 * 给出逐条问题和改写建议。用户看过、点「采用」才真正替换消息；不采用什么都不变。
 */
import { ContextBuilder } from './context';
import { DB } from './db';
import { safeFetchJson, extractContent } from './safeApi';
import { resolveDialogueApi } from './characterApi';
import { getBannedTropes } from './tropeBan';
import type { APIConfig, CharacterProfile, Message } from '../types';

export interface SelfCheckIssue { quote: string; problem: string }
export interface SelfCheckResult {
  ok: boolean;
  issues: SelfCheckIssue[];
  /** 每条消息 id → 改写后的文字（只包含要改的） */
  rewrites: Record<number, string>;
}

const parseJson = (t: string): any => {
  const m = t.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('自查结果格式没对上，再试一次');
  try { return JSON.parse(m[0]); } catch { throw new Error('自查结果格式没对上，再试一次'); }
};

/** 最近一轮：末尾连续的角色文字消息 */
export const lastAssistantTurn = (messages: Message[]): Message[] => {
  const out: Message[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') break;
    if ((m.type || 'text') === 'text' && typeof m.content === 'string' && m.content.trim()) out.unshift(m);
  }
  return out;
};

export async function selfCheckReply(char: CharacterProfile, apiConfig: APIConfig, messages: Message[], focus = ''): Promise<SelfCheckResult> {
  const turn = lastAssistantTurn(messages);
  if (!turn.length) throw new Error('最近一轮没有可以检查的文字回复');
  const idx = messages.indexOf(turn[0]);
  const before = messages.slice(Math.max(0, idx - 8), idx)
    .filter(m => (m.type || 'text') === 'text' && typeof m.content === 'string')
    .map(m => `${m.role === 'user' ? '对方' : char.name}：${String(m.content).slice(0, 300)}`).join('\n');
  const reply = turn.map(m => `[#${m.id}] ${m.content}`).join('\n');
  const user = await DB.getUserProfile();
  const banned = getBannedTropes(char.id);
  const instructions = `### 【自查任务】
你现在不是在扮演 ${char.name}，而是一个熟悉这份人设的编辑。上面是 ${char.name} 的完整设定。
下面会给你最近的几句聊天，以及 ${char.name} 刚写的这一轮回复（每条带 [#编号]）。请对照设定挑问题：
- 不像他：语气、用词、称呼、态度和人设冲突，或者变成了刻板印象（比如突然变得说教、油腻、过度乖顺）
- 出戏：说了设定里他不会知道或不会做的事；跳出角色；像客服或 AI
- 重复和套路：车轱辘话、老梗${banned.length ? `（尤其是：${banned.join('、')}）` : ''}
- 和前文矛盾
${focus ? `- 对方特别在意：${focus}\n` : ''}只挑真正的问题，没有就说没有，不要为挑而挑。有问题的消息给出改写：保留原意和长度，只改有问题的地方，用他自己的语气。
只输出一个 JSON：{"ok":true/false,"issues":[{"quote":"原文里有问题的那一小段","problem":"为什么有问题，一句话"}],"rewrites":{"编号":"改写后的整条消息"}}`;
  const reqMessages = await ContextBuilder.buildCharacterRequest(
    { char, user: user as any, instructions },
    [{ role: 'user', content: `最近的聊天：\n${before || '（无）'}\n\n${char.name} 刚写的这一轮：\n${reply}` }],
  );
  const api = resolveDialogueApi(apiConfig, char);
  if (!api?.baseUrl || !api.model) throw new Error('先在设置里配好聊天 API');
  const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
    body: JSON.stringify({ model: api.model, messages: reqMessages, temperature: 0.3, max_tokens: 6000, stream: false }),
  }, 0, 0, { appName: '消息', charId: char.id, charName: char.name, purpose: '自查回复' });
  const j = parseJson(extractContent(data));
  const ids = new Set(turn.map(m => m.id));
  const rewrites: Record<number, string> = {};
  for (const [k, v] of Object.entries(j.rewrites || {})) {
    const id = Number(String(k).replace(/[^\d]/g, ''));
    if (ids.has(id) && typeof v === 'string' && v.trim()) rewrites[id] = v.trim();
  }
  const issues: SelfCheckIssue[] = Array.isArray(j.issues) ? j.issues.filter((x: any) => x && x.problem).map((x: any) => ({ quote: String(x.quote || ''), problem: String(x.problem) })) : [];
  return { ok: !!j.ok && !issues.length, issues, rewrites };
}
