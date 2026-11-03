/**
 * Vertex AI 本机直连。
 *
 * 用户导入 Google Cloud 服务账号 JSON，只存在这台设备的 localStorage 里（不进备份、不进镜像、
 * 不上云、不经过任何 Worker / 中转）。需要调用时在浏览器里用 WebCrypto 给 JWT 签名，
 * 直接向 Google 换一小时有效的 access token，再直接请求 Vertex 的 OpenAI 兼容端点：
 *   https://aiplatform.googleapis.com/v1/projects/{项目}/locations/global/endpoints/openapi/chat/completions
 *
 * 接入方式：API 设置里 baseUrl 填上面的 …/endpoints/openapi，密钥填占位符 vertex-local。
 * fetchLlm 发现请求打到 aiplatform.googleapis.com 时交给这里：换上真 token、补全模型名前缀、
 * 把「拉取模型」的 /models 请求换成 Vertex 自己的模型列表。
 *
 * 安全约束：私钥只会被拿来在本机签名；网络上只发往 oauth2.googleapis.com（换 token）和
 * *.aiplatform.googleapis.com（调用模型）。
 */

export const VERTEX_STORE_KEY = 'sully_vertex_sa_v1';
export const VERTEX_PLACEHOLDER_KEY = 'vertex-local';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

export interface VertexServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export interface VertexStore {
  sa: VertexServiceAccount;
  location: string;
}

export const loadVertexStore = (): VertexStore | null => {
  try {
    const raw = localStorage.getItem(VERTEX_STORE_KEY);
    const j = raw ? JSON.parse(raw) : null;
    return j?.sa?.private_key && j?.sa?.client_email ? j : null;
  } catch { return null; }
};

export const saveVertexStore = (s: VertexStore | null) => {
  cachedToken = null;
  try {
    if (s) localStorage.setItem(VERTEX_STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(VERTEX_STORE_KEY);
  } catch { /* ignore */ }
};

/** 解析用户导入的服务账号 JSON，只留下需要的四个字段 */
export const parseServiceAccount = (text: string): VertexServiceAccount => {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('不是有效的 JSON 文件'); }
  if (j?.type !== 'service_account' || !j.private_key || !j.client_email || !j.project_id) {
    throw new Error('这不像服务账号密钥（需要 type=service_account，含 private_key / client_email / project_id）');
  }
  return { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key, private_key_id: j.private_key_id };
};

export const isVertexUrl = (url: string): boolean => {
  try { return /(^|\.)aiplatform\.googleapis\.com$/i.test(new URL(url).hostname); } catch { return false; }
};

export const vertexBaseUrl = (project: string, location: string): string => {
  const loc = (location || 'global').trim();
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(loc)}/endpoints/openapi`;
};

/* ───────── 本机签名换 token ───────── */

const b64url = (data: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const importPrivateKey = async (pem: string): Promise<CryptoKey> => {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
};

let cachedToken: { token: string; exp: number; email: string } | null = null;
let inflight: Promise<string> | null = null;

export const getVertexAccessToken = async (transport: typeof fetch = fetch): Promise<string> => {
  const store = loadVertexStore();
  if (!store) throw new Error('还没导入 Vertex 服务账号（设置 → · Vertex 直连 ·）');
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.email === store.sa.client_email && cachedToken.exp - 120 > now) return cachedToken.token;
  if (inflight) return inflight;
  inflight = (async () => {
    const header = { alg: 'RS256', typ: 'JWT', ...(store.sa.private_key_id ? { kid: store.sa.private_key_id } : {}) };
    const claims = {
      iss: store.sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    };
    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const key = await importPrivateKey(store.sa.private_key);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const assertion = `${unsigned}.${b64url(sig)}`;
    let res: Response;
    try {
      res = await transport(TOKEN_URI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
      });
    } catch (e: any) {
      throw new Error(`连不上 Google 登录服务（${e?.message || e}）。可能是网络或浏览器拦截了跨域请求`);
    }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.access_token) throw new Error(`换取 Vertex token 失败：${j?.error_description || j?.error || `HTTP ${res.status}`}`);
    cachedToken = { token: j.access_token, exp: now + Number(j.expires_in || 3600), email: store.sa.client_email };
    return cachedToken.token;
  })().finally(() => { inflight = null; });
  return inflight;
};

/* ───────── 请求改写 ───────── */

const FALLBACK_MODELS = ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'];

const listVertexModels = async (transport: typeof fetch, token: string): Promise<string[]> => {
  try {
    const res = await transport('https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=200', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return FALLBACK_MODELS;
    const j = await res.json();
    const names: string[] = (j?.publisherModels || [])
      .map((m: any) => String(m?.name || '').split('/').pop() || '')
      .filter((n: string) => /^gemini/i.test(n));
    return names.length ? Array.from(new Set(names)).map(n => `google/${n}`).sort() : FALLBACK_MODELS;
  } catch { return FALLBACK_MODELS; }
};

/** 由 fetchLlm 调用：所有打到 aiplatform.googleapis.com 的请求都从这里走 */
export async function fetchVertex(resource: RequestInfo | URL, init: RequestInit | undefined, transport: typeof fetch): Promise<Response> {
  const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
  const method = (init?.method || (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
  const token = await getVertexAccessToken(transport);

  // 「拉取模型」：OpenAI 兼容端点没有 /models，换成 Vertex 的模型目录
  if (method === 'GET' && /\/endpoints\/openapi\/models\/?$/.test(new URL(url).pathname)) {
    const ids = await listVertexModels(transport, token);
    return new Response(JSON.stringify({ object: 'list', data: ids.map(id => ({ id, object: 'model', owned_by: 'google' })) }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  const headers = new Headers(init?.headers || (resource instanceof Request ? resource.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  let body = init?.body;
  if (method === 'POST' && typeof body === 'string') {
    try {
      const j = JSON.parse(body);
      // Vertex 的 OpenAI 端点要求带发布方前缀：gemini-2.5-pro → google/gemini-2.5-pro
      if (typeof j?.model === 'string' && !j.model.includes('/')) {
        j.model = `google/${j.model}`;
        body = JSON.stringify(j);
      }
    } catch { /* 非 JSON 原样发 */ }
  }
  const target = resource instanceof Request ? resource.url : resource;
  return transport(target, { ...init, method, headers, body });
}
