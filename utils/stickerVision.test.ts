import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, GroupProfile, Message, UserProfile, VisionApiConfig } from '../types';
import { ChatPrompts } from './chatPrompts';
import { DB } from './db';
import { stickerNameFromUrl, normalizeMessageContent } from './messageFormat';
import { buildGroupHistoryBlock } from './groupChat/prompts';
import { messageLogText } from './groupChat/format';
import {
    buildStickerVisionMetadata,
    exportStickerVisionLocal,
    importStickerVisionLocal,
    isStickerVisionEligible,
    loadGlobalStickerVisionEnabled,
    resolveStickerVisionEnabled,
    saveGlobalStickerVisionEnabled,
} from './stickerVision';
import { STICKER_VISION_PROMPT, materializeStickerVisionDescriptions } from './visionApi';

const config: VisionApiConfig = {
    enabled: true,
    baseUrl: 'https://vision.example.com/v1',
    apiKey: 'vision-key',
    model: 'vision-model',
};

const STICKER_URL = 'https://img.example/yin-an-pa-xing.gif';
const emojis = [{ name: '阴暗地爬行', url: STICKER_URL }];

const stickerMessage = (id: number, metadata?: any): Message => ({
    id,
    charId: 'char-1',
    role: 'user',
    type: 'emoji',
    content: STICKER_URL,
    timestamp: 1_700_000_000_000 + id,
    ...(metadata ? { metadata } : {}),
});

const char = { id: 'char-1', name: '小角色' } as CharacterProfile;
const userProfile = { name: '我' } as UserProfile;

