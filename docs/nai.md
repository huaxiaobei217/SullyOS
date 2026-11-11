# NovelAI 生图

代码：`utils/nai.ts`（提示词、拼车排队、单并发、解 zip）、`utils/naiChatPhoto.ts`（聊天里拍照）、`components/settings/NaiSettingsPanel.tsx`、页脚里的便签配图与背景（`utils/footnote.ts` 的 `drawCardImage`）。

## 规矩

- NovelAI Key 只存本机 localStorage（`sully_nai_cfg_v1`），不进镜像/备份/云端。生图请求只经过**用户自己的**代理 Worker：`POST /nai/generate`（Key 放 Authorization 透传，不记录）。
- 拼车排队兼容 st-chatu8 队列服务：只发 Key 的 SHA-256；队列调用经 Worker 的 `/lx/request` 中转。连不上队列就直接画，排队超时就放弃这次。
- 全局单并发 + 两张之间至少 6 秒 + 429 退避，避免同一个 Key 被并发打爆。
- 默认只画无人场景（去掉人物 tag、加 no humans / background dataset）；写 self 才按角色外貌 tag 画本人。
- 聊天拍照：角色回复写 `[[NAI_PHOTO: tags]]`，正文剥掉标签，后台画好后作为角色发的 image 消息存入（`metadata.naiScene` 给模型看）；失败只提示不插假图。只有在 NAI 设置里给该角色勾了「聊天里拍照」才注入能力说明。

## 绘图 App（个人二改，搬 ST-iPhonie）

代码：`apps/DrawApp.tsx`（界面）、`utils/naiStudio.ts`（请求拼法、模型能力、导演工具、放大、Vibe、读图）、`utils/drawAssistant.ts`（小助手和提示词工具）。拼法照 ST-iPhonie（github.com/hey8v0/ST-iPhonie，作者同意搬运）的 core/novelai.js。

- 用同一把 Key（`sully_nai_cfg_v1`）和同一套画风；登记外貌（角色外貌 tag、你的外貌 tag）给助手和工作台的「+ 角色」用。
- 线路：先走自己的 Worker 的 `/nai/x/<路径>`（只放行 generate-image、generate-image-stream、augment-image、encode-vibe、suggest-tags、upscale、user/subscription，带图请求上限 40MB，Key 只透传）；Worker 没更新（404）时直连 NovelAI（image.novelai.net 允许跨域）。不经过任何第三方。
- 所有会出图 / 扣 Anlas 的请求一次一个、间隔 6 秒、429 退避。免费档守卫默认开：Opus 订阅时超出 28 步或 1024×1024 自动压回去；要扣 Anlas 的操作（放大、增强、导演工具、Vibe 编码、守卫关时的大图）先问。
- 画出来的图存成 blobref 令牌，清单在 localStorage `sully_draw_history_v1`（GC 会扫 localStorage，不会被当孤儿删）。参考图 `sully_draw_refs_v1`（含 Vibe 编码缓存），助手对话 `sully_draw_chat_v1`，工作台 `sully_draw_work_v1`。都只在本机。
