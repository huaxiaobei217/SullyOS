/**
 * 电话 · 免提模式（像 ChatGPT 语音那样）：
 *  - 轮到你说话时自动开麦；你说完停顿约 1.2 秒，自动结束识别并发送
 *  - 他用语音回你，念完自动接着听
 *  - 他说话时你开口（持续约 0.35 秒、音量明显高于底噪），就打断他、开始听你说
 *  - 一轮没说话（约 12 秒）就不再反复开识别，改成「等你开口」：检测到声音才开（省识别费用，开头可能吃掉半个字）
 * 只在通话页面打开时工作；用到的识别 / 发送 / 停播都由电话页传进来，不改原来的点按流程。
 *
 * 用浏览器 / 系统自带识别时（releaseMic）：安卓上同一时间只能有一个人用麦克风，
 * 所以识别开始前先把自己这路麦克风关掉，识别结束再拿回来；这期间「说完了没有」改看识别出来的字：
 * 字停了约 1.3 秒没再变，就当你说完了。
 */
import { useEffect, useRef, useState } from 'react';

export type HandsFreeStatus = 'off' | 'waiting' | 'listening' | 'sending' | 'thinking' | 'speaking' | 'broken';

interface Opts {
  enabled: boolean;
  inCall: boolean;
  callState: string;
  isListening: boolean;
  isTranscribing: boolean;
  isAudioPlaying: boolean;
  draftInput: string;
  startListening: () => void;
  stopListening: () => void;
  send: () => void;
  interrupt: () => void;
  /** 识别时把麦克风让出来（浏览器 / 系统自带识别必须） */
  releaseMic?: boolean;
}

const SILENCE_END_MS = 1200;
const NO_SPEECH_MS = 12000;
const BARGE_MS = 350;
const TEXT_SETTLE_MS = 1300;