const okVisionResponse = (description: string) => new Response(JSON.stringify({
    choices: [{ message: { content: description } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('三层配置解析', () => {
    it('配置矩阵（6 组合）：inherit 跟随全局，on/off 双向覆盖', () => {
        expect(resolveStickerVisionEnabled(false, 'inherit')).toBe(false);
        expect(resolveStickerVisionEnabled(true, 'inherit')).toBe(true);
        expect(resolveStickerVisionEnabled(false, 'on')).toBe(true);
        expect(resolveStickerVisionEnabled(true, 'on')).toBe(true);
        expect(resolveStickerVisionEnabled(false, 'off')).toBe(false);
        expect(resolveStickerVisionEnabled(true, 'off')).toBe(false);
    });

    it('mode 缺省等同于 inherit（旧角色/旧群安全退化）', () => {
        expect(resolveStickerVisionEnabled(true, undefined)).toBe(true);
        expect(resolveStickerVisionEnabled(false, undefined)).toBe(false);
    });

    it('全局开关存取 localStorage，默认关闭', () => {
        expect(loadGlobalStickerVisionEnabled()).toBe(false);
        saveGlobalStickerVisionEnabled(true);
        expect(loadGlobalStickerVisionEnabled()).toBe(true);
        saveGlobalStickerVisionEnabled(false);
        expect(loadGlobalStickerVisionEnabled()).toBe(false);
    });

    it('全局开关随完整备份导出/导入（旧备份无字段时安全不动）', () => {
        saveGlobalStickerVisionEnabled(true);
        const exported = exportStickerVisionLocal();
        localStorage.clear();
        expect(loadGlobalStickerVisionEnabled()).toBe(false);
        importStickerVisionLocal(exported);
        expect(loadGlobalStickerVisionEnabled()).toBe(true);
        importStickerVisionLocal(undefined);
        expect(loadGlobalStickerVisionEnabled()).toBe(true);
    });
});

describe('发送时刻冻结视觉资格', () => {
    it('开启时创建的资格携带发送时刻名称快照', () => {
        const meta = buildStickerVisionMetadata('阴暗地爬行', true);
        expect(meta).toEqual({ stickerVision: { eligible: true, name: '阴暗地爬行' } });
    });

    it('关闭时不产生任何 metadata —— 这是"旧消息永不补识别"的基石', () => {
        expect(buildStickerVisionMetadata('阴暗地爬行', false)).toBeUndefined();
    });

    it('消息级 helper：缺失/false/形状不对一律视为无资格', () => {
        expect(isStickerVisionEligible(stickerMessage(1))).toBe(false);
        expect(isStickerVisionEligible(stickerMessage(2, { stickerVision: { eligible: false, name: 'x' } }))).toBe(false);
        expect(isStickerVisionEligible(stickerMessage(3, { stickerVision: { eligible: true, name: 'x' } }))).toBe(true);
    });

    it('展示名优先用冻结快照，URL 反查只作回落', () => {
        // 表情库里名字已被改掉/删除，快照仍然生效
        const renamed = stickerMessage(4, { stickerVision: { eligible: true, name: '发送时的名字' } });
        expect(stickerNameFromUrl(emojis, STICKER_URL)).toBe('阴暗地爬行');
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [renamed], 10, char, userProfile, [], undefined, { useVisionDescriptions: true },
        );
        expect(apiMessages[0].content).toContain('发送时的名字');
    });
});

describe('materializeStickerVisionDescriptions（独立识图物化）', () => {
    it('成功：使用表情包专用 prompt（非普通图片 prompt），写回 metadata，同批同资源只识一次', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okVisionResponse('一只黄色小人趴在地上缓慢爬行，配文「阴暗地爬行」。'));
        vi.stubGlobal('fetch', fetchMock);
        const updateSpy = vi.spyOn(DB, 'updateMessageMetadata').mockResolvedValue(undefined);

        const prepared = await materializeStickerVisionDescriptions(
            [stickerMessage(1, { stickerVision: { eligible: true, name: '阴暗地爬行' } }),
             stickerMessage(2, { stickerVision: { eligible: true, name: '阴暗地爬行' } })],
            config,
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.messages[0].content[0].text).toBe(STICKER_VISION_PROMPT);
        // 视觉模型不能收到表情包名称作为提示
        expect(body.messages[0].content[0].text).not.toContain('阴暗地爬行');
        expect(updateSpy).toHaveBeenCalledTimes(2);
        expect(prepared[0].metadata.stickerVision.description).toContain('黄色小人');
        expect(prepared[0].metadata.stickerVision.recognizedAt).toBeTypeOf('number');
        expect(prepared[0].metadata.stickerVision.model).toBe('vision-model');

        // 已有描述的后续重跑不再调 API
        await materializeStickerVisionDescriptions(prepared, config);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('无资格旧消息永不补识别（即使识图 API 开着）', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const updateSpy = vi.spyOn(DB, 'updateMessageMetadata').mockResolvedValue(undefined);

        const prepared = await materializeStickerVisionDescriptions([stickerMessage(3)], config);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
        expect(prepared[0]).toEqual(stickerMessage(3));
    });

    it('失败 fail-soft：网络错误不 throw，消息原样保留（名称模式降级），同批失败资源不再重试', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('vision down'));
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(DB, 'updateMessageMetadata').mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const prepared = await materializeStickerVisionDescriptions(
            [stickerMessage(4, { stickerVision: { eligible: true, name: 'x' } }),
             stickerMessage(5, { stickerVision: { eligible: true, name: 'x' } })],
            config,
        );

        expect(fetchMock).toHaveBeenCalledTimes(1); // 第二条因首条失败被跳过
        expect(warnSpy).toHaveBeenCalled();
        expect(prepared[0].metadata.stickerVision).toEqual({ eligible: true, name: 'x' });
        expect(prepared[1].metadata.stickerVision).toEqual({ eligible: true, name: 'x' });
    });

    it('识图 API 未开启 / 配置不完整时整批原样返回，不抛错', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const eligible = stickerMessage(6, { stickerVision: { eligible: true, name: 'x' } });
        expect(await materializeStickerVisionDescriptions([eligible], undefined)).toEqual([eligible]);
        expect(await materializeStickerVisionDescriptions([eligible], { ...config, enabled: false })).toEqual([eligible]);
        expect(await materializeStickerVisionDescriptions([eligible], { ...config, apiKey: '' })).toEqual([eligible]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('图片数据不可用（纯文字备份剥掉了原图）按名称模式降级', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(DB, 'updateMessageMetadata').mockResolvedValue(undefined);
        const broken = { ...stickerMessage(7, { stickerVision: { eligible: true, name: 'x' } }), content: '' };

        const prepared = await materializeStickerVisionDescriptions([broken], config);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(prepared[0].metadata.stickerVision.description).toBeUndefined();
    });
});

describe('buildMessageHistory 私聊三态渲染', () => {
    it('情况1（历史边界）：旧表情无 metadata → 后续无论开关如何都只有名称，不发 image_url', () => {
        const old = stickerMessage(10);
        for (const useVision of [false, true]) {
            const { apiMessages } = ChatPrompts.buildMessageHistory(
                [old], 10, char, userProfile, emojis, undefined, { useVisionDescriptions: useVision },
            );
            expect(apiMessages[0].content).toContain('[用户 发送了表情包: 阴暗地爬行]');
            expect(JSON.stringify(apiMessages)).not.toContain('image_url');
        }
    });

    it('情况2（历史边界）：开启时发送的资格在关闭后仍然生效（描述保留）', () => {
        const eligible = stickerMessage(11, {
            stickerVision: { eligible: true, name: '阴暗地爬行', description: '一只黄色小人趴在地上爬行。' },
        });
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [eligible], 10, char, userProfile, emojis, undefined, { useVisionDescriptions: true },
        );
        expect(apiMessages[0].content).toContain('[用户 发送了表情包: 阴暗地爬行。画面内容：一只黄色小人趴在地上爬行。]');
        expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    });

    it('情况3（历史边界）：关闭时发送的表情无资格，之后开启也不补识别', () => {
        const off = stickerMessage(12);
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [off], 10, char, userProfile, emojis, undefined, { useVisionDescriptions: true },
        );
        expect(apiMessages[0].content).toContain('[用户 发送了表情包: 阴暗地爬行]');
        expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    });

    it('有资格 + 无独立识图 → 主模型收到表情身份文本 + image_url（不伪装成普通图片）', () => {
        const eligible = stickerMessage(13, { stickerVision: { eligible: true, name: '阴暗地爬行' } });
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [eligible], 10, char, userProfile, emojis,
        );
        expect(Array.isArray(apiMessages[0].content)).toBe(true);
        expect(apiMessages[0].content[0].text).toContain('[用户 发送了表情包: 阴暗地爬行。请结合随附的表情包图片理解它实际表达的语气和含义。]');
        expect(apiMessages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: STICKER_URL } });
    });

    it('独立识图开启但这条没拿到描述（识别失败）→ 降级名称模式，不发 image_url', () => {
        const eligible = stickerMessage(14, { stickerVision: { eligible: true, name: '阴暗地爬行' } });
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [eligible], 10, char, userProfile, emojis, undefined, { useVisionDescriptions: true },
        );
        expect(apiMessages[0].content).toContain('[用户 发送了表情包: 阴暗地爬行]');
        expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    });

    it('角色自己发的表情用「你 发送了表情包」', () => {
        const mine = { ...stickerMessage(15, { stickerVision: { eligible: true, name: '比心' } }), role: 'assistant' as const };
        const { apiMessages } = ChatPrompts.buildMessageHistory(
            [mine], 10, char, userProfile, emojis, undefined, { useVisionDescriptions: true },
        );
        expect(apiMessages[0].content).toContain('你 发送了表情包: 比心');
    });
});

