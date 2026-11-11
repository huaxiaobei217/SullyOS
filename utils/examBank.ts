/**
 * 考公陪练 · 题库（个人二改）
 *  1. LogiQA：研究用数据集，8678 道国考逻辑判断题（github.com/lgw863/LogiQA-dataset，题目来自国考），只做个人练习用。
 *     第一次用时下载一次（约 5MB），存进本机 Cache Storage；刷题本身不花 token，点「讲这道」才问一次模型。
 *  2. PDF 导入：自己的习题集 / 真题 PDF。在手机上直接解析文字、按题号切题、从答案页对答案，不花 token；
 *     每道题记下页码和上下位置，做题时把那一块截出来显示（图推、资料分析的图表都能看到）。扫描版 PDF 没有文字层，切不出题。
 */
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.js?url';
import type { ExamModule } from './examCards';
import { putImageBlob, getBlobForRef } from './blobRef';

const CACHE = 'sully-exam-bank-v1';
const LS_BANKS = 'sully_exam_banks_v1', LS_DONE = 'sully_exam_bank_done_v1';
export const BANK_EVENT = 'sully:exam-bank-changed';
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } try { window.dispatchEvent(new Event(BANK_EVENT)); } catch { /* ignore */ } };

export interface BankQ {
  id: string; bank: string; no?: number; stem: string; options: string[]; answer?: string; type?: string; module: ExamModule;
  /** PDF 题：在第几页、从哪到哪（PDF 坐标，y 从下往上） */ page?: number; y0?: number; y1?: number; pageTo?: number;
}
export interface BankMeta { id: string; name: string; kind: 'logiqa' | 'pdf'; count: number; withAnswer: number; at: number; pdf?: string; module?: ExamModule }
export const getBanks = (): BankMeta[] => read<BankMeta[]>(LS_BANKS, []);
const saveBanks = (b: BankMeta[]) => write(LS_BANKS, b);
export const getDone = (): Record<string, string> => read<Record<string, string>>(LS_DONE, {});
export function markDone(id: string, picked: string) { const d = getDone(); d[id] = picked; write(LS_DONE, d); }

async function cachePut(key: string, data: unknown) { const c = await caches.open(CACHE); await c.put(new Request(`/__exam-bank/${key}.json`), new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })); }
async function cacheGet<T>(key: string): Promise<T | null> { try { const c = await caches.open(CACHE); const r = await c.match(new Request(`/__exam-bank/${key}.json`)); return r ? await r.json() as T : null; } catch { return null; } }
const memo = new Map<string, BankQ[]>();
export async function loadBank(id: string): Promise<BankQ[]> {
  if (memo.has(id)) return memo.get(id)!;
  const qs = (await cacheGet<BankQ[]>(id)) || []; memo.set(id, qs); return qs;
}
export async function deleteBank(id: string) {
  try { const c = await caches.open(CACHE); await c.delete(new Request(`/__exam-bank/${id}.json`)); } catch { /* ignore */ }
  memo.delete(id); saveBanks(getBanks().filter(b => b.id !== id));
}