export function useHandsFreeCall(o: Opts): HandsFreeStatus {
  const latest = useRef(o); latest.current = o;
  const [armed, setArmed] = useState(false);          // true = 等你开口才开识别
  // 识别一开就马上空手结束（没权限 / 手机没有识别服务 / 网络连不上）连续几次：别再自己反复重开（会一直闪）
  const quickFails = useRef(0);
  const [broken, setBroken] = useState(false);
  const autoRef = useRef(false);                      // 这一轮识别是免提开的，结束后自动发送
  const heardRef = useRef(false);                     // 这一轮里听到过人声
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const floorRef = useRef(0.01);
  const [level, setLevel] = useState(0);

  const active = o.enabled && o.inCall;

  /* 开一路麦克风给音量检测用（和识别各自独立；开了回声消除，他的声音不容易误触发打断） */
  const releaseNow = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null; ctxRef.current = null; analyserRef.current = null;
  };
  const [releasing, setReleasing] = useState(false);
  const wantMic = active && !(o.releaseMic && (o.isListening || releasing));
  useEffect(() => {
    if (!wantMic) { releaseNow(); return; }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser(); an.fftSize = 1024;
        src.connect(an);
        streamRef.current = stream; ctxRef.current = ctx; analyserRef.current = an;
      } catch { /* 拿不到麦克风就只做「自动开麦 + 自动发送」，没有打断和等你开口 */ }
    })();
    return () => { cancelled = true; releaseNow(); };
  }, [wantMic]);

  /* 每 50ms 读一次音量 */
  useEffect(() => {
    if (!active) return;
    const buf = new Float32Array(1024);
    const t = setInterval(() => {
      const an = analyserRef.current;
      if (!an) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // 底噪慢慢跟着安静时的音量走
      if (rms < floorRef.current * 1.5) floorRef.current = floorRef.current * 0.95 + rms * 0.05;
      setLevel(rms);
    }, 50);
    return () => clearInterval(t);
  }, [active]);

  const speechThreshold = Math.max(0.018, floorRef.current * 3);
  const bargeThreshold = Math.max(0.045, floorRef.current * 5);
  const loud = level > speechThreshold;

  /* 轮到你：自动开麦（或者 armed 时等你开口） */
  useEffect(() => {
    const c = latest.current;
    if (!active || broken || c.callState !== 'listening' || c.isAudioPlaying || c.isListening || c.isTranscribing || c.draftInput.trim()) return;
    if (armed && !(analyserRef.current && loud)) return;
    const t = setTimeout(() => {
      const n = latest.current;
      if (n.callState !== 'listening' || n.isAudioPlaying || n.isListening || n.isTranscribing) return;
      autoRef.current = true; heardRef.current = armed; setArmed(false);
      if (n.releaseMic) {
        // 先把麦克风让出来，再开识别
        setReleasing(true); releaseNow();
        setTimeout(() => { latest.current.startListening(); setTimeout(() => setReleasing(false), 400); }, 180);
      } else n.startListening();
    }, armed ? 0 : 400);
    return () => clearTimeout(t);
  }, [active, broken, o.callState, o.isAudioPlaying, o.isListening, o.isTranscribing, o.draftInput, armed, loud]);

  /* 识别中：说完停顿就结束；一直没开口就收起来改成等你开口 */
  const lastLoudAt = useRef(0);
  const listenStartedAt = useRef(0);
  useEffect(() => {
    if (o.isListening) { listenStartedAt.current = Date.now(); lastLoudAt.current = 0; }
  }, [o.isListening]);
  useEffect(() => {
    if (!active || !o.isListening || !autoRef.current || !analyserRef.current) return;
    const now = Date.now();
    if (loud) { heardRef.current = true; lastLoudAt.current = now; return; }
    if (heardRef.current && lastLoudAt.current && now - lastLoudAt.current > SILENCE_END_MS) { latest.current.stopListening(); return; }
    if (!heardRef.current && now - listenStartedAt.current > NO_SPEECH_MS) { setArmed(true); latest.current.stopListening(); }
  }, [active, o.isListening, level, loud]);

  /* 自带识别（麦克风让出去了）：看字有没有停 */
  const textAt = useRef({ text: '', at: 0 });
  useEffect(() => {
    if (!active || !o.releaseMic || !o.isListening || !autoRef.current) return;
    const text = o.draftInput.trim();
    if (text !== textAt.current.text) textAt.current = { text, at: Date.now() };
    const t = setInterval(() => {
      const n = latest.current;
      if (!n.isListening) return;
      const cur = n.draftInput.trim();
      if (cur && cur === textAt.current.text && Date.now() - textAt.current.at > TEXT_SETTLE_MS) { n.stopListening(); return; }
      if (!cur && Date.now() - listenStartedAt.current > NO_SPEECH_MS) { setArmed(true); n.stopListening(); }
    }, 200);
    return () => clearInterval(t);
  }, [active, o.releaseMic, o.isListening, o.draftInput]);

  /* 识别一结束就判断：开了不到 3 秒、一个字没有 → 算一次「识别没起来」（立刻算，不等宽限，免得被下一轮重开冲掉） */
  const wasListening = useRef(false);
  useEffect(() => {
    if (o.isListening) { wasListening.current = true; return; }
    if (!wasListening.current) return;
    wasListening.current = false;
    if (!active) return;
    const dur = Date.now() - listenStartedAt.current;
    if (listenStartedAt.current && dur < 3000 && !latest.current.draftInput.trim()) {
      quickFails.current++;
      if (quickFails.current >= 3) setBroken(true);
      else setArmed(true);
    } else if (latest.current.draftInput.trim()) quickFails.current = 0;
  }, [active, o.isListening]);

  /* 识别结束、文字到了：自动发送 */
  useEffect(() => {
    if (!active || o.isListening || o.isTranscribing || !autoRef.current) return;
    if (!o.draftInput.trim()) {
      // 有的识别平台先关麦、过一会儿才把文字送回来：给 2.5 秒宽限，还是空的才算这一轮没说话
      const g = setTimeout(() => {
        const n = latest.current;
        if (n.isListening || n.isTranscribing || n.draftInput.trim()) return;
        autoRef.current = false;
      }, 2500);
      return () => clearTimeout(g);
    }
    autoRef.current = false; quickFails.current = 0;
    const t = setTimeout(() => latest.current.send(), 150);
    return () => clearTimeout(t);
  }, [active, o.isListening, o.isTranscribing, o.draftInput]);

  /* 他在说话时你开口：打断 */
  const bargeSince = useRef(0);
  useEffect(() => {
    if (!active || !o.isAudioPlaying || !analyserRef.current) { bargeSince.current = 0; return; }
    if (level > bargeThreshold) {
      if (!bargeSince.current) bargeSince.current = Date.now();
      else if (Date.now() - bargeSince.current > BARGE_MS) { bargeSince.current = 0; setArmed(false); latest.current.interrupt(); }
    } else bargeSince.current = 0;
  }, [active, o.isAudioPlaying, level, bargeThreshold]);

  useEffect(() => { if (!active) { setArmed(false); autoRef.current = false; quickFails.current = 0; setBroken(false); } }, [active]);

  if (!active) return 'off';
  if (broken) return 'broken';
  if (o.isAudioPlaying || o.callState === 'speaking') return 'speaking';
  if (o.callState === 'thinking' || o.callState === 'connecting') return 'thinking';
  if (o.isTranscribing) return 'sending';
  if (o.isListening) return 'listening';
  return armed ? 'waiting' : 'listening';
}
