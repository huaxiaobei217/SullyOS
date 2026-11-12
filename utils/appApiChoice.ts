/**
 * 某个 App 单独用哪套 API（个人二改）：主 API，或者「设置 → API」里存的任意一个预设。
 * 上班没 VPN 时切到国内能直接连的那套。选中的预设被删了就回到主 API。
 */
import type { APIConfig, ApiPreset } from '../types';

const key = (app: string) => `sully_app_api_${app}_v1`;
export const getAppApiChoice = (app: string): string => { try { return localStorage.getItem(key(app)) || 'main'; } catch { return 'main'; } };
export const setAppApiChoice = (app: string, choice: string) => { try { localStorage.setItem(key(app), choice); } catch { /* ignore */ } };
export function resolveAppApi(main: APIConfig, presets: ApiPreset[] | undefined, choice: string): APIConfig {
  if (choice.startsWith('preset:')) {
    const p = (presets || []).find(x => x.id === choice.slice(7));
    if (p?.config?.baseUrl) return { ...main, ...p.config };
  }
  return main;
}
export const appApiOptions = (main: APIConfig, presets: ApiPreset[] | undefined) => [
  { value: 'main', label: `跟主 API · ${main?.model || '没配'}` },
  ...(presets || []).filter(p => p.config?.baseUrl).map(p => ({ value: `preset:${p.id}`, label: `${p.group ? `${p.group} · ` : ''}${p.name} · ${p.config.model || ''}` })),
];
