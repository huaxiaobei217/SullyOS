/**
 * 书影架 · 一起看书（个人二改，参考 MoRead 的伴读思路）
 * - 书：导入 TXT / EPUB，切成章和段落；正文存 IndexedDB assets（shelf_book_<id>），目录和进度存 localStorage
 * - 批注：他只批注你已经读到的章节（不剧透），在原文上画线 + 写一两句；批注中文显示，另带一句他的语音语言版本用来念
 * - 伴读：你对着一段吐槽 / 提问，他回你；同样中文显示、可以用他的声音念外语版
 * - 聊天：最近一起读的书、读到哪、他的几条批注，带进 Message，他记得你们在读什么
 */
import JSZip from 'jszip';
import type { CharacterProfile, APIConfig } from '../types';
import { DB } from './db';
import { callAsChar } from './footnote';
import { voiceLanguageLabel } from './voiceLanguage';

export interface ShelfChapter { title: string; paras: string[] }
export interface ShelfBook {
  id: string;
  title: string;
  author: string;
  format: 'txt' | 'epub';
  chapterTitles: string[];
  chapterSizes: number[];
  pos: { ch: number; para: number };
  readTo: number[];          // 每章读到的最远段落（-1 = 没读）
  addedAt: number;
  lastReadAt: number;
  cover: string;             // 渐变色
  annotatedChapters: number[];
}
export interface ShelfNote {
  id: string;
  bookId: string;
  charId: string;
  ch: number;
  para: number;
  quote: string;             // 原文里被画线的那一小段（空 = 整段）
  zh: string;
  voice: string;             // 用他的语音语言写的同一句，念出来用
  at: number;
}
export interface ShelfChat { id: string; bookId: string; charId: string; role: 'me' | 'him'; text: string; voice?: string; quote?: string; ch: number; at: number }

interface Store { books: ShelfBook[]; notes: ShelfNote[]; chat: ShelfChat[]; autoNote: boolean }

const LS = 'sully_shelf_v1';
export const SHELF_EVENT = 'sully:shelf-changed';
const bookKey = (id: string) => `shelf_book_${id}`;

export const loadShelf = (): Store => {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || 'null');
    if (s && Array.isArray(s.books)) return { books: s.books, notes: s.notes || [], chat: s.chat || [], autoNote: s.autoNote !== false };
  } catch { /* ignore */ }
  return { books: [], notes: [], chat: [], autoNote: true };
};
export const saveShelf = (s: Store) => {
  const trimmed = { ...s, notes: s.notes.slice(0, 3000), chat: s.chat.slice(-3000) };
  try { localStorage.setItem(LS, JSON.stringify(trimmed)); } catch { /* 满了就算了 */ }
  try { window.dispatchEvent(new Event(SHELF_EVENT)); } catch { /* ignore */ }
};
export const updateShelf = (fn: (s: Store) => Store) => saveShelf(fn(loadShelf()));
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const COVERS = [
  'linear-gradient(135deg,#3b2f2a,#7a5c45)', 'linear-gradient(135deg,#1f2d3a,#4b6a7e)', 'linear-gradient(135deg,#2e3b2c,#6b7f55)',
  'linear-gradient(135deg,#3a2433,#8a5468)', 'linear-gradient(135deg,#2b2b3d,#5c5c86)', 'linear-gradient(135deg,#40321f,#a17e4a)',
];

/* ───────── 导入 ───────── */

const decodeText = (buf: ArrayBuffer): string => {
  let t = new TextDecoder('utf-8').decode(buf);
  if ((t.match(/�/g) || []).length > 20) {
    try { t = new TextDecoder('gb18030').decode(buf); } catch { /* 浏览器不支持就用 utf-8 的结果 */ }
  }
  return t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
};

const CH_RE = /^\s*(第[零〇一二三四五六七八九十百千万两0-9]+[章节回卷集部篇幕].{0,40}|chapter\s+[0-9ivxlc]+\b.{0,40}|序章.{0,20}|序言|序|楔子.{0,20}|引子|前言|尾声.{0,20}|后记|番外.{0,30})\s*$/i;

