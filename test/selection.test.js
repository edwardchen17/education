/* 選項記錄的端到端測試
 *
 * 起因：使用者反映「作答時選了 A，交卷後系統顯示我選的是 C」。
 * 這一支測試把整條路徑釘死：
 *   點選 → S.answers → Draft 存檔 → 還原 → gradeLesson → 資料庫 raw → 檢討畫面索引
 * 任何一個環節錯位都會被抓到。
 */

import { suite, test, ok, eq, deepEq, makeFakeSupabase } from './harness.js';
import { injectClient, attempts, lessons } from '../js/db.js';
import { Draft } from '../js/cache.js';
import { gradeLesson, submitLesson } from '../js/engine/grade.js';
import { check, correctIndices } from '../js/engine/answer.js';
import { generateOne, allGenerators } from '../js/bank/index.js';
import { maxScore } from '../js/config/scoring.js';

/* 造一道正解不在第一個位置的題目，才驗得出索引錯位 */
const q4 = (correctAt = 2) => ({
  type: 'mc', stem: '題幹',
  options: [0, 1, 2, 3].map(i => ({
    text: `選項${'ABCD'[i]}`, correct: i === correctAt, why: `說明${'ABCD'[i]}`
  })),
  topic: 'math.g8.factor.cross', subject: 'math',
  difficulty: 'basic', est_seconds: 60, base_points: 2
});

const mkLesson = items => ({
  id: 900, student_id: 1, lesson_date: '2026-09-15', slot_of_day: 1,
  subject: 'math', status: 'active', assigned_by: 'auto',
  plan: { items, seconds: items.reduce((s, x) => s + x.est_seconds, 0), difficulty: 'basic' },
  score_max: items.reduce((s, x) => s + maxScore(x.type, x.difficulty), 0),
  pending_grading: 0
});

const STUDENT = { id: 1, name: 'Bruce', level: 'g8' };

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

/* ------------------------------------------------------------------ */

suite('選項索引：批改階段', () => {

  test('選到正解的索引就判對，其餘判錯', () => {
    for (let correctAt = 0; correctAt < 4; correctAt++) {
      const lesson = mkLesson([q4(correctAt)]);
      for (let picked = 0; picked < 4; picked++) {
        const g = gradeLesson(lesson, { answers: { 1: picked } });
        eq(g.rows[0].is_correct, picked === correctAt,
          `正解在 ${correctAt}，選了 ${picked}`);
        eq(g.rows[0].answer.raw, picked, '存下的 raw 必須等於點選的索引');
      }
    }
  });

  test('索引 0 不會被當成未作答', () => {
    const lesson = mkLesson([q4(0)]);
    const g = gradeLesson(lesson, { answers: { 1: 0 } });
    eq(g.rows[0].is_correct, true);
    eq(g.rows[0].answer.raw, 0, '0 是合法的答案，不能被視為空白');
    ok(g.rows[0].answer !== null);
  });

  test('多題各自對應自己的答案，不會互相錯位', () => {
    const items = [q4(0), q4(1), q4(2), q4(3), q4(1)];
    const lesson = mkLesson(items);
    const picks = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 1 };
    const g = gradeLesson(lesson, { answers: picks });
    g.rows.forEach((r, i) => {
      eq(r.answer.raw, picks[i + 1], `第 ${i + 1} 題的 raw 錯位`);
      eq(r.is_correct, true, `第 ${i + 1} 題應判對`);
    });
    eq(g.scoreEarned, 10);
  });

  test('只答部分題目時，其餘維持未作答而不是錯位補上', () => {
    const items = [q4(0), q4(1), q4(2)];
    const lesson = mkLesson(items);
    const g = gradeLesson(lesson, { answers: { 2: 1 } });
    eq(g.rows[0].answer, null);
    eq(g.rows[1].answer.raw, 1);
    eq(g.rows[2].answer, null);
    eq(g.scoreEarned, 2, '只有第二題得分');
  });

  test('字串索引也對應正確（localStorage 還原可能變成字串）', () => {
    const lesson = mkLesson([q4(2)]);
    const g = gradeLesson(lesson, { answers: { 1: '2' } });
    eq(g.rows[0].is_correct, true, '字串 "2" 應等同數字 2');
  });
});

