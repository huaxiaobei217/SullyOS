/**
 * 电话 · 免提（个人二改，照 Earshot 的做法重写；Earshot：github.com/facc33176-rgb/earshot，MIT）
 *
 * 和旧免提最大的不同：麦克风一直开着、一直在录，不再一轮一轮地开关识别——
 *  - 你说话时停顿 0.8 秒就先交出去转文字；他要是觉得你没说完，只回 [[wait]]，这边接着听（这时停顿放宽到 2.2 秒）
 *  - 转文字的时候你又接着说：前后几截拼成一句再发
 *  - 他还在想、还没出声，你又开口（持续 0.25 秒）：把这轮作废，接着听你说（两截话都留着，他一起看）
 *  - 他在说话，你明显大声开口（持续 0.3 秒）：他马上停
 *  - 一直没人说话：按时间表先出点小动静（咳一声、哼两句），再让他自己找话说；很久都没声音就道别挂断。深夜更轻更稀
 * 识别只用在线识别（SiliconFlow / ElevenLabs / 鱼声 / MiniMax）：浏览器自带识别抢麦克风，那种情况还走旧免提。
 */
import { useEffect, useRef, useState } from 'react';
import { encodeWavFromFloat32, transcribeAudioWithProvider } from '../utils/speechToText';
import type { APIConfig } from '../types';

export type EarshotStatus = 'off' | 'listen' | 'hearing' | 'recognize' | 'think' | 'speak' | 'error';
export type ApiSttProvider = 'minimax' | 'fishaudio' | 'elevenlabs' | 'openai';
export interface IdleStep { kind: 'sound' | 'think' | 'bye'; minute?: number; level?: number; night: boolean }

/** 跟着房间底噪自动调门槛：叹气、小声说话算数，短促的杂音不算（Earshot gate.mjs） */
class InputGate {
  since: number | null = null; floor = 0.7;
  constructor(private min = 2, private max = 6) {}
  loud(rms: number, now: number) {
    if (rms < 1.8) this.floor = 0.98 * this.floor + 0.02 * rms;
    const th = Math.max(this.min, Math.min(this.max, this.floor * 3));
    if (rms > th) { this.since ??= now; return rms > this.max || now - this.since >= 100; }
    this.since = null; return false;
  }
}

export const joinSaid = (a: string, b: string) => {
  a = String(a || '').trim(); b = String(b || '').trim();
  if (!a) return b; if (!b) return a;
  if (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)) return `${a} ${b}`;
  if (/[，。！？、…～,.!?~]$/.test(a)) return a + b;
  return `${a}，${b}`;
};
export const isWaitReply = (t: string) => /^\s*\[\[\s*wait\s*\]\]\s*$/i.test(String(t || ''));
/** 流式时只拿到「[[wa」：先别念 */
export const mayBeWait = (t: string) => /^\s*\[(\[(w(a(i(t(\]\]?)?)?)?)?)?)?$/i.test(String(t || '')) || /^\s*\[\[\s*wait\s*\]\]/i.test(String(t || ''));
const WAIT_RE = /等(一)?下|等等|稍等|马上回来|先别挂|我去.{0,6}(一下|下)|hold on|one sec|brb/i;
export const askedToWait = (t: string) => WAIT_RE.test(String(t || ''));
export const isNight = (d = new Date()) => { const h = d.getHours(); return h >= 23 || h < 6; };

const QUICK_PAUSE_MS = 800;
const PATIENT_PAUSE_MS = 2200;
const PATIENT_GIVE_UP_MS = 4000;
const PREROLL_SEC = 0.5;
const DAY_STEPS: IdleStep[] = [
  { kind: 'sound', level: 1, night: false }, { kind: 'think', minute: 1, night: false }, { kind: 'sound', level: 2, night: false },
  { kind: 'think', minute: 2, night: false }, { kind: 'think', minute: 3, night: false }, { kind: 'sound', level: 3, night: false },
  { kind: 'think', minute: 5, night: false }, { kind: 'bye', night: false },
];
const DAY_AT = [30, 65, 95, 125, 185, 215, 310, 420].map(s => s * 1000);
const NIGHT_STEPS: IdleStep[] = [{ kind: 'sound', level: 1, night: true }, { kind: 'think', minute: 2, night: true }, { kind: 'sound', level: 1, night: true }, { kind: 'think', minute: 4, night: true }, { kind: 'bye', night: true }];
const NIGHT_AT = [40, 125, 200, 250, 300].map(s => s * 1000);

