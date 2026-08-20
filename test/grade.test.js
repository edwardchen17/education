/* 任務 10.3 — 批改與計分測試
 * 對應 Property 1（積分單調遞增）、7（看解答零分）、8（得分不超上限）、
 *      9（連續加成有上界）、10（近期紀錄有界）
 */

import { suite, test, ok, eq, approx, deepEq, makeFakeSupabase } from './harness.js';
import { injectClient, lessons, attempts, points, mastery, subjectState } from '../js/db.js';
import { gradeLesson, submitLesson, applyTeacherGrade, reviseGrade, accuracyOf } from '../js/engine/grade.js';
import { maxScore, streakBonus } from '../js/config/scoring.js';

/* ------------------------------------------------------------------ */
/* 測試用的題目與課堂                                                  */
/* ------------------------------------------------------------------ */

const mcQ = (difficulty = 'basic', topic = 'math.g8.factor.cross') => ({
  type: 'mc', stem: '題',
  options: [
    { text: 'A', correct: true, why: '對' },
    { text: 'B', correct: false, why: '錯' }
  ],
  topic, subject: 'math', difficulty, est_seconds: 60, base_points: 2
});

const calcQ = (difficulty = 'basic') => ({
  type: 'calc', stem: '算', answer: { value: 18, tolerance: 0.01 },
  steps: [{ expr: '18', why: '' }],
  topic: 'math.g8.pythagoras.basic', subject: 'math',
  difficulty, est_seconds: 90, base_points: 5
});

const essayQ = () => ({
  type: 'essay', stem: '作文', prompt: '題目', min_words: 400,
  rubric: [
    { item: '內容', points: 15, desc: '說明' },
    { item: '文字', points: 15, desc: '說明' }
  ],
  sample: '範文'.repeat(60),
  topic: 'chinese.g8.writing.narrative', subject: 'chinese',
  difficulty: 'basic', est_seconds: 1200, base_points: 30
});

const mkLesson = (items, extra = {}) => ({
  id: 500, student_id: 1, lesson_date: '2026-09-15', slot_of_day: 1,
  subject: items[0].subject, status: 'pending', assigned_by: 'auto',
  plan: { items, seconds: items.reduce((s, q) => s + q.est_seconds, 0) },
  score_max: items.reduce((s, q) => s + maxScore(q.type, q.difficulty), 0),
  pending_grading: items.filter(q => q.type === 'essay').length,
  ...extra
});

const STUDENT = { id: 1, name: 'Bruce', level: 'g8' };

function fresh(lesson) {
  const fake = makeFakeSupabase({
    students: [STUDENT, { id: 2, name: 'Melody', level: 'g5' }],
    app_settings: [{ id: 1, summer_start: '07-01', summer_end: '08-31', lessons_weekday: 1, lessons_summer: 2, target_minutes: 25, rotation: {} }],
    lessons: lesson ? [lesson] : [],
    attempts: [], topic_mastery: [], subject_state: [], points_ledger: [],
    badges: [], notifications: []
  });
  injectClient(fake);
  return fake;
}

/* ------------------------------------------------------------------ */
/* 純函式批改                                                          */
/* ------------------------------------------------------------------ */

