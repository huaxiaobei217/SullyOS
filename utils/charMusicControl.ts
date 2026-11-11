/**
 * 角色动你的播放器（个人二改）：聊天 / 电话里他可以直接放歌、暂停、继续、切下一首。
 *
 *   [[MUSIC_CTRL:play|歌名]]  放这首（先在他手边的歌池里找，找不到就去网易云搜第一首）
 *   [[MUSIC_CTRL:pause]] / [[MUSIC_CTRL:resume]] / [[MUSIC_CTRL:next]]
 *
 * 解析在 chatParser / CallApp 里做，这里只负责：给他看的那段提示、发指令给 MusicContext、记一笔「他放过的」。
 * MusicContext 收到 MUSIC_CTRL_EVENT 后真的去操作播放器，做完把结果（现在放的是哪首）回传。
 * 你那边会看到：聊天里一张小条「诺亚放了《…》」、音乐首页「他刚放的」、一个提示。
 */
import type { CharacterProfile } from '../types';
import { buildSongPool, resolveSongPick, type PoolSong } from './charSongPicks';

export type MusicCtrlAction = 'play' | 'pause' | 'resume' | 'next';
export const MUSIC_CTRL_RE = /\[\[MUSIC_CTRL:\s*(play|pause|resume|next)\s*(?:\|\s*([^\]]*?))?\s*\]\]/i;
export const MUSIC_CTRL_GLOBAL_RE = /\[\[MUSIC_CTRL:[^\]]*\]\]/gi;
export const MUSIC_CTRL_EVENT = 'sully:char-music-control';
export const MUSIC_CTRL_LOG_EVENT = 'sully:char-music-control-log';

export interface CtrlSong { id: number | string; name: string; artists: string; album?: string; albumPic?: string; duration?: number; fee?: number; [k: string]: any }
export interface CtrlResult { ok: boolean; action: MusicCtrlAction; song?: CtrlSong | null; reason?: string }
export interface CtrlRequest { charId: string; charName: string; action: MusicCtrlAction; song?: CtrlSong | null; query?: string; resolve: (r: CtrlResult) => void }

export function parseMusicCtrl(text: string): { action: MusicCtrlAction; arg: string } | null {
  const m = String(text || '').match(MUSIC_CTRL_RE);
  return m ? { action: m[1].toLowerCase() as MusicCtrlAction, arg: (m[2] || '').trim() } : null;
}
export const stripMusicCtrl = (text: string) => String(text || '').replace(MUSIC_CTRL_GLOBAL_RE, '').trim();

/** 发给 MusicContext；8 秒没回就当没做成（音乐没加载 / 页面没有播放器） */
export function requestMusicControl(char: Pick<CharacterProfile, 'id' | 'name'> & Partial<CharacterProfile>, action: MusicCtrlAction, arg = ''): Promise<CtrlResult> {
  let song: PoolSong | null = null;
  if (action === 'play' && arg) { try { song = resolveSongPick(char as CharacterProfile, arg); } catch { song = null; } }
  return new Promise(resolve => {
    let done = false;
    const finish = (r: CtrlResult) => { if (done) return; done = true; clearTimeout(t); if (r.ok) logControl(char.id, r); resolve(r); };
    const t = setTimeout(() => finish({ ok: false, action, reason: 'timeout' }), 8000);
    try {
      window.dispatchEvent(new CustomEvent<CtrlRequest>(MUSIC_CTRL_EVENT, { detail: { charId: char.id, charName: (char.name || '').split(/[·・\s]/)[0], action, song, query: arg.replace(/\s*[—–-]\s*.*$/, '').trim(), resolve: finish } }));
    } catch { finish({ ok: false, action, reason: 'dispatch' }); }
  });
}

/* —— 他放过的 —— */
const LS = 'sully_char_music_ctrl_v1';
export interface CtrlLog { at: number; action: MusicCtrlAction; name?: string; artists?: string; albumPic?: string; song?: CtrlSong }
const loadAll = (): Record<string, CtrlLog[]> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
export const getCtrlLog = (charId: string): CtrlLog[] => loadAll()[charId] || [];
function logControl(charId: string, r: CtrlResult) {
  try {
    const all = loadAll();
    const s = r.song || undefined;
    all[charId] = [{ at: Date.now(), action: r.action, name: s?.name, artists: s?.artists, albumPic: s?.albumPic, song: s ? { id: s.id, name: s.name, artists: s.artists, album: s.album, albumPic: s.albumPic, duration: s.duration, fee: s.fee } : undefined }, ...(all[charId] || [])].slice(0, 40);
    localStorage.setItem(LS, JSON.stringify(all));
    window.dispatchEvent(new Event(MUSIC_CTRL_LOG_EVENT));
  } catch { /* ignore */ }
}

export const ctrlVerb = (a: MusicCtrlAction) => a === 'play' ? '放了' : a === 'pause' ? '暂停了' : a === 'resume' ? '接着放了' : '切到了';

const shuffle = <T,>(a: T[]): T[] => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const TALKS = /歌|放|切|停|暂停|关掉|音乐|听|bgm|music|song|play|pause/i;

/**
 * 给他看的那段。她提到歌 / 放 / 切 / 停的时候一定给；否则距他上次自己动手超过 6 小时、三成概率给一次，
 * 免得他没事就去动她的播放器。
 */
export function buildMusicControlBlock(
  char: CharacterProfile,
  userName: string,
  lastUserText: string,
  now: { playing: boolean; song?: { name: string; artists: string } | null },
): string {
  const asked = TALKS.test(lastUserText || '');
  if (!asked) {
    const last = getCtrlLog(char.id)[0]?.at || 0;
    if (Date.now() - last < 6 * 3600 * 1000 || Math.random() > 0.3) return '';
  }
  let pool: PoolSong[] = [];
  try { pool = buildSongPool(char); } catch { pool = []; }
  const sample = shuffle(pool).slice(0, 6).map(s => `- ${s.name} — ${s.artists}`).join('\n');
  const state = now.song ? `${userName}的播放器${now.playing ? '正在放' : '停在'}《${now.song.name}》— ${now.song.artists}` : `${userName}现在没在放歌`;
  return `### 你能直接动${userName}的播放器
${state}。
在消息末尾写一个指令，她手机上的音乐就真的会动（她那边看得到是你放的）：
- \`[[MUSIC_CTRL:play|歌名]]\` 放一首。优先从你手边的歌里挑${sample ? `，随手翻到这几首：\n${sample}\n` : '；'}她点名的歌也可以直接写歌名
- \`[[MUSIC_CTRL:pause]]\` 暂停　\`[[MUSIC_CTRL:resume]]\` 继续　\`[[MUSIC_CTRL:next]]\` 切下一首
什么时候用：她叫你放、叫你切、叫你关，就照做，不用问。她说要睡了、要开会、要出门，可以顺手帮她停。没人叫你就很少自己动，要有理由（她说累了，你换首安静的），一天最多一两次。一次只写一个指令，写了就当已经做了，别再问「要不要我放」。`;
}