/* ───────── LogiQA ───────── */
const LOGIQA_FILES = ['zh_train', 'zh_eval', 'zh_test'];
const LOGIQA_URLS = (f: string) => [`https://cdn.jsdelivr.net/gh/lgw863/LogiQA-dataset@master/${f}.txt`, `https://raw.githubusercontent.com/lgw863/LogiQA-dataset/master/${f}.txt`];
export function logiqaType(q: string): { type: string; module: ExamModule } {
  if (/根据上述定义|上述定义/.test(q)) return { type: '定义判断', module: 'pd' };
  if (/意在|旨在|主旨|主要(说明|介绍|讲|论述|强调)|标题|概括|复述|主要意思|作者.*(观点|态度)/.test(q)) return { type: '主旨意图', module: 'yy' };
  if (/说法(正确|错误|不正确)|与原文|理解(准确|正确|不正确|错误)|不符合文意|符合文意/.test(q)) return { type: '细节判断', module: 'yy' };
  if (/削弱|质疑|反驳|动摇/.test(q)) return { type: '削弱论证', module: 'pd' };
  if (/加强|支持|证明/.test(q)) return { type: '加强论证', module: 'pd' };
  if (/假设|前提|保证/.test(q)) return { type: '前提假设', module: 'pd' };
  if (/解释|矛盾|差异/.test(q)) return { type: '原因解释', module: 'pd' };
  if (/真|假/.test(q) && /只有一|一真|一假/.test(q)) return { type: '真假推理', module: 'pd' };
  if (/评价|评估|最为重要/.test(q)) return { type: '评价论证', module: 'pd' };
  if (/推出|得出|结论|推断|可以确定|由此可见|可见|因此|所以|由此可知/.test(q)) return { type: '推理结论', module: 'pd' };
  return { type: '逻辑判断', module: 'pd' };
}
export function parseLogiqa(text: string, prefix: string): BankQ[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: BankQ[] = [];
  // 每 8 行一题：空行、答案字母、材料、问题、四个选项
  for (let i = 0; i + 7 < lines.length; i += 8) {
    const ans = lines[i + 1].trim().toUpperCase();
    if (!/^[A-D]$/.test(ans)) { // 对不齐就往后找下一个空行重新对齐
      const j = lines.slice(i + 1).findIndex(l => !l.trim()); if (j < 0) break; i = i + 1 + j - 8; continue;
    }
    const opts = lines.slice(i + 4, i + 8).map(l => l.trim()).map((o, k) => /^[A-D][.．、]/.test(o) ? o.replace(/^([A-D])[.．、]\s*/, '$1. ') : `${'ABCD'[k]}. ${o}`);
    const question = lines[i + 3].trim();
    const t = logiqaType(question);
    out.push({ id: `${prefix}-${out.length}`, bank: 'logiqa', stem: `${lines[i + 2].trim().replace(/^\d{1,3}\s*[.．、]\s*/, '')}\n\n${question}`, options: opts, answer: ans, type: t.type, module: t.module });
  }
  return out;
}
export async function installLogiqa(onProgress?: (s: string) => void): Promise<BankMeta> {
  const all: BankQ[] = [];
  for (const f of LOGIQA_FILES) {
    onProgress?.(`下载 ${f}…`);
    let text = '';
    for (const url of LOGIQA_URLS(f)) { try { const r = await fetch(url); if (r.ok) { text = await r.text(); break; } } catch { /* 换下一个地址 */ } }
    if (!text) throw new Error('下载不了题库：检查网络（可能要挂梯子）');
    all.push(...parseLogiqa(text, `lq${f.slice(3, 5)}`));
  }
  if (all.length < 1000) throw new Error('题库解析出来太少了，可能下载不完整');
  await cachePut('logiqa', all); memo.set('logiqa', all);
  const meta: BankMeta = { id: 'logiqa', name: 'LogiQA · 国考真题（逻辑、定义、言语）', kind: 'logiqa', count: all.length, withAnswer: all.length, at: Date.now(), module: 'pd' };
  saveBanks([meta, ...getBanks().filter(b => b.id !== 'logiqa')]);
  return meta;
}

/* ───────── PDF ───────── */
let workerSet = false;
const lib = () => { if (!workerSet) { (pdfjs as any).GlobalWorkerOptions.workerSrc = pdfWorkerSrc; workerSet = true; } return pdfjs as any; };
interface Line { text: string; page: number; y: number; h: number; x: number }

async function pdfLines(data: ArrayBuffer, onProgress?: (s: string) => void): Promise<{ lines: Line[]; pages: number }> {
  const doc = await lib().getDocument({ data, isEvalSupported: false }).promise;
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(`读第 ${p} / ${doc.numPages} 页…`);
    const page = await doc.getPage(p); const tc = await page.getTextContent();
    const rows: { y: number; h: number; items: { x: number; s: string }[] }[] = [];
    for (const it of tc.items as any[]) {
      const s = String(it.str ?? ''); if (!s) continue;
      const x = it.transform?.[4] ?? 0, y = it.transform?.[5] ?? 0, h = it.height || Math.abs(it.transform?.[3] || 10);
      const row = rows.find(r => Math.abs(r.y - y) < Math.max(r.h, h) * 0.5);
      if (row) row.items.push({ x, s }); else rows.push({ y, h, items: [{ x, s }] });
    }
    for (const r of rows.sort((a, b) => b.y - a.y)) {
      const items = r.items.sort((a, b) => a.x - b.x);
      lines.push({ text: items.map(i => i.s).join('').replace(/\s+/g, ' ').trim(), page: p, y: r.y, h: r.h, x: items[0].x });
    }
    page.cleanup?.();
  }
  const pages = doc.numPages; await doc.destroy?.();
  return { lines: lines.filter(l => l.text), pages };
}

