/**
 * 考公陪练 · 知识点大纲（个人二改）：行测五大模块 + 申论，按常见教材的分法列到具体考点。
 * card 指向 examCards.ts 里手写的技巧卡；没有的点第一次打开时由模型按同一格式生成并缓存。
 */
import type { ExamModule } from './examCards';

export interface SyllabusPoint { id: string; name: string; card?: string }
export interface SyllabusTopic { name: string; points: SyllabusPoint[] }

const P = (id: string, name: string, card?: string): SyllabusPoint => ({ id, name, card });

export const SYLLABUS: Record<ExamModule, SyllabusTopic[]> = {
  yy: [
    { name: '逻辑填空', points: [P('yy-real', '实词辨析'), P('yy-idiom', '成语辨析'), P('yy-context', '语境分析（呼应、对应）', 'yy-blank')] },
    { name: '片段阅读', points: [P('yy-gist', '主旨概括', 'yy-main'), P('yy-intent', '意图判断'), P('yy-detail', '细节判断'), P('yy-title', '标题选择'), P('yy-attitude', '态度观点')] },
    { name: '语句表达', points: [P('yy-sort', '语句排序', 'yy-order'), P('yy-fill', '语句填空'), P('yy-next', '下文推断')] },
  ],
  sl: [
    { name: '解题方法', points: [P('sl-sub', '代入排除'), P('sl-num', '数字特性', 'sl-feature'), P('sl-eq', '方程法'), P('sl-assign', '赋值法')] },
    { name: '常考题型', points: [P('sl-work2', '工程问题', 'sl-work'), P('sl-travel2', '行程问题', 'sl-travel'), P('sl-profit2', '经济利润', 'sl-profit'), P('sl-perm2', '排列组合', 'sl-perm'), P('sl-prob2', '概率问题', 'sl-prob'), P('sl-venn', '容斥原理'), P('sl-ext2', '最值问题', 'sl-extreme'), P('sl-geo', '几何问题'), P('sl-age', '年龄问题'), P('sl-cycle', '周期问题'), P('sl-ratio', '和差倍比'), P('sl-cow', '牛吃草问题')] },
  ],
  pd: [
    { name: '图形推理 · 怎么下手', points: [P('pd-num', '先看什么：拿到图推的判断顺序', 'pd-count'), P('pd-pos', '位置规律总览', 'pd-position')] },
    { name: '图形推理 · 位置', points: [P('pd-move2', '平移', 'pd-move'), P('pd-rot2', '旋转与翻转', 'pd-rot')] },
    { name: '图形推理 · 样式', points: [P('pd-style', '叠加与黑白运算', 'pd-xor'), P('pd-trav2', '遍历', 'pd-trav')] },
    { name: '图形推理 · 属性', points: [P('pd-attr', '对称', 'pd-sym'), P('pd-curve2', '曲直', 'pd-curve'), P('pd-open2', '开闭', 'pd-open')] },
    { name: '图形推理 · 数量', points: [P('pd-face2', '面', 'pd-face'), P('pd-line2', '线', 'pd-line'), P('pd-point2', '点（交点）', 'pd-point'), P('pd-stroke2', '一笔画与笔画数', 'pd-stroke'), P('pd-part2', '部分数', 'pd-part')] },
    { name: '图形推理 · 空间', points: [P('pd-cube', '六面体展开图', 'pd-cube'), P('pd-section2', '截面与三视图', 'pd-section')] },
    { name: '定义判断', points: [P('pd-def', '单定义 / 多定义', 'pd-define')] },
    { name: '类比推理', points: [P('pd-ana', '逻辑关系（种属、组成、交叉、对立）', 'pd-analogy'), P('pd-sem', '语义关系（近义、反义、比喻）'), P('pd-gram', '语法关系（主谓、动宾）')] },
    { name: '逻辑判断', points: [P('pd-trans', '翻译推理', 'pd-translate'), P('pd-truth', '真假推理'), P('pd-anal', '分析推理（排列、对应）'), P('pd-weak', '削弱论证', 'pd-argue'), P('pd-strong', '加强论证'), P('pd-premise', '前提假设'), P('pd-explain', '原因解释'), P('pd-induct', '归纳推理')] },
  ],
  zl: [
    { name: '基础概念', points: [P('zl-rate', '增长率'), P('zl-amt', '增长量', 'zl-growth'), P('zl-base2', '基期量', 'zl-base'), P('zl-now', '现期量'), P('zl-mult', '倍数')] },
    { name: '进阶题型', points: [P('zl-share2', '比重', 'zl-share'), P('zl-avg2', '平均数', 'zl-avg'), P('zl-int2', '间隔增长率', 'zl-interval'), P('zl-mix2', '混合增长率', 'zl-mixed'), P('zl-pull2', '拉动增长 / 贡献率', 'zl-pull'), P('zl-yearavg', '年均增长率')] },
    { name: '速算', points: [P('zl-speed2', '截位直除 · 百化分', 'zl-speed'), P('zl-feature', '特征数字、估算'), P('zl-comp', '综合分析题怎么快速排除')] },
  ],
  cs: [
    { name: '政治', points: [P('cs-news', '时政热点'), P('cs-marx', '马克思主义哲学'), P('cs-party', '党史与重要会议'), P('cs-theory', '党的创新理论')] },
    { name: '法律', points: [P('cs-const', '宪法'), P('cs-civil', '民法典'), P('cs-crime', '刑法'), P('cs-admin', '行政法')] },
    { name: '经济', points: [P('cs-macro', '宏观调控（财政、货币政策）'), P('cs-market', '市场经济基本概念')] },
    { name: '历史人文', points: [P('cs-ancient', '中国古代史'), P('cs-modern', '中国近现代史'), P('cs-lit', '文学常识'), P('cs-culture', '传统文化（节日、礼仪）')] },
    { name: '地理科技', points: [P('cs-geo', '中国地理'), P('cs-nature', '自然地理'), P('cs-sci', '生活中的物理化学生物'), P('cs-tech', '科技成就')] },
  ],
  sh: [
    { name: '小题', points: [P('sh-sum', '归纳概括', 'sh-summary'), P('sh-anal', '综合分析（解释、评价）'), P('sh-measure', '提出对策')] },
    { name: '贯彻执行', points: [P('sh-doc2', '通知 / 倡议书', 'sh-doc'), P('sh-speech', '讲话稿'), P('sh-report', '报告 / 简报'), P('sh-promo', '宣传稿 / 编者按')] },
    { name: '大作文', points: [P('sh-theme', '审题立意'), P('sh-sub', '分论点怎么列'), P('sh-arg', '论证段怎么写'), P('sh-open', '开头和结尾')] },
  ],
};

export const allPoints = () => (Object.keys(SYLLABUS) as ExamModule[]).flatMap(m => SYLLABUS[m].flatMap(t => t.points.map(p => ({ ...p, module: m, topic: t.name }))));
export const pointById = (id?: string) => allPoints().find(p => p.id === id);