export function splitTxt(text: string): ShelfChapter[] {
  const chapters: ShelfChapter[] = [];
  let cur: ShelfChapter = { title: '开篇', paras: [] };
  for (const raw of text.split('\n')) {
    const t = raw.replace(/^[\s　]+|[\s　]+$/g, '');
    if (!t) continue;
    if (t.length <= 50 && CH_RE.test(t)) {
      if (cur.paras.length) chapters.push(cur);
      cur = { title: t, paras: [] };
    } else cur.paras.push(t);
  }
  if (cur.paras.length) chapters.push(cur);
  // 没认出章节：每 6000 字左右切一节
  if (chapters.length <= 1 && (chapters[0]?.paras.length || 0) > 80) {
    const all = chapters[0].paras;
    const out: ShelfChapter[] = [];
    let buf: string[] = []; let len = 0;
    for (const p of all) {
      buf.push(p); len += p.length;
      if (len > 6000) { out.push({ title: `第 ${out.length + 1} 部分`, paras: buf }); buf = []; len = 0; }
    }
    if (buf.length) out.push({ title: `第 ${out.length + 1} 部分`, paras: buf });
    return out;
  }
  return chapters;
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const joinPath = (base: string, href: string) => {
  const parts = (base + decodeURIComponent(href.split('#')[0])).split('/');
  const out: string[] = [];
  for (const x of parts) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }
  return out.join('/');
};

export async function parseEpub(buf: ArrayBuffer): Promise<{ title: string; author: string; chapters: ShelfChapter[] }> {
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('这个 EPUB 读不出目录');
  const opfText = await zip.file(opfPath)?.async('string');
  if (!opfText) throw new Error('这个 EPUB 读不出目录');
  const opf = new DOMParser().parseFromString(opfText, 'application/xml');
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || '';
  const author = opf.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || '';
  const manifest = new Map<string, string>();
  for (const it of Array.from(opf.getElementsByTagName('item'))) manifest.set(it.getAttribute('id') || '', it.getAttribute('href') || '');
  const base = dirOf(opfPath);
  const chapters: ShelfChapter[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const href = manifest.get(ref.getAttribute('idref') || '');
    if (!href) continue;
    const html = await zip.file(joinPath(base, href))?.async('string');
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim();
    const nodes = Array.from(doc.body?.querySelectorAll('p,h1,h2,h3,h4,li,blockquote') || []);
    let paras = nodes.filter(n => !n.querySelector('p')).map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!paras.length) paras = (doc.body?.textContent || '').split(/\n+/).map(t => t.trim()).filter(Boolean);
    if (heading && paras[0] === heading) paras = paras.slice(1);
    if (!paras.length) continue;
    chapters.push({ title: heading || doc.title?.trim() || `第 ${chapters.length + 1} 节`, paras });
  }
  if (!chapters.length) throw new Error('这个 EPUB 里没读到正文');
  return { title, author, chapters };
}

export async function importBook(file: File): Promise<ShelfBook> {
  const buf = await file.arrayBuffer();
  const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
  const baseName = file.name.replace(/\.(txt|epub)$/i, '');
  let title = baseName; let author = ''; let chapters: ShelfChapter[];
  if (isEpub) {
    const r = await parseEpub(buf);
    title = r.title || baseName; author = r.author; chapters = r.chapters;
  } else {
    chapters = splitTxt(decodeText(buf));
    const m = baseName.match(/^《?(.+?)》?(?:\s*(?:作者[:：]?|by)\s*(.+))?$/i);
    if (m) { title = m[1].trim(); author = (m[2] || '').trim(); }
  }
  if (!chapters.length) throw new Error('没读到正文');
  const id = uid('book');
  await DB.saveAssetRaw(bookKey(id), { chapters });
  const book: ShelfBook = {
    id, title, author, format: isEpub ? 'epub' : 'txt',
    chapterTitles: chapters.map(c => c.title), chapterSizes: chapters.map(c => c.paras.length),
    pos: { ch: 0, para: 0 }, readTo: chapters.map(() => -1),
    addedAt: Date.now(), lastReadAt: Date.now(), cover: COVERS[Math.floor(Math.random() * COVERS.length)], annotatedChapters: [],
  };
  updateShelf(s => ({ ...s, books: [book, ...s.books] }));
  return book;
}

const chapterCache = new Map<string, ShelfChapter[]>();
export async function loadChapters(bookId: string): Promise<ShelfChapter[]> {
  if (chapterCache.has(bookId)) return chapterCache.get(bookId)!;
  const raw = await DB.getAssetRaw(bookKey(bookId));
  const chapters: ShelfChapter[] = raw?.chapters || raw?.data?.chapters || [];
  chapterCache.set(bookId, chapters);
  return chapters;
}

