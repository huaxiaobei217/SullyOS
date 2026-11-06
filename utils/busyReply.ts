/**
 * 忙的时候晚点回（个人二改）：日程上他正在开会、在路上、在健身……自动回复就多等一会儿，
 * 输入框上方写着他在干嘛。只影响「自动回复」的等待时间，你手动点闪电还是马上回。
 */
import type { CharacterProfile, ScheduleSlot } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { getCurrentSlot } from './charMusicSchedule';
import { resolveCharTimeZone, nowInTimeZone } from './timezone';

const LS = 'sully_busy_reply_v1';
const BUSY = /开会|会议|上课|讲课|赶稿|截稿|通勤|在路上|路上|开车|骑车|地铁|公交|飞机|航班|火车|高铁|登机|健身|跑步|游泳|拳击|洗澡|淋浴|电影院|看电影|演出|音乐会|采访|面试|排练|看医生|牙医|理发|修车|搬家|打球|比赛|值班|实验室|考试|葬礼|婚礼/;

const all = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
export const isBusyReplyOn = (charId: string) => all()[charId] !== false;
export const setBusyReplyOn = (charId: string, on: boolean) => { const a = all(); a[charId] = on; try { localStorage.setItem(LS, JSON.stringify(a)); } catch { /* ignore */ } };

export const slotIsBusy = (slot: ScheduleSlot | null) => !!slot && BUSY.test(`${slot.activity || ''} ${slot.description || ''}`);

/** 他现在忙不忙：忙就返回在干嘛（一个短词），不忙返回 null */
export async function currentBusy(char: CharacterProfile): Promise<string | null> {
  if (!isBusyReplyOn(char.id)) return null;
  try {
    const sched = await getDailyScheduleForChar(char);
    const slot = getCurrentSlot(sched, nowInTimeZone(resolveCharTimeZone(char)));
    if (!slotIsBusy(slot)) return null;
    return (slot!.activity || '').slice(0, 12) || '忙';
  } catch { return null; }
}

/** 忙的时候等多久：25～75 秒，像隔一会儿才瞄到手机 */
export const busyDelayMs = () => Math.round((25 + Math.random() * 50) * 1000);