describe('chat_forward 转发渲染', () => {
    const buildForward = (messages: any[], options?: { useVisionDescriptions?: boolean }) => {
        const forwardMessage = {
            id: 99,
            charId: 'char-1',
            role: 'user',
            type: 'chat_forward',
            content: JSON.stringify({
                fromUserName: '我',
                fromCharName: '另一个角色',
                count: messages.length,
                messages,
            }),
            timestamp: 1_700_000_100_000,
        } as Message;
        return ChatPrompts.buildMessageHistory(
            [forwardMessage], 10, char, userProfile, emojis, undefined, options,
        ).apiMessages[0].content;
    };

    it('有描述：目标角色即使关了表情包视觉也看得到名称+画面内容（历史语义不得删）', () => {
        const content = buildForward([
            { role: 'user', type: 'emoji', content: STICKER_URL, timestamp: 1, stickerName: '阴暗地爬行', stickerVision: { eligible: true, description: '黄色小人趴地爬行。' } },
        ], { useVisionDescriptions: true });
        expect(content).toContain('[表情包: 阴暗地爬行。画面内容：黄色小人趴地爬行。]');
        expect(content).not.toContain('[表情]');
        expect(JSON.stringify(content)).not.toContain('image_url');
    });

    it('只有资格没描述且无独立识图：保留真实图片能力，并明确标注是转发表情', () => {
        const content = buildForward([
            { role: 'user', type: 'emoji', content: STICKER_URL, timestamp: 1, stickerName: '阴暗地爬行', stickerVision: { eligible: true } },
        ]);
        expect(JSON.stringify(content)).toContain('被转发聊天记录中的表情包: 阴暗地爬行');
        expect((content[0] as any).text).toContain('被转发聊天记录中的表情包: 阴暗地爬行');
        expect(content[1]).toEqual({ type: 'image_url', image_url: { url: STICKER_URL } });
    });

    it('只有资格没描述但独立识图开着（纯文本兼容）：退回名称模式，不发图', () => {
        const content = buildForward([
            { role: 'user', type: 'emoji', content: STICKER_URL, timestamp: 1, stickerName: '阴暗地爬行', stickerVision: { eligible: true } },
        ], { useVisionDescriptions: true });
        expect(content).toContain('[表情包: 阴暗地爬行]');
        expect(JSON.stringify(content)).not.toContain('image_url');
    });

    it('无资格旧表情：转发后只有名称，不得触发补识别', () => {
        const content = buildForward([
            { role: 'user', type: 'emoji', content: STICKER_URL, timestamp: 1, stickerName: '阴暗地爬行' },
        ]);
        expect(content).toContain('[表情包: 阴暗地爬行]');
        expect(JSON.stringify(content)).not.toContain('image_url');
        expect(content).not.toContain('画面内容');
    });
});

