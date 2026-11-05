/**
 * 电话 · 免提模式（像 ChatGPT 语音那样）：
 *  - 轮到你说话时自动开麦；你说完停顿约 1.2 秒，自动结束识别并发送
 *  - 他用语音回你，念完自动接着听
 *  - 他说话时你开口（持续约 0.35 秒、音量明显高于底噪），就打断他、开始听你说
 *  - 一轮没说话（约 12 秒）就不再反复开识别，改成「等你开口」：检测到声音才开（省识别费用，开头可能吃掉半个字）
 * 只在通话页面打开时工作；用到的识别 / 发送 / 停播都由电话页传进来，不改原来的点按流程。
 */
import { useEffect, useRef, useState } from 'react';

export type HandsFreeStatus = 'off' | 'waiting' | 'listening' | 'sending' | 'thinking' | 'speaking';

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
}

const SILENCE_END_MS = 1200;
const NO_SPEECH_MS = 12000;
const BARGE_MS = 350;

export function useHandsFreeCall(o: Opts): HandsFreeStatus {
  const latest = useRef(o); latest.current = o;
  const [armed, setArmed] = useState(false);          // true = 等你开口才开识别
  const autoRef = useRef(false);                      // 这一轮识别是免提开的，结束后自动发送
  const heardRef = useRef(false);                     // 这一轮里听到过人声
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const floorRef = useRef(0.01);
  const [level, setLevel] = useState(0);

  const active = o.enabled && o.inCall;

  /* 开一路麦克风给音量检测用（和识别各自独立；开了回声消除，他的声音不容易误触发打断） */
  useEffect(() => {
    if (!active) return;
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
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close().catch(() => {});
      streamRef.current = null; ctxRef.current = null; analyserRef.current = null;
    };
  }, [active]);

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
    if (!active || c.callState !== 'listening' || c.isAudioPlaying || c.isListening || c.isTranscribing || c.draftInput.trim()) return;
    if (armed && !(analyserRef.current && loud)) return;
    const t = setTimeout(() => {
      const n = latest.current;
      if (n.callState !== 'listening' || n.isAudioPlaying || n.isListening || n.isTranscribing) return;
      autoRef.current = true; heardRef.current = armed; setArmed(false);
      n.startListening();
    }, armed ? 0 : 400);
    return () => clearTimeout(t);
  }, [active, o.callState, o.isAudioPlaying, o.isListening, o.isTranscribing, o.draftInput, armed, loud]);

  /* 识别中：说完停顿就结束；一直没开口就收起来改成等你开口 */
  const lastLoudAt = useRef(0);
  const listenStartedAt = useRef(0);
  useEffect(() => {
    if (o.isListening && autoRef.current) { listenStartedAt.current = Date.now(); lastLoudAt.current = 0; }
  }, [o.isListening]);
  useEffect(() => {
    if (!active || !o.isListening || !autoRef.current || !analyserRef.current) return;
    const now = Date.now();
    if (loud) { heardRef.current = true; lastLoudAt.current = now; return; }
    if (heardRef.current && lastLoudAt.current && now - lastLoudAt.current > SILENCE_END_MS) { latest.current.stopListening(); return; }
    if (!heardRef.current && now - listenStartedAt.current > NO_SPEECH_MS) { autoRef.current = false; setArmed(true); latest.current.stopListening(); }
  }, [active, o.isListening, level, loud]);

  /* 识别结束、文字到了：自动发送 */
  useEffect(() => {
    if (!active || o.isListening || o.isTranscribing || !autoRef.current) return;
    if (!o.draftInput.trim()) { if (!o.isTranscribing) autoRef.current = false; return; }
    autoRef.current = false;
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

  useEffect(() => { if (!active) { setArmed(false); autoRef.current = false; } }, [active]);

  if (!active) return 'off';
  if (o.isAudioPlaying || o.callState === 'speaking') return 'speaking';
  if (o.callState === 'thinking' || o.callState === 'connecting') return 'thinking';
  if (o.isTranscribing) return 'sending';
  if (o.isListening) return 'listening';
  return armed ? 'waiting' : 'listening';
}
