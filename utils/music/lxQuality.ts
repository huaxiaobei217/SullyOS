/** LX 音质偏好：用户选一个目标音质，实际播放取「音源支持 ∩ 歌曲有」里不超过目标的最高一档 */

export const LX_QUALITY_ORDER = ['128k', '320k', 'flac', 'flac24bit', 'hires'] as const;
export type LxQualityPref = typeof LX_QUALITY_ORDER[number];

export const LX_QUALITY_LABEL: Record<LxQualityPref, string> = {
  '128k': '标准 128k',
  '320k': '高品 320k',
  flac: '无损 FLAC',
  flac24bit: 'Hi-Res 24bit',
  hires: 'Hi-Res',
};

const LS_KEY = 'sully_music_lx_quality_v1';

export const loadLxQualityPref = (): LxQualityPref => {
  try {
    const v = localStorage.getItem(LS_KEY) as LxQualityPref | null;
    return v && (LX_QUALITY_ORDER as readonly string[]).includes(v) ? v : '320k';
  } catch { return '320k'; }
};

export const saveLxQualityPref = (q: LxQualityPref) => {
  try { localStorage.setItem(LS_KEY, q); } catch {}
};

export const pickLxQuality = (sourceQualitys: string[], songQualitys?: string[], pref = loadLxQualityPref()): string => {
  const maxIdx = LX_QUALITY_ORDER.indexOf(pref);
  const ok = (q: string) => (!sourceQualitys.length || sourceQualitys.includes(q))
    && (!songQualitys || !songQualitys.length || songQualitys.includes(q));
  for (let i = maxIdx; i >= 0; i--) {
    if (ok(LX_QUALITY_ORDER[i])) return LX_QUALITY_ORDER[i];
  }
  return '128k';
};