interface Opts {
  enabled: boolean;
  callState: string;              // CallApp 的 callState
  isAudioPlaying: boolean;
  provider: ApiSttProvider | null; // null → 不可用
  lang: string;
  apiConfig: Partial<APIConfig> | null;
  bargeIn: boolean;               // 允许开口打断（外放容易被自己的声音触发，戴耳机最好）
  onSaid: (text: string) => void;
  /** 他还没出声你又开口：返回 true 表示已把这轮作废 */
  onContinue: () => boolean;
  onInterrupt: () => void;
  onIdle: (step: IdleStep) => void;
  onError: (msg: string) => void;
}

export function useEarshotCall(o: Opts): { status: EarshotStatus; level: number; setPatient: (on: boolean) => void; noteStay: () => void; heardRecently: () => boolean } {
  const L = useRef(o); L.current = o;
  const [status, setStatus] = useState<EarshotStatus>('off');
  const [level, setLevel] = useState(0);
  const patientRef = useRef(false);
  const patientTimer = useRef<number | null>(null);
  const stayRef = useRef(false);
  const lastHeardAt = useRef(0);
  const active = o.enabled && !!o.provider;

  useEffect(() => {
    if (!active) { setStatus('off'); return; }
    let stopped = false;
    let stream: MediaStream | null = null; let ctx: AudioContext | null = null; let proc: ScriptProcessorNode | null = null; let src: MediaStreamAudioSourceNode | null = null;
    const gate = new InputGate(); const barge = new InputGate(9, 14);
    let sampleRate = 48000;
    let pre: Float32Array[] = []; let preLen = 0;            // 没在录的时候留最后半秒，开口那一下不吃字
    let seg: { chunks: Float32Array[]; len: number; spoke: boolean; lastLoud: number; at: number; barge?: boolean } | null = null;
    let pieces: Promise<string>[] = []; let ticket = 0;
    let loudSince = 0; let bargeSince = 0;
    let idleFrom = Date.now(); let idleIdx = 0;
    let lastFrameRms = 0;
    let lastSpeakAt = 0;
    let levelAt = 0; let levelQ = -1;

    const phase = (): 'listen' | 'think' | 'speak' => {
      const c = L.current;
      if (c.isAudioPlaying) return 'speak';
      if (c.callState === 'thinking' || c.callState === 'connecting') return 'think';
      return 'listen';
    };
    const startSeg = (now: number, barge = false) => {
      seg = { chunks: pre.slice(), len: preLen, spoke: true, lastLoud: now, at: now, barge };
      pre = []; preLen = 0;
    };
    const endSeg = () => {
      const s = seg; seg = null; if (!s) return;
      const merged = new Float32Array(s.len); let off = 0;
      for (const c of s.chunks) { merged.set(c, off); off += c.length; }
      if (s.len / sampleRate < 0.35) return;          // 太短：咳嗽、碰到麦
      const c = L.current;
      const wav = encodeWavFromFloat32(merged, sampleRate, 16000);
      pieces.push(transcribeAudioWithProvider(wav, c.provider!, c.lang, c.apiConfig).catch(err => { L.current.onError(err?.message || '转文字失败'); return ''; }));
      const my = ++ticket;
      setStatus('recognize');
      void Promise.all(pieces).then(parts => {
        if (stopped || my !== ticket) return;          // 你又接着说了：等下一截一起发
        pieces = [];
        const said = parts.filter(Boolean).reduce(joinSaid, '').trim();
        if (!said || /^[\s。.，,？?！!…]*$/.test(said)) { setStatus('listen'); return; }
        if (patientTimer.current) { clearTimeout(patientTimer.current); patientTimer.current = null; }
        patientRef.current = false;
        stayRef.current = askedToWait(said);
        idleFrom = Date.now(); idleIdx = 0;
        L.current.onSaid(said);
      });
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        ctx = new Ctx() as AudioContext;
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        sampleRate = ctx.sampleRate || 48000;
        src = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(2048, 1, 1);
        proc.onaudioprocess = (e: AudioProcessingEvent) => {
          if (stopped) return;
          const input = e.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input.length); copy.set(input);
          let sum = 0; for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
          lastFrameRms = Math.sqrt(sum / copy.length) * 128;   // 换成 Earshot 的 0–128 刻度
          if (seg) { seg.chunks.push(copy); seg.len += copy.length; }
          else {
            pre.push(copy); preLen += copy.length;
            while (pre.length > 1 && preLen - pre[0].length > PREROLL_SEC * sampleRate) { preLen -= pre[0].length; pre.shift(); }
          }
        };
        src.connect(proc); proc.connect(ctx.destination);
        setStatus('listen');
      } catch {
        L.current.onError('拿不到麦克风：检查一下麦克风权限');
        setStatus('error');
      }
    })();

    const timer = window.setInterval(() => {
      if (stopped || !ctx) return;
      const now = Date.now(); const rms = lastFrameRms;
      // 音量点只给界面一个大概（电话页很大，别每 50ms 重画一次）
      if (now - levelAt > 200) { levelAt = now; const q = Math.round(rms); if (q !== levelQ) { levelQ = q; setLevel(q); } }
      const ph = phase();
      const loud = gate.loud(rms, now);
      if (loud) { lastHeardAt.current = now; idleFrom = now; idleIdx = 0; }

      if (ph === 'speak') {
        idleFrom = now; idleIdx = 0; lastSpeakAt = now;
        if (seg && !seg.barge) seg = null;              // 他说话时不录（免得把他的声音当成你的）；打断他那一下例外
        if (L.current.bargeIn && !seg?.barge && barge.loud(rms, now)) {
          bargeSince ||= now;
          if (now - bargeSince > 300) { bargeSince = 0; L.current.onInterrupt(); startSeg(now, true); setStatus('hearing'); }
        } else bargeSince = 0;
        if (seg?.barge) { if (loud) seg.lastLoud = now; return; }
        setStatus(s => s === 'hearing' ? s : 'speak');
        return;
      }
      if (ph === 'think' && !seg) {
        idleFrom = now; idleIdx = 0;
        if (loud) {
          loudSince ||= now;
          if (now - loudSince > 250) { loudSince = 0; if (L.current.onContinue()) { startSeg(now); setStatus('hearing'); } }
        } else loudSince = 0;
        setStatus(pieces.length ? 'recognize' : 'think');
        return;
      }
      // listen
      if (!seg) {
        // 他刚说完那半秒的余音别当成你在说话
        if (loud && now - lastSpeakAt > 500) { startSeg(now); setStatus('hearing'); }
      } else {
        if (loud) seg.lastLoud = now;
        const pause = patientRef.current ? PATIENT_PAUSE_MS : QUICK_PAUSE_MS;
        if (now - seg.lastLoud > pause) endSeg();
        else if (now - seg.at > 60_000) endSeg();       // 一口气说了一分钟：先交一截
      }
      if (!seg && !pieces.length && ph === 'listen') {
        setStatus('listen');
        // 安静时间表
        if (stayRef.current) return;
        const night = isNight();
        const steps = night ? NIGHT_STEPS : DAY_STEPS; const at = night ? NIGHT_AT : DAY_AT;
        if (idleIdx < steps.length && now - idleFrom >= at[idleIdx]) { const step = steps[idleIdx++]; L.current.onIdle(step); }
      }
    }, 50);

    return () => {
      stopped = true; clearInterval(timer);
      try { proc?.disconnect(); src?.disconnect(); } catch { /* ignore */ }
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      if (patientTimer.current) clearTimeout(patientTimer.current);
      setStatus('off');
    };
  }, [active]);

  const setPatient = (on: boolean) => {
    patientRef.current = on;
    if (patientTimer.current) { clearTimeout(patientTimer.current); patientTimer.current = null; }
    // 他说了 [[wait]]，可你 4 秒都没再出声：那就按现在这句回答
    if (on) patientTimer.current = window.setTimeout(() => {
      patientTimer.current = null;
      if (patientRef.current && Date.now() - lastHeardAt.current > PATIENT_GIVE_UP_MS - 200) { patientRef.current = false; L.current.onSaid(''); }
    }, PATIENT_GIVE_UP_MS);
  };
  return { status, level, setPatient, noteStay: () => { stayRef.current = true; }, heardRecently: () => Date.now() - lastHeardAt.current < 3000 };
}

