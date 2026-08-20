/* 任務 12.4／12.5 — 批改介面的資料路徑測試
 *
 * 這個檔案釘住批改流程的三件事，避免介面改版時悄悄壞掉：
 *   1. 評分規準逐項給分換算成該題滿分的比例（需求 9.3、Property 8）
 *   2. 逐項給分、標註、評語在存檔與讀回之間完整往返（需求 9.4、9.7）
 *   3. gradedWriting 只回傳已批改的寫作題，供老師回頭修改分數
 */

import { suite, test, ok, eq, approx, deepEq, makeFakeSupabase } from './harness.js';
import { injectClient, attempts } from '../js/db.js';
import { submitLesson, applyTeacherGrade, reviseGrade, scaleRubric } from '../js/engine/grade.js';
import { maxScore } from '../js/config/scoring.js';

/* ------------------------------------------------------------------ */
/* 測試素材                                                            */
/* ------------------------------------------------------------------ */

const RUBRIC = [
  { item: '內容取材', points: 10, desc: '切題、有具體例子' },
  { item: '結構組織', points: 8, desc: '段落分明' },
  { item: '文字運用', points: 8, desc: '用詞準確' },
  { item: '標點格式', points: 4, desc: '標點正確' }
];

const mcQ = () => ({
  type: 'mc', stem: '題',
  options: [{ text: 'A', correct: true, why: '對' }, { text: 'B', correct: false, why: '錯' }],
  topic: 'math.g8.factor.cross', subject: 'math',
  difficulty: 'basic', est_seconds: 60, base_points: 2
});

const essayQ = (difficulty = 'basic') => ({
  type: 'essay', stem: '作文', prompt: '請寫一篇記敘文', min_words: 400,
  rubric: RUBRIC, sample: '範文'.repeat(60),
  topic: 'chinese.g8.writing.narrative', subject: 'chinese',
  difficulty, est_seconds: 1200, base_points: 30
});

const shortQ = () => ({
  type: 'short', stem: '請說明理由', prompt: '請說明理由',
  topic: 'science.g8.force.newton', subject: 'science',
  difficulty: 'basic', est_seconds: 180, base_points: 5
});

const STUDENT = { id: 1, name: 'Bruce', level: 'g8' };

const mkLesson = (items, extra = {}) => ({
  id: 900, student_id: 1, lesson_date: '2026-09-20', slot_of_day: 1,
  subject: 'chinese', status: 'pending', assigned_by: 'auto',
  plan: { items, seconds: items.reduce((s, q) => s + q.est_seconds, 0) },
  score_max: items.reduce((s, q) => s + maxScore(q.type, q.difficulty), 0),
  pending_grading: items.filter(q => q.type === 'essay' || q.type === 'short').length,
  ...extra
});

function fresh(lesson) {
  const fake = makeFakeSupabase({
    students: [STUDENT],
    app_settings: [{ id: 1, summer_start: '07-01', summer_end: '08-31', lessons_weekday: 1, lessons_summer: 2, target_minutes: 25, rotation: {} }],
    lessons: lesson ? [lesson] : [],
    attempts: [], topic_mastery: [], subject_state: [], points_ledger: [],
    badges: [], notifications: []
  });
  injectClient(fake);
  return fake;
}

/** 交卷後取出待批改的那一題 */
async function pending(items, extra = {}) {
  const lesson = mkLesson(items, extra);
  const fake = fresh(lesson);
  const answers = {};
  items.forEach((q, i) => { answers[i + 1] = q.type === 'mc' ? 0 : '我寫的內容'; });
  await submitLesson({ lesson, student: STUDENT, answers, date: '2026-09-20' });
  const rows = await attempts.forLesson(lesson.id);
  return { fake, lesson, target: rows.find(r => r.needs_grading) };
}

/* ------------------------------------------------------------------ */
/* 規準換算                                                            */
/* ------------------------------------------------------------------ */

