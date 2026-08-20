/* 任務 13.1 — 第一階段全流程驗證
 *
 * 用記憶體版資料庫走完一遍真實使用順序，確認各模組串起來不會斷：
 *   家庭登入 → 選學生 → 今日任務排課 → 作答 → 看解答 → 交卷（暫定成績）
 *   → 老師批改 → 成績轉正式 → 補積分 → 產生通知 → 檢討畫面資料齊全
 *
 * 這裡刻意不 mock 任何引擎函式，只換掉 Supabase 用戶端。
 */

import { suite, test, ok, eq, approx, makeFakeSupabase, resetStorage } from './harness.js';
import { injectClient, settings as dbSettings, students, lessons, attempts, points, notifications, subjectState, mastery } from '../js/db.js';
import { ensureToday, todaySummary, assignLesson } from '../js/engine/schedule.js';
import { submitLesson, applyTeacherGrade } from '../js/engine/grade.js';
import { validateQuestion } from '../js/bank/validate.js';

const BRUCE = { id: 1, name: 'Bruce', level: 'g8' };
const MELODY = { id: 2, name: 'Melody', level: 'g5' };

const SETTINGS = {
  id: 1, summer_start: '07-01', summer_end: '08-31',
  lessons_weekday: 1, lessons_summer: 2, target_minutes: 25, rotation: {}
};

function boot() {
  resetStorage();
  const fake = makeFakeSupabase({
    students: [BRUCE, MELODY],
    app_settings: [SETTINGS],
    lessons: [], attempts: [], topic_mastery: [], subject_state: [],
    points_ledger: [], badges: [], notifications: []
  });
  injectClient(fake);
  return fake;
}

/* ------------------------------------------------------------------ */

suite('全流程：平日一堂課從排課到正式成績', () => {

  test('一路走完不會中斷，且每一步的資料都對得上', async () => {
    const fake = boot();
    const date = '2026-09-16';               // 星期三，非暑假

    /* 1. 讀設定與學生 —— 相當於家庭登入後的第一批查詢 */
    const cfg = await dbSettings.get();
    eq(cfg.lessons_weekday, 1);
    eq((await students.list()).length, 2);

    /* 2. 今日任務：自動排課 */
    const todays = await ensureToday(BRUCE, { date, settings: cfg });
    eq(todays.length, 1, '平日一堂');
    const lesson = todays[0];
    eq(lesson.student_id, 1);
    eq(lesson.lesson_date, date);
    eq(lesson.status, 'pending');
    ok(lesson.plan.items.length > 0, '課堂必須有題目');

    /* 重複進首頁不應該再排一次 */
    eq((await ensureToday(BRUCE, { date, settings: cfg })).length, 1, '排課要具有幂等性');

    /* 3. 題目結構全部合法 */
    lesson.plan.items.forEach((q, i) => {
      const errs = validateQuestion(q, `第 ${i + 1} 題`);
      eq(errs.length, 0, `題目不合法：${errs.join('；')}`);
    });

    /* 4. 作答：第一題故意看解答，其餘照正解填 */
    const answers = {};
    lesson.plan.items.forEach((q, i) => { answers[i + 1] = correctAnswerOf(q); });

    const r = await submitLesson({
      lesson, student: BRUCE, answers, revealed: [1], date,
      timerSeconds: 1500, elapsedSeconds: 1800, pauseCount: 1
    });

    /* 5. 交卷結果 */
    const rows = await attempts.forLesson(lesson.id);
    eq(rows.length, lesson.plan.items.length, '每題都要有作答紀錄');
    eq(rows[0].revealed, true);
    eq(rows[0].score, 0, '看過解答不計分');

    const writingCount = rows.filter(x => x.needs_grading).length;
    eq(r.provisional, writingCount > 0);
    eq(r.lesson.status, writingCount > 0 ? 'submitted' : 'graded');

    /* 6. 積分只從得分來，且必須大於零（第一題以外都答對） */
    const afterSubmit = await points.total(1);
    approx(afterSubmit, r.scoreEarned + r.bonus, 0.01);
    ok(afterSubmit > 0, '答對題目應該有積分');

    /* 7. 看過解答的知識點排入複習 */
    const m = await mastery.get(1, rows[0].topic);
    ok(m, '看過解答的知識點要排複習');
    eq(m.mastered, false);

    /* 8. 近期紀錄不含看過解答的那題 */
    const st = await subjectState.get(1, lesson.subject);
    eq(st.recent.length, rows.length - 1);

    /* 9. 老師批改所有待批改的題目 */
    let pendingRows = await attempts.needingGrading();
    eq(pendingRows.length, writingCount);

    while (pendingRows.length) {
      const target = pendingRows[0];
      await applyTeacherGrade({
        attempt: target,
        grade: { score: Number(target.max_score) * 0.8, comment: '寫得不錯，再多舉一個例子' }
      });
      pendingRows = await attempts.needingGrading();
    }

    /* 10. 成績轉正式 */
    const finalLesson = await lessons.get(lesson.id);
    eq(finalLesson.pending_grading, 0);
    eq(finalLesson.status, 'graded');
    ok(Number(finalLesson.score_earned) <= Number(finalLesson.score_max), '得分不得超過滿分');

    /* 11. 積分只增不減 */
    ok(await points.total(1) >= afterSubmit, '批改後積分不得下降');

    /* 12. 有作文才會有批改完成通知 */
    const notes = await notifications.unread(1);
    eq(notes.filter(n => n.kind === 'graded').length, writingCount > 0 ? 1 : 0);

    /* 13. 檢討畫面要用到的欄位都在 */
    for (const x of await attempts.forLesson(lesson.id)) {
      ok(x.question, '缺少題目快照，檢討畫面會空白');
      ok(x.qtype, '缺少題型');
      ok(x.topic, '缺少知識點');
      ok(Number.isFinite(Number(x.max_score)), '缺少單題滿分');
      eq(x.needs_grading, false, '全部批改完成後不該還有待批改');
    }

    /* 14. 兩個學生的資料彼此獨立 */
    eq(await points.total(2), 0, 'Melody 沒作答，不該有積分');
    eq((await lessons.forDate(2, date)).length, 0);
    ok(fake.__rows('lessons').every(l => l.student_id === 1));
  });
});

