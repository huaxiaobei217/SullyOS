import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

export const CHAT_AUTO_REPLY_DELAY_MS = 2000;

interface Options {
    enabled: boolean;
    conversationId: string | null;
    active: boolean;
    blocked: boolean;
    generating: boolean;
    onGenerate: () => void;
    /** 二改：这次要等多久（他在忙时会久一点）；不填就是默认的 2 秒 */
    delayMs?: () => number;
    /** 倒计时旁边写什么（比如「他在开会」） */
    label?: string | null;
}

const newWork = () => ({ pending: false, sends: new Set<symbol>(), cancelVersion: 0 });

/** 只处理本次聊天实际发送的消息；历史加载、切角色和取消都不会补触发。 */
export function useChatAutoReply(options: Options) {
    const current = useRef(options);
    useLayoutEffect(() => { current.current = options; });
    const workRef = useRef(newWork());
    const [revision, refresh] = useReducer(n => n + 1, 0);
    const [seconds, setSeconds] = useState<number | null>(null);
    const [visible, setVisible] = useState(() => !document.hidden);

    const cancel = useCallback(() => {
        const work = workRef.current;
        work.pending = false;
        work.cancelVersion++;
        setSeconds(null);
        refresh();
    }, []);

    useLayoutEffect(() => {
        workRef.current = newWork();
        setSeconds(null);
        refresh();
        return () => { workRef.current = newWork(); };
    }, [options.conversationId, options.enabled, options.active]);

    // 手动闪电、重生成或其他生成入口已经接手时，取消尚未执行的自动回复。
    useLayoutEffect(() => {
        if (options.generating) cancel();
    }, [options.generating, cancel]);

    useEffect(() => {
        const onVisibility = () => setVisible(!document.hidden);
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    // 从发送开始就暂停计时，直到图片处理、落库和聊天刷新都结束。
    // 返回的完成函数绑定本次会话；切走或取消后，晚到的结果不会重新启动倒计时。
    const beginSend = useCallback((conversationId: string | null) => {
        if (!current.current.enabled || !current.current.active || conversationId !== current.current.conversationId) {
            return (_sent: boolean) => {};
        }
        const work = workRef.current;
        const token = Symbol();
        const version = work.cancelVersion;
        work.sends.add(token);
        setSeconds(null);
        refresh();
        return (sent: boolean) => {
            if (workRef.current !== work || !work.sends.delete(token)) return;
            if (sent && version === work.cancelVersion) work.pending = true;
            refresh();
        };
    }, []);

    useEffect(() => {
        const work = workRef.current;
        const ready = () => {
            const latest = current.current;
            return workRef.current === work && work.pending && work.sends.size === 0
                && latest.enabled && latest.active && !latest.blocked && !latest.generating
                && !document.hidden;
        };
        if (!visible || !ready()) {
            setSeconds(null);
            return;
        }
        const total = Math.max(CHAT_AUTO_REPLY_DELAY_MS, current.current.delayMs?.() || CHAT_AUTO_REPLY_DELAY_MS);
        const startAt = Date.now();
        setSeconds(Math.ceil(total / 1000));
        const tick = window.setInterval(() => { if (ready()) setSeconds(Math.max(1, Math.ceil((total - (Date.now() - startAt)) / 1000))); }, 1000);
        const timer = window.setTimeout(() => {
            if (!ready()) return;
            cancel();
            current.current.onGenerate();
        }, total);
        return () => { window.clearInterval(tick); window.clearTimeout(timer); };
    }, [revision, visible, options.enabled, options.active, options.blocked, options.generating, options.conversationId, cancel]);

    return { seconds, beginSend, cancel };
}