suite('批改：客觀題', () => {

  test('全對得滿分', () => {
    const lesson = mkLesson([mcQ(), mcQ(), calcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: 0, 3: '18' } });
    eq(g.scoreEarned, 2 + 2 + 5);
    eq(g.scoreMax, 9);
    eq(g.correctCount, 3);
    eq(g.pendingGrading, 0);
  });

  test('答錯得零分', () => {
    const lesson = mkLesson([mcQ(), calcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 1, 2: '20' } });
    eq(g.scoreEarned, 0);
    eq(g.correctCount, 0);
  });

  test('未作答視為答錯', () => {
    const lesson = mkLesson([mcQ(), mcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0 } });
    eq(g.scoreEarned, 2);
    eq(g.rows[1].is_correct, false);
    eq(g.rows[1].answer, null);
  });

  test('難度倍率反映在滿分上（Property 8）', () => {
    const lesson = mkLesson([mcQ('gifted'), calcQ('advanced')]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: '18' } });
    eq(g.rows[0].max_score, 3.2, '單選 2 分 × 1.6');
    eq(g.rows[1].max_score, 6.5, '計算 5 分 × 1.3');
    eq(g.scoreEarned, 9.7);
  });

  test('每題得分不超過該題滿分（Property 8）', () => {
    const lesson = mkLesson([mcQ('gifted'), calcQ('gifted'), mcQ('advanced')]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: '18', 3: 0 } });
    for (const r of g.rows) {
      ok(r.score <= r.max_score, `${r.seq} 得分 ${r.score} 超過滿分 ${r.max_score}`);
    }
    ok(g.scoreEarned <= g.scoreMax);
  });

  test('保留原始作答供老師複核', () => {
    const lesson = mkLesson([calcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: '大概十八' } });
    eq(g.rows[0].is_correct, false);
    eq(g.rows[0].answer.raw, '大概十八', '看不懂的答案也要留下原文');
  });

  test('記錄每題耗時', () => {
    const lesson = mkLesson([mcQ(), mcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: 0 }, seconds: { 1: 45, 2: 88.6 } });
    eq(g.rows[0].seconds, 45);
    eq(g.rows[1].seconds, 89, '秒數四捨五入');
  });
});

suite('批改：看過解答一律零分（Property 7）', () => {

  test('看過解答即使答對也是零分', () => {
    const lesson = mkLesson([mcQ(), mcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: 0 }, revealed: [1] });
    eq(g.rows[0].score, 0, '第一題看過解答');
    eq(g.rows[0].revealed, true);
    eq(g.rows[1].score, 2);
    eq(g.scoreEarned, 2, '只有第二題計分');
  });

  test('看過解答不計入答對率（需求 12.7）', () => {
    const lesson = mkLesson([mcQ(), mcQ(), mcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: 0, 3: 1 }, revealed: [1] });
    eq(g.accuracyItems.length, 2, '只有兩題納入答對率');
    eq(g.correctCount, 1, '看過解答的那題不算答對');
  });

  test('仍保留實際對錯，供老師參考', () => {
    const lesson = mkLesson([mcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0 }, revealed: [1] });
    eq(g.rows[0].is_correct, true, '看了解答後答對，事實仍要記錄');
    eq(g.rows[0].score, 0, '但不給分');
  });

  test('全部看過解答則得零分', () => {
    const lesson = mkLesson([mcQ(), calcQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: '18' }, revealed: [1, 2] });
    eq(g.scoreEarned, 0);
    eq(g.accuracyItems.length, 0);
  });
});

suite('批改：作文送待批改', () => {

  test('作文標記待批改且不計分', () => {
    const lesson = mkLesson([mcQ(), essayQ()]);
    const g = gradeLesson(lesson, { answers: { 1: 0, 2: '我的作文……' } });
    eq(g.pendingGrading, 1);
    eq(g.rows[1].needs_grading, true);
    eq(g.rows[1].score, null, '尚未批改，分數為空而不是零');
    eq(g.rows[1].is_correct, null);
    eq(g.scoreEarned, 2, '暫定成績只含客觀題');
  });

  test('滿分包含作文', () => {
    const lesson = mkLesson([mcQ(), essayQ()]);
    const g = gradeLesson(lesson, { answers: {} });
    eq(g.scoreMax, 32, '單選 2 + 作文 30');
  });

  test('作文即使空白也送批改而非自動零分', () => {
    const lesson = mkLesson([essayQ()]);
    const g = gradeLesson(lesson, { answers: { 1: '' } });
    eq(g.rows[0].needs_grading, true);
    eq(g.rows[0].score, null);
  });
});

/* ------------------------------------------------------------------ */
/* 交卷流程                                                            */
/* ------------------------------------------------------------------ */

