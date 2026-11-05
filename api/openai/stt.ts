/**
 * 个人二改：OpenAI 兼容的语音转写（/audio/transcriptions）中转。
 * 用于硅基流动 SenseVoice、Groq Whisper、OpenAI Whisper 这类接口——浏览器 / App 直连可能被 CORS 拦，
 * 所以和 ElevenLabs 一样走这台 Vercel 的函数转一下。只放行下面几个官方域名，Key 原样透传、不落盘。
 */
export const config = {
    api: {
        bodyParser: false,
    },
};

const ALLOWED_HOSTS = new Set([
    'api.siliconflow.cn',
    'api.siliconflow.com',
    'api.groq.com',
    'api.openai.com',
]);

function readRawBody(req: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        if (Buffer.isBuffer(req.body)) {
            resolve(req.body);
            return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: any) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

export default async function handler(req: any, res: any) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-stt-base');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const auth = req.headers['authorization'];
        if (!auth) return res.status(401).json({ error: 'Missing Authorization' });
        let base: URL;
        try { base = new URL(String(req.headers['x-stt-base'] || '')); } catch { return res.status(400).json({ error: 'Bad x-stt-base' }); }
        if (base.protocol !== 'https:' || !ALLOWED_HOSTS.has(base.hostname)) {
            return res.status(400).json({ error: `不支持的转写地址：${base.hostname}` });
        }
        const target = `${base.origin}${base.pathname.replace(/\/+$/, '')}/audio/transcriptions`;
        const rawBody = await readRawBody(req);
        const headers: Record<string, string> = { Authorization: String(auth) };
        if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type']);
        const response = await fetch(target, { method: 'POST', headers, body: new Uint8Array(rawBody) });
        const text = await response.text();
        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        return res.send(text);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Internal Server Error' });
    }
}
