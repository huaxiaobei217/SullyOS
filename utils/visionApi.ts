import type { ApiPreset, Message, VisionApiConfig } from '../types';
import { DB } from './db';
import { extractContent, safeFetchJson } from './safeApi';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';
import { isBlobRef } from './blobRef';
import { readStickerVision, readStickerVisionDescription } from './stickerVision';

export const VISION_DESCRIPTION_METADATA_KEY = 'visionDescription';

/** 设置页测试识图能力时发送的 48×48 白底紫色圆点 PNG。 */
export const VISION_API_TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADKSURBVGhD7Y+5DQMxDASvLtfmll2DDQYHHDYwfxGCdoBJFGg513dzLnzYDQZMw4BpGDANA568Xx+zVZQE4HEes6QC8JiMUcIBeECFEUIBOFypF3cADnbowRWAQ51aOScAB1Zo4YwA/HilGgzoVoMB3WqoAfjhajXUAAE/XakGA7rVYEC3GqYAAT9eoYVzAgQc6NTKWQECDnXowR0g4GClXkIBAg5XGCEcIOABGaOkAm7wGI9ZSgJu8Lh/VlEaMAEDpmHANAyYZvuAH2hIrK7auxVfAAAAAElFTkSuQmCC';

const VISION_PROMPT = `请准确、具体地描述图片中实际可见的内容，供另一个无法看图的对话模型理解。
请覆盖主体、动作、场景、重要物品、画面中的文字或界面信息；不要猜测画面外的信息，不要寒暄，只输出描述正文。`;

/**
 * 这个值还能拿去识图吗。三种形态都算数：内嵌的 data URL、网络地址，以及本机存的
 * 图片令牌（`blobref:`，二进制在 blob_assets 里，见 utils/blobRef.ts）——令牌发出去
 * 之前会由网络出口统一还原成 data URL（utils/apiBlobRefs.ts），这里只负责别把它
 * 误判成「图没了」。
 *
 * 判漏的后果是静默的：图明明在，识图这步却直接跳过或报「图片数据不可用」，
 * 界面上一点征兆都没有。
 */
const canDescribeImage = (value: unknown): value is string =>
  typeof value === 'string' && (/^(data:image\/|https?:\/\/)/i.test(value) || isBlobRef(value));

const inFlightDescriptions = new Map<string, Promise<string>>();

/** 把一份通用模型预设填入独立识图配置，不改变主 API 当前选择。 */
export const visionApiConfigFromPreset = (preset: ApiPreset, enabled = true): VisionApiConfig => ({
  enabled,
  baseUrl: normalizeApiBaseUrl(preset.config.baseUrl),
  apiKey: normalizeApiCredential(preset.config.apiKey),
  model: normalizeApiModel(preset.config.model),
});

export const isVisionApiReady = (config?: VisionApiConfig | null): config is VisionApiConfig =>
  config?.enabled === true
  && !!config.baseUrl?.trim()
  && !!config.apiKey?.trim()
  && !!config.model?.trim();

export const readVisionDescription = (message: Message): string => {
  const value = message.metadata?.[VISION_DESCRIPTION_METADATA_KEY];
  return typeof value === 'string' ? value.trim() : '';
};

const cleanDescription = (value: string): string => value
  .replace(/^\s*\[?图片\s*[：:]\s*/i, '')
  .replace(/\]\s*$/i, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 4000);

/** 调用 OpenAI 兼容视觉端点，把一张图片变成可交给纯文本模型的描述。 */
export async function describeImageWithVisionApi(
  imageUrl: string,
  config: VisionApiConfig,
  options?: { prompt?: string },
): Promise<string> {
  if (!isVisionApiReady(config)) {
    throw new Error('识图 API 已开启，但 URL、Key 或 Model 尚未填写完整');
  }
  if (!canDescribeImage(imageUrl)) {
    throw new Error('图片数据不可用，无法调用识图 API');
  }

  const prompt = options?.prompt?.trim() || VISION_PROMPT;
  const dedupKey = `${prompt}\u0000${imageUrl}`;
  const existing = inFlightDescriptions.get(dedupKey);
  if (existing) return existing;

  const request = (async () => {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        temperature: 0,
        max_tokens: 1200,
        stream: false,
      }),
    }, 1, 60_000, { appName: '消息', purpose: '识图' });

    const description = cleanDescription(extractContent(data));
    if (!description) throw new Error('识图 API 没有返回图片描述');
    return description;
  })();

  inFlightDescriptions.set(dedupKey, request);
  try {
    return await request;
  } finally {
    inFlightDescriptions.delete(dedupKey);
  }
}

