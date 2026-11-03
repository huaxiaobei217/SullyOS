/** 封面：图片加载失败或没有图时，显示按歌名生成的渐变占位 */
import React, { useEffect, useState } from 'react';
import { MusicNotes } from '@phosphor-icons/react';

const hue = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};

const Cover: React.FC<{
  src?: string;
  seed?: string;
  className?: string;
  style?: React.CSSProperties;
  iconSize?: number;
}> = ({ src, seed = '', className = '', style, iconSize = 20 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const url = (src || '').replace(/^http:\/\//i, 'https://');
  if (!url || failed) {
    const h = hue(seed);
    return (
      <div className={`flex items-center justify-center ${className}`}
        style={{ background: `linear-gradient(135deg, hsl(${h} 45% 78%), hsl(${(h + 50) % 360} 45% 62%))`, ...style }}>
        <MusicNotes size={iconSize} color="rgba(255,255,255,0.85)" weight="fill" />
      </div>
    );
  }
  return (
    <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`} style={style} />
  );
};

export default Cover;
