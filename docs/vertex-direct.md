# Vertex AI 本机直连

代码：`utils/vertexDirect.ts`（签名、换 token、请求改写）、`components/settings/VertexDirectPanel.tsx`（设置页「· Vertex 直连 ·」）、`utils/anthropicApi.ts` 的 `fetchLlm` 入口分流。

## 规矩

- 服务账号 JSON 只存本机 localStorage（`sully_vertex_sa_v1`）。**不得**加入 lsMirror 以外的备份、云端同步、amsg 凭据，也不得让请求经过任何 Worker / 中转（防止 IP 漂移触发风控）。
- 网络上只允许发往 `oauth2.googleapis.com/token`（换 token）和 `*aiplatform.googleapis.com`（模型）。
- API 设置里 baseUrl 是 `…/projects/{项目}/locations/{区域}/endpoints/openapi`，密钥是占位符 `vertex-local`；真 token 在 `fetchVertex` 里现换现填，内存缓存 1 小时。
- `/models` 被改写成 Vertex 模型目录；没带前缀的模型名自动补 `google/`。
- 主动消息 2.0 在云端执行，用不了本机直连。