suite('交卷：寫入與狀態', () => {

  test('作答紀錄寫入資料庫', async () => {
    const lesson = mkLesson([mcQ(), calcQ()]);
    const fake = fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: '18' }, date: '2026-09-15' });
    eq(fake.__rows('attempts').length, 2);
  });

  test('沒有作文時直接轉為已批改', async () => {
    const lesson = mkLesson([mcQ()]);
    fresh(lesson);
    const r = await submitLesson({ lesson, student: STUDENT, answers: { 1: 0 }, date: '2026-09-15' });
    eq(r.lesson.status, 'graded');
    eq(r.provisional, false);
    eq(r.lesson.pending_grading, 0);
  });

  test('有作文時停在暫定狀態', async () => {
    const lesson = mkLesson([mcQ(), essayQ()]);
    fresh(lesson);
    const r = await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: '文' }, date: '2026-09-15' });
    eq(r.lesson.status, 'submitted');
    eq(r.provisional, true, '成績為暫定');
    eq(r.lesson.pending_grading, 1);
  });

  test('分別記錄計時器與實際經過時間（需求 7.5）', async () => {
    const lesson = mkLesson([mcQ()]);
    fresh(lesson);
    const r = await submitLesson({
      lesson, student: STUDENT, answers: { 1: 0 }, date: '2026-09-15',
      timerSeconds: 900, elapsedSeconds: 3300, pauseCount: 4
    });
    eq(r.lesson.timer_seconds, 900);
    eq(r.lesson.elapsed_seconds, 3300, '實際經過遠大於計時器，代表暫停過');
    eq(r.lesson.pause_count, 4);
  });
});

suite('交卷：積分與連續加成（Property 1、9）', () => {

  test('積分等於得分', async () => {
    const lesson = mkLesson([mcQ(), calcQ()]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: '18' }, date: '2026-09-15' });
    eq(await points.total(1), 7);
  });

  test('第一天沒有連續加成', async () => {
    const lesson = mkLesson([mcQ()]);
    fresh(lesson);
    const r = await submitLesson({ lesson, student: STUDENT, answers: { 1: 0 }, date: '2026-09-15' });
    eq(r.streak, 1);
    eq(r.bonusRate, 0);
    eq(r.bonus, 0);
  });

  test('連續七天開始有加成', async () => {
    const lesson = mkLesson([mcQ(), mcQ(), mcQ(), mcQ(), mcQ()]);
    const fake = fresh();
    // 先造出前六天都已完成的紀錄。日期一定要補零，
    // 因為 addDays 產生的是 2026-09-09 這種格式，字串必須完全一致才對得上。
    for (let d = 9; d <= 14; d++) {
      fake.__rows('lessons').push({
        id: 100 + d, student_id: 1, lesson_date: `2026-09-${String(d).padStart(2, '0')}`,
        slot_of_day: 1, subject: 'math', status: 'submitted', plan: { items: [] }
      });
    }
    fake.__rows('lessons').push(lesson);
    const r = await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, date: '2026-09-15' });
    eq(r.streak, 7);
    approx(r.bonusRate, 0.05);
    approx(r.bonus, 10 * 0.05);
    approx(await points.total(1), 10.5);
  });

  test('加成率恆不超過 25%（Property 9）', () => {
    for (const d of [0, 6, 7, 34, 35, 100, 1000]) {
      const b = streakBonus(d);
      ok(b >= 0 && b <= 0.25, `第 ${d} 天加成 ${b} 超出範圍`);
    }
    eq(streakBonus(35), 0.25);
    eq(streakBonus(3650), 0.25);
  });

  test('答對零題時不寫入積分流水', async () => {
    const lesson = mkLesson([mcQ()]);
    const fake = fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 1 }, date: '2026-09-15' });
    eq(fake.__rows('points_ledger').length, 0);
    eq(await points.total(1), 0);
  });

  test('多次交卷後積分單調遞增（Property 1）', async () => {
    const fake = fresh();
    let prev = 0;
    for (let d = 10; d <= 16; d++) {
      const lesson = mkLesson([mcQ(), calcQ()], { id: 600 + d, lesson_date: `2026-09-${d}` });
      fake.__rows('lessons').push(lesson);
      await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: '18' }, date: `2026-09-${d}` });
      const now = await points.total(1);
      ok(now >= prev, `積分下降了：${prev} → ${now}`);
      prev = now;
    }
    ok(prev > 0);
  });
});