suite('選項索引：Draft 存檔與還原', () => {

  test('存檔再還原後答案索引不變', () => {
    const lesson = mkLesson([q4(0), q4(1), q4(2), q4(3)]);
    const answers = { 1: 0, 2: 1, 3: 2, 4: 3 };

    Draft.clear(lesson.id);
    Draft.save(lesson.id, {
      itemCount: 4, index: 2, answers, revealed: [3], perSeconds: { 1: 10 },
      timer: 120, elapsed: 200, pauseCount: 1
    });

    const back = Draft.load(lesson.id);
    deepEq(back.answers, answers, 'JSON 往返後索引必須完全一致');
    eq(back.answers['1'], 0, '索引 0 不能在往返中消失');
    deepEq(back.revealed, [3]);
    eq(back.timer, 120);
  });

  test('還原後的答案送去批改仍然判對', () => {
    const lesson = mkLesson([q4(0), q4(3)]);
    Draft.clear(lesson.id);
    Draft.save(lesson.id, { itemCount: 2, answers: { 1: 0, 2: 3 } });
    const back = Draft.load(lesson.id);
    const g = gradeLesson(lesson, { answers: back.answers });
    eq(g.rows[0].is_correct, true);
    eq(g.rows[1].is_correct, true);
  });

  test('題數不同的舊暫存不會被套用', () => {
    // 模擬 restore() 的判斷：itemCount 不符就整份丟掉
    const lesson = mkLesson([q4(0), q4(1)]);
    Draft.clear(lesson.id);
    Draft.save(lesson.id, { itemCount: 5, answers: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 } });
    const saved = Draft.load(lesson.id);
    const usable = saved && saved.itemCount === lesson.plan.items.length;
    eq(usable, false, '題數不符的暫存必須整份丟棄，否則答案會對到別的題目');
  });
});

suite('選項索引：寫入資料庫與檢討畫面', () => {

  test('資料庫存下的 raw 就是點選的索引', async () => {
    const lesson = mkLesson([q4(0), q4(2), q4(3)]);
    fresh(lesson);
    await submitLesson({
      lesson, student: STUDENT, answers: { 1: 1, 2: 2, 3: 0 }, date: '2026-09-15'
    });
    const rows = await attempts.forLesson(lesson.id);
    eq(rows[0].answer.raw, 1);
    eq(rows[1].answer.raw, 2);
    eq(rows[2].answer.raw, 0);
    eq(rows[0].is_correct, false, '第一題正解在 0，選 1 應判錯');
    eq(rows[1].is_correct, true);
    eq(rows[2].is_correct, false);
  });

  test('檢討畫面標記的「你選的」與作答時的索引一致', async () => {
    const lesson = mkLesson([q4(1), q4(3)]);
    fresh(lesson);
    const picks = { 1: 3, 2: 3 };
    await submitLesson({ lesson, student: STUDENT, answers: picks, date: '2026-09-15' });

    const rows = await attempts.forLesson(lesson.id);
    rows.forEach((r, i) => {
      // 這段複製 result.js 的判斷邏輯
      const raw = r.answer?.raw;
      const mine = raw === undefined || raw === null ? [] : [Number(raw)];
      const markedIndex = r.question.options.findIndex((o, idx) => mine.includes(idx));
      eq(markedIndex, picks[i + 1], `第 ${i + 1} 題畫面標記的索引與作答不符`);

      const rightIndex = r.question.options.findIndex(o => o.correct);
      eq(r.is_correct, markedIndex === rightIndex, '對錯判定與標記必須一致');
    });
  });

  test('題目快照裡的選項順序與批改時完全相同', async () => {
    const lesson = mkLesson([q4(2)]);
    fresh(lesson);
    await submitLesson({ lesson, student: STUDENT, answers: { 1: 2 }, date: '2026-09-15' });
    const rows = await attempts.forLesson(lesson.id);
    deepEq(
      rows[0].question.options.map(o => o.text),
      lesson.plan.items[0].options.map(o => o.text),
      '快照的選項順序若與作答時不同，索引就會對到別的選項'
    );
  });
});

