# 考公陪练（个人二改）

代码：`apps/ExamApp.tsx`、`components/exam/ExamRunner.tsx`、`utils/examCards.ts` + `utils/examCardsPd.ts`（手写技巧卡）、`utils/examSyllabus.ts`（知识点大纲）、`utils/examCoach.ts`（错题拆解、复习、申论、模型出题）、`utils/figureGen.ts`（图推题生成）、`utils/examBank.ts`（题库）。

## 规矩

- 技巧卡是手写的固定内容，不让模型现编；没有手写卡的知识点第一次打开时按同一格式生成一次并缓存（`sully_exam_points_v2`）。
- 图形推理的图只能由 `figureGen.ts` 按规则画：先定规则、再画、答案由同一份数据算出，再用独立检查（数面、数线、奇点、对称轴、运算唯一性）复查，不过的题丢掉重出。不要让模型生成图推题或图。改生成器后跑一遍每类 200 道的检查。
- 题库：LogiQA（研究数据集，题目来自国考）运行时从 jsDelivr / GitHub 下载到本机 Cache Storage（`sully-exam-bank-v1`），不打包进仓库；PDF 导入在本机解析切题、对答案，不调模型。只有「讲这道」「拆错题」「追问」「申论批改」「模型出题」会调用模型（自习室 API，没配用主 API）。
- 不接入付费题库或盗版资源。
