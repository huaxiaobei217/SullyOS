/**
 * 角色级「关掉转账和记账」：关掉后，这个角色的提示词里不再出现转账动作说明，
 * 也不注入记账（支出）类生活记录，免得他把话题往钱上带。只存本机。
 */
const KEY = 'sully_money_off_v1';
const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
export const isMoneyOff = (charId?: string) => !!charId && typeof localStorage !== 'undefined' && !!load()[charId];
export const setMoneyOff = (charId: string, off: boolean) => {
  const m = load(); if (off) m[charId] = true; else delete m[charId];
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
};