suite('選項索引：真實生成題', () => {

  test('每個生成器的正解索引送出後都判對', async () => {
    for (const g of allGenerators()) {
      for (const difficulty of g.levels) {
        const q = generateOne(g, difficulty, 4242);
        if (q.type !== 'mc' && q.type !== 'mmc') continue;

        const want = correctIndices(q);
        const raw = q.type === 'mc' ? want[0] : want;
        const r = check(q, raw);
        ok(r.correct === true, `${g.id} / ${difficulty}：送出正解索引卻判錯`);

        // 逐一送出錯誤索引，必須全部判錯
        q.options.forEach((o, i) => {
          if (want.includes(i)) return;
          const rr = check(q, q.type === 'mc' ? i : [i]);
          ok(rr.correct === false, `${g.id}：送出錯誤索引 ${i} 卻判對`);
        });
      }
    }
  });

  test('生成題經過 JSON 往返後索引不變', () => {
    for (const g of allGenerators()) {
      const q = generateOne(g, g.levels[0], 909);
      if (q.type !== 'mc') continue;
      const round = JSON.parse(JSON.stringify(q));
      eq(correctIndices(round).join(','), correctIndices(q).join(','),
        `${g.id} 經過序列化後正解位置改變了`);
      const want = correctIndices(round)[0];
      ok(check(round, want).correct === true, `${g.id} 序列化後正解判錯`);
    }
  });
});

suite('選項內容：不得有數學上等價的干擾項', () => {

  test('沒有任何錯誤選項的文字與正解相同', () => {
    for (const g of allGenerators()) {
      for (const difficulty of g.levels) {
        for (let s = 1; s <= 60; s++) {
          const q = generateOne(g, difficulty, s * 131);
          if (!q.options) continue;
          const texts = q.options.map(o => String(o.text).replace(/\s+/g, ''));
          const dup = texts.find((t, i) => texts.indexOf(t) !== i);
          ok(!dup, `${g.id} / ${difficulty} 種子 ${s * 131}：選項重複「${dup}」`);
        }
      }
    }
  });

  test('多項式類生成器：錯誤選項不得等於正解（第 15 題那個 bug）', () => {
    const targets = ['math_g8.mult_formula', 'math_g8.factor_formula', 'math_g8.factor_common'];
    for (const g of allGenerators().filter(x => targets.includes(x.id))) {
      for (const difficulty of g.levels) {
        for (let s = 1; s <= 200; s++) {
          const q = generateOne(g, difficulty, s * 977);
          ok(g.verify(q),
            `${g.id} / ${difficulty} 種子 ${s * 977}：驗算不通過（可能有等價的假干擾項）`);
        }
      }
    }
  });
});

suite('題目文字：不得含有 HTML 標籤', () => {

  test('生成題的題幹與解析都不含標籤', () => {
    const tag = /<\s*\/?\s*[A-Za-z][^>]*>/;
    for (const g of allGenerators()) {
      for (const difficulty of g.levels) {
        const q = generateOne(g, difficulty, 555);
        ok(!tag.test(String(q.stem)), `${g.id} 的題幹含有標籤：${q.stem}`);
        (q.options || []).forEach(o => {
          ok(!tag.test(String(o.text)), `${g.id} 的選項含有標籤`);
          ok(!tag.test(String(o.why)), `${g.id} 的解析含有標籤`);
        });
        (q.steps || []).forEach(st => {
          ok(!tag.test(String(st.expr)), `${g.id} 的算式含有標籤`);
          ok(!tag.test(String(st.why || '')), `${g.id} 的步驟說明含有標籤`);
        });
      }
    }
  });
});
