/** 口癖清洗面板里的一行：他会不会拉你一起听 + 从哪几个歌单里挑 */
import React, { useState } from 'react';
import type { CharacterProfile } from '../../types';
import { isSongPickOn, setSongPickOn, listUserPlaylists, getPickPlaylistIds, setPickPlaylistIds, buildSongPool } from '../../utils/charSongPicks';

const CharSongPickRow: React.FC<{ char: CharacterProfile }> = ({ char }) => {
  const [on, setOn] = useState(isSongPickOn(char.id));
  const [ids, setIds] = useState<string[]>(() => getPickPlaylistIds(char));
  const lists = listUserPlaylists();
  const toggle = (id: string) => { const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]; setIds(next); setPickPlaylistIds(char.id, next); };
  const poolSize = on ? buildSongPool(char).length : 0;
  return (
    <div className="p-2.5 rounded-xl bg-white border border-slate-100 space-y-1.5">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[11.5px] font-semibold text-slate-600">拉你一起听</span>
          <span className="block text-[10px] text-slate-400 leading-relaxed">
            {char.name}偶尔会从「手边的歌」里挑一首发你一张「一起听」卡，点了才放。他不能自己想歌名，只能从下面勾的歌单 + 他自己主页的歌单里随手抽的几首里挑，最近推过的 40 首不会再出现，所以不会来来回回那几首。
          </span>
        </span>
        <input type="checkbox" className="mt-1" checked={on} onChange={e => { setOn(e.target.checked); setSongPickOn(char.id, e.target.checked); }} />
      </label>
      {on && (
        <div>
          <div className="flex flex-wrap gap-1">
            {lists.map(p => (
              <button key={p.id} onClick={() => toggle(p.id)}
                className={`px-2 py-0.5 rounded-full text-[10px] border ${ids.includes(p.id) ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-slate-200 text-slate-400'}`}>
                {p.name}（{p.count}）
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">现在歌池一共 {poolSize} 首{poolSize < 5 ? '，少于 5 首他不会推' : ''}</div>
        </div>
      )}
    </div>
  );
};

export default CharSongPickRow;