suite('批改介面：評分規準換算', () => {

  test('規準總分等於題目滿分時原分照給', () => {
    const r = scaleRubric([10, 8, 8, 4], RUBRIC, 30);
    eq(r.rubricMax, 30);
    eq(r.sum, 30);
    eq(r.score, 30);
  });

  test('全部零分得零分', () => {
    const r = scaleRubric([0, 0, 0, 0], RUBRIC, 30);
    eq(r.sum, 0);
    eq(r.score, 0);
  });

  test('部分給分按比例換算', () => {
    const r = scaleRubric([7, 6, 5, 3], RUBRIC, 30);
    eq(r.sum, 21);
    eq(r.score, 21, '規準 30 分對滿分 30 分，比例為一');
  });

  test('題目滿分因難度倍率放大時按比例放大', () => {
    /* 資優作文滿分 30 × 1.6 = 48，規準仍以 30 分為基準 */
    const max = maxScore('essay', 'gifted');
    eq(max, 48);
    const r = scaleRubric([10, 8, 8, 4], RUBRIC, max);
    eq(r.score, 48, '規準拿滿就是題目滿分');
    approx(scaleRubric([5, 4, 4, 2], RUBRIC, max).score, 24, 1e-9, '規準一半就是滿分一半');
  });

  test('換算結果不會超過題目滿分（Property 8）', () => {
    for (const diff of ['basic', 'advanced', 'gifted']) {
      const max = maxScore('essay', diff);
      /* 刻意給超過配分的分數，模擬老師打錯 */
      const r = scaleRubric([99, 99, 99, 99], RUBRIC, max);
      ok(r.score <= max, `${diff} 換算得 ${r.score} 超過滿分 ${max}`);
      eq(r.sum, 30, '逐項給分先各自夾在該項配分內');
    }
  });

  test('單項負分夾成零', () => {
    const r = scaleRubric([-5, 8, 8, 4], RUBRIC, 30);
    eq(r.sum, 20);
    eq(r.score, 20);
  });

  test('缺少的項目視為零分', () => {
    const r = scaleRubric([10], RUBRIC, 30);
    eq(r.sum, 10);
  });

  test('非數字視為零分而不是 NaN', () => {
    const r = scaleRubric(['', null, undefined, '四'], RUBRIC, 30);
    eq(r.sum, 0);
    eq(r.score, 0);
    ok(Number.isFinite(r.score));
  });

  test('沒有規準時退回直接給分', () => {
    const r = scaleRubric([12], [], 30);
    eq(r.rubricMax, 0);
    eq(r.score, 0, '沒有規準就沒有項目可加');
  });

  test('換算結果最多兩位小數', () => {
    const r = scaleRubric([1, 0, 0, 0], RUBRIC, 39);
    eq(r.score, Math.round(r.score * 100) / 100);
  });
});

/* ------------------------------------------------------------------ */
/* 存檔往返                                                            */
/* ------------------------------------------------------------------ */

