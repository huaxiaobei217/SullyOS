/** 口癖清洗面板里的一组：他住哪（真实天气）、忙的时候晚点回、你们的日子 */
import React, { useEffect, useState } from 'react';
import type { CharacterProfile } from '../../types';
import { getCharCity, setCharCity, geocodeCity, refreshCharWeather, weatherLine, type CharWeather } from '../../utils/charWeather';
import { isBusyReplyOn, setBusyReplyOn } from '../../utils/busyReply';
import { getOurDates, setOurDates } from '../../utils/ourDates';
import { getDayState } from '../../utils/charDayState';
import { isGoodDaysOn, setGoodDaysOn } from '../../utils/goodDays';

const box = 'p-2.5 rounded-xl bg-white border border-slate-100 space-y-1.5';
const title = 'block text-[11.5px] font-semibold text-slate-600';
const hint = 'block text-[10px] text-slate-400 leading-relaxed';
const input = 'px-2 py-1 rounded-lg border border-slate-200 text-[11px] bg-white';

const CharLifeRow: React.FC<{ char: CharacterProfile; userName: string }> = ({ char, userName }) => {
  const [city, setCity] = useState(() => getCharCity(char));
  const [w, setW] = useState<CharWeather | null>(null);
  const [cityInput, setCityInput] = useState('');
  const [busyOn, setBusyOn] = useState(isBusyReplyOn(char.id));
  const [goodOn, setGoodOn] = useState(isGoodDaysOn(char.id));
  const [dates, setDates] = useState(() => getOurDates(char as any));
  const [newName, setNewName] = useState(''); const [newDate, setNewDate] = useState('');
  const day = getDayState(char.id);
  useEffect(() => { void refreshCharWeather(char).then(setW); }, [char.id, city?.name]);
  const patch = (p: Partial<typeof dates>) => { setOurDates(char.id, p); setDates(getOurDates(char as any)); };
  const md = (v?: string) => v ? `2000-${v}` : '';

  return (
    <>
      <div className={box}>
        <span className={title}>{char.name}那边的天气</span>
        <span className={hint}>按他住的城市查真实天气，进聊天、日程、纸条和电台（查的是他那边，不碰你的位置）。</span>
        <div className="text-[11px] text-slate-600">{city ? (w ? weatherLine(w) : `${city.name}：查天气中…`) : '没设城市，不查'}</div>
        <div className="flex gap-1.5">
          <input value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="换个城市，比如 爱丁堡" className={`${input} flex-1 min-w-0`} />
          <button onClick={async () => { if (!cityInput.trim()) return; const c = await geocodeCity(cityInput.trim()).catch(() => null); if (c) { setCharCity(char.id, c); setCity(c); setCityInput(''); } else alert('没找到这个城市'); }} className="text-[11px] px-2 rounded-lg bg-slate-100 text-slate-600">换</button>
          {city && <button onClick={() => { setCharCity(char.id, null); setCity(null); setW(null); }} className="text-[11px] px-2 rounded-lg text-slate-400">不查</button>}
        </div>
        {(day.level || day.threads.length > 0) && (
          <div className="text-[10.5px] text-slate-500 pt-1 border-t border-slate-100">
            {day.level && <div>今天状态：{day.level}{day.why ? `（${day.why}）` : ''}</div>}
            {day.threads.map(t => <div key={t.title}>在跟进：{t.kind}《{t.title}》{t.progress ? ` · ${t.progress}` : ''}</div>)}
          </div>
        )}
      </div>

      <label className={`${box} flex items-start justify-between gap-3`}>
        <span className="min-w-0">
          <span className={title}>忙的时候晚点回</span>
          <span className={hint}>日程上他在开会、在路上、在健身时，开着自动回复的话会多等半分钟到一分多钟，输入框上方写着他在干嘛。你手动点闪电还是马上回。</span>
        </span>
        <input type="checkbox" className="mt-1" checked={busyOn} onChange={e => { setBusyOn(e.target.checked); setBusyReplyOn(char.id, e.target.checked); }} />
      </label>

      <label className={`${box} flex items-start justify-between gap-3`}>
        <span className="min-w-0">
          <span className={title}>好的那天</span>
          <span className={hint}>旧账本的温柔版：两周前、一个月前、三个月前前后，你说过的心愿和计划（想去、想学、第一次……）。只有正好接得上现在，比如你真去做了，他才轻轻提一句，一天最多一次。只读本机聊天记录，不花调用。</span>
        </span>
        <input type="checkbox" className="mt-1" checked={goodOn} onChange={e => { setGoodOn(e.target.checked); setGoodDaysOn(char.id, e.target.checked); }} />
      </label>

      <div className={box}>
        <span className={title}>你们的日子</span>
        <span className={hint}>平时不会带进聊天。只有当天、前三天（让{char.name}记着、悄悄准备），还有认识 / 在一起满整百天、满周年那天，他才会知道。</span>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] text-slate-500 items-center">
          <span>{userName}的生日</span><input type="date" value={md(dates.userBirthday)} onChange={e => patch({ userBirthday: e.target.value ? e.target.value.slice(5) : undefined })} className={input} />
          <span>{char.name}的生日</span><input type="date" value={md(dates.charBirthday)} onChange={e => patch({ charBirthday: e.target.value ? e.target.value.slice(5) : '' })} className={input} />
          <span>认识那天</span><input type="date" value={dates.metOn || ''} onChange={e => patch({ metOn: e.target.value || undefined })} className={input} />
          <span>在一起那天</span><input type="date" value={dates.togetherOn || ''} onChange={e => patch({ togetherOn: e.target.value || undefined })} className={input} />
        </div>
        <div className="text-[9.5px] text-slate-400">生日只看月和日，年份随便选。</div>
        {dates.custom.map((c, i) => (
          <div key={i} className="flex items-center justify-between text-[11px] text-slate-600">
            <span>{c.name} · {c.date}</span>
            <button onClick={() => patch({ custom: dates.custom.filter((_, k) => k !== i) })} className="text-slate-400 text-[10.5px]">删</button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="自己加一个，比如 第一次打电话" className={`${input} flex-1 min-w-0`} />
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className={`${input} w-[7.5rem]`} />
          <button onClick={() => { if (!newName.trim() || !newDate) return; patch({ custom: [...dates.custom, { name: newName.trim().slice(0, 20), date: newDate }] }); setNewName(''); setNewDate(''); }} className="text-[11px] px-2 rounded-lg bg-slate-100 text-slate-600">加</button>
        </div>
      </div>
    </>
  );
};

export default CharLifeRow;