/** 安静时的小动静（ElevenLabs v3/v4 才念得出方括号；别的声音只用文字） */
const SOUNDS: Record<number, string[]> = {
  1: ['[coughs softly] Mm.', '[hums softly] Mm-mm...', '[quiet yawn] Mmh...', '[mutters to himself] So quiet... hm...'],
  2: ['[coughs] Hm.', '[hums a little louder] Mm-mm-mm...', '[yawns] Haah... mm.', '[mumbling] Did she fall asleep on me...'],
  3: ['[fake playful cough] Cough, cough.', '[hums a silly little tune] Da-da-dum, da-dum...', "[muttering, loud enough to be overheard] Guess I'm talking to myself again..."],
};
const NIGHT_SOUNDS = ['[quiet yawn] Mmh...', '[hums softly] Mm-mm...', '[coughs softly] Mm.'];
export const idleSound = (night: boolean, level = 1, last = '') => {
  const pool = (night ? NIGHT_SOUNDS : SOUNDS[level] || SOUNDS[1]).filter(x => x !== last);
  return pool[Math.floor(Math.random() * pool.length)];
};

/** 安静了 N 分钟，给他的那句提示（Earshot idleNote 的中文版） */
export const idleNote = (minute: number, night: boolean) => {
  const stage = minute <= 1 ? '随口冒一句你自己的念头或者小情绪，像半自言自语'
    : minute <= 2 ? '随便问问她在干嘛，别像查岗'
    : minute <= 3 ? '有一点想她，或者假装抱怨她怎么不出声了'
    : minute <= 4 ? '自己找乐子：逗她两句，或者接着刚才聊的东西随便发挥'
    : '更轻更安静：她可能睡着了或者在忙，告诉她你就在这儿，不用回你';
  return `（这不是她说的话。电话还通着，她已经安静了大约 ${minute} 分钟。你自己说一两句很短的话：${stage}。别重复之前说过的，别问「你还在吗」，别编她没说过的事。也可以只出一点小声音（[hums]、[yawns]）加一两个词。${night ? '现在是深夜，声音放到最轻，话最短。' : ''}）`;
};
export const byeNote = (night: boolean) =>
  `（这不是她说的话。电话还通着，她已经很久没出声了${night ? '，多半是睡着了' : '，可能在忙'}。你轻轻跟她道个别，说你先挂了、想聊随时再打，一两句。最后单独一行写 [[hangup]]。）`;