const Q_START = /^\s*(\d{1,4})\s*[.．、]\s*(?!\d)/;
const OPT = /([A-D])\s*[.．、:：]\s*/g;
/** 答案页：「1.B 2.C」「1-5 BCADB」「1．【答案】B」 */
function findAnswers(lines: Line[]): Map<number, string> {
  const ans = new Map<number, string>();
  const startIdx = lines.findIndex(l => /^(参考答案|答案(与|及)?解析|答案)\s*$|参考答案/.test(l.text));
  const zone = startIdx >= 0 ? lines.slice(startIdx) : lines.slice(Math.floor(lines.length * 0.6));
  for (const l of zone) {
    const t = l.text;
    for (const m of t.matchAll(/(\d{1,4})\s*[-—~～]\s*(\d{1,4})\s*[:：]?\s*([A-D]{2,10})/g)) {
      const a = Number(m[1]), letters = m[3]; letters.split('').forEach((c, i) => { if (a + i <= Number(m[2])) ans.set(a + i, c); });
    }
    for (const m of t.matchAll(/(?:^|\s|[，,；;])(\d{1,4})\s*[.．、:：]?\s*(?:【?答案】?\s*[:：]?\s*)?([A-D])(?![A-Za-z])/g)) if (!ans.has(Number(m[1]))) ans.set(Number(m[1]), m[2]);
  }
  return ans;
}
export function guessModule(text: string): ExamModule {
  if (/增长率|同比|比重|亿元|百分点|资料/.test(text)) return 'zl';
  if (/[甲乙丙].*[天元米]|概率|几种|多少种|速度|工程|利润/.test(text)) return 'sl';
  if (/填入|画横线|这段文字|意在|排序|语句/.test(text)) return 'yy';
  if (/图形|规律|展开图|立方体|削弱|加强|推出|定义|类比|：.*：/.test(text)) return 'pd';
  return 'cs';
}

