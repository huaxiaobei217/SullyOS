/**
 * 让角色真的听一首歌：两层
 *   1. 歌曲解读（客观）：只听一次音频，存档后所有角色共用；放这首歌时注入聊天
 *   2. 听歌日记（主观）：每个角色专属，读解读 + 歌词 + 人设来写，不再重新听音频
 *
 * 思路参考自社区 fork SullyOS-NuiAPK（post090）的「角色主动听歌」：
 * 取整首歌的音频 + 歌词 → 带着角色人设（ContextBuilder）单独调用一个能听音频的模型（OpenAI 兼容，input_audio）
 * → 角色第一人称写听后感 → 存起来，之后一段时间的聊天里注入给主模型。每首歌每个角色只听一次。
 *
 * 浏览器不能跨域下载平台音频，所以音频经用户自己的代理 Worker 的 /music2/audio 中转。
 */
import { ContextBuilder } from '../context';
import { DB } from '../db';
import { resolveMusicWorkerUrl, loadMusicCfgStandalone, type Song } from '../../context/MusicContext';
import { getLxRuntime } from './lxRuntime';
import { fetchLyricsForLxSong } from './lyrics';

/* ───────── 配置 ───────── */

export interface ListenApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 一起听时，每首新歌自动让角色听一遍 */
  autoTogether: boolean;
  /** 没人陪听时，放新歌也自动生成歌曲解读（每首只解读一次） */
  autoAnalyze: boolean;
  /** 流式请求（有些中转对非流式长回复容易断） */
  stream: boolean;
}

const LS_CFG = 'sully_music_listen_api_v1';

export const loadListenApiConfig = (): ListenApiConfig => {
  try {
    const raw = localStorage.getItem(LS_CFG);
    return { baseUrl: '', apiKey: '', model: '', autoTogether: true, autoAnalyze: false, stream: false, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { baseUrl: '', apiKey: '', model: '', autoTogether: true, autoAnalyze: false, stream: false }; }
};
export const saveListenApiConfig = (c: ListenApiConfig) => {
  try { localStorage.setItem(LS_CFG, JSON.stringify(c)); } catch {}
};
export const isListenApiReady = (c = loadListenApiConfig()) => !!(c.baseUrl.trim() && c.apiKey.trim() && c.model.trim());

import {
  ListenDiary, SongAnalysis, songKeyOf, loadDiaries, saveDiaries, findDiary, getAnalysis, saveAnalysis,
} from './listenDiaryStore';
export * from './listenDiaryStore';

/* ───────── 取音频 ───────── */

const MAX_BYTES = 20 * 1024 * 1024;

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const formatOf = (mime: string, hint = '') => {
  const m = `${mime} ${hint}`.toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('flac')) return 'flac';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'aac';
  return 'mp3';
};