/**
 * 为聊天历史里的图片补齐识图描述。
 *
 * 描述写回消息 metadata，因此同一条图片消息后续聊天、重 roll、主动消息都只识别一次；
 * 同一批里内容完全相同的图片也会复用第一次结果。
 */
export async function materializeVisionDescriptions(
  messages: Message[],
  config?: VisionApiConfig | null,
): Promise<Message[]> {
  if (config?.enabled !== true) return messages;
  if (!isVisionApiReady(config)) {
    throw new Error('识图 API 已开启，但 URL、Key 或 Model 尚未填写完整');
  }

  const descriptionByImage = new Map<string, string>();
  const prepared: Message[] = [];

  for (const message of messages) {
    if(message.type==='friend_feed_share_card') {
      const share=message.metadata?.friendFeedShare;
      if(!share?.imagesEnabled || !Array.isArray(share.imageRefs) || readVisionDescription(message)) {prepared.push(message);continue;}
      const refs=share.imageRefs.filter((r:unknown)=>typeof r==='string'&&(isBlobRef(r)||r.startsWith('data:image/'))).slice(0,18);
      const descriptions:string[]=[];
      for(const [index,ref] of refs.entries()){
        const description=descriptionByImage.get(ref)||await describeImageWithVisionApi(ref,config);
        descriptionByImage.set(ref,description);descriptions.push(`配图 ${index+1}：${description}`);
      }
      if(!descriptions.length){prepared.push(message);continue;}
      const metadata={...message.metadata,visionDescription:descriptions.join('\n'),visionRecognizedAt:Date.now(),visionModel:config.model.trim()};
      await DB.updateMessageMetadata(message.id,prev=>({...prev,...metadata}));prepared.push({...message,metadata});continue;
    }
    if (message.type !== 'image') {
      prepared.push(message);
      continue;
    }

    const cached = readVisionDescription(message);
    if (cached) {
      descriptionByImage.set(message.content, cached);
      prepared.push(message);
      continue;
    }

    const imageUrl = typeof message.content === 'string' ? message.content : '';
    // 纯文字备份会保留 image 消息但移除原图数据；这种历史沿用“图片已不可用”占位，
    // 不能因为新开了识图 API 就让整轮聊天失败。
    if (!canDescribeImage(imageUrl)) {
      prepared.push(message);
      continue;
    }
    const description = descriptionByImage.get(imageUrl)
      || await describeImageWithVisionApi(imageUrl, config);
    descriptionByImage.set(imageUrl, description);

    const metadata = {
      ...(message.metadata || {}),
      [VISION_DESCRIPTION_METADATA_KEY]: description,
      visionRecognizedAt: Date.now(),
      visionModel: config.model.trim(),
    };
    // 先写回 DB 再调用主模型：下一轮与刷新页面后都会直接命中，不重复扣识图额度。
    await DB.updateMessageMetadata(message.id, prev => ({ ...(prev || {}), ...metadata }));
    prepared.push({ ...message, metadata });
  }

  return prepared;
}

export { canDescribeImage };

/** 表情包专用识图提示词。与普通图片不同：重视聊天语义、图内文字与 meme 含义；
 *  刻意不给视觉模型表情包名称，避免它被名称诱导「看图说名称」。名称由客户端另拼。 */
export const STICKER_VISION_PROMPT = `这是一张聊天中使用的表情包 / meme 图片。
请准确描述图片实际可见的内容，并帮助另一个无法看图的聊天模型理解它在对话中的表达效果。

重点关注：
1. 图片中的人物、动物、物体、动作和表情；
2. 图片上的文字；
3. 夸张、荒诞、反差、抽象等视觉元素；
4. 这张图通常可能表达的语气、情绪或 meme 式含义。

不要根据文件名或表情包名称猜测画面；
不要编造画面外的信息；
“可能表达”可以结合图像本身判断，但不要把不确定的网络梗来源说成事实；
输出简洁自然的描述，不要寒暄。`;