export async function importPdf(file: File, onProgress?: (s: string) => void): Promise<BankMeta> {
  const data = await file.arrayBuffer();
  const { lines, pages } = await pdfLines(data.slice(0), onProgress);
  if (lines.length < 10) throw new Error('这份 PDF 里几乎没有文字（可能是扫描版），切不出题');
  onProgress?.('切题…');
  const ans = findAnswers(lines);
  const ansStart = lines.findIndex(l => /参考答案|答案(与|及)?解析/.test(l.text) && l.text.length < 20);
  const body = ansStart > 20 ? lines.slice(0, ansStart) : lines;
  const qs: BankQ[] = []; const id = `pdf_${Date.now().toString(36)}`;
  let cur: { no: number; lines: Line[] } | null = null;
  const flush = () => {
    if (!cur || cur.lines.length === 0) return;
    const text = cur.lines.map(l => l.text).join('\n').replace(Q_START, '');
    // 选项：从第一个「A.」开始切
    const firstA = text.search(/(^|\s|\n)A\s*[.．、:：]/);
    const stem = (firstA > 0 ? text.slice(0, firstA) : text).trim();
    const optText = firstA > 0 ? text.slice(firstA) : '';
    const options: string[] = []; const ms = [...optText.matchAll(OPT)];
    ms.forEach((m, i) => { const s = optText.slice(m.index! + m[0].length, ms[i + 1]?.index ?? optText.length).replace(/\s+/g, ' ').trim(); options.push(`${m[1]}. ${s}`); });
    const first = cur.lines[0], last = cur.lines[cur.lines.length - 1];
    qs.push({ id: `${id}-${cur.no}-${qs.length}`, bank: id, no: cur.no, stem, options: options.slice(0, 4), answer: ans.get(cur.no), module: guessModule(stem), page: first.page, pageTo: last.page, y0: first.y + first.h * 1.2, y1: last.y - last.h * 0.6 });
  };
  let expect = 1;
  for (const l of body) {
    const m = l.text.match(Q_START);
    const n = m ? Number(m[1]) : -1;
    // 题号得大致连续，避免把正文里的「1. 」「2020.」当成新题
    if (m && n > 0 && (n === expect || (n > expect && n - expect < 4) || n === 1)) { flush(); cur = { no: n, lines: [l] }; expect = n + 1; }
    else if (cur) cur.lines.push(l);
  }
  flush();
  if (qs.length < 3) throw new Error('没认出题号（要像「1.」「2、」这样的格式）');
  onProgress?.('保存…');
  const pdfToken = await putImageBlob(new Blob([data], { type: 'application/pdf' }));
  await cachePut(id, qs); memo.set(id, qs);
  const mods = qs.map(q => q.module); const top = (['zl', 'sl', 'pd', 'yy', 'cs'] as ExamModule[]).sort((a, b) => mods.filter(x => x === b).length - mods.filter(x => x === a).length)[0];
  const meta: BankMeta = { id, name: file.name.replace(/\.pdf$/i, '').slice(0, 40), kind: 'pdf', count: qs.length, withAnswer: qs.filter(q => q.answer).length, at: Date.now(), pdf: pdfToken, module: top };
  saveBanks([meta, ...getBanks()]);
  void pages;
  return meta;
}

/** 把 PDF 题那一块截成图片（显示图推、图表用）；结果缓存成 blobref */
const cropMemo = new Map<string, string>();
export async function cropQuestion(meta: BankMeta, q: BankQ): Promise<string | null> {
  if (!meta.pdf || !q.page) return null;
  if (cropMemo.has(q.id)) return cropMemo.get(q.id)!;
  const blob = await getBlobForRef(meta.pdf); if (!blob) return null;
  const doc = await lib().getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
  try {
    const parts: HTMLCanvasElement[] = [];
    for (let p = q.page; p <= (q.pageTo || q.page); p++) {
      const page = await doc.getPage(p); const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      const H = page.view[3];
      const top = p === q.page ? Math.max(0, (H - (q.y0 ?? H)) * 2) : 0;
      const bottom = p === (q.pageTo || q.page) ? Math.min(vp.height, (H - (q.y1 ?? 0)) * 2 + 8) : vp.height;
      const out = document.createElement('canvas'); out.width = vp.width; out.height = Math.max(20, bottom - top);
      out.getContext('2d')!.drawImage(c, 0, top, vp.width, out.height, 0, 0, vp.width, out.height);
      parts.push(out); page.cleanup?.();
    }
    const W = Math.max(...parts.map(c => c.width)), Ht = parts.reduce((s, c) => s + c.height, 0);
    const all = document.createElement('canvas'); all.width = W; all.height = Ht;
    const g = all.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, W, Ht); let y = 0; for (const c of parts) { g.drawImage(c, 0, y); y += c.height; }
    const png: Blob = await new Promise(res => all.toBlob(b => res(b!), 'image/jpeg', 0.85));
    const token = await putImageBlob(png); cropMemo.set(q.id, token); return token;
  } finally { await doc.destroy?.(); }
}

/** 抽一组：没做过的优先，可按题型过滤 */
export async function drawFromBank(bankId: string, n = 5, type?: string): Promise<BankQ[]> {
  const qs = (await loadBank(bankId)).filter(q => q.options.length >= 2 && (!type || q.type === type));
  const done = getDone();
  const fresh = qs.filter(q => !done[q.id]); const pool = fresh.length >= n ? fresh : qs;
  const out: BankQ[] = []; const used = new Set<number>();
  while (out.length < Math.min(n, pool.length)) { const i = Math.floor(Math.random() * pool.length); if (!used.has(i)) { used.add(i); out.push(pool[i]); } }
  return out;
}