export async function deleteBook(bookId: string) {
  chapterCache.delete(bookId);
  try { await DB.deleteAsset(bookKey(bookId)); } catch { /* ignore */ }
  updateShelf(s => ({ ...s, books: s.books.filter(b => b.id !== bookId), notes: s.notes.filter(n => n.bookId !== bookId), chat: s.chat.filter(c => c.bookId !== bookId) }));
}

export function savePosition(bookId: string, ch: number, para: number) {
  updateShelf(s => ({
    ...s,
    books: s.books.map(b => {
      if (b.id !== bookId) return b;
      const readTo = [...b.readTo];
      readTo[ch] = Math.max(readTo[ch] ?? -1, para);
      return { ...b, pos: { ch, para }, readTo, lastReadAt: Date.now() };
    }),
  }));
}

/* ───────── 他批注 / 伴读 ───────── */

const ROLE = (userName: string, book: ShelfBook) =>
  `你在和 ${userName} 一起读《${book.title}》${book.author ? `（${book.author}）` : ''}。你们是并肩读同一本书的人，你读到的地方和她一样多，不知道后面的情节——绝对不要剧透，也不要假装知道后面。用你自己的说话方式，不要变成书评人或老师。`;

const langNote = (lang: string) => `${voiceLanguageLabel(lang)}`;