suite('交卷：近期紀錄與複習佇列', () => {

  test('答對錯寫入 subject_state.recent', async () => {
    const lesson = mkLesson([mcQ(), mcQ(), mcQ()]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: 1, 3: 0 }, date: '2026-09-15' });
    const st = await subjectState.get(1, 'math');
    deepEq(st.recent, [true, false, true]);
  });

  test('recent 最多保留二十筆（Property 10）', async () => {
    const fake = fresh();
    for (let d = 1; d <= 9; d++) {
      const items = [mcQ(), mcQ(), mcQ()];
      const lesson = mkLesson(items, { id: 700 + d, lesson_date: `2026-09-0${d}` });
      fake.__rows('lessons').push(lesson);
      await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: 0, 3: 0 }, date: `2026-09-0${d}` });
    }
    const st = await subjectState.get(1, 'math');
    eq(st.recent.length, 20, `實際 ${st.recent.length} 筆`);
  });

  test('看過解答的題目不進入 recent', async () => {
    const lesson = mkLesson([mcQ(), mcQ()]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: 0 }, revealed: [1], date: '2026-09-15' });
    const st = await subjectState.get(1, 'math');
    eq(st.recent.length, 1, '只有未看解答的那題');
  });

  test('答錯的知識點排入三天後複習（需求 11.1、11.2）', async () => {
    const lesson = mkLesson([mcQ('basic', 'math.g8.factor.cross')]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 1 }, date: '2026-09-15' });
    const m = await mastery.get(1, 'math.g8.factor.cross');
    ok(m, '應建立複習紀錄');
    eq(m.box, 0);
    eq(m.due_on, '2026-09-18', '三天後');
    eq(m.wrong_count, 1);
    eq(m.mastered, false);
  });

  test('看過解答的知識點也排入複習（需求 6.7）', async () => {
    const lesson = mkLesson([mcQ('basic', 'math.g8.sqrt.simplify')]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0 }, revealed: [1], date: '2026-09-15' });
    const m = await mastery.get(1, 'math.g8.sqrt.simplify');
    ok(m, '看過解答即使答對也要複習');
    eq(m.due_on, '2026-09-18');
  });

  test('答對的知識點不排入複習', async () => {
    const lesson = mkLesson([mcQ('basic', 'math.g8.quad.factoring')]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0 }, date: '2026-09-15' });
    eq(await mastery.get(1, 'math.g8.quad.factoring'), null);
  });

  test('重複答錯累加錯誤次數', async () => {
    const fake = fresh();
    for (let d = 10; d <= 12; d++) {
      const lesson = mkLesson([mcQ('basic', 'math.g8.factor.cross')], { id: 800 + d, lesson_date: `2026-09-${d}` });
      fake.__rows('lessons').push(lesson);
      await submitLesson({ lesson, student: STUDENT, answers: { 1: 1 }, date: `2026-09-${d}` });
    }
    const m = await mastery.get(1, 'math.g8.factor.cross');
    eq(m.wrong_count, 3);
  });
});

/* ------------------------------------------------------------------ */
/* 老師批改                                                            */
/* ------------------------------------------------------------------ */

