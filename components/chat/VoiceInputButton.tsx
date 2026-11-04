/**
 * 聊天输入框里的麦克风：点一下开始说，再点一下结束，转成文字填进输入框（可以改了再发）。
 * 识别走「电话」里选的那家（MiniMax / 鱼声 / ElevenLabs），没配就用浏览器 / 系统自带的识别。
 */
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Microphone, Stop } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { startStt, isSttSupported, type SttSession } from '../../utils/speechToText';

const VoiceInputButton: React.FC<{ input: string; setInput: (v: string) => void; className?: string }> = ({ input, setInput, className }) => {
  const { apiConfig, addToast } = useOS() as any;
  const [state, setState] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const [partial, setPartial] = useState('');
  const session = useRef<SttSession | null>(null);
  const base = useRef('');
  if (!isSttSupported(apiConfig)) return null;

  const start = async () => {
    base.current = input;
    setPartial('');
    setState('listening');
    try {
      session.current = await startStt('zh-CN', {
        onPartial: t => setPartial(t),
        onFinal: t => {
          const text = (t || '').trim();
          if (text) setInput(base.current ? `${base.current}${/[\s，。！？,.!?]$/.test(base.current) ? '' : ' '}${text}` : text);
        },
        onTranscribing: on => setState(on ? 'transcribing' : 'listening'),
        onError: msg => addToast?.(msg, 'error'),
        onEnd: () => { setState('idle'); setPartial(''); session.current = null; },
      }, apiConfig);
    } catch (e: any) {
      addToast?.(`麦克风没打开：${e?.message || e}`, 'error');
      setState('idle');
    }
  };
  const stop = () => { session.current?.stop(); };

  return (
    <>
      <button type="button" aria-label={state === 'idle' ? '语音输入' : '结束语音输入'}
        onClick={state === 'idle' ? start : stop}
        className={`p-2 shrink-0 ${state !== 'idle' ? 'text-rose-500 animate-pulse' : className || 'text-slate-400 hover:text-primary'}`}>
        {state === 'idle' ? <Microphone className="w-6 h-6" weight="regular" /> : <Stop className="w-6 h-6" weight="fill" />}
      </button>
      {state !== 'idle' && createPortal(
        <div className="fixed left-4 right-4 z-[9999] rounded-2xl px-4 py-3 bg-black/75 text-white text-[13px] leading-relaxed shadow-lg pointer-events-none" style={{ bottom: 'calc(var(--safe-bottom, 0px) + 96px)' }}>
          <div className="text-[10.5px] opacity-70 mb-0.5">{state === 'transcribing' ? '正在转成文字…' : '在听，说完点 ■ 结束'}</div>
          <div>{partial || '……'}</div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default VoiceInputButton;