/** 读完一章（或读到某处）后，让他在这章里画几处线、写批注 */
export async function annotateChapter(char: CharacterProfile, api: APIConfig, userName: string, book: ShelfBook, ch: number, upTo?: number): Promise<ShelfNote[]> {
  const chapters = await loadChapters(book.id);
  const chapter = chapters[ch];
  if (!chapter) throw new Error('这章没找到');
  const last = Math.min(chapter.paras.length - 1, upTo ?? chapter.paras.length - 1);
  let text = ''; const shown: number[] = [];
  for (let i = 0; i <= last; i++) {
    const line = `[${i}] ${chapter.paras[i]}\n`;
    if (text.length + line.length > 9000) break;
    text += line; shown.push(i);
  }
  const lang = char.callVoiceLang || 'en';
  const { text: out } = await callAsChar(char, api,
    `${ROLE(userName, book)}
- 你们刚读完「${chapter.title}」${upTo !== undefined && upTo < chapter.paras.length - 1 ? '的前半部分' : ''}。像在书页边上用铅笔画线、写批注那样，挑 3～6 处你真有感觉的地方：被打动的、想吐槽的、想到你们自己的、觉得写得妙的。
- 每条批注 1～2 句，口语，像写在页边给她看的。不要概括剧情，不要用括号写动作。
- 每条另写一个「${langNote(lang)}」版本（意思一样，自然口语，你会用这门语言念给她听）。
- 只输出 JSON 数组：[{"p":段落编号,"quote":"从该段原样摘下的一小段（8～40 字，必须一字不差）","zh":"中文批注","voice":"${langNote(lang)}版本"}]`,
    `「${chapter.title}」正文（方括号里是段落编号）：\n${text}`, '书影架·批注', 2500);
  const m = out.replace(/```(?:json)?/gi, '').match(/\[[\s\S]*\]/);
  let arr: any[] = [];
  try { arr = JSON.parse(m ? m[0] : '[]'); } catch { throw new Error('他写的批注格式没对上，再试一次'); }
  const notes: ShelfNote[] = arr.filter(x => x && typeof x.zh === 'string').map(x => {
    let p = Number(x.p);
    let quote = String(x.quote || '').trim();
    if (!shown.includes(p)) p = shown.find(i => quote && chapter.paras[i].includes(quote)) ?? shown[shown.length - 1];
    if (quote && !chapter.paras[p]?.includes(quote)) {
      const hit = shown.find(i => chapter.paras[i].includes(quote));
      if (hit !== undefined) p = hit; else quote = '';
    }
    return { id: uid('sn'), bookId: book.id, charId: char.id, ch, para: p, quote, zh: x.zh.trim(), voice: String(x.voice || '').trim(), at: Date.now() };
  });
  updateShelf(s => ({
    ...s,
    notes: [...notes, ...s.notes],
    books: s.books.map(b => b.id === book.id ? { ...b, annotatedChapters: [...new Set([...(b.annotatedChapters || []), ch])] } : b),
  }));
  return notes;
}

/** 解析「中文回复 + [VOICE] 外语版」 */
const splitVoice = (t: string) => {
  const m = t.split(/\n?\s*\[VOICE\]\s*\n?/i);
  return { zh: m[0].trim(), voice: (m[1] || '').trim() };
};

/** 伴读：你对着某段（或随口）说一句，他回 */
export async function chatAboutBook(char: CharacterProfile, api: APIConfig, userName: string, book: ShelfBook, ch: number, para: number, said: string, quote?: string): Promise<ShelfChat> {
  const chapters = await loadChapters(book.id);
  const chapter = chapters[ch];
  const from = Math.max(0, para - 12);
  const context = (chapter?.paras.slice(from, para + 1) || []).join('\n').slice(-2500);
  const store = loadShelf();
  const history = store.chat.filter(c => c.bookId === book.id && c.charId === char.id).slice(-10)
    .map(c => `${c.role === 'me' ? userName : '你'}：${c.text}`).join('\n');
  const myNotes = store.notes.filter(n => n.bookId === book.id && n.charId === char.id && n.ch === ch).slice(0, 6)
    .map(n => `「${n.quote || '（整段）'}」——${n.zh}`).join('\n');
  const lang = char.callVoiceLang || 'en';
  const { text } = await callAsChar(char, api,
    `${ROLE(userName, book)}
- 她现在读到「${chapter?.title || ''}」。她在跟你吐槽 / 讨论，你接着她的话聊，1～4 句，像并排坐着看书时小声说话。可以接梗、反驳、讲你的感受，别总结剧情，别说教，不要用括号写动作。
- 先写中文回复；然后另起一行写 [VOICE]，再写同一段话的${langNote(lang)}版本（你会用这门语言念给她听）。`,
    `${myNotes ? `你在这章页边写过的批注：\n${myNotes}\n\n` : ''}她刚读到的地方：\n${context}\n\n${quote ? `她指着这一句：「${quote}」\n` : ''}${history ? `\n你们刚才的对话：\n${history}\n` : ''}\n${userName}：${said}`,
    '书影架·伴读', 1200);
  const { zh, voice } = splitVoice(text);
  const mine: ShelfChat = { id: uid('sc'), bookId: book.id, charId: char.id, role: 'me', text: said, quote, ch, at: Date.now() };
  const his: ShelfChat = { id: uid('sc'), bookId: book.id, charId: char.id, role: 'him', text: zh, voice, ch, at: Date.now() + 1 };
  updateShelf(s => ({ ...s, chat: [...s.chat, mine, his] }));
  return his;
}

export const toggleAutoNote = (on: boolean) => updateShelf(s => ({ ...s, autoNote: on }));

/* ───────── 聊天里记得你们在读什么 ───────── */

export function buildShelfBlock(charId: string, userName: string): string {
  const s = loadShelf();
  const now = Date.now();
  const recent = s.books.filter(b => now - b.lastReadAt < 3 * 24 * 3600 * 1000).sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, 2);
  if (!recent.length) return '';
  const who = userName || '她';
  const lines = [`### 【你和${who}最近一起读的书（书影架）】`];
  for (const b of recent) {
    const chTitle = b.chapterTitles[b.pos.ch] || '';
    const done = b.readTo.filter((r, i) => r >= (b.chapterSizes[i] || 1) - 1).length;
    lines.push(`- 《${b.title}》${b.author ? `（${b.author}）` : ''}：读到「${chTitle}」（${done}/${b.chapterTitles.length} 章读完）`);
    const notes = s.notes.filter(n => n.bookId === b.id && n.charId === charId).slice(0, 3);
    for (const n of notes) lines.push(`  · 你在页边写过：「${(n.quote || '').slice(0, 30)}」——${n.zh.slice(0, 60)}`);
    const talk = s.chat.filter(c => c.bookId === b.id && c.charId === charId).slice(-2);
    for (const c of talk) lines.push(`  · ${c.role === 'me' ? who : '你'}说：${c.text.slice(0, 60)}`);
  }
  lines.push('（你只读到她读到的地方，别剧透后面。想聊就自然提起，不必每轮都说。）');
  return lines.join('\n');
}