describe('群聊 buildGroupHistoryBlock 三态渲染', () => {
    const group = { id: 'g1', members: ['char-1'] } as GroupProfile;
    const members = [char];

    it('旧表情只报名称（不看当前开关）', () => {
        const block = buildGroupHistoryBlock([stickerMessage(20)], members, emojis, '我', 0);
        expect(block.text).toContain('用户: [表情包: 阴暗地爬行]');
        expect(block.attachedImages).toHaveLength(0);
    });

    it('有资格+描述且识图开着 → 名称+画面内容；识图关着描述也不消失（场景 D）', () => {
        const described = stickerMessage(21, {
            stickerVision: { eligible: true, name: '阴暗地爬行', description: '黄色小人趴地爬行。' },
        });
        const withVision = buildGroupHistoryBlock([described], members, emojis, '我', 0, { useVisionDescriptions: true });
        expect(withVision.text).toContain('[表情包: 阴暗地爬行。画面内容：黄色小人趴地爬行。]');
        const withoutVision = buildGroupHistoryBlock([described], members, emojis, '我', 0);
        expect(withoutVision.text).toContain('[表情包: 阴暗地爬行。画面内容：黄色小人趴地爬行。]');
        expect(withoutVision.attachedImages).toHaveLength(0);
    });

    it('有资格无描述且识图关着 → 进附带窗口带真实图，占位行标注是表情包', () => {
        const eligible = stickerMessage(22, { stickerVision: { eligible: true, name: '阴暗地爬行' } });
        const block = buildGroupHistoryBlock([eligible], members, emojis, '我', 3);
        expect(block.text).toContain('[表情包: 阴暗地爬行，真实图片见随附图片#1]');
        expect(block.attachedImages).toEqual([{ tag: 1, url: STICKER_URL }]);
    });

    it('有资格无描述但识图开着（识别失败降级）→ 只报名称，不进附带窗口', () => {
        const eligible = stickerMessage(23, { stickerVision: { eligible: true, name: '阴暗地爬行' } });
        const block = buildGroupHistoryBlock([eligible], members, emojis, '我', 3, { useVisionDescriptions: true });
        expect(block.text).toContain('[表情包: 阴暗地爬行]');
        expect(block.attachedImages).toHaveLength(0);
    });

    it('群成员的表情占位行带成员名（资格与发送者无关）', () => {
        const memberSticker = { ...stickerMessage(24, { stickerVision: { eligible: true, name: '比心' } }), charId: group.members[0], role: 'assistant' as const };
        const block = buildGroupHistoryBlock([memberSticker], members, emojis, '我', 0, { useVisionDescriptions: true });
        expect(block.text).toContain('小角色: [表情包: 比心]');
    });
});

describe('记忆宫殿 / 总结隔离', () => {
    it('normalizeMessageContent 不吃 stickerVision.description（表情仍按占位符处理）', () => {
        const described = stickerMessage(30, {
            stickerVision: { eligible: true, name: '阴暗地爬行', description: '非常详细的 meme 描述，绝不能泄漏进记忆。' },
        });
        const text = normalizeMessageContent(described, '小角色', '我');
        expect(text).not.toContain('非常详细的 meme 描述');
    });

    it('messageLogText（群聊上下文/总结用）不吃 stickerVision.description', () => {
        const described = stickerMessage(31, {
            stickerVision: { eligible: true, name: '阴暗地爬行', description: '非常详细的 meme 描述，绝不能泄漏进总结。' },
        });
        const text = messageLogText(described, (url) => stickerNameFromUrl(emojis, url));
        expect(text).toBe('[表情包: 阴暗地爬行]');
        expect(text).not.toContain('非常详细的 meme 描述');
    });

    it('有资格+描述不依赖识图开关：不带识图选项的调用方（scheduleGenerator 等）同样读得到 Case B 文本', () => {
        const described = stickerMessage(32, {
            stickerVision: { eligible: true, name: '阴暗地爬行', description: '黄色小人趴地爬行。' },
        });
        const { apiMessages } = ChatPrompts.buildMessageHistory([described], 10, char, userProfile, emojis);
        expect(apiMessages[0].content).toContain('[用户 发送了表情包: 阴暗地爬行。画面内容：黄色小人趴地爬行。]');
        expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    });
});
