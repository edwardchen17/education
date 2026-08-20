/* 訪客試用模式測試
 *
 * 這一組測試守住三件事：
 *   1. 本機資料庫的行為和 Supabase 那一套查詢介面一致（否則畫面會拿到錯資料）
 *   2. 訪客沙盒完全獨立：不用家庭密碼、不共用學生 id、不寫 edu.currentStudent
 *   3. 不限次數且每次換一張新卷
 */

import { suite, test, ok, eq, deepEq, resetStorage, installBrowserStubs } from './harness.js';
import { makeLocalClient, clearLocalStore } from '../js/local.js';
import { injectClient, students, lessons, attempts, points, subjectState, settings } from '../js/db.js';
import { createPracticeLesson } from '../js/engine/schedule.js';
import { submitLesson } from '../js/engine/grade.js';
import { validateQuestion } from '../js/bank/validate.js';
import {
  DEMO_STUDENT_ID, DEMO_NAME, DEMO_SUBJECT, DEMO_LEVEL, DEMO_ROUTES,
  isDemo, enterDemo, exitDemo, resetDemo, currentStudentId
} from '../js/demo.js';

installBrowserStubs();

/* 每個測試都從乾淨的分頁開始 */
function freshDemo() {
  exitDemo();
  resetStorage();
  enterDemo();
}

const correctAnswerOf = q => {
  if (q.type === 'mc') return q.options.findIndex(o => o.correct);
  if (q.type === 'mmc') return q.options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0);
  if (q.type === 'essay' || q.type === 'short') return '示範作答'.repeat(30);
  const a = q.answer || {};
  if (a.value !== undefined) return String(a.value);
  if (a.text !== undefined) return a.text;
  if (Array.isArray(a.accept) && a.accept.length) return a.accept[0];
  return '';
};

/* ------------------------------------------------------------------ */
/* 本機資料庫                                                          */
/* ------------------------------------------------------------------ */

suite('本機資料庫：查詢介面', () => {

  function client() {
    resetStorage();
    clearLocalStore();
    return makeLocalClient({ students: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], lessons: [] });
  }

  test('select 加 eq 只回符合的列', async () => {
    const c = client();
    const { data } = await c.from('students').select('*').eq('id', 2);
    eq(data.length, 1);
    eq(data[0].name, 'B');
  });

  test('maybeSingle 找不到時回 null 而不是錯誤', async () => {
    const c = client();
    const { data, error } = await c.from('students').select('*').eq('id', 99).maybeSingle();
    eq(data, null);
    eq(error, null);
  });

  test('single 筆數不符時回 PGRST116', async () => {
    const c = client();
    const { error } = await c.from('students').select('*').single();
    eq(error.code, 'PGRST116');
  });

  test('insert 自動補流水號與建立時間', async () => {
    const c = client();
    const { data } = await c.from('lessons')
      .insert({ student_id: 1, lesson_date: '2026-09-20', slot_of_day: 1, plan: {} }).select();
    ok(data[0].id >= 900000, `流水號 ${data[0].id} 應該從九十萬起跳，才不會和家庭帳號的暫存撞號`);
    ok(data[0].created_at);
  });

  test('唯一鍵重複時 insert 回 23505', async () => {
    const c = client();
    const row = { student_id: 1, lesson_date: '2026-09-20', slot_of_day: 1, plan: {} };
    await c.from('lessons').insert(row).select();
    const { error } = await c.from('lessons').insert(row).select();
    eq(error.code, '23505');
  });

  test('upsert 加 ignoreDuplicates 回既有那一列', async () => {
    const c = client();
    const row = { student_id: 1, lesson_date: '2026-09-20', slot_of_day: 1, plan: {}, subject: 'math' };
    const first = await c.from('lessons').upsert(row, { ignoreDuplicates: true }).select();
    const again = await c.from('lessons')
      .upsert({ ...row, subject: 'chinese' }, { ignoreDuplicates: true }).select();
    eq(again.data[0].id, first.data[0].id);
    eq(again.data[0].subject, 'math', 'ignoreDuplicates 不該覆蓋既有資料');
    eq(c.__rows('lessons').length, 1);
  });

  test('upsert 不加 ignoreDuplicates 會覆蓋', async () => {
    const c = client();
    await c.from('subject_state').upsert({ student_id: 1, subject: 'math', difficulty: 'basic' }).select();
    await c.from('subject_state').upsert({ student_id: 1, subject: 'math', difficulty: 'gifted' }).select();
    eq(c.__rows('subject_state').length, 1);
    eq(c.__rows('subject_state')[0].difficulty, 'gifted');
  });

  test('order 與 limit', async () => {
    const c = client();
    for (const d of ['2026-09-01', '2026-09-05', '2026-09-03']) {
      await c.from('lessons').insert({ student_id: 1, lesson_date: d, slot_of_day: 1, plan: {} }).select();
    }
    const { data } = await c.from('lessons').select('*')
      .order('lesson_date', { ascending: false }).limit(2);
    deepEq(data.map(r => r.lesson_date), ['2026-09-05', '2026-09-03']);
  });

  test('is null 與 in', async () => {
    const c = client();
    await c.from('notifications').insert([
      { student_id: 1, kind: 'graded', read_at: null },
      { student_id: 1, kind: 'streak', read_at: '2026-09-01' }
    ]).select();
    const unread = await c.from('notifications').select('*').eq('student_id', 1).is('read_at', null);
    eq(unread.data.length, 1);
    const both = await c.from('notifications').select('*').in('kind', ['graded', 'streak']);
    eq(both.data.length, 2);
  });

  test('update 只改符合條件的列', async () => {
    const c = client();
    await c.from('students').update({ name: 'Z' }).eq('id', 1).select();
    eq(c.__rows('students').find(r => r.id === 1).name, 'Z');
    eq(c.__rows('students').find(r => r.id === 2).name, 'B');
  });

  test('回傳的是複本，改動不會回寫資料庫', async () => {
    const c = client();
    const { data } = await c.from('students').select('*').eq('id', 1).maybeSingle();
    data.name = '被亂改';
    const again = (await c.from('students').select('*').eq('id', 1).maybeSingle()).data;
    eq(again.name, 'A');
  });

  test('重新載入分頁後資料還在', async () => {
    const c = client();
    await c.from('lessons').insert({ student_id: 1, lesson_date: '2026-09-20', slot_of_day: 1, plan: {} }).select();
    c.__flush();

    /* 模擬重新載入：用同一份 sessionStorage 重建一個用戶端，種子應被忽略 */
    const c2 = makeLocalClient({ students: [], lessons: [] });
    eq(c2.__rows('lessons').length, 1, '既有資料不該被種子蓋掉');
    eq(c2.__rows('students').length, 2);
  });

  test('清掉儲存空間後才會重新套用種子', async () => {
    const c = client();
    await c.from('lessons').insert({ student_id: 1, lesson_date: '2026-09-20', slot_of_day: 1, plan: {} }).select();
    c.__flush();
    clearLocalStore();
    const c2 = makeLocalClient({ students: [{ id: 1, name: 'A' }], lessons: [] });
    eq(c2.__rows('lessons').length, 0);
  });

  test('沒有真正的登入也回報已登入', async () => {
    const c = client();
    const { data } = await c.auth.getSession();
    ok(data.session, '訪客模式要讓路由守門通過，否則會被踢回家庭密碼頁');
  });
});

