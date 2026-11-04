# NovelAI 生图

代码：`utils/nai.ts`（提示词、拼车排队、单并发、解 zip）、`utils/naiChatPhoto.ts`（聊天里拍照）、`components/settings/NaiSettingsPanel.tsx`、页脚里的便签配图与背景（`utils/footnote.ts` 的 `drawCardImage`）。

## 规矩

- NovelAI Key 只存本机 localStorage（`sully_nai_cfg_v1`），不进镜像/备份/云端。生图请求只经过**用户自己的**代理 Worker：`POST /nai/generate`（Key 放 Authorization 透传，不记录）。
- 拼车排队兼容 st-chatu8 队列服务：只发 Key 的 SHA-256；队列调用经 Worker 的 `/lx/request` 中转。连不上队列就直接画，排队超时就放弃这次。
- 全局单并发 + 两张之间至少 6 秒 + 429 退避，避免同一个 Key 被并发打爆。
- 默认只画无人场景（去掉人物 tag、加 no humans / background dataset）；写 self 才按角色外貌 tag 画本人。
- 聊天拍照：角色回复写 `[[NAI_PHOTO: tags]]`，正文剥掉标签，后台画好后作为角色发的 image 消息存入（`metadata.naiScene` 给模型看）；失败只提示不插假图。只有在 NAI 设置里给该角色勾了「聊天里拍照」才注入能力说明。