suite('批改介面：逐項給分與標註往返', () => {

  test('逐項給分寫入 grade.items 並能讀回', async () => {
    const { target, lesson } = await pending([mcQ(), essayQ()]);
    const items = [9, 7, 6, 3];
    const r = scaleRubric(items, RUBRIC, Number(target.max_score));

    await applyTeacherGrade({ attempt: target, grade: { score: r.score, comment: '不錯', items } });

    const rows = await attempts.forLesson(lesson.id);
    const e = rows.find(x => x.qtype === 'essay');
    deepEq(e.grade.items, items, '批改介面要靠這個還原輸入框');
    eq(e.score, r.score);
    eq(e.needs_grading, false);
  });

  test('標註的引文與註解完整保存', async () => {
    const { target, lesson } = await pending([essayQ()]);
    const marks = [
      { text: '春天的風吹過來', note: '這裡可以再具體一點' },
      { text: '我很開心', note: '換個說法看看' }
    ];
    await applyTeacherGrade({ attempt: target, grade: { score: 20, comment: '', marks, items: [7, 5, 5, 3] } });

    const rows = await attempts.forLesson(lesson.id);
    const e = rows.find(x => x.qtype === 'essay');
    deepEq(e.grade.marks, marks);
  });

  test('沒有標註時存成空陣列而不是 undefined', async () => {
    const { target, lesson } = await pending([essayQ()]);
    await applyTeacherGrade({ attempt: target, grade: { score: 18, comment: '' } });
    const rows = await attempts.forLesson(lesson.id);
    deepEq(rows.find(x => x.qtype === 'essay').grade.marks, [], '檢討畫面會走 marks.filter');
  });

  test('修改分數時保留原有的逐項給分', async () => {
    const { target, lesson } = await pending([essayQ()]);
    await applyTeacherGrade({ attempt: target, grade: { score: 20, comment: '初評', items: [7, 5, 5, 3] } });

    let rows = await attempts.forLesson(lesson.id);
    const graded = rows.find(x => x.qtype === 'essay');

    await reviseGrade({ attempt: graded, grade: { score: 24 } });

    rows = await attempts.forLesson(lesson.id);
    const e = rows.find(x => x.qtype === 'essay');
    deepEq(e.grade.items, [7, 5, 5, 3], '沒有重新指定就要保留');
    eq(e.grade.comment, '初評');
    eq(e.score, 24);
  });

  test('修改時給新的逐項給分會覆蓋舊的', async () => {
    const { target, lesson } = await pending([essayQ()]);
    await applyTeacherGrade({ attempt: target, grade: { score: 20, comment: '', items: [7, 5, 5, 3] } });

    let rows = await attempts.forLesson(lesson.id);
    const graded = rows.find(x => x.qtype === 'essay');

    const items = [10, 8, 8, 4];
    const r = scaleRubric(items, RUBRIC, Number(graded.max_score));
    await reviseGrade({ attempt: graded, grade: { score: r.score, items, comment: '重看一次，寫得很好' } });

    rows = await attempts.forLesson(lesson.id);
    const e = rows.find(x => x.qtype === 'essay');
    deepEq(e.grade.items, items);
    eq(e.grade.comment, '重看一次，寫得很好');
  });

  test('修改時清空標註會被保存', async () => {
    const { target, lesson } = await pending([essayQ()]);
    await applyTeacherGrade({
      attempt: target,
      grade: { score: 20, comment: '', items: [7, 5, 5, 3], marks: [{ text: '一段', note: '註' }] }
    });

    let rows = await attempts.forLesson(lesson.id);
    const graded = rows.find(x => x.qtype === 'essay');
    await reviseGrade({ attempt: graded, grade: { score: 20, marks: [] } });

    rows = await attempts.forLesson(lesson.id);
    deepEq(rows.find(x => x.qtype === 'essay').grade.marks, []);
  });

  test('簡答題也走同一條批改路徑', async () => {
    const { target, lesson } = await pending([shortQ()], { subject: 'science' });
    eq(target.qtype, 'short');
    const r = await applyTeacherGrade({ attempt: target, grade: { score: 4, comment: '方向對了' } });
    eq(r.pending, 0);
    eq(r.lesson.status, 'graded');

    const rows = await attempts.forLesson(lesson.id);
    eq(rows[0].grade.comment, '方向對了');
  });

  test('多篇待批改要全部改完才轉正式', async () => {
    const lesson = mkLesson([essayQ(), shortQ()]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: '作文', 2: '簡答' }, date: '2026-09-20' });

    let rows = await attempts.forLesson(lesson.id);
    const first = rows.find(r => r.qtype === 'essay');
    const r1 = await applyTeacherGrade({ attempt: first, grade: { score: 20, comment: '' } });
    eq(r1.pending, 1, '還剩簡答');
    eq(r1.lesson.status, 'submitted', '仍是暫定成績');

    rows = await attempts.forLesson(lesson.id);
    const second = rows.find(r => r.needs_grading);
    const r2 = await applyTeacherGrade({ attempt: second, grade: { score: 5, comment: '' } });
    eq(r2.pending, 0);
    eq(r2.lesson.status, 'graded');
    eq(r2.earned, 25);
  });
});

/* ------------------------------------------------------------------ */
/* 批改佇列                                                            */
/* ------------------------------------------------------------------ */

suite('批改介面：佇列查詢', () => {

  test('needingGrading 只回傳待批改的寫作題', async () => {
    const { lesson } = await pending([mcQ(), essayQ()]);
    const queue = await attempts.needingGrading();
    eq(queue.length, 1);
    eq(queue[0].qtype, 'essay');
    eq(queue[0].lesson_id, lesson.id);
  });

  test('批改完就離開待批改佇列', async () => {
    const { target } = await pending([mcQ(), essayQ()]);
    await applyTeacherGrade({ attempt: target, grade: { score: 20, comment: '' } });
    eq((await attempts.needingGrading()).length, 0);
  });

  test('gradedWriting 只回傳已批改的寫作題', async () => {
    const { target } = await pending([mcQ(), essayQ()]);
    eq((await attempts.gradedWriting()).length, 0, '還沒批改時是空的');

    await applyTeacherGrade({ attempt: target, grade: { score: 20, comment: '評語' } });

    const list = await attempts.gradedWriting();
    eq(list.length, 1, '客觀題不該出現在這裡');
    eq(list[0].qtype, 'essay');
    eq(list[0].grade.comment, '評語');
  });

  test('gradedWriting 遵守筆數上限', async () => {
    const fake = fresh();
    for (let d = 1; d <= 5; d++) {
      const lesson = mkLesson([essayQ()], { id: 950 + d, lesson_date: `2026-09-0${d}` });
      fake.__rows('lessons').push(lesson);
      await submitLesson({ lesson, student: STUDENT, answers: { 1: '作文' }, date: `2026-09-0${d}` });
      const target = (await attempts.needingGrading())[0];
      await applyTeacherGrade({ attempt: target, grade: { score: 20, comment: '' } });
    }
    eq((await attempts.gradedWriting()).length, 5);
    eq((await attempts.gradedWriting(3)).length, 3);
  });
});
