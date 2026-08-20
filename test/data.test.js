/* 任務 3.4 — 資料層測試
 * 以記憶體假用戶端驗證，不連網路。
 */

import {
  suite, test, eq, ok, deepEq, rejects,
  makeFakeSupabase, resetStorage
} from './harness.js';

import { injectClient, students, lessons, attempts, points, badges, mastery, settings, notifications } from '../js/db.js';
import { Cache, Draft, OfflineQueue } from '../js/cache.js';

const SEED = () => ({
  students: [
    { id: 1, name: 'Bruce',  level: 'g8', name_locked: false, settings: {}, active: true },
    { id: 2, name: 'Melody', level: 'g5', name_locked: false, settings: {}, active: true },
    { id: 3, name: '學生三', level: null, name_locked: false, settings: {}, active: true },
    { id: 4, name: '學生四', level: null, name_locked: false, settings: {}, active: true }
  ],
  app_settings: [
    { id: 1, summer_start: '07-01', summer_end: '08-31', lessons_weekday: 1, lessons_summer: 2, target_minutes: 25, rotation: {} }
  ],
  lessons: [], attempts: [], points_ledger: [], badges: [], topic_mastery: [], notifications: []
});

function fresh() {
  const fake = makeFakeSupabase(SEED());
  injectClient(fake);
  return fake;
}

suite('資料層：學生', () => {

  test('列出四個檔位', async () => {
    fresh();
    const list = await students.list();
    eq(list.length, 4);
    eq(list[0].name, 'Bruce');
    eq(list[1].name, 'Melody');
  });

  test('首次改名成功並上鎖', async () => {
    fresh();
    await students.rename(3, '小明');
    const s = await students.get(3);
    eq(s.name, '小明');
    eq(s.name_locked, true);
  });

  test('改名後學生自己不能再改', async () => {
    fresh();
    await students.rename(3, '小明');
    await rejects(students.rename(3, '小華'), '第二次改名應被拒絕');
  });

  test('管理者仍可直接改名', async () => {
    fresh();
    await students.rename(3, '小明');
    await students.update(3, { name: '小華' });
    eq((await students.get(3)).name, '小華');
  });
});

suite('資料層：課堂建立的競態（Property 3）', () => {

  const row = () => ({
    student_id: 1, lesson_date: '2026-08-20', slot_of_day: 1,
    subject: 'math', plan: { items: [] }, status: 'pending', assigned_by: 'auto'
  });

  test('第一次建立成功', async () => {
    const fake = fresh();
    const l = await lessons.createIfAbsent(row());
    ok(l && l.id, '應回傳課堂');
    eq(fake.__rows('lessons').length, 1);
  });

  test('重複建立不會產生第二筆', async () => {
    const fake = fresh();
    const a = await lessons.createIfAbsent(row());
    const b = await lessons.createIfAbsent(row());
    eq(fake.__rows('lessons').length, 1, '同日同節次只能有一堂');
    eq(a.id, b.id, '第二次應回傳同一堂');
  });

  test('模擬兩台裝置同時建立', async () => {
    const fake = fresh();
    const [a, b] = await Promise.all([
      lessons.createIfAbsent(row()),
      lessons.createIfAbsent(row())
    ]);
    eq(fake.__rows('lessons').length, 1);
    eq(a.id, b.id);
  });

  test('不同節次可以各有一堂', async () => {
    const fake = fresh();
    await lessons.createIfAbsent(row());
    await lessons.createIfAbsent({ ...row(), slot_of_day: 2 });
    eq(fake.__rows('lessons').length, 2, '暑假一天兩堂');
  });

  test('不同日期互不干擾', async () => {
    const fake = fresh();
    await lessons.createIfAbsent(row());
    await lessons.createIfAbsent({ ...row(), lesson_date: '2026-08-21' });
    eq(fake.__rows('lessons').length, 2);
  });

  test('不同學生互不干擾', async () => {
    const fake = fresh();
    await lessons.createIfAbsent(row());
    await lessons.createIfAbsent({ ...row(), student_id: 2 });
    eq(fake.__rows('lessons').length, 2);
  });
});

suite('資料層：積分只增不減（Property 1）', () => {

  test('總額為流水加總', async () => {
    fresh();
    await points.add({ student_id: 1, kind: 'question', points: 12 });
    await points.add({ student_id: 1, kind: 'question', points: 8 });
    await points.add({ student_id: 1, kind: 'streak_bonus', points: 1 });
    eq(await points.total(1), 21);
  });

  test('不同學生的積分互不混淆', async () => {
    fresh();
    await points.add({ student_id: 1, kind: 'question', points: 10 });
    await points.add({ student_id: 2, kind: 'question', points: 99 });
    eq(await points.total(1), 10);
    eq(await points.total(2), 99);
  });

  test('連續新增後總額單調遞增', async () => {
    fresh();
    let prev = 0;
    for (const p of [5, 3, 8, 1, 20]) {
      await points.add({ student_id: 1, kind: 'question', points: p });
      const now = await points.total(1);
      ok(now >= prev, `總額不得下降：${prev} → ${now}`);
      prev = now;
    }
  });

  test('沒有紀錄時為零', async () => {
    fresh();
    eq(await points.total(1), 0);
  });
});

