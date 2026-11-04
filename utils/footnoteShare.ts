/**
 * 「页脚」→ 聊天：把一件一起经历的小事发成一张卡片放进聊天记录。
 * 用的是聊天里现成的 HTML 卡片：界面上是一张小纸条，给模型和记忆看的是 htmlTextPreview 那句文字，
 * 所以会跟着正常的记忆整理写进长期记忆。
 */
import { DB } from './db';
import type { FootCard, QaRound, RadioPiece } from './footnote';
import { RADIO_CHANNELS, parseRadioSegments, threadOf } from './footnote';

const esc = (s: string) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const clean = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\[[^\]]{1,24}\]/g, '').trim();

const card = (tag: string, title: string, body: string, foot = '', tint = '#fffcf3') => `<div style="width:260px;box-sizing:border-box;padding:14px 14px 12px;background:${tint};border-radius:3px;box-shadow:0 2px 8px rgba(60,45,30,.12);font-family:'Noto Serif SC','Songti SC',serif;color:#2f3442;position:relative">
<div style="position:absolute;left:50%;top:-8px;width:64px;height:16px;transform:translateX(-50%) rotate(-3deg);background:rgba(222,190,140,.45)"></div>
<div style="font-size:10px;letter-spacing:.2em;color:#b9875a;margin-bottom:4px">页脚 · ${esc(tag)}</div>
<div style="font-size:14px;font-weight:600;margin-bottom:6px">${esc(title)}</div>
<div style="font-size:12.5px;line-height:1.75;white-space:pre-wrap">${body}</div>
${foot ? `<div style="font-size:10px;color:#6f6a62;margin-top:8px">${foot}</div>` : ''}
</div>`;

async function save(charId: string, role: 'user' | 'assistant', html: string, preview: string) {
  await DB.saveMessage({
    charId, role, type: 'html_card',
    content: `[HTML卡片] ${preview}`,
    metadata: { htmlSource: html, htmlTextPreview: preview, fromFootnote: true },
  } as any);
}

export async function shareNote(c: FootCard, charName: string, userName: string) {
  const who = c.author === 'user' ? userName : charName;
  const th = threadOf(c);
  const body = esc(c.note) + (th.length ? `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(0,0,0,.15);font-size:11.5px">${th.map(t => `${esc(t.by === 'user' ? userName : charName)}：${esc(t.text)}`).join('<br/>')}</div>` : '');
  const preview = `【页脚·便签墙】${who}贴了一张纸条：「${c.note}」${c.source ? `（${c.source}）` : ''}${th.length ? `；下面你来我往：${th.map(t => `${t.by === 'user' ? userName : charName}说「${t.text}」`).join('，')}` : ''}`;
  await save(c.charId, c.author === 'user' ? 'user' : 'assistant', card('便签墙', c.author === 'user' ? `${userName}贴的纸条` : `${charName}贴的纸条`, body, esc(c.source || '')), preview);
}

export async function shareRadio(p: RadioPiece, charName: string, userName: string) {
  const ch = RADIO_CHANNELS.find(x => x.id === p.channel)?.name || '电台';
  const segs = parseRadioSegments(p.text);
  const zh = segs.map(s => clean(s.zh)).join('\n');
  const excerpt = zh.length > 160 ? zh.slice(0, 160) + '…' : zh;
  const preview = `【页脚·深夜点播】${charName}给${userName}点播了一期「${ch}」《${p.title}》${p.voiceLang ? '（用外语念、配中文字幕）' : ''}。大意：${zh.slice(0, 300)}`;
  await save(p.charId, 'assistant', card(`深夜点播 · ${ch}`, p.title, esc(excerpt), `${esc(charName)} 念给 ${esc(userName)}`, '#f6f2ea'), preview);
}

export async function shareQa(r: QaRound, charName: string, userName: string) {
  const body = `<div>${esc(userName)}：${esc(r.mine)}</div><div style="margin-top:4px">${esc(charName)}：${esc(r.his)}</div>${r.reaction ? `<div style="margin-top:6px;font-style:italic;color:#6f6a62">—— ${esc(r.reaction)}</div>` : ''}`;
  const preview = `【页脚·快问快答】题目「${r.question}」：${userName}答「${r.mine}」，${charName}答「${r.his}」${r.reaction ? `，${charName}看完说「${r.reaction}」` : ''}`;
  await save(r.charId, 'assistant', card('快问快答', r.question, body), preview);
}
