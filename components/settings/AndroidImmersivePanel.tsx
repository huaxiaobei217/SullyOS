/** 设置页 · 安卓主屏幕版的沉浸全屏开关（只在安卓「添加到主屏幕」打开时出现） */
import React, { useState } from 'react';
import { isAndroidStandalone, isImmersiveOn, setImmersiveOn } from '../../utils/androidSystemBars';

const AndroidImmersivePanel: React.FC = () => {
  const [on, setOn] = useState(isImmersiveOn());
  if (!isAndroidStandalone()) return null;
  return (
    <section className="bg-white/60 rounded-2xl p-4 border border-slate-100">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-600 tracking-wider">沉浸全屏</span>
          <span className="block text-[10px] text-slate-400 mt-1 leading-relaxed">
            把手机的状态栏和底部导航条都藏起来，整屏都是 SullyOS。打开后每次进 App，第一次点屏幕就会进入全屏（浏览器规定要点一下才行）。
            全屏时顶上会留一条极简状态栏（时间和电量，字的深浅跟着页面颜色变），看起来和没全屏时一样。从屏幕边缘往里滑可以临时叫出系统栏。
          </span>
        </span>
        <input type="checkbox" className="mt-1" checked={on} onChange={e => { setOn(e.target.checked); setImmersiveOn(e.target.checked); }} />
      </label>
    </section>
  );
};

export default AndroidImmersivePanel;