suite('資料層：勳章不重複授予', () => {

  test('同一勳章同一等級只有一筆', async () => {
    const fake = fresh();
    await badges.grant(1, 'points', 1);
    await badges.grant(1, 'points', 1);
    eq(fake.__rows('badges').length, 1);
  });

  test('不同等級各自一筆', async () => {
    const fake = fresh();
    await badges.grant(1, 'points', 1);
    await badges.grant(1, 'points', 2);
    eq(fake.__rows('badges').length, 2);
  });
});

suite('資料層：複習到期查詢', () => {

  test('只取到期且未精熟的', async () => {
    fresh();
    await mastery.upsert({ student_id: 1, topic: 'a', subject: 'math', box: 0, due_on: '2026-08-19', mastered: false, streak: 0, wrong_count: 1 });
    await mastery.upsert({ student_id: 1, topic: 'b', subject: 'math', box: 1, due_on: '2026-08-25', mastered: false, streak: 1, wrong_count: 1 });
    await mastery.upsert({ student_id: 1, topic: 'c', subject: 'math', box: 3, due_on: '2026-08-01', mastered: true,  streak: 3, wrong_count: 2 });

    const due = await mastery.due(1, '2026-08-20');
    eq(due.length, 1, '只有 a 到期');
    eq(due[0].topic, 'a');
  });

  test('精熟的知識點永不出現在到期清單（Property 12）', async () => {
    fresh();
    await mastery.upsert({ student_id: 1, topic: 'x', subject: 'math', box: 3, due_on: '2020-01-01', mastered: true, streak: 3, wrong_count: 5 });
    const due = await mastery.due(1, '2030-01-01');
    eq(due.length, 0);
  });

  test('upsert 覆蓋同一知識點而非新增', async () => {
    const fake = fresh();
    await mastery.upsert({ student_id: 1, topic: 'a', subject: 'math', box: 0, due_on: '2026-08-23', mastered: false, streak: 0, wrong_count: 1 });
    await mastery.upsert({ student_id: 1, topic: 'a', subject: 'math', box: 1, due_on: '2026-08-27', mastered: false, streak: 1, wrong_count: 1 });
    eq(fake.__rows('topic_mastery').length, 1);
    eq(fake.__rows('topic_mastery')[0].box, 1);
  });
});

suite('資料層：作答與待批改', () => {

  test('批量建立與依序讀回', async () => {
    fresh();
    const lesson = await lessons.createIfAbsent({
      student_id: 1, lesson_date: '2026-08-20', slot_of_day: 1,
      subject: 'math', plan: {}, status: 'pending', assigned_by: 'auto'
    });
    await attempts.bulkCreate([
      { lesson_id: lesson.id, student_id: 1, seq: 2, question: { id: 'q2' }, subject: 'math', topic: 't', qtype: 'mc', difficulty: 'basic', max_score: 2 },
      { lesson_id: lesson.id, student_id: 1, seq: 1, question: { id: 'q1' }, subject: 'math', topic: 't', qtype: 'mc', difficulty: 'basic', max_score: 2 }
    ]);
    const rows = await attempts.forLesson(lesson.id);
    eq(rows.length, 2);
    deepEq(rows.map(r => r.seq), [1, 2], '應依題號排序');
  });

  test('待批改佇列只含需要批改的', async () => {
    fresh();
    const lesson = await lessons.createIfAbsent({
      student_id: 1, lesson_date: '2026-08-20', slot_of_day: 1,
      subject: 'chinese', plan: {}, status: 'pending', assigned_by: 'auto'
    });
    await attempts.bulkCreate([
      { lesson_id: lesson.id, student_id: 1, seq: 1, question: {}, subject: 'chinese', topic: 't', qtype: 'mc',    difficulty: 'basic', max_score: 2, needs_grading: false },
      { lesson_id: lesson.id, student_id: 1, seq: 2, question: {}, subject: 'chinese', topic: 't', qtype: 'essay', difficulty: 'basic', max_score: 30, needs_grading: true }
    ]);
    const pend = await attempts.needingGrading();
    eq(pend.length, 1);
    eq(pend[0].qtype, 'essay');
  });
});

suite('資料層：錯誤訊息轉為中文', () => {

  test('權限不足的訊息可讀', async () => {
    injectClient({
      from: () => ({
        select() { return this; }, eq() { return this; }, order() { return this; },
        then(res) { return Promise.resolve({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }).then(res); }
      })
    });
    try {
      await students.list();
      ok(false, '應該丟出例外');
    } catch (err) {
      ok(err.message.includes('沒有存取權限'), err.message);
    }
  });

  test('連線失敗會提示專案可能被暫停', async () => {
    injectClient({
      from: () => ({
        select() { return this; }, eq() { return this; }, order() { return this; },
        then(res) { return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }).then(res); }
      })
    });
    try {
      await students.list();
      ok(false, '應該丟出例外');
    } catch (err) {
      ok(err.message.includes('Restore'), err.message);
    }
  });
});

