/**
 * 安卓 App 内更新（个人二改）：打开 App 时看一眼 GitHub Releases 的 android-latest，
 * 安装包比手上这个新，就在顶上冒一条「App 有新版本」，点了在 App 里下载、下完直接弹系统安装。
 * 只有壳本身改了（悬浮歌词、权限这类）才需要；网页内容的更新不用装包，打开就是新的。
 */
import React, { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface AppShellApi {
  getBuild(): Promise<{ stamp: string; canInstall: boolean }>;
  openInstallPermission(): Promise<void>;
  downloadAndInstall(o: { url: string }): Promise<void>;
  addListener(ev: 'update', cb: (e: { state: string; progress: number; message: string }) => void): Promise<{ remove: () => void }>;
}
const AppShell = registerPlugin<AppShellApi>('AppShell');
const RELEASE_API = 'https://api.github.com/repos/huaxiaobei217/SullyOS/releases/tags/android-latest';
const DISMISS_KEY = 'sully_app_update_dismissed_v1';

const AppUpdateBanner: React.FC = () => {
  const [avail, setAvail] = useState<{ stamp: string; url: string; size: number } | null>(null);
  const [state, setState] = useState<'idle' | 'perm' | 'downloading' | 'failed'>('idle');
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('AppShell')) return;
        const { stamp } = await AppShell.getBuild();
        if (!stamp) return;
        const r = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) return;
        const j = await r.json();
        const asset = (j.assets || []).find((a: any) => /^SullyOS-noah-(\d{8}-\d{4})\.apk$/.test(a.name));
        const latest = asset?.name.match(/(\d{8}-\d{4})/)?.[1];
        if (!latest || latest <= stamp) return;
        try { if (localStorage.getItem(DISMISS_KEY) === latest) return; } catch { /* ignore */ }
        if (!cancelled) setAvail({ stamp: latest, url: asset.browser_download_url, size: asset.size || 0 });
      } catch { /* 连不上 GitHub 就下次再看 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!avail) return;
    let h: { remove: () => void } | null = null;
    AppShell.addListener('update', e => {
      if (e.state === 'progress') setProgress(e.progress);
      else if (e.state === 'done') { setProgress(1); setState('idle'); setMsg('下好了，在弹出的界面里点「安装」'); }
      else if (e.state === 'failed') { setState('failed'); setMsg(e.message || '下载失败'); }
    }).then(x => { h = x; }).catch(() => {});
    return () => { h?.remove(); };
  }, [avail]);

  if (!avail) return null;

  const start = async () => {
    try {
      const { canInstall } = await AppShell.getBuild();
      if (!canInstall) { setState('perm'); await AppShell.openInstallPermission(); return; }
      setState('downloading'); setProgress(0); setMsg('');
      await AppShell.downloadAndInstall({ url: avail.url });
    } catch (e: any) { setState('failed'); setMsg(e?.message || '没开始下载'); }
  };
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, avail.stamp); } catch { /* ignore */ } setAvail(null); };

  return (
    <div className="absolute left-3 right-3 z-[90] rounded-2xl bg-slate-900/85 text-white px-3 py-2 text-[12px] shadow-lg backdrop-blur"
      style={{ top: 'calc(var(--safe-top, 0px) + 0.6rem)' }}>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0">
          {state === 'downloading' ? `正在下载新版 App… ${Math.round(progress * 100)}%`
            : state === 'perm' ? '先允许「安装未知应用」，回来再点一次更新'
            : msg || `App 有新版本（${avail.stamp.slice(4, 6)}/${avail.stamp.slice(6, 8)}）${avail.size ? ` · ${(avail.size / 1048576).toFixed(1)}MB` : ''}`}
        </span>
        {state !== 'downloading' && <button onClick={start} className="px-2.5 py-1 rounded-lg bg-white text-slate-900 font-bold text-[11px]">{state === 'failed' ? '重试' : '更新'}</button>}
        {state !== 'downloading' && <button onClick={dismiss} className="text-white/60 text-[11px]">先不</button>}
      </div>
      {state === 'downloading' && <div className="mt-1.5 h-1 rounded bg-white/20 overflow-hidden"><div className="h-full bg-white" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
    </div>
  );
};

export default AppUpdateBanner;
