/** 口癖清洗面板里的一行：偶尔出趟门 开关 + 现在的行程 */
import React, { useState } from 'react';
import { isTripOn, setTripOn, getTrip, cancelTrip } from '../../utils/charTrip';

const CharTripRow: React.FC<{ charId: string; charName: string }> = ({ charId, charName }) => {
  const [on, setOn] = useState(isTripOn(charId));
  const [trip, setTrip] = useState(() => getTrip(charId));
  return (
    <div className="p-2.5 rounded-xl bg-white border border-slate-100 space-y-1.5">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[11.5px] font-semibold text-slate-600">偶尔出趟门</span>
          <span className="block text-[10px] text-slate-400 leading-relaxed">
            平时{charName}就在自己城市过日子；隔至少三周，生成日程时才有小概率让他考虑出门一趟（出差、看展、回家……理由他按人设自己定，没理由就不去），一次 1–4 天。出门那几天日程写在当地，聊天里他知道自己在哪，会顺手跟你说说见闻。不额外花调用。
          </span>
        </span>
        <input type="checkbox" className="mt-1" checked={on} onChange={e => { setOn(e.target.checked); setTripOn(charId, e.target.checked); if (!e.target.checked) setTrip(undefined); }} />
      </label>
      {on && trip && (
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-500">
          <span className="min-w-0">✈️ {trip.startDate.slice(5)}–{trip.endDate.slice(5)} 去{trip.destination}（{trip.reason}）</span>
          <button onClick={() => { cancelTrip(charId); setTrip(undefined); }} className="shrink-0 text-rose-400">取消这趟</button>
        </div>
      )}
    </div>
  );
};

export default CharTripRow;