/* ------------------------------------------------------------------ */
/* 模式切換與隔離                                                      */
/* ------------------------------------------------------------------ */

suite('訪客模式：切換與隔離', () => {

  test('進入後 isDemo 為真，離開後為假', () => {
    freshDemo();
    ok(isDemo());
    exitDemo();
    ok(!isDemo());
  });

  test('訪客的學生 id 不在正式檔位 1 到 4 之內', () => {
    freshDemo();
    ok(DEMO_STUDENT_ID > 4, `訪客 id ${DEMO_STUDENT_ID} 不可以佔用正式檔位`);
    eq(currentStudentId(), DEMO_STUDENT_ID);
  });

  test('訪客模式不看也不寫 edu.currentStudent', () => {
    freshDemo();
    localStorage.setItem('edu.currentStudent', '1');
    eq(currentStudentId(), DEMO_STUDENT_ID, '就算本機留著家人的檔位，也不能拿來用');

    exitDemo();
    eq(currentStudentId(), 1, '離開試用後才回頭讀家人的檔位');
  });

  test('沙盒裡只有訪客一個人', async () => {
    freshDemo();
    const list = await students.list();
    eq(list.length, 1);
    eq(list[0].id, DEMO_STUDENT_ID);
    eq(list[0].name, DEMO_NAME);
    eq(list[0].level, DEMO_LEVEL);
    ok(list[0].name_locked, '試用帳號不開放改名');
  });

  test('預設是國二數學進階，且鎖住不自動升降', async () => {
    freshDemo();
    const st = await subjectState.get(DEMO_STUDENT_ID, DEMO_SUBJECT);
    eq(st.difficulty, 'advanced');
    eq(st.locked, true);
  });

  test('系統設定有預設值，不必連後端', async () => {
    freshDemo();
    const cfg = await settings.get();
    eq(cfg.target_minutes, 25);
  });

  test('動線只開放試用首頁、作答、成績與說明', () => {
    for (const r of ['demo', 'lesson', 'result', 'help']) {
      ok(DEMO_ROUTES.has(r), `${r} 應該可以走`);
    }
    for (const r of ['gate', 'students', 'home', 'admin', 'history', 'preview', 'diag']) {
      ok(!DEMO_ROUTES.has(r), `${r} 不該出現在訪客動線裡`);
    }
  });

  test('重新開始會清掉考卷但仍在試用模式', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20' });
    eq((await lessons.history(DEMO_STUDENT_ID)).length, 1);

    resetDemo();
    ok(isDemo());
    eq((await lessons.history(DEMO_STUDENT_ID)).length, 0);
    eq((await students.list()).length, 1, '重新開始後檔位要重新種回來');
  });
});

/* ------------------------------------------------------------------ */
/* 不限次數、每次換一張                                                */
/* ------------------------------------------------------------------ */

