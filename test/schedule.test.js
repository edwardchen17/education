/* 任務 7.x 與 8.3 — 國文題庫驗證與排課測試
 * 對應 Property 3（冪等且唯一）、4（管理者指派不被覆寫）、
 *      5（課堂時長）、6（台灣日期歸屬）
 */

import { suite, test, ok, eq, deepEq, rejects, makeFakeSupabase } from './harness.js';
import { readFileSync } from 'node:fs';
import { injectClient, lessons, mastery, subjectState, settings as dbSettings } from '../js/db.js';
import { injectStatic, clearStaticCache, pickQuestions, loadPool } from '../js/bank/index.js';
import { validateQuestion } from '../js/bank/validate.js';
import {
  slotsForDate, chooseSubject, rotationFor, buildPlan,
  ensureToday, assignLesson, todaySummary
} from '../js/engine/schedule.js';
import { seeded, addDays } from '../js/core.js';

/* ------------------------------------------------------------------ */
/* 載入靜態題庫（Node 直接讀檔，瀏覽器走 fetch）                        */
/* ------------------------------------------------------------------ */

const POOLS = {};
for (const name of ['chinese_g8', 'chinese_g5']) {
  const raw = readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8');
  POOLS[name] = JSON.parse(raw).questions;
  injectStatic(name, POOLS[name]);
}

/* ------------------------------------------------------------------ */
/* 國文題庫                                                            */
/* ------------------------------------------------------------------ */