async function fetchSongAudio(song: Song): Promise<{ blob: Blob; format: string }> {
  if (song.local && song.localAssetKey) {
    const entry = await DB.getAssetRaw(song.localAssetKey).catch(() => null) as { blob?: Blob; mimeType?: string } | Blob | null;
    const blob = entry instanceof Blob ? entry : (entry?.blob instanceof Blob ? entry.blob : null);
    if (!blob) throw new Error('本地歌曲文件丢失');
    if (blob.size > MAX_BYTES) throw new Error('这首本地歌文件太大');
    return { blob, format: formatOf(blob.type || song.localMimeType || '') };
  }
  if (!song.lxSource || !song.lxSongmid) throw new Error('这首歌没有可用的音源');
  const rt = await getLxRuntime();
  // 听歌只要能听清，用最小的 128k，省流量也省模型额度
  const url = await rt.getMusicUrl(song.lxSource, {
    songmid: song.lxSongmid, hash: song.lxHash, name: song.name, singer: song.artists,
    albumName: song.album, interval: song.interval, strMediaMid: song.lxStrMediaMid,
    copyrightId: song.lxCopyrightId, source: song.lxSource,
  }, '128k');
  const base = resolveMusicWorkerUrl(loadMusicCfgStandalone());
  const res = await fetch(`${base}/music2/audio?url=${encodeURIComponent(url)}`);
  if (res.status === 404 || res.status === 405) throw new Error('代理 Worker 需要更新到最新的 worker/index.js');
  if (!res.ok) throw new Error(`音频下载失败 HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('音频下载结果为空');
  if (blob.size > MAX_BYTES) throw new Error('音频太大');
  return { blob, format: formatOf(blob.type, url) };
}

/* ───────── 调模型 ───────── */

const tasteBlock = (char: any): string => {
  const mp = char?.musicProfile;
  if (!mp) return '';
  const lines: string[] = [];
  if (mp.bio?.trim()) lines.push(`你的音乐品味：${mp.bio.trim()}`);
  if (mp.genreTags?.length) lines.push(`你常听的类型：${mp.genreTags.slice(0, 8).join('、')}`);
  const artists = (mp.signatureArtists || []).slice(0, 8).map((a: any) => (a.starred ? `${a.name}（最爱）` : a.name));
  if (artists.length) lines.push(`你偏爱的歌手：${artists.join('、')}`);
  return lines.length ? `\n${lines.join('\n')}\n` : '';
};

/** 第一层：客观的歌曲解读（只听一次音频，所有角色共用） */
const ANALYZE_PROMPT = `请认真听这首歌（音频附在后面，歌词供对照），写一份客观、详细的「歌曲解读」，让一个没听过这首歌的人读完就能想象出它听起来是什么样，也知道它是一首什么来头的歌。

包含这几部分（用简洁的中文，小标题 + 短句即可）：
1. 关于这首歌：歌手 / 乐队是谁（国籍、出道年代、代表风格、大概的地位）；这首歌出自哪张专辑、大约哪年发行；创作背景、用在过什么影视或游戏里、有什么广为人知的故事。只写你确实知道的，拿不准的就标「（不确定）」，完全不了解就直说「对这首歌的背景不了解」，绝对不要编。
2. 整体：风格流派、整体氛围和情绪基调，两三句话概括。
3. 声音：主要乐器与音色、编曲和制作上的特点（混响、空间感、电子 / 原声）、节奏和速度感、人声的特点（性别、音色、唱法、语种）。
4. 结构：按时间顺序列出各段落（前奏 / 主歌 / 副歌 / 桥段 / 间奏 / 尾奏等），标注大致时间点（mm:ss），每段一两句话说清楚发生了什么、情绪怎么变化。
5. 歌词：这首歌在唱什么、讲了一个什么样的故事或心情、用了哪些意象；挑三到五句最关键的歌词，原文后附中文意思，说说它们在整首歌里起什么作用。
6. 记忆点：最抓耳的两三处（某句歌词、某个转折、某段旋律），带时间点。

要求：声音和结构只描述确实听到的，听不出来的不要编；不写个人喜好，不打分；总长度 800–1500 字。`;

/** 第二层：角色专属的听歌日记（读解读 + 歌词来写，不再听音频） */
const diaryInstructions = (charName: string, userName: string, mode: 'together' | 'alone', char: any) => {
  const scene = mode === 'together'
    ? `${userName} 正在放这首歌，你戴上了另一只耳机，和 ta 一起把它从头听到尾。`
    : '你一个人戴着耳机，把这首歌从头听到尾，没有人打扰。';
  return `### 【现在：听歌】
${scene}
${tasteBlock(char)}
下面会给你这首歌的客观解读（它听起来是什么样）和歌词——这就是你刚刚亲耳听到的内容。
听完以后，作为 ${charName} 本人，写一段只给自己看的听歌日记。

最重要的是「像 ${charName}」，而不是「听得准」：
- 用 ${charName} 平时说话的方式写：用词、语气、口头禅、句子长短、标点习惯，都照你的人设来。
- 带着你自己的口味和偏见去听：喜欢就说喜欢，听不惯、觉得吵、觉得矫情、觉得一般也可以直说，不用替这首歌说好话。拿它跟你熟悉的歌或歌手比也行。
- 让歌勾出你自己的东西：某段旋律、某句歌词让你想起了什么人、什么事、你的经历或最近的心情${mode === 'together' ? `，或者此刻身边的 ${userName}` : ''}。这部分比描述音乐本身更重要。
- 声音上的细节只挑一两处真正抓住你的写，用你自己的话说，不要照搬解读里的术语。解读里没有的细节别编。

格式：第一人称，长短按你的性格来，大约 80–300 字。不要列条目，不要打分，不要写成报告。只输出日记正文，不要标题、引号或任何格式标签。`;
};

const plainLyrics = (lrc: string) => lrc.split('\n')
  .map(l => l.replace(/\[[^\]]*\]/g, '').trim())
  .filter(Boolean).join('\n');

const callModel = async (messages: any[], maxTokens: number, temperature: number): Promise<string> => {
  const cfg = loadListenApiConfig();
  const base = cfg.baseUrl.trim().replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
    // 思考型模型（如 Gemini 2.5）的思考也算在 max_tokens 里，给足余量，不然正文会被截断
    body: JSON.stringify({ model: cfg.model.trim(), messages, temperature, max_tokens: maxTokens, stream: !!cfg.stream }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message || j?.error || `HTTP ${res.status}`);
  }
  let content = '';
  let finish = '';
  if (cfg.stream && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const d = t.slice(5).trim();
        if (d === '[DONE]') continue;
        try {
          const j = JSON.parse(d);
          content += j?.choices?.[0]?.delta?.content || '';
          finish = j?.choices?.[0]?.finish_reason || finish;
        } catch { /* 半行，跳过 */ }
      }
    }
  } else {
    const j = await res.json().catch(() => null);
    content = String(j?.choices?.[0]?.message?.content || '');
    finish = j?.choices?.[0]?.finish_reason || '';
  }
  content = content.trim();
  if (!content) throw new Error(finish === 'length' ? '输出被截断了（模型思考太长），可以换个模型或开流式再试' : '模型没有返回内容');
  return content;
};

/* ───────── 第一层：歌曲解读 ───────── */

const analyzeInFlight = new Map<string, Promise<SongAnalysis>>();

/** 取这首歌的解读：有存档直接用，没有就听一遍音频生成并存档 */
export function analyzeSong(song: Song, opts: { force?: boolean } = {}): Promise<SongAnalysis> {
  const key = songKeyOf(song);
  const cached = getAnalysis(key);
  if (cached && !opts.force) return Promise.resolve(cached);
  const running = analyzeInFlight.get(key);
  if (running) return running;
  const task = (async () => {
    if (!isListenApiReady()) throw new Error('还没填「听歌模型」的接口');
    const [{ blob, format }, ly] = await Promise.all([
      fetchSongAudio(song),
      fetchLyricsForLxSong(loadMusicCfgStandalone(), song).catch(() => null),
    ]);
    const data = await blobToBase64(blob);
    const lyrics = ly?.lrc ? plainLyrics(ly.lrc).slice(0, 4000) : '';
    const head = `《${song.name}》— ${song.artists}${song.album ? `（专辑《${song.album}》）` : ''}`;
    const text = await callModel([{
      role: 'user',
      content: [
        { type: 'text', text: `${ANALYZE_PROMPT}\n\n${head}\n\n${lyrics ? `歌词：\n${lyrics}` : '（没拿到歌词）'}` },
        { type: 'input_audio', input_audio: { data, format } },
      ],
    }], 12000, 0.2);
    const a: SongAnalysis = {
      songKey: key, songName: song.name, artists: song.artists,
      text: text.slice(0, 12000), lyrics: lyrics.slice(0, 4000), createdAt: Date.now(),
    };
    saveAnalysis(a);
    return a;
  })().finally(() => analyzeInFlight.delete(key));
  analyzeInFlight.set(key, task);
  return task;
}

/* ───────── 第二层：角色听歌日记 ───────── */

export interface ListenOutcome { status: 'listened' | 'existing' | 'skipped' | 'failed'; diary?: ListenDiary; error?: string; }

const inFlight = new Map<string, Promise<ListenOutcome>>();

export function listenToSong(charId: string, song: Song, mode: 'together' | 'alone', opts: { force?: boolean } = {}): Promise<ListenOutcome> {
  const key = `${charId}|${songKeyOf(song)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = run(charId, song, mode, opts.force).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function run(charId: string, song: Song, mode: 'together' | 'alone', force?: boolean): Promise<ListenOutcome> {
  if (!isListenApiReady()) return { status: 'skipped', error: '还没填「听歌模型」的接口' };
  const old = findDiary(charId, song);
  if (old && !force) return { status: 'existing', diary: old };
  try {
    const [char, user] = await Promise.all([DB.getCharacter(charId), DB.getUserProfile()]);
    if (!char || !user) return { status: 'skipped', error: '找不到角色' };
    const analysis = await analyzeSong(song);
    const userText = `《${song.name}》— ${song.artists}

【这首歌听起来是什么样】
${analysis.text}

${analysis.lyrics ? `【歌词】\n${analysis.lyrics}` : '（没有歌词）'}`;
    const messages = await ContextBuilder.buildCharacterRequest(
      { char, user, instructions: diaryInstructions(char.name, user.name || '对方', mode, char) },
      [{ role: 'user', content: userText }],
    );
    const content = (await callModel(messages, 8000, 0.85)).replace(/^["“「]|["”」]$/g, '').trim().slice(0, 4000);
    const diary: ListenDiary = {
      id: `ld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      charId, songKey: songKeyOf(song), songName: song.name, artists: song.artists, mode, content, createdAt: Date.now(),
    };
    saveDiaries([diary, ...loadDiaries().filter(d => !(d.charId === charId && d.songKey === diary.songKey))]);
    return { status: 'listened', diary };
  } catch (e: any) {
    return { status: 'failed', error: e?.message || String(e) };
  }
}