suite('訪客模式：不限次數換新卷', () => {

  test('連續開六張都成功，節次自動往後排', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const made = [];
    for (let i = 0; i < 6; i++) {
      made.push(await createPracticeLesson({
        student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20'
      }));
    }
    deepEq(made.map(l => l.slot_of_day), [1, 2, 3, 4, 5, 6], '不受每日堂數限制');
    eq(new Set(made.map(l => l.id)).size, 6, '每張都是新的課堂');
  });

  test('每一張的題目不一樣', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const stems = [];
    for (let i = 0; i < 5; i++) {
      const l = await createPracticeLesson({
        student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20'
      });
      stems.push(l.plan.items.map(q => q.stem).join('|'));
    }
    eq(new Set(stems).size, 5, '五張考卷不該有任何兩張完全相同');
  });

  test('指定同一個種子時題目相同，證明差異來自種子而非隨機副作用', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const a = await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20', seed: 12345 });
    const b = await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20', seed: 12345 });
    deepEq(a.plan.items.map(q => q.stem), b.plan.items.map(q => q.stem));
  });

  test('進階與資優都出得出題，且資優滿分較高', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const adv = await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20', seed: 7 });
    const gif = await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: 'gifted', date: '2026-09-20', seed: 7 });
    ok(adv.plan.items.length > 0);
    ok(gif.plan.items.length > 0);
    eq(adv.plan.difficulty, 'advanced');
    eq(gif.plan.difficulty, 'gifted');
  });

  test('每張考卷的題目都通過結構驗證', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    for (const diff of ['advanced', 'gifted']) {
      for (let i = 0; i < 3; i++) {
        const l = await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: diff, date: '2026-09-20' });
        l.plan.items.forEach((q, n) => {
          const errs = validateQuestion(q, `${diff} 第 ${i + 1} 張第 ${n + 1} 題`);
          eq(errs.length, 0, errs.join('；'));
        });
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 走完一張考卷                                                        */
/* ------------------------------------------------------------------ */

suite('訪客模式：作答到看成績', () => {

  test('全對交卷後立刻是正式成績，不需要老師批改', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const lesson = await createPracticeLesson({
      student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20'
    });

    const answers = {};
    lesson.plan.items.forEach((q, i) => { answers[i + 1] = correctAnswerOf(q); });

    const r = await submitLesson({
      lesson, student, answers, date: '2026-09-20',
      timerSeconds: 900, elapsedSeconds: 900
    });

    eq(r.provisional, false, '數學卷沒有作文，應該馬上出正式成績');
    eq(r.lesson.status, 'graded');
    eq(r.pendingGrading, 0);
    ok(r.scoreEarned > 0);
    ok(await points.total(DEMO_STUDENT_ID) > 0, '積分要能累積，才看得到獎勵機制');
  });

  test('看過解答的題目不計分但仍給解題邏輯', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const lesson = await createPracticeLesson({
      student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20'
    });
    const answers = {};
    lesson.plan.items.forEach((q, i) => { answers[i + 1] = correctAnswerOf(q); });

    await submitLesson({ lesson, student, answers, revealed: [1], date: '2026-09-20' });

    const rows = await attempts.forLesson(lesson.id);
    eq(rows[0].revealed, true);
    eq(rows[0].score, 0);
    ok(rows[0].question.steps || rows[0].question.options, '檢討畫面要有解題依據');
  });

  test('檢討畫面需要的欄位都齊全', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    const lesson = await createPracticeLesson({
      student, subject: DEMO_SUBJECT, difficulty: 'gifted', date: '2026-09-20'
    });
    const answers = {};
    lesson.plan.items.forEach((q, i) => { answers[i + 1] = correctAnswerOf(q); });
    await submitLesson({ lesson, student, answers, date: '2026-09-20' });

    for (const x of await attempts.forLesson(lesson.id)) {
      ok(x.question, '缺少題目快照');
      ok(x.qtype);
      ok(x.topic);
      ok(Number.isFinite(Number(x.max_score)));
    }
  });

  test('做完三張的紀錄都留著，可以逐張回看', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    for (let i = 0; i < 3; i++) {
      const l = await createPracticeLesson({
        student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20'
      });
      const answers = {};
      l.plan.items.forEach((q, n) => { answers[n + 1] = correctAnswerOf(q); });
      await submitLesson({ lesson: l, student, answers, date: '2026-09-20' });
    }
    const hist = await lessons.history(DEMO_STUDENT_ID, { limit: 20 });
    eq(hist.length, 3);
    ok(hist.every(l => l.status === 'graded'));
  });

  test('離開試用會清掉沙盒', async () => {
    freshDemo();
    const student = await students.get(DEMO_STUDENT_ID);
    await createPracticeLesson({ student, subject: DEMO_SUBJECT, difficulty: 'advanced', date: '2026-09-20' });

    exitDemo();
    ok(!isDemo());

    /* 重新進來應該是空的 */
    enterDemo();
    eq((await lessons.history(DEMO_STUDENT_ID)).length, 0);
    exitDemo();
  });
});
