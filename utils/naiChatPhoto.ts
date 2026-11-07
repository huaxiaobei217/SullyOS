/**
 * 聊天里角色「拍照」：回复里写 [[NAI_PHOTO: 英文 tag]]，这里把标签从正文剥掉，
 * 后台排队生图，画好后作为角色发的一张图片存进聊天（失败只提示，不插假图）。
 */
import { DB } from './db';
import { putImageBlob } from './blobRef';
import { generateNaiImage, isNaiReady, loadNaiConfig, type NaiOrient } from './nai';

export const NAI_PHOTO_RE = /\[\[\s*(?:NAI_PHOTO|拍照)\s*[:：]\s*([^\]]+?)\]\]/gi;
export const NAI_PHOTO_READY_EVENT = 'nai-photo-ready';
export const NAI_PHOTO_FAILED_EVENT = 'nai-photo-failed';

export const naiPhotosEnabledFor = (charId: string) => {
  const c = loadNaiConfig();
  return isNaiReady(c) && !!c.chatPhotos[charId];
};

/** 从正文里取出拍照标签（最多一张），返回剥干净的正文 */
export function extractNaiPhotos(content: string): { cleaned: string; scenes: string[] } {
  const scenes: string[] = [];
  const cleaned = content.replace(NAI_PHOTO_RE, (_m, scene) => { scenes.push(String(scene).trim()); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { cleaned, scenes: scenes.slice(0, 1) };
}

export function sendNaiPhoto(charId: string, rawScene: string): void {
  let scene = rawScene;
  let orient: NaiOrient | undefined;
  const m = /^@(landscape|portrait|square)\s+/i.exec(scene);
  if (m) { orient = m[1].toLowerCase() as NaiOrient; scene = scene.slice(m[0].length); }
  const wantsSelf = /(^|,)\s*(self|\{self\}|us|\{us\}|user|\{user\})\s*(,|$)/i.test(scene);
  void (async () => {
    try {
      const blob = await generateNaiImage(scene, { charId, orient: orient || 'portrait', allowPeople: wantsSelf || undefined });
      const token = await putImageBlob(blob);
      await DB.saveMessage({ charId, role: 'assistant', type: 'image', content: token, metadata: { naiScene: scene } } as any);
      window.dispatchEvent(new CustomEvent(NAI_PHOTO_READY_EVENT, { detail: { charId } }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent(NAI_PHOTO_FAILED_EVENT, { detail: { charId, error: e?.message || String(e) } }));
    }
  })();
}

/** 给角色看的能力说明（只在开了「聊天里拍照」时注入） */
export function buildNaiPhotoBlock(charId: string, userName = '对方'): string {
  if (!naiPhotosEnabledFor(charId)) return '';
  return `### 【拍照】
你可以像真人一样偶尔拍张照片发给 ${userName}：手边的东西、窗外、正在看的书、路上看到的场景……在回复末尾单独写一行
[[NAI_PHOTO: 用英文 danbooru tag 描述画面，逗号分隔]]
- 默认拍的是你看到的东西，不是自拍；真要拍你自己，在 tag 里写 self；你们俩的合照写 us（她的样子会自动补上）。
- 自拍、合照是奖励：${userName}做到了让你高兴的事（早睡了、记账了、读完一本书、扛过了难熬的一天……）时，偶尔用一张有你的照片夸她，比说「真棒」管用；平时还是拍你看到的东西。
- 想要横图就在 tag 最前面写 @landscape，方图写 @square。
- 有理由才拍（聊到了、想分享、想让 ta 看看），不要每轮都拍；一次最多一张。照片要过一会儿才会出现，文字里别说「照片如下」。`;
}