suite('本機快取', () => {

  test('寫入後讀回', () => {
    resetStorage();
    Cache.set('bank.math', { items: [1, 2, 3] });
    deepEq(Cache.get('bank.math'), { items: [1, 2, 3] });
  });

  test('不存在回傳 null', () => {
    resetStorage();
    eq(Cache.get('nope'), null);
  });

  test('過期後讀不到，但 getStale 仍可取得', () => {
    resetStorage();
    Cache.set('k', 'v', -1);            // 立刻過期
    eq(Cache.get('k'), null);
    eq(Cache.getStale('k'), 'v', '斷線時寧可用舊資料');
  });

  test('wrap 命中快取就不呼叫載入函式', async () => {
    resetStorage();
    let calls = 0;
    const loader = async () => { calls++; return 'fresh'; };
    eq(await Cache.wrap('w', loader), 'fresh');
    eq(await Cache.wrap('w', loader), 'fresh');
    eq(calls, 1, '第二次應直接用快取');
  });

  test('wrap 載入失敗時退回舊快取', async () => {
    resetStorage();
    Cache.set('w2', 'old', -1);         // 已過期
    const loader = async () => { throw new Error('離線'); };
    eq(await Cache.wrap('w2', loader), 'old');
  });

  test('wrap 沒有舊快取時把錯誤丟出來', async () => {
    resetStorage();
    await rejects(Cache.wrap('w3', async () => { throw new Error('離線'); }));
  });
});

suite('作答暫存', () => {

  test('存取與清除', () => {
    resetStorage();
    Draft.save(101, { answers: { 1: 'A' }, timer: 42 });
    const d = Draft.load(101);
    eq(d.timer, 42);
    eq(d.answers['1'], 'A');
    Draft.clear(101);
    eq(Draft.load(101), null);
  });

  test('列出未完成的暫存', () => {
    resetStorage();
    Draft.save(1, { answers: {} });
    Draft.save(2, { answers: {} });
    eq(Draft.list().length, 2);
  });
});

suite('離線佇列', () => {

  test('入列與計數', () => {
    resetStorage();
    OfflineQueue.push('submitLesson', { id: 1 });
    OfflineQueue.push('submitLesson', { id: 2 });
    eq(OfflineQueue.size(), 2);
  });

  test('全部成功後清空', async () => {
    resetStorage();
    const seen = [];
    OfflineQueue.push('op', { n: 1 });
    OfflineQueue.push('op', { n: 2 });
    const r = await OfflineQueue.flush({ op: async p => seen.push(p.n) });
    eq(r.sent, 2);
    eq(r.left, 0);
    eq(OfflineQueue.size(), 0);
    deepEq(seen, [1, 2], '必須依原順序補送');
  });

  test('中途失敗時保留剩下的並維持順序', async () => {
    resetStorage();
    OfflineQueue.push('op', { n: 1 });
    OfflineQueue.push('op', { n: 2 });
    OfflineQueue.push('op', { n: 3 });
    const r = await OfflineQueue.flush({
      op: async p => { if (p.n === 2) throw new Error('還是連不上'); }
    });
    eq(r.sent, 1);
    eq(r.left, 2);
    eq(OfflineQueue.size(), 2);
    eq(OfflineQueue.list()[0].payload.n, 2, '失敗的那筆仍排在最前面');
  });

  test('重試後可補完', async () => {
    resetStorage();
    OfflineQueue.push('op', { n: 1 });
    OfflineQueue.push('op', { n: 2 });
    let fail = true;
    const handlers = { op: async p => { if (fail && p.n === 2) throw new Error('x'); } };
    await OfflineQueue.flush(handlers);
    eq(OfflineQueue.size(), 1);
    fail = false;
    const r2 = await OfflineQueue.flush(handlers);
    eq(r2.sent, 1);
    eq(OfflineQueue.size(), 0);
  });

  test('未知操作直接丟棄，不卡住佇列', async () => {
    resetStorage();
    OfflineQueue.push('unknownOp', {});
    OfflineQueue.push('op', { n: 1 });
    let done = 0;
    const r = await OfflineQueue.flush({ op: async () => { done++; } });
    eq(done, 1);
    eq(r.left, 0);
  });
});

suite('系統設定', () => {

  test('讀取預設值', async () => {
    fresh();
    const s = await settings.get();
    eq(s.summer_start, '07-01');
    eq(s.lessons_summer, 2);
    eq(s.target_minutes, 25);
  });

  test('更新後讀回', async () => {
    fresh();
    await settings.update({ target_minutes: 30 });
    eq((await settings.get()).target_minutes, 30);
  });
});

suite('通知', () => {

  test('新增與讀取未讀', async () => {
    fresh();
    await notifications.add(1, 'graded', { lessonId: 5 });
    const un = await notifications.unread(1);
    eq(un.length, 1);
    eq(un[0].kind, 'graded');
  });

  test('標記已讀後不再出現', async () => {
    fresh();
    await notifications.add(1, 'badge', {});
    const un = await notifications.unread(1);
    await notifications.markRead(un.map(n => n.id));
    eq((await notifications.unread(1)).length, 0);
  });
});