suite('老師批改：作文', () => {

  async function setup() {
    // 課堂科目要明確設成國文，否則 mkLesson 會取第一題（數學單選）的科目
    const lesson = mkLesson([mcQ(), essayQ()], { subject: 'chinese' });
    const fake = fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: '我的作文' }, date: '2026-09-15' });
    const rows = await attempts.forLesson(lesson.id);
    return { fake, lesson, essay: rows.find(r => r.needs_grading) };
  }

  test('批改後轉為正式成績', async () => {
    const { essay } = await setup();
    const r = await applyTeacherGrade({ attempt: essay, grade: { score: 24, comment: '結構清楚' } });
    eq(r.pending, 0);
    eq(r.lesson.status, 'graded');
    eq(r.earned, 26, '客觀題 2 + 作文 24');
  });

  test('批改完成後補上作文積分', async () => {
    const { essay } = await setup();
    eq(await points.total(1), 2, '交卷時只有客觀題積分');
    await applyTeacherGrade({ attempt: essay, grade: { score: 24, comment: '' } });
    eq(await points.total(1), 26, '批改後補上 24 分');
  });

  test('批改完成後產生通知（需求 9.6）', async () => {
    const { fake, essay } = await setup();
    await applyTeacherGrade({ attempt: essay, grade: { score: 20, comment: '' } });
    const notes = fake.__rows('notifications');
    eq(notes.length, 1);
    eq(notes[0].kind, 'graded');
    eq(notes[0].payload.subject, 'chinese');
  });

  test('分數超過滿分會被夾住（Property 8）', async () => {
    const { essay } = await setup();
    const r = await applyTeacherGrade({ attempt: essay, grade: { score: 999, comment: '' } });
    eq(r.earned, 32, '作文最多 30 分，加上客觀題 2 分');
  });

  test('負分會被夾成零', async () => {
    const { essay } = await setup();
    const r = await applyTeacherGrade({ attempt: essay, grade: { score: -5, comment: '' } });
    eq(r.earned, 2);
  });

  test('評語與標註會被保存', async () => {
    const { essay } = await setup();
    await applyTeacherGrade({
      attempt: essay,
      grade: { score: 22, comment: '第三段可以再具體一點', marks: [{ from: 10, to: 20, note: '這裡語意不清' }] }
    });
    const rows = await attempts.forLesson(500);
    const e = rows.find(r => r.qtype === 'essay');
    eq(e.grade.comment, '第三段可以再具體一點');
    eq(e.grade.marks.length, 1);
    eq(e.needs_grading, false);
  });
});

suite('老師批改：修改已批改的分數（需求 9.7）', () => {

  async function graded() {
    const lesson = mkLesson([mcQ(), essayQ()]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 0, 2: '文' }, date: '2026-09-15' });
    let rows = await attempts.forLesson(lesson.id);
    const essay = rows.find(r => r.needs_grading);
    await applyTeacherGrade({ attempt: essay, grade: { score: 20, comment: '初評' } });
    rows = await attempts.forLesson(lesson.id);
    return rows.find(r => r.qtype === 'essay');
  }

  test('調升分數會補上差額', async () => {
    const essay = await graded();
    eq(await points.total(1), 22);
    await reviseGrade({ attempt: essay, grade: { score: 26 } });
    eq(await points.total(1), 28, '補上 6 分的差額');
  });

  test('調降分數不追回積分（Property 1）', async () => {
    const essay = await graded();
    const before = await points.total(1);
    const r = await reviseGrade({ attempt: essay, grade: { score: 10 } });
    eq(r.earned, 12, '課堂得分反映新分數');
    eq(await points.total(1), before, '但累積積分不倒退');
  });

  test('修改後評語保留原有內容', async () => {
    const essay = await graded();
    await reviseGrade({ attempt: essay, grade: { score: 24 } });
    const rows = await attempts.forLesson(500);
    const e = rows.find(r => r.qtype === 'essay');
    eq(e.grade.comment, '初評', '沒有指定評語時應保留舊的');
    ok(e.grade.revised_at, '應記錄修改時間');
  });
});

suite('答對率計算', () => {

  test('空紀錄回傳 null', () => eq(accuracyOf([]), null));
  test('全對為 1', () => eq(accuracyOf([true, true, true]), 1));
  test('全錯為 0', () => eq(accuracyOf([false, false]), 0));
  test('一半', () => approx(accuracyOf([true, false, true, false]), 0.5));
  test('非陣列不會拋錯', () => eq(accuracyOf(undefined), null));
});
