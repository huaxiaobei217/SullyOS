/**
 * 表情包视觉理解（sticker vision）配置层与消息级 helper。
 *
 * 设计基线（见任务规格）：
 *  - 全局开关独立持久化（localStorage `sully-sticker-vision-v1`），默认关闭，
 *    不与 VisionApiConfig.enabled、任何 API 预设绑定。
 *  - 角色 / 群各自持三态 `inherit | on | off`：inherit 跟随全局，on/off 双向覆盖。
 *  - 资格在"表情包创建那一刻"一次性冻结进 message.metadata.stickerVision，
 *    之后无论开关怎么拨都不追溯生效、也不追溯失效。enabled=false 时不写任何
 *    metadata —— 这正是"旧消息永不补识别"的基石：旧消息与该字段完全无交集。
 */

import type { Emoji, Message } from '../types';
import { stickerNameFromUrl } from './messageFormat';

export type StickerVisionMode = 'inherit' | 'on' | 'off';

const STORAGE_KEY = 'sully-sticker-vision-v1';

/** 识别后写回 message.metadata.stickerVision 的形状。 */
export interface StickerVisionMetadata {
    eligible: boolean;
    /** 发送时刻冻结的表情包名称快照。 */
    name: string;
    /** 视觉识别结果；缺省代表尚未识别或识别失败（降级为只报名字）。 */
    description?: string;
    recognizedAt?: number;
    model?: string;
}

export function loadGlobalStickerVisionEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function saveGlobalStickerVisionEnabled(enabled: boolean): void {
    try {
        if (enabled) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

/** 三态解析：inherit→全局默认；on/off 为角色或群的独立覆盖（双向生效）。 */
export function resolveStickerVisionEnabled(globalEnabled: boolean, mode?: StickerVisionMode): boolean {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return globalEnabled;
}

/** 只有 eligible === true 才算有资格；缺失 / 形状不对 / false 一律视为旧消息语义。 */
export function readStickerVision(message: Message): StickerVisionMetadata | undefined {
    const sv = (message.metadata as any)?.stickerVision;
    if (!sv || typeof sv !== 'object' || sv.eligible !== true) return undefined;
    return sv as StickerVisionMetadata;
}

export function isStickerVisionEligible(message: Message): boolean {
    return readStickerVision(message) !== undefined;
}

/** 展示名优先用发送时刻快照；旧消息回落到表情库按 URL 反查。 */
export function readStickerVisionName(message: Message, emojis: Emoji[]): string {
    const sv = readStickerVision(message);
    return sv?.name || stickerNameFromUrl(emojis, typeof message.content === 'string' ? message.content : '');
}

export function readStickerVisionDescription(message: Message): string | undefined {
    const sv = readStickerVision(message);
    const desc = typeof sv?.description === 'string' ? sv.description.trim() : '';
    return desc || undefined;
}

/**
 * 发送时刻冻结视觉资格。返回 undefined 表示本次创建不携带该字段
 * （调用方以 `...(meta ? { metadata: meta } : {})` 或展开合并接入）。
 */
export function buildStickerVisionMetadata(
    name: string | undefined,
    enabled: boolean,
): { stickerVision: StickerVisionMetadata } | undefined {
    if (!enabled) return undefined;
    return { stickerVision: { eligible: true, name: name || '未知表情' } };
}

/** 备份导出：与 mcpLocal 同款模式，随完整备份带走全局开关（存 localStorage）。 */
export function exportStickerVisionLocal(): Record<string, string> | undefined {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v ? { [STORAGE_KEY]: v } : undefined;
    } catch {
        return undefined;
    }
}

export function importStickerVisionLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        if (typeof data[STORAGE_KEY] === 'string') localStorage.setItem(STORAGE_KEY, data[STORAGE_KEY]);
    } catch { /* ignore */ }
}

/**
 * 注意：识图网络调用与 materializeStickerVisionDescriptions 管线在 utils/visionApi.ts
 * （与普通图片 materialization 同文件）。这里刻意不 import visionApi，避免
 * db → stickerVision → visionApi → db 的模块环。
 */