suite('全流程：暑假兩堂與管理者指派', () => {

  test('暑假一天排兩堂，科目不重複', async () => {
    boot();
    const cfg = await dbSettings.get();
    const list = await ensureToday(MELODY, { date: '2026-07-15', settings: cfg });
    eq(list.length, 2, '暑假兩堂');
    eq(list[0].slot_of_day, 1);
    eq(list[1].slot_of_day, 2);
    ok(list[0].subject !== list[1].subject, '同一天兩堂不該是同一科');
  });

  test('管理者指派會覆蓋自動排課且標記來源', async () => {
    boot();
    const cfg = await dbSettings.get();
    const date = '2026-09-16';
    await ensureToday(BRUCE, { date, settings: cfg });

    const assigned = await assignLesson({
      student: BRUCE, date, slot: 1, subject: 'chinese', settings: cfg
    });
    eq(assigned.subject, 'chinese');
    eq(assigned.assigned_by, 'admin');

    const still = await ensureToday(BRUCE, { date, settings: cfg });
    eq(still.length, 1, '不該多排一堂');
    eq(still[0].subject, 'chinese', '自動排課不得覆寫管理者的指派');
  });

  test('todaySummary 回報完成進度', async () => {
    boot();
    const date = '2026-09-16';
    const before = await todaySummary(BRUCE, date);
    eq(before.done, 0);
    ok(before.total >= 1);

    const lesson = (await ensureToday(BRUCE, { date }))[0];
    const answers = {};
    lesson.plan.items.forEach((q, i) => { answers[i + 1] = correctAnswerOf(q); });
    await submitLesson({ lesson, student: BRUCE, answers, date });

    const after = await todaySummary(BRUCE, date);
    eq(after.done, 1);
  });
});

/* ------------------------------------------------------------------ */
/* 依題型取出正解，模擬「全部答對」的作答                                */
/* ------------------------------------------------------------------ */

function correctAnswerOf(q) {
  if (q.type === 'mc') return q.options.findIndex(o => o.correct);
  if (q.type === 'mmc') return q.options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0);
  if (q.type === 'essay' || q.type === 'short') return '這是我寫的內容。'.repeat(30);
  const a = q.answer || {};
  if (a.value !== undefined) return String(a.value);
  if (a.text !== undefined) return a.text;
  if (Array.isArray(a.accept) && a.accept.length) return a.accept[0];
  return '';
}