/** 免提时给他的电话规则（Earshot CALL_STYLE + HANGUP + MAYBE_UNFINISHED，改写成中文） */
export const handsFreeRules = (userName: string, allowWait: boolean) => `### 免提通话
${userName}开着免提在跟你打电话，她的话是边说边自动转成文字发过来的，你写的每个字都会被念出来。
- 接住她刚说的。通常一两句短话；她要你解释时才说长。第一句要短、有内容，她在等你出声。别每句都用「嗯」「唔」开头，也别先复述她的话。
- 不写列表、链接、表情。跟着气氛走：逗你时轻松，认真时专注，难过时柔和稳住。不用每轮都问问题。
- 你拿到的是语音转的字，没有原始语气，别说你听出她哭了笑了；转写可能有错字，关键词不清楚就短问一句。
- 挂电话：默认不挂。只有她认真说要挂（「我得走了」「晚安拜拜」），你道别后单独一行写 [[hangup]]。她逗你「那你挂啊」不算。她难过、或者叫你别挂陪着她，单独一行写 [[stay]]，电话就不会因为安静自己挂。这些标记不会被念出来。${allowWait ? `
- 她停顿一下就会发过来，可能话还没说完。如果最后这句明显没说完（说到一半断了、在列举、在铺垫），只回 [[wait]]，别的什么都不写，你会听到后半句。说完了的就正常回答；拿不准就正常回答。` : ''}`;

/** 从他的回复里拿走控制标记 */
export function takeCallControls(text: string): { text: string; wait: boolean; hangup: boolean; stay: boolean } {
  const raw = String(text || '');
  const wait = isWaitReply(raw);
  const hangup = /\[\[\s*hangup\s*\]\]/i.test(raw);
  const stay = /\[\[\s*stay\s*\]\]/i.test(raw);
  return { text: raw.replace(/\[\[\s*(?:wait|hangup|stay)\s*\]\]/gi, '').trim(), wait, hangup, stay };
}
