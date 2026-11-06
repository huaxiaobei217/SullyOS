/**
 * 角色所在城市的真实天气（个人二改）：他在伦敦，就查伦敦今天的天气。
 * 免费的 Open-Meteo（免 key、可跨域），一个半小时内复用缓存；查不到就当没有，不影响别的。
 * 查的是「他」那边的城市，不碰你的位置。
 */
import type { CharacterProfile } from '../types';

const LS_CITY = 'sully_char_city_v1';
const LS_CACHE = 'sully_char_weather_v1';
const FRESH_MS = 90 * 60 * 1000;

export interface CharCity { name: string; lat: number; lon: number }
export interface CharWeather { at: number; city: string; temp: number; code: number; desc: string; hi: number; lo: number; rain: number; isDay: boolean }

const PRESETS: Record<string, CharCity> = { London: { name: '伦敦', lat: 51.5072, lon: -0.1276 } };
const readJ = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJ = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/** 他住哪：设置过就用设置的；诺亚默认伦敦；别的角色没设就不查 */
export function getCharCity(char: Pick<CharacterProfile, 'id' | 'name'>): CharCity | null {
  const all = readJ<Record<string, CharCity | null>>(LS_CITY, {});
  if (char.id in all) return all[char.id];
  if (/诺亚|Noah/i.test(char.name || '')) return PRESETS.London;
  return null;
}
export function setCharCity(charId: string, city: CharCity | null) {
  const all = readJ<Record<string, CharCity | null>>(LS_CITY, {}); all[charId] = city; writeJ(LS_CITY, all);
  const c = readJ<Record<string, CharWeather>>(LS_CACHE, {}); delete c[charId]; writeJ(LS_CACHE, c);
}
export async function geocodeCity(name: string): Promise<CharCity | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`);
  if (!r.ok) return null;
  const hit = (await r.json())?.results?.[0];
  return hit ? { name: hit.name, lat: hit.latitude, lon: hit.longitude } : null;
}

const WMO: Record<number, string> = {
  0: '晴', 1: '大致晴朗', 2: '多云', 3: '阴', 45: '有雾', 48: '雾凇', 51: '零星毛毛雨', 53: '毛毛雨', 55: '密毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '阵雨', 82: '大阵雨',
  85: '阵雪', 86: '大阵雪', 95: '雷阵雨', 96: '雷阵雨带冰雹', 99: '强雷阵雨带冰雹',
};

const inflight = new Map<string, Promise<CharWeather | null>>();
/** 取天气（有新鲜缓存直接用）；查不到返回 null */
export function refreshCharWeather(char: Pick<CharacterProfile, 'id' | 'name'>): Promise<CharWeather | null> {
  const city = getCharCity(char); if (!city) return Promise.resolve(null);
  const cached = readJ<Record<string, CharWeather>>(LS_CACHE, {})[char.id];
  if (cached && Date.now() - cached.at < FRESH_MS && cached.city === city.name) return Promise.resolve(cached);
  if (inflight.has(char.id)) return inflight.get(char.id)!;
  const p = (async () => {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto`, { signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) return cached || null;
      const d = await r.json();
      const w: CharWeather = {
        at: Date.now(), city: city.name, temp: Math.round(d.current?.temperature_2m), code: d.current?.weather_code ?? -1,
        desc: WMO[d.current?.weather_code] || '天气不明', hi: Math.round(d.daily?.temperature_2m_max?.[0]), lo: Math.round(d.daily?.temperature_2m_min?.[0]),
        rain: Math.round(d.daily?.precipitation_probability_max?.[0] ?? 0), isDay: !!d.current?.is_day,
      };
      const all = readJ<Record<string, CharWeather>>(LS_CACHE, {}); all[char.id] = w; writeJ(LS_CACHE, all);
      return w;
    } catch { return cached || null; }
    finally { inflight.delete(char.id); }
  })();
  inflight.set(char.id, p);
  return p;
}

/** 同步读缓存（拼提示词用；过期太久就不给） */
export function cachedCharWeather(charId: string): CharWeather | null {
  const w = readJ<Record<string, CharWeather>>(LS_CACHE, {})[charId];
  return w && Date.now() - w.at < 6 * 3600 * 1000 ? w : null;
}

export const weatherLine = (w: CharWeather) => `${w.city}现在 ${w.temp}°C，${w.desc}；今天 ${w.lo}～${w.hi}°C${w.rain >= 30 ? `，下雨概率 ${w.rain}%` : ''}`;

export function buildCharWeatherBlock(char: Pick<CharacterProfile, 'id' | 'name'>): string {
  void refreshCharWeather(char);
  const w = cachedCharWeather(char.id);
  if (!w) return '';
  return `### 你那边的天气（真实的）\n${weatherLine(w)}。这是你身边的天气，自然地活在里面就好：出门带没带伞、窗外什么样；别像天气预报那样播报。`;
}