/**
 * 为聊天窗口内的 eligible 表情包补齐视觉描述。与普通图片的 materializeVisionDescriptions
 * 平行、互不干扰：
 *  - 只处理 type === 'emoji' 且 metadata.stickerVision.eligible === true 且尚无 description 的消息；
 *    旧表情（无资格）永远不会被它碰，无论当前开关如何。
 *  - 识别结果写回 metadata.stickerVision.description/recognizedAt/model，一次识别永久复用。
 *  - 同批次相同资源复用第一次结果；失败过的资源同批次不再重试。
 *  - 全程 fail-soft：识图配置不完整 / 网络失败 / 返回为空都只让该表情降级为名称模式，
 *    绝不 throw 让整轮聊天失败（这是与 materializeVisionDescriptions 最大的语义差异）。
 */
const STICKER_ARCHIVE_KEY = 'sully_sticker_vision_archive_v1';
const archiveKeyOf = (url: string) => {
  if (url.length <= 200) return url;
  let h = 5381; for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}:${url.length}`;
};
export function getStickerArchive(url: string): string {
  try { return (JSON.parse(localStorage.getItem(STICKER_ARCHIVE_KEY) || '{}') || {})[archiveKeyOf(url)]?.d || ''; } catch { return ''; }
}
function putStickerArchive(url: string, description: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STICKER_ARCHIVE_KEY) || '{}') || {};
    all[archiveKeyOf(url)] = { d: description, t: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 600) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - 600).forEach(k => delete all[k]);
    localStorage.setItem(STICKER_ARCHIVE_KEY, JSON.stringify(all));
  } catch { /* 满了就不存 */ }
}
export function stickerArchiveCount(): number {
  try { return Object.keys(JSON.parse(localStorage.getItem(STICKER_ARCHIVE_KEY) || '{}') || {}).length; } catch { return 0; }
}

export async function materializeStickerVisionDescriptions(
  messages: Message[],
  config?: VisionApiConfig | null,
): Promise<Message[]> {
  if (config?.enabled !== true || !isVisionApiReady(config)) return messages;

  const descriptionByImage = new Map<string, string>();
  const failedImages = new Set<string>();
  const prepared: Message[] = [];

  for (const message of messages) {
    if (message.type !== 'emoji') {
      prepared.push(message);
      continue;
    }
    const vision = readStickerVision(message);
    if (!vision || readStickerVisionDescription(message)) {
      prepared.push(message);
      continue;
    }
    const imageUrl = typeof message.content === 'string' ? message.content : '';
    if (failedImages.has(imageUrl)) {
      prepared.push(message);
      continue;
    }
    // 二改：表情包识图存档——同一张图（同一个 URL / blobref）认过一次，以后直接用存档，不重复花识图额度
    const shared = descriptionByImage.get(imageUrl) || getStickerArchive(imageUrl);
    if (shared) {
      prepared.push(await writeStickerVisionDescription(message, shared, config));
      continue;
    }
    // 纯文字备份会保留消息但移除原图数据；这种历史沿用名称模式，不能让它失败。
    if (!canDescribeImage(imageUrl)) {
      failedImages.add(imageUrl);
      prepared.push(message);
      continue;
    }
    try {
      const description = await describeImageWithVisionApi(imageUrl, config, { prompt: STICKER_VISION_PROMPT });
      descriptionByImage.set(imageUrl, description);
      putStickerArchive(imageUrl, description);
      prepared.push(await writeStickerVisionDescription(message, description, config));
    } catch (error) {
      console.warn('[stickerVision] 表情包识图失败，该表情本轮降级为名称模式', error);
      failedImages.add(imageUrl);
      prepared.push(message);
    }
  }

  return prepared;
}

/** 把识别到的描述合并进 metadata.stickerVision 并落库；DB 写回失败同样 fail-soft（只丢描述不丢消息）。 */
async function writeStickerVisionDescription(message: Message, description: string, config: VisionApiConfig): Promise<Message> {
  const metadata = {
    ...(message.metadata || {}),
    stickerVision: {
      ...(readStickerVision(message) || { eligible: true, name: '未知表情' }),
      description,
      recognizedAt: Date.now(),
      model: config.model.trim(),
    },
  };
  try {
    await DB.updateMessageMetadata(message.id, prev => ({ ...(prev || {}), ...metadata }));
  } catch (error) {
    console.warn('[stickerVision] 描述写回 metadata 失败，本轮仍按已识别内容渲染', error);
  }
  return { ...message, metadata };
}
