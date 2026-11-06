/**
 * 账本（个人二改）：银行 App 里的咖啡店、升级都不要，只留记账。
 * 和银行 / 生活记录共用同一份流水（bank_transactions），诺亚在聊天里代记的也在这里（标着「他记的」）。
 * - 顶上：这个月花了多少、进了多少、还剩多少；设了月预算就显示进度和「接下来每天还能花」
 * - 记一笔：金额 + 支出/收入 + 分类（按备注自动猜，可改）+ 备注
 * - 明细：按天分组；点一条可以改分类、改金额、删
 * - 分析：分类占比、每天花了多少、和上个月比、最大的几笔；可以让他看看这个月（他的口气，不说教）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import type { BankTransaction, CharacterProfile } from '../types';
import { DB } from '../utils/db';
import { isExpense, parseLedgerAmount, formatLedgerCsv } from '../utils/bankLedger';
import { roundMoney, sumMoney, formatMoney } from '../utils/format';
import { getLocalDateKey } from '../utils/localDate';
import { shareOrDownloadFile } from '../utils/shareExport';
import { callAsChar } from '../utils/footnote';
import TokenImg from '../components/os/TokenImg';

const C = { bg: '#f7f5f0', card: '#ffffff', ink: '#26241f', muted: '#8b867b', faint: '#bdb7aa', line: '#ebe6dc', accent: '#c26a3d', income: '#3f8f6b', deep: '#f0ebe1' };

export const CATS: Record<string, { emoji: string; label: string; color: string; re?: RegExp }> = {
  food: { emoji: '🍜', label: '吃饭', color: '#e07a4f', re: /饭|餐|吃|外卖|食|奶茶|咖啡|早餐|午餐|晚餐|夜宵|火锅|烧烤|面|饮|零食|水果|超市买菜|买菜|甜品|蛋糕/ },
  transport: { emoji: '🚇', label: '交通', color: '#4f8fd6', re: /车|地铁|公交|打车|滴滴|油费|加油|停车|出租|高铁|火车|机票|骑行|单车/ },
  shopping: { emoji: '🛍️', label: '购物', color: '#a368c9', re: /买|购|淘宝|京东|拼多多|商场|衣服|鞋|包|化妆|护肤|日用/ },
  fun: { emoji: '🎮', label: '玩乐', color: '#58a967', re: /游戏|电影|娱乐|ktv|酒吧|玩|演出|门票|旅游|展/ },
  rent: { emoji: '🏠', label: '房租水电', color: '#e0a23a', re: /房租|租金|押金|水电|电费|水费|燃气|物业|宽带/ },
  bills: { emoji: '📱', label: '订阅话费', color: '#c9a227', re: /话费|网费|会员|订阅|api|vps|服务器|域名|梯子|节点|流量/i },
  health: { emoji: '💊', label: '医疗', color: '#d9534f', re: /医|药|体检|看病|挂号|牙/ },
  study: { emoji: '📚', label: '学习', color: '#5c6bc0', re: /书|课|学习|培训|考试|报名/ },
  social: { emoji: '🎁', label: '人情', color: '#d36f9c', re: /红包|礼物|请客|份子|生日/ },
  other: { emoji: '📦', label: '其他', color: '#8d969c' },
};
const INCOME_CATS: Record<string, { emoji: string; label: string; re?: RegExp }> = {
  salary: { emoji: '💼', label: '工资', re: /工资|薪|奖金|绩效/ },
  side: { emoji: '✍️', label: '外快', re: /稿费|兼职|外快|接单|佣金/ },
  gift: { emoji: '🧧', label: '红包', re: /红包|压岁|礼金|转账给我/ },
  other_in: { emoji: '💰', label: '其他收入' },
};
export const guessCat = (note: string, income: boolean) => {
  const table = income ? INCOME_CATS : CATS;
  for (const [k, v] of Object.entries(table)) if (v.re?.test(note)) return k;
  return income ? 'other_in' : 'other';
};
const catOf = (tx: BankTransaction) => {
  const inc = !isExpense(tx);
  const table: Record<string, any> = inc ? INCOME_CATS : CATS;
  return table[tx.category] ? tx.category : guessCat(tx.note || '', inc);
};
const catInfo = (tx: BankTransaction) => (isExpense(tx) ? CATS : INCOME_CATS as any)[catOf(tx)] as { emoji: string; label: string; color?: string };

const LS_BUDGET = 'sully_ledger_budget_v1';
const LS_TALK = 'sully_ledger_talk_v1';
const money = (n: number) => formatMoney(roundMoney(n));
const monthOf = (k: string) => k.slice(0, 7);
const shiftMonth = (m: string, d: number) => { const [y, mo] = m.split('-').map(Number); const t = new Date(y, mo - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
const daysIn = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const WEEK = '日一二三四五六';

const LedgerApp: React.FC = () => {
  const { closeApp, characters, apiConfig, userProfile, addToast } = useOS() as any;
  const him: CharacterProfile | undefined = characters.find((c: any) => /诺亚|Noah/i.test(c.name)) || characters[0];
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const today = getLocalDateKey();
  const [month, setMonth] = useState(monthOf(today));
  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [budget, setBudget] = useState<number>(() => { try { return Number(localStorage.getItem(LS_BUDGET)) || 0; } catch { return 0; } });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BankTransaction | null>(null);
  const [talk, setTalk] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem(LS_TALK) || '{}'); } catch { return {}; } });
  const [talking, setTalking] = useState(false);

  const reload = () => DB.getAllTransactions().then(list => setTxs(list.sort((a, b) => b.timestamp - a.timestamp))).catch(() => {});
  useEffect(() => { reload(); const t = setInterval(reload, 15000); return () => clearInterval(t); }, []);

  const inMonth = useMemo(() => txs.filter(t => t.dateStr.startsWith(month)), [txs, month]);
  const lastMonth = useMemo(() => txs.filter(t => t.dateStr.startsWith(shiftMonth(month, -1))), [txs, month]);
  const spent = sumMoney(inMonth.filter(isExpense).map(t => t.amount));
  const earned = sumMoney(inMonth.filter(t => !isExpense(t)).map(t => t.amount));
  const lastSpent = sumMoney(lastMonth.filter(isExpense).map(t => t.amount));
  const isThisMonth = month === monthOf(today);
  const daysLeft = isThisMonth ? daysIn(month) - Number(today.slice(8)) + 1 : 0;

  const byDay = useMemo(() => {
    const m = new Map<string, BankTransaction[]>();
    for (const t of inMonth) { const a = m.get(t.dateStr); if (a) a.push(t); else m.set(t.dateStr, [t]); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [inMonth]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of inMonth.filter(isExpense)) m.set(catOf(t), (m.get(catOf(t)) || 0) + t.amount);
    return [...m.entries()].map(([k, v]) => ({ k, v: roundMoney(v) })).sort((a, b) => b.v - a.v);
  }, [inMonth]);
  const daily = useMemo(() => {
    const n = daysIn(month); const arr = Array(n).fill(0);
    for (const t of inMonth.filter(isExpense)) if (catOf(t) !== 'rent') arr[Number(t.dateStr.slice(8)) - 1] += t.amount;
    return arr.map(roundMoney);
  }, [inMonth, month]);

  const save = async (tx: BankTransaction) => { await DB.saveTransaction(tx); await reload(); };
  const remove = async (id: string) => { await DB.deleteTransaction(id); await reload(); };

  const askHim = async () => {
    if (!him || talking) return;
    setTalking(true);
    try {
      const catText = cats.map(c => `${CATS[c.k]?.label || c.k} ${money(c.v)}`).join('，');
      const top = inMonth.filter(isExpense).sort((a, b) => b.amount - a.amount).slice(0, 5).map(t => `${t.note || '没写'} ${money(t.amount)}`).join('，');
      const { text } = await callAsChar(him, apiConfig,
        `### 【她的账本】她把这个月的账给你看，让你帮她看看。
用你平时跟她说话的口气，3～6 句：说说钱主要花在哪、有没有哪里明显多了（和上个月比）、一两个具体的小建议（能做到的那种）。
不要说教、不要列表、不要念一堆数字（挑一两个关键的说就行）、不要当理财顾问；可以损她一句，也可以夸她。她刚开始工作，钱不多；房租水电是固定开销，别拿它说她花多了。`,
        `${month}：支出 ${money(spent)}，收入 ${money(earned)}${budget ? `，月预算 ${money(budget)}` : ''}；上个月支出 ${money(lastSpent)}。
分类：${catText || '没什么支出'}
最大的几笔：${top || '无'}`, '账本·他看看', 900);
      const next = { ...talk, [month]: text.replace(/<[^>]+>/g, '').trim() };
      setTalk(next); try { localStorage.setItem(LS_TALK, JSON.stringify(next)); } catch { /* ignore */ }
    } catch (e: any) { addToast?.(`他没看成：${e?.message || e}`, 'error'); }
    setTalking(false);
  };

  const exportCsv = async () => {
    try { await shareOrDownloadFile({ content: formatLedgerCsv(inMonth, t => catInfo(t).label), fileName: `账本_${month}.csv`, mimeType: 'text/csv;charset=utf-8', shareTitle: '账本' }); }
    catch { addToast?.('导出失败', 'error'); }
  };

  const pct = budget ? Math.min(1, spent / budget) : 0;
  const maxDay = Math.max(1, ...daily);
  const catTotal = cats.reduce((a, c) => a + c.v, 0) || 1;

  return (
    <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ background: C.bg, color: C.ink }}>
      <div className="shrink-0 px-5 pb-2 flex items-center justify-between" style={{ paddingTop: 'calc(var(--chrome-top) + 0.5rem)' }}>
        <button onClick={closeApp} className="text-sm" style={{ color: C.muted }}>‹ 返回</button>
        <div className="flex items-center gap-3 text-[15px] font-semibold">
          <button onClick={() => setMonth(shiftMonth(month, -1))} style={{ color: C.muted }}>‹</button>
          <span>{Number(month.slice(5))} 月</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={isThisMonth} className="disabled:opacity-20" style={{ color: C.muted }}>›</button>
        </div>
        <button onClick={exportCsv} className="text-[12px]" style={{ color: C.muted }}>导出</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {/* 本月概览 */}
        <div className="rounded-3xl p-4 mb-3" style={{ background: C.card, boxShadow: '0 2px 12px rgba(60,40,20,0.05)' }}>
          <div className="text-[11px]" style={{ color: C.muted }}>这个月花了</div>
          <div className="text-[30px] font-bold tracking-tight leading-tight">¥{money(spent)}</div>
          <div className="flex gap-4 mt-1 text-[11.5px]" style={{ color: C.muted }}>
            <span>收入 <b style={{ color: C.income }}>¥{money(earned)}</b></span>
            <span>结余 <b style={{ color: earned - spent >= 0 ? C.income : C.accent }}>¥{money(earned - spent)}</b></span>
            {lastSpent > 0 && <span>比上月 {spent >= lastSpent ? '多' : '少'} {Math.abs(Math.round((spent / lastSpent - 1) * 100))}%</span>}
          </div>
          {budget > 0 ? (
            <div className="mt-3">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: C.deep }}><div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: pct > 0.9 ? '#d9534f' : pct > 0.7 ? '#e0a23a' : C.income }} /></div>
              <div className="flex justify-between mt-1 text-[10.5px]" style={{ color: C.muted }}>
                <span>预算 ¥{money(budget)} · 还剩 ¥{money(Math.max(0, budget - spent))}</span>
                {isThisMonth && budget > spent && <span>接下来每天 ¥{money((budget - spent) / Math.max(1, daysLeft))}</span>}
                <button onClick={() => { const v = prompt('月预算（填 0 取消）', String(budget)); if (v != null) { const n = Math.max(0, Number(v) || 0); setBudget(n); try { localStorage.setItem(LS_BUDGET, String(n)); } catch { /* ignore */ } } }} style={{ color: C.accent }}>改</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { const v = prompt('每个月想花多少？'); if (v) { const n = Math.max(0, Number(v) || 0); setBudget(n); try { localStorage.setItem(LS_BUDGET, String(n)); } catch { /* ignore */ } } }} className="mt-2 text-[11px]" style={{ color: C.accent }}>＋ 设个月预算</button>
          )}
        </div>

        <div className="flex gap-1 p-1 rounded-full mb-3 text-[12.5px]" style={{ background: C.deep }}>
          {([['list', '明细'], ['stats', '分析']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className="flex-1 py-1.5 rounded-full" style={{ background: tab === k ? C.card : 'transparent', fontWeight: tab === k ? 600 : 400, color: tab === k ? C.ink : C.muted }}>{l}</button>
          ))}
        </div>

        {tab === 'list' && (
          <div className="space-y-3">
            {!byDay.length && <div className="text-center text-[12px] py-12" style={{ color: C.faint }}>这个月还没有记录。点下面的「记一笔」，或者在聊天里跟{him?.name || '他'}说你花了多少，他会帮你记。</div>}
            {byDay.map(([d, list]) => {
              const out = sumMoney(list.filter(isExpense).map(t => t.amount)); const inn = sumMoney(list.filter(t => !isExpense(t)).map(t => t.amount));
              const dt = new Date(`${d}T12:00:00`);
              return (
                <div key={d} className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
                  <div className="flex justify-between px-3.5 pt-2.5 pb-1.5 text-[11px]" style={{ color: C.muted }}>
                    <span>{d === today ? '今天' : `${dt.getMonth() + 1}月${dt.getDate()}日`} · 周{WEEK[dt.getDay()]}</span>
                    <span>{out > 0 && `出 ¥${money(out)}`}{out > 0 && inn > 0 && '  '}{inn > 0 && `入 ¥${money(inn)}`}</span>
                  </div>
                  {list.map(t => {
                    const ci = catInfo(t); const inc = !isExpense(t);
                    return (
                      <button key={t.id} onClick={() => setEditing(t)} className="w-full flex items-center gap-3 px-3.5 py-2 text-left border-t" style={{ borderColor: C.line }}>
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[15px] shrink-0" style={{ background: C.deep }}>{ci.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] truncate">{t.note || ci.label}</div>
                          <div className="text-[10px] flex gap-1.5" style={{ color: C.faint }}>
                            <span>{ci.label}</span><span>{new Date(t.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                            {t.id.startsWith('tx-life-') && <span style={{ color: C.accent }}>{him?.name.split(/[·・\s]/)[0] || '他'}记的</span>}
                          </div>
                        </div>
                        <span className="text-[14px] font-semibold tabular-nums" style={{ color: inc ? C.income : C.ink }}>{inc ? '+' : '-'}{money(t.amount)}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'stats' && (
          <div className="space-y-3">
            {/* 他看看 */}
            {him && (
              <div className="rounded-2xl p-3.5" style={{ background: C.card }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <TokenImg value={him.avatar} className="w-6 h-6 rounded-full object-cover" />
                  <span className="text-[12px] font-semibold flex-1">{him.name.split(/[·・\s]/)[0]}看了看</span>
                  <button onClick={askHim} disabled={talking || !inMonth.length} className="text-[11px] px-2.5 py-1 rounded-full disabled:opacity-40" style={{ background: C.deep, color: C.accent }}>{talking ? '在看…' : talk[month] ? '再看一次' : '让他看看'}</button>
                </div>
                <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: talk[month] ? C.ink : C.faint }}>{talk[month] || '把这个月的账给他看，他会用他的口气说说钱都花哪了。'}</div>
              </div>
            )}

            {/* 分类 */}
            <div className="rounded-2xl p-3.5" style={{ background: C.card }}>
              <div className="text-[12px] font-semibold mb-2.5">花在哪了</div>
              {!cats.length ? <div className="text-[11.5px]" style={{ color: C.faint }}>还没有支出</div> : (
                <div className="flex items-center gap-4">
                  <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0 -rotate-90">
                    {(() => { let acc = 0; return cats.map(c => { const frac = c.v / catTotal; const dash = frac * 251.3; const el = <circle key={c.k} cx={50} cy={50} r={40} fill="none" stroke={CATS[c.k]?.color || '#999'} strokeWidth={16} strokeDasharray={`${dash} ${251.3 - dash}`} strokeDashoffset={-acc * 251.3} />; acc += frac; return el; }); })()}
                  </svg>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    {cats.slice(0, 6).map(c => (
                      <div key={c.k} className="flex items-center gap-2 text-[11.5px]">
                        <span>{CATS[c.k]?.emoji}</span><span className="flex-1 truncate">{CATS[c.k]?.label}</span>
                        <span style={{ color: C.muted }}>{Math.round((c.v / catTotal) * 100)}%</span><span className="w-14 text-right tabular-nums">¥{money(c.v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 每天 */}
            <div className="rounded-2xl p-3.5" style={{ background: C.card }}>
              <div className="flex justify-between text-[12px] mb-2"><span className="font-semibold">每天花了多少</span><span style={{ color: C.muted }}>日均 ¥{money((spent - (cats.find(c => c.k === 'rent')?.v || 0)) / Math.max(1, isThisMonth ? Number(today.slice(8)) : daysIn(month)))}{cats.some(c => c.k === 'rent') ? '（不含房租）' : ''}</span></div>
              <div className="flex items-end gap-[2px] h-20">
                {daily.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${i + 1}日 ¥${money(v)}`}>
                    <div className="w-full rounded-t-sm" style={{ height: `${Math.max(v ? 3 : 1, (v / maxDay) * 72)}px`, background: v ? (budget && v > budget / daysIn(month) * 1.8 ? '#e0a23a' : C.accent) : C.deep, opacity: v ? 0.85 : 1 }} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[9px] mt-1" style={{ color: C.faint }}><span>1</span><span>{Math.ceil(daily.length / 2)}</span><span>{daily.length}</span></div>
            </div>

            {/* 最大的几笔 */}
            <div className="rounded-2xl p-3.5" style={{ background: C.card }}>
              <div className="text-[12px] font-semibold mb-2">最大的几笔</div>
              {inMonth.filter(isExpense).sort((a, b) => b.amount - a.amount).slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-[12px] py-1">
                  <span>{catInfo(t).emoji}</span><span className="flex-1 truncate">{t.note || catInfo(t).label}</span>
                  <span className="text-[10px]" style={{ color: C.faint }}>{t.dateStr.slice(5)}</span><span className="tabular-nums w-16 text-right">¥{money(t.amount)}</span>
                </div>
              ))}
              {!inMonth.some(isExpense) && <div className="text-[11.5px]" style={{ color: C.faint }}>还没有支出</div>}
            </div>
          </div>
        )}
      </div>

      {/* 记一笔 */}
      <div className="absolute left-0 right-0 bottom-0 px-5 pt-2" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 0.9rem)', background: `linear-gradient(to top, ${C.bg} 70%, transparent)` }}>
        <button onClick={() => setAdding(true)} className="w-full py-3 rounded-2xl text-white text-[14px] font-semibold shadow-lg active:scale-[0.98] transition-transform" style={{ background: C.ink }}>＋ 记一笔</button>
      </div>

      {(adding || editing) && (
        <TxSheet tx={editing} onClose={() => { setAdding(false); setEditing(null); }}
          onSave={async tx => { await save(tx); setAdding(false); setEditing(null); }}
          onDelete={editing ? async () => { if (confirm('删掉这一笔？')) { await remove(editing.id); setEditing(null); } } : undefined} />
      )}
    </div>
  );
};

/** 记一笔 / 改一笔 */
const TxSheet: React.FC<{ tx: BankTransaction | null; onClose: () => void; onSave: (tx: BankTransaction) => void; onDelete?: () => void }> = ({ tx, onClose, onSave, onDelete }) => {
  const [income, setIncome] = useState(tx ? !isExpense(tx) : false);
  const [amount, setAmount] = useState(tx ? String(tx.amount) : '');
  const [note, setNote] = useState(tx?.note || '');
  const [cat, setCat] = useState<string | null>(tx ? catOf(tx) : null);
  const [date, setDate] = useState(tx?.dateStr || getLocalDateKey());
  const table: Record<string, { emoji: string; label: string }> = income ? INCOME_CATS : CATS;
  const autoCat = guessCat(note, income);
  const effCat = cat && table[cat] ? cat : autoCat;
  const amt = parseLedgerAmount(amount);
  const submit = () => {
    if (!amt) return;
    const now = Date.now();
    const ts = tx ? (tx.dateStr === date ? tx.timestamp : new Date(`${date}T12:00:00`).getTime()) : (date === getLocalDateKey() ? now : new Date(`${date}T12:00:00`).getTime());
    onSave({ id: tx?.id || `tx-${now}-${Math.floor(Math.random() * 1e4)}`, type: income ? 'income' : 'expense', amount: amt, category: effCat, note: note.trim(), timestamp: ts, dateStr: date });
  };
  return (
    <div className="absolute inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-full rounded-t-3xl p-5 space-y-3" style={{ background: C.card, paddingBottom: 'calc(var(--safe-bottom, 0px) + 1.2rem)' }} onClick={e => e.stopPropagation()}>
        <div className="flex gap-1 p-1 rounded-full text-[12.5px] w-40" style={{ background: C.deep }}>
          {[false, true].map(v => <button key={String(v)} onClick={() => { setIncome(v); setCat(null); }} className="flex-1 py-1 rounded-full" style={{ background: income === v ? C.card : 'transparent', color: income === v ? (v ? C.income : C.ink) : C.muted, fontWeight: income === v ? 600 : 400 }}>{v ? '收入' : '支出'}</button>)}
        </div>
        <div className="flex items-baseline gap-1 border-b pb-1" style={{ borderColor: C.line }}>
          <span className="text-[20px]" style={{ color: C.muted }}>¥</span>
          <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" className="flex-1 text-[32px] font-bold outline-none bg-transparent" style={{ color: income ? C.income : C.ink }} />
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="买了什么 / 哪来的（会自动猜分类）" className="w-full px-3 py-2 rounded-xl text-[13px] outline-none" style={{ background: C.deep }} />
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(table).map(([k, v]) => (
            <button key={k} onClick={() => setCat(k)} className="px-2.5 py-1 rounded-full text-[11.5px]" style={{ background: effCat === k ? C.ink : C.deep, color: effCat === k ? '#fff' : C.ink }}>{v.emoji} {v.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value || getLocalDateKey())} className="px-2 py-1.5 rounded-lg text-[12px]" style={{ background: C.deep }} />
          <span className="flex-1" />
          {onDelete && <button onClick={onDelete} className="text-[12.5px] px-3 py-2" style={{ color: '#d9534f' }}>删除</button>}
          <button onClick={submit} disabled={!amt} className="px-6 py-2 rounded-xl text-white text-[13.5px] font-semibold disabled:opacity-30" style={{ background: income ? C.income : C.ink }}>{tx ? '保存' : '记下'}</button>
        </div>
      </div>
    </div>
  );
};

export default LedgerApp;