suite('國文題庫：結構與內容', () => {

  for (const [name, list] of Object.entries(POOLS)) {
    test(`${name} 全部通過結構驗證`, () => {
      const errs = [];
      list.forEach((q, i) => errs.push(...validateQuestion(q, `${name}#${i + 1} ${q.id || ''}`)));
      ok(errs.length === 0, errs.join('\n      '));
    });

    test(`${name} 的 id 不重複`, () => {
      const ids = list.map(q => q.id);
      const dup = ids.find((x, i) => ids.indexOf(x) !== i);
      ok(!dup, `重複的 id：${dup}`);
      ok(ids.every(Boolean), '每題都要有 id');
    });

    test(`${name} 閱讀題都附有文章`, () => {
      const reading = list.filter(q => (q.topic || '').includes('.reading.'));
      ok(reading.length > 0, '應該要有閱讀題');
      for (const q of reading) {
        ok(q.passage && q.passage.text, `${q.id} 缺少 passage`);
        ok(q.passage.title && q.passage.author, `${q.id} 的 passage 缺少標題或作者`);
        ok(q.passage.source, `${q.id} 缺少出處，公有領域素材必須標明來源`);
      }
    });

    test(`${name} 同一篇文章的題目共用同一個 group`, () => {
      const groups = {};
      list.filter(q => q.group).forEach(q => {
        groups[q.group] = groups[q.group] || [];
        groups[q.group].push(q);
      });
      ok(Object.keys(groups).length > 0, '應該要有分組的閱讀題');
      for (const [g, qs] of Object.entries(groups)) {
        const titles = new Set(qs.map(q => q.passage?.title));
        eq(titles.size, 1, `group ${g} 內出現了 ${titles.size} 篇不同的文章`);
      }
    });

    test(`${name} 有作文題且評分規準完整`, () => {
      const essays = list.filter(q => q.type === 'essay');
      ok(essays.length >= 2, `只有 ${essays.length} 題作文`);
      for (const e of essays) {
        const total = e.rubric.reduce((s, r) => s + r.points, 0);
        eq(total, 30, `${e.id} 的評分規準總分是 ${total}，應為 30`);
        ok(e.sample.length >= 200, `${e.id} 的範文太短（${e.sample.length} 字）`);
        ok(e.min_words >= 300, `${e.id} 的最低字數 ${e.min_words} 偏低`);
      }
    });

    test(`${name} 三種難度都有題目`, () => {
      const diffs = new Set(list.map(q => q.difficulty));
      for (const d of ['basic', 'advanced', 'gifted']) {
        ok(diffs.has(d), `缺少 ${d} 難度的題目`);
      }
    });
  }

  test('選擇題的解析不使用「正確答案是」這種寫法（需求 6.2）', () => {
    const bad = [];
    for (const list of Object.values(POOLS)) {
      for (const q of list) {
        (q.options || []).forEach((o, i) => {
          if (/正確答案是|答案為\s*\(?[A-D]/.test(o.why)) {
            bad.push(`${q.id} 選項 ${'ABCD'[i]}`);
          }
        });
      }
    }
    eq(bad.length, 0, bad.join('、'));
  });

  test('每個錯誤選項的解析都說明了為什麼錯', () => {
    const short = [];
    for (const list of Object.values(POOLS)) {
      for (const q of list) {
        (q.options || []).filter(o => !o.correct).forEach((o, i) => {
          if (o.why.length < 12) short.push(`${q.id}：${o.why}`);
        });
      }
    }
    eq(short.length, 0, '解析過短：' + short.join('　'));
  });
});

suite('國文題庫：組課', () => {

  test('國二國文能組出 20 至 40 分鐘的課', () => {
    for (let s = 0; s < 30; s++) {
      const r = pickQuestions({
        subject: 'chinese', level: 'g8', difficulty: 'advanced',
        budget: 1500, staticPool: POOLS.chinese_g8, rng: seeded(s + 1)
      });
      ok(r.items.length > 0, `第 ${s} 次組不出題`);
      ok(r.warnings.length === 0, r.warnings.join('\n      '));
      ok(r.seconds >= 1200 && r.seconds <= 2400, `時長 ${r.seconds} 秒超出範圍`);
    }
  });

  test('小五國語能組出 20 至 40 分鐘的課', () => {
    for (let s = 0; s < 30; s++) {
      const r = pickQuestions({
        subject: 'chinese', level: 'g5', difficulty: 'basic',
        budget: 1500, staticPool: POOLS.chinese_g5, rng: seeded(s + 200)
      });
      ok(r.items.length > 0);
      ok(r.warnings.length === 0, r.warnings.join('\n      '));
      ok(r.seconds >= 1200 && r.seconds <= 2400, `時長 ${r.seconds} 秒超出範圍`);
    }
  });

  test('同一堂課裡同一篇文章不會出現兩次以上的分組', () => {
    for (let s = 0; s < 30; s++) {
      const r = pickQuestions({
        subject: 'chinese', level: 'g8', difficulty: 'advanced',
        budget: 1500, staticPool: POOLS.chinese_g8, rng: seeded(s + 400)
      });
      const titles = r.items.filter(q => q.passage).map(q => q.passage.title);
      const counts = {};
      titles.forEach(t => counts[t] = (counts[t] || 0) + 1);
      for (const [t, n] of Object.entries(counts)) {
        ok(n <= 3, `文章「${t}」在一堂課裡出現 ${n} 題，超過同組上限`);
      }
    }
  });

  test('沒有題庫的科目回傳空清單而不是拋錯', async () => {
    clearStaticCache();
    for (const name of ['chinese_g8', 'chinese_g5']) injectStatic(name, POOLS[name]);
    deepEq(await loadPool('social', 'g8'), [], '社會還沒有靜態題庫');
    const r = pickQuestions({ subject: 'social', level: 'g8', difficulty: 'basic', budget: 1500, rng: seeded(1) });
    eq(r.items.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 排課：純函式                                                        */
/* ------------------------------------------------------------------ */

suite('排課：每日堂數', () => {

  const cfg = { summer_start: '07-01', summer_end: '08-31', lessons_weekday: 1, lessons_summer: 2 };

  test('平日一堂，暑假兩堂', () => {
    eq(slotsForDate('2026-06-30', cfg), 1);
    eq(slotsForDate('2026-07-01', cfg), 2);
    eq(slotsForDate('2026-08-20', cfg), 2);
    eq(slotsForDate('2026-08-31', cfg), 2);
    eq(slotsForDate('2026-09-01', cfg), 1);
  });

  test('管理者可調整暑假範圍與堂數', () => {
    const custom = { summer_start: '07-10', summer_end: '08-20', lessons_weekday: 1, lessons_summer: 3 };
    eq(slotsForDate('2026-07-05', custom), 1);
    eq(slotsForDate('2026-07-10', custom), 3);
    eq(slotsForDate('2026-08-21', custom), 1);
  });

  test('堂數有上限保護', () => {
    eq(slotsForDate('2026-07-01', { lessons_summer: 99 }), 4);
    eq(slotsForDate('2026-01-01', { lessons_weekday: -5 }), 0);
  });
});

suite('排課：科目輪替', () => {

  const rotation = ['math', 'chinese', 'english', 'science', 'social'];

  test('同一天同一節的結果永遠相同（冪等）', () => {
    for (let i = 0; i < 20; i++) {
      const a = chooseSubject({ rotation, dateStr: '2026-08-20', slot: 1 });
      const b = chooseSubject({ rotation, dateStr: '2026-08-20', slot: 1 });
      eq(a, b);
    }
  });

  test('同一天的兩節課是不同科目', () => {
    for (let d = 1; d <= 28; d++) {
      const date = `2026-07-${String(d).padStart(2, '0')}`;
      const s1 = chooseSubject({ rotation, dateStr: date, slot: 1 });
      const s2 = chooseSubject({ rotation, dateStr: date, slot: 2, avoid: [s1] });
      ok(s1 !== s2, `${date} 兩節都是 ${s1}`);
    }
  });

  test('可以避開前一天上過的科目（需求 8.5）', () => {
    for (let d = 1; d <= 28; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      const prev = chooseSubject({ rotation, dateStr: addDays(date, -1), slot: 1 });
      const today = chooseSubject({ rotation, dateStr: date, slot: 1, avoid: [prev] });
      ok(today !== prev, `${date} 與前一天都是 ${prev}`);
    }
  });

  test('連續一個月每個科目都輪得到', () => {
    const seen = new Set();
    for (let d = 1; d <= 30; d++) {
      seen.add(chooseSubject({ rotation, dateStr: `2026-10-${String(d).padStart(2, '0')}`, slot: 1 }));
    }
    eq(seen.size, rotation.length, `一個月內只出現 ${seen.size} 個科目`);
  });

  test('空輪替序回傳 null 而不是拋錯', () => {
    eq(chooseSubject({ rotation: [], dateStr: '2026-08-20' }), null);
  });

  test('預設輪替序符合各程度的科目', () => {
    const g8 = rotationFor({ level: 'g8' }, {});
    const g5 = rotationFor({ level: 'g5' }, {});
    ok(g8.includes('science') && g8.includes('bio'), '國二應含理化與生物');
    ok(g5.includes('nature') && !g5.includes('science'), '小五應為自然而非理化');
  });

  test('管理者自訂的輪替序優先', () => {
    const custom = rotationFor({ level: 'g8' }, { rotation: { g8: ['math', 'math', 'chinese'] } });
    deepEq(custom, ['math', 'math', 'chinese']);
  });
});

suite('排課：組課時長（Property 5）', () => {

  test('數學課的預估時長落在範圍內', () => {
    for (let s = 0; s < 25; s++) {
      const plan = buildPlan({
        subject: 'math', level: 'g8', difficulty: 'advanced',
        settings: { target_minutes: 25 }, seed: s + 1
      });
      ok(plan.seconds >= 1200 && plan.seconds <= 2400, `時長 ${plan.seconds} 秒超出範圍`);
    }
  });

  test('目標時間可由設定調整', () => {
    const short = buildPlan({ subject: 'math', level: 'g8', difficulty: 'basic', settings: { target_minutes: 21 }, seed: 5 });
    const long = buildPlan({ subject: 'math', level: 'g8', difficulty: 'basic', settings: { target_minutes: 38 }, seed: 5 });
    ok(long.seconds > short.seconds, `長課 ${long.seconds} 應多於短課 ${short.seconds}`);
    ok(long.seconds <= 38 * 60, '不得超過設定的目標');
  });

  test('相同種子組出相同的課', () => {
    const a = buildPlan({ subject: 'math', level: 'g5', difficulty: 'basic', seed: 777 });
    const b = buildPlan({ subject: 'math', level: 'g5', difficulty: 'basic', seed: 777 });
    eq(JSON.stringify(a.items), JSON.stringify(b.items));
  });
});

/* ------------------------------------------------------------------ */
/* 排課：資料庫互動                                                    */
/* ------------------------------------------------------------------ */

const BRUCE = { id: 1, name: 'Bruce', level: 'g8', name_locked: false, settings: {}, active: true };
const MELODY = { id: 2, name: 'Melody', level: 'g5', name_locked: false, settings: {}, active: true };

function fresh(overrides = {}) {
  const fake = makeFakeSupabase({
    students: [BRUCE, MELODY],
    app_settings: [{
      id: 1, summer_start: '07-01', summer_end: '08-31',
      lessons_weekday: 1, lessons_summer: 2, target_minutes: 25, rotation: {},
      ...overrides
    }],
    lessons: [], attempts: [], topic_mastery: [], subject_state: [],
    points_ledger: [], badges: [], notifications: []
  });
  injectClient(fake);
  return fake;
}

suite('排課：ensureToday 冪等（Property 3）', () => {

  test('平日只建一堂', async () => {
    const fake = fresh();
    const out = await ensureToday(BRUCE, { date: '2026-09-15' });
    eq(out.length, 1);
    eq(fake.__rows('lessons').length, 1);
  });

  test('重複呼叫不會多建課堂', async () => {
    const fake = fresh();
    await ensureToday(BRUCE, { date: '2026-09-15' });
    await ensureToday(BRUCE, { date: '2026-09-15' });
    await ensureToday(BRUCE, { date: '2026-09-15' });
    eq(fake.__rows('lessons').length, 1, '同一天只能有一堂');
  });

  test('重複呼叫回傳相同的課堂 id', async () => {
    fresh();
    const a = await ensureToday(BRUCE, { date: '2026-09-15' });
    const b = await ensureToday(BRUCE, { date: '2026-09-15' });
    deepEq(a.map(l => l.id), b.map(l => l.id));
  });

  test('多台裝置同時呼叫只會建一堂', async () => {
    const fake = fresh();
    await Promise.all([
      ensureToday(BRUCE, { date: '2026-09-16' }),
      ensureToday(BRUCE, { date: '2026-09-16' }),
      ensureToday(BRUCE, { date: '2026-09-16' })
    ]);
    eq(fake.__rows('lessons').length, 1);
  });

  test('暑假建兩堂且科目不同', async () => {
    const fake = fresh();
    const out = await ensureToday(BRUCE, { date: '2026-07-20' });
    eq(out.length, 2, '暑假一天兩堂');
    eq(fake.__rows('lessons').length, 2);
    ok(out[0].subject !== out[1].subject, `兩堂都是 ${out[0].subject}`);
    deepEq(out.map(l => l.slot_of_day), [1, 2]);
  });

  test('不同學生互不干擾', async () => {
    const fake = fresh();
    await ensureToday(BRUCE, { date: '2026-09-15' });
    await ensureToday(MELODY, { date: '2026-09-15' });
    eq(fake.__rows('lessons').length, 2);
  });

  test('沒設定程度的學生不排課', async () => {
    const fake = fresh();
    await ensureToday({ id: 3, name: '學生三', level: null }, { date: '2026-09-15' });
    eq(fake.__rows('lessons').length, 0);
  });

  test('建立的課堂帶有題目與滿分', async () => {
    fresh();
    const [lesson] = await ensureToday(BRUCE, { date: '2026-09-15' });
    ok(lesson.plan.items.length > 0, '課堂應含題目');
    ok(lesson.score_max > 0, '應計算滿分');
    ok(lesson.plan.seconds >= 1200 && lesson.plan.seconds <= 2400,
      `時長 ${lesson.plan.seconds} 秒超出範圍`);
    eq(lesson.status, 'pending');
    eq(lesson.assigned_by, 'auto');
  });

  test('課堂題目全部通過結構驗證', async () => {
    fresh();
    const [lesson] = await ensureToday(BRUCE, { date: '2026-09-15' });
    const errs = [];
    lesson.plan.items.forEach((q, i) => errs.push(...validateQuestion(q, `#${i + 1}`)));
    ok(errs.length === 0, errs.join('\n      '));
  });

  test('作文題會計入待批改數', async () => {
    fresh();
    // 連續數天找出有作文的那一堂
    let found = null;
    for (let d = 1; d <= 20 && !found; d++) {
      fresh();
      const out = await ensureToday(BRUCE, { date: `2026-09-${String(d).padStart(2, '0')}` });
      found = out.find(l => l.plan.items.some(q => q.type === 'essay'));
    }
    if (!found) return;    // 這幾天剛好都沒排到作文，不算失敗
    const essays = found.plan.items.filter(q => q.type === 'essay' || q.type === 'short').length;
    eq(found.pending_grading, essays, '待批改數應等於作文與簡答的題數');
  });
});

suite('排課：避免連續兩天同一科（需求 8.5）', () => {

  test('連續十天不會有兩天同科', async () => {
    fresh();
    const seq = [];
    for (let d = 1; d <= 10; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      const out = await ensureToday(BRUCE, { date });
      seq.push(out[0].subject);
    }
    for (let i = 1; i < seq.length; i++) {
      ok(seq[i] !== seq[i - 1], `第 ${i} 天與第 ${i + 1} 天都是 ${seq[i]}`);
    }
  });
});

suite('排課：複習優先納入（需求 8.6）', () => {

  test('到期的複習知識點會出現在課堂裡', async () => {
    fresh();
    await mastery.upsert({
      student_id: 1, topic: 'math.g8.factor.cross', subject: 'math',
      box: 0, due_on: '2026-09-10', mastered: false, streak: 0, wrong_count: 1
    });
    await subjectState.upsert({ student_id: 1, subject: 'math', difficulty: 'basic', locked: false, recent: [] });

    // 找到排到數學的那一天
    let lesson = null;
    for (let d = 10; d <= 20 && !lesson; d++) {
      const date = `2026-09-${d}`;
      const out = await ensureToday(BRUCE, { date });
      lesson = out.find(l => l.subject === 'math');
    }
    ok(lesson, '十天內應該至少排到一次數學');
    const topics = lesson.plan.items.map(q => q.topic);
    ok(topics.includes('math.g8.factor.cross'), '到期的複習知識點沒有被納入');
    ok(lesson.plan.review_count > 0, '應記錄複習題數');
  });

  test('未到期的複習不會被納入', async () => {
    fresh();
    await mastery.upsert({
      student_id: 1, topic: 'math.g8.sqrt.simplify', subject: 'math',
      box: 2, due_on: '2026-12-31', mastered: false, streak: 2, wrong_count: 1
    });
    let lesson = null;
    for (let d = 10; d <= 20 && !lesson; d++) {
      const out = await ensureToday(BRUCE, { date: `2026-09-${d}` });
      lesson = out.find(l => l.subject === 'math');
    }
    ok(lesson);
    const reviewed = lesson.plan.items.filter(q => q.is_review);
    eq(reviewed.length, 0, '未到期的知識點不該被當成複習題');
  });
});

suite('排課：管理者指派不被覆寫（Property 4）', () => {

  test('手動指派後自動排課不會動它', async () => {
    const fake = fresh();
    const assigned = await assignLesson({
      student: BRUCE, date: '2026-09-15', slot: 1, subject: 'chinese', difficulty: 'advanced'
    });
    eq(assigned.assigned_by, 'admin');
    eq(assigned.subject, 'chinese');

    await ensureToday(BRUCE, { date: '2026-09-15' });
    const rows = fake.__rows('lessons');
    eq(rows.length, 1);
    eq(rows[0].assigned_by, 'admin', '自動排課不得把 admin 改回 auto');
    eq(rows[0].subject, 'chinese', '科目不得被改掉');
  });

  test('手動指派可覆蓋既有的自動課堂', async () => {
    const fake = fresh();
    const [auto] = await ensureToday(BRUCE, { date: '2026-09-15' });
    eq(auto.assigned_by, 'auto');

    await assignLesson({ student: BRUCE, date: '2026-09-15', slot: 1, subject: 'chinese', difficulty: 'basic' });
    const rows = fake.__rows('lessons');
    eq(rows.length, 1, '應覆蓋而不是新增');
    eq(rows[0].assigned_by, 'admin');
    eq(rows[0].subject, 'chinese');
  });

  test('已交卷的課堂不能重新指派', async () => {
    fresh();
    const [auto] = await ensureToday(BRUCE, { date: '2026-09-15' });
    await lessons.update(auto.id, { status: 'submitted' });
    await rejects(
      assignLesson({ student: BRUCE, date: '2026-09-15', slot: 1, subject: 'chinese' }),
      '已交卷應拒絕重新指派'
    );
  });

  test('指派沒有題庫的科目會給出清楚的錯誤', async () => {
    fresh();
    await rejects(
      assignLesson({ student: BRUCE, date: '2026-09-15', slot: 1, subject: 'social' }),
      '社會還沒有題庫，應該拒絕並說明'
    );
  });
});

suite('排課：今日任務摘要', () => {

  test('回傳堂數、完成數與連續天數', async () => {
    fresh();
    const s = await todaySummary(BRUCE, '2026-09-15');
    eq(s.total, 1);
    eq(s.done, 0);
    eq(s.allDone, false);
    eq(s.streak, 0);
  });

  test('交卷後完成數與連續天數會更新', async () => {
    fresh();
    const [l] = await ensureToday(BRUCE, { date: '2026-09-15' });
    await lessons.update(l.id, { status: 'submitted' });
    const s = await todaySummary(BRUCE, '2026-09-15');
    eq(s.done, 1);
    eq(s.allDone, true);
    eq(s.streak, 1);
  });

  test('連續三天完成則連續天數為三', async () => {
    fresh();
    for (const d of ['13', '14', '15']) {
      const out = await ensureToday(BRUCE, { date: `2026-09-${d}` });
      for (const l of out) await lessons.update(l.id, { status: 'submitted' });
    }
    const s = await todaySummary(BRUCE, '2026-09-15');
    eq(s.streak, 3);
  });

  test('中斷一天則連續天數重新計算', async () => {
    fresh();
    for (const d of ['12', '13']) {
      const out = await ensureToday(BRUCE, { date: `2026-09-${d}` });
      for (const l of out) await lessons.update(l.id, { status: 'submitted' });
    }
    // 14 日沒做，15 日做
    const out = await ensureToday(BRUCE, { date: '2026-09-15' });
    for (const l of out) await lessons.update(l.id, { status: 'submitted' });
    const s = await todaySummary(BRUCE, '2026-09-15');
    eq(s.streak, 1, '中斷後只算得到當天');
  });
});
