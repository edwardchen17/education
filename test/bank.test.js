/* 任務 5.3 與 6.3 — 題庫結構驗證與生成器正解驗算
 *
 * 這是整份測試套件裡最重要的一支。
 * 錯誤的題目答案會直接誤導小孩，而且家長很難察覺，
 * 所以每個生成器都要產一千題並用獨立方式驗算正解（Property 14）。
 */

import { suite, test, ok, eq } from './harness.js';
import { seeded, ri } from '../js/core.js';
import { DIFFICULTIES, maxScore, streakBonus, BASE_POINTS } from '../js/config/scoring.js';
import { isKnownTopic, topicsOf } from '../js/config/topics.js';
import { subjectsFor, subjectLabel } from '../js/config/subjects.js';
import { validateQuestion, validateGenerator } from '../js/bank/validate.js';
import { allGenerators, generateOne, generatorsFor, pickQuestions, coverage } from '../js/bank/index.js';
import { check } from '../js/engine/answer.js';
import {
  polyMul, polyEval, polyEq, polyToMath, simplifySqrt, isSquareFree,
  gcdBrute, lcmBrute, frac, fracAdd, fracToText
} from '../js/bank/poly.js';

/* ================================================================== */
/* 設定檔                                                              */
/* ================================================================== */

suite('設定：科目與程度', () => {

  test('國二有六科，含社會', () => {
    const list = subjectsFor('g8').map(s => s.code);
    eq(list.length, 6);
    ok(list.includes('social'), '需求 4.1 要求含社會');
    ok(list.includes('science'), '國二是理化');
    ok(list.includes('bio'), '生物列為複習');
  });

  test('小五有五科，自然不分科', () => {
    const list = subjectsFor('g5').map(s => s.code);
    eq(list.length, 5);
    ok(list.includes('nature'), '小五是統整的自然');
    ok(!list.includes('science') && !list.includes('bio'), '小五不拆分物理化學生物（需求 4.6）');
  });

  test('生物標示為七年級複習（需求 4.4）', () => {
    const bio = subjectsFor('g8').find(s => s.code === 'bio');
    ok(bio.note && bio.note.includes('複習'), bio.note);
  });

  test('國文在兩個程度顯示不同名稱', () => {
    eq(subjectLabel('chinese', 'g8'), '國文');
    eq(subjectLabel('chinese', 'g5'), '國語');
  });
});

suite('設定：計分', () => {

  test('基準配分符合需求 10.1', () => {
    eq(BASE_POINTS.mc, 2);
    eq(BASE_POINTS.mmc, 3);
    eq(BASE_POINTS.fill, 3);
    eq(BASE_POINTS.calc, 5);
    eq(BASE_POINTS.short, 8);
    eq(BASE_POINTS.essay, 30);
  });

  test('難度倍率（需求 10.2）', () => {
    eq(maxScore('mc', 'basic'), 2);
    eq(maxScore('mc', 'advanced'), 2.6);
    eq(maxScore('mc', 'gifted'), 3.2);
    eq(maxScore('essay', 'gifted'), 48);
  });

  test('連續加成的邊界（Property 9）', () => {
    eq(streakBonus(0), 0);
    eq(streakBonus(6), 0, '未滿七天沒有加成');
    eq(streakBonus(7), 0.05);
    eq(streakBonus(13), 0.05);
    eq(streakBonus(14), 0.10);
    eq(streakBonus(35), 0.25, '五段達到上限');
    eq(streakBonus(42), 0.25, '超過上限仍為 25%');
    eq(streakBonus(3650), 0.25, '十年也不超過上限');
  });

  test('加成率恆落在 [0, 0.25]', () => {
    for (let d = 0; d < 2000; d += 7) {
      const b = streakBonus(d);
      ok(b >= 0 && b <= 0.25, `第 ${d} 天的加成 ${b} 超出範圍`);
    }
  });
});

/* ================================================================== */
/* 多項式工具（生成器驗算的基礎，必須自己先正確）                        */
/* ================================================================== */

suite('多項式工具', () => {

  test('摺積相乘', () => {
    // (x+2)(x+3) = x^2 + 5x + 6
    ok(polyEq(polyMul([2, 1], [3, 1]), [6, 5, 1]));
    // (2x+3)^2 = 4x^2 + 12x + 9
    ok(polyEq(polyMul([3, 2], [3, 2]), [9, 12, 4]));
    // (3x+4)(3x-4) = 9x^2 - 16
    ok(polyEq(polyMul([4, 3], [-4, 3]), [-16, 0, 9]));
  });

  test('求值', () => {
    eq(polyEval([6, 5, 1], 0), 6);
    eq(polyEval([6, 5, 1], 1), 12);
    eq(polyEval([6, 5, 1], -2), 0, 'x=-2 是 x^2+5x+6 的根');
    eq(polyEval([6, 5, 1], -3), 0);
  });

  test('轉數學標記', () => {
    eq(polyToMath([9, 12, 4]), '4x^{2} + 12x + 9');
    eq(polyToMath([-16, 0, 9]), '9x^{2} - 16');
    eq(polyToMath([6, 5, 1]), 'x^{2} + 5x + 6');
    eq(polyToMath([0, 1]), 'x');
  });

  test('根式化簡', () => {
    let s = simplifySqrt(72);
    eq(s.k, 6); eq(s.m, 2);
    s = simplifySqrt(50);
    eq(s.k, 5); eq(s.m, 2);
    s = simplifySqrt(13);
    eq(s.k, 1); eq(s.m, 13);
    ok(isSquareFree(2) && isSquareFree(15));
    ok(!isSquareFree(12), '12 含平方因數 4');
  });

  test('公因數與公倍數', () => {
    eq(gcdBrute(12, 18), 6);
    eq(lcmBrute(12, 18), 36);
    eq(gcdBrute(7, 13), 1);
    eq(lcmBrute(4, 6), 12);
  });

  test('分數精確運算', () => {
    eq(fracToText(fracAdd(frac(1, 2), frac(1, 3))), '5/6');
    eq(fracToText(fracAdd(frac(1, 6), frac(1, 3))), '1/2', '結果要化簡');
    eq(fracToText(frac(4, 8)), '1/2');
    eq(fracToText(frac(6, 3)), '2');
  });
});

/* ================================================================== */
/* 生成器介面                                                          */
/* ================================================================== */

suite('生成器：介面完整性', () => {

  test('有登記生成器', () => {
    ok(allGenerators().length >= 16, `目前 ${allGenerators().length} 個`);
  });

  test('每個生成器都有 id、topic、generate 與 verify', () => {
    const errs = [];
    for (const g of allGenerators()) errs.push(...validateGenerator(g));
    ok(errs.length === 0, errs.join('\n      '));
  });

  test('id 不重複', () => {
    const ids = allGenerators().map(g => g.id);
    const dup = ids.find((x, i) => ids.indexOf(x) !== i);
    ok(!dup, `重複的 id：${dup}`);
  });

  test('所有 topic 都登記在 config/topics.js', () => {
    for (const g of allGenerators()) {
      ok(isKnownTopic(g.topic), `${g.id} 的 topic ${g.topic} 未登記`);
    }
  });

  test('依科目與程度篩選', () => {
    ok(generatorsFor({ subject: 'math', level: 'g8' }).length >= 8);
    ok(generatorsFor({ subject: 'math', level: 'g5' }).length >= 8);
    eq(generatorsFor({ subject: 'nosuch' }).length, 0);
  });

  test('題庫涵蓋摘要', () => {
    const cov = coverage();
    ok(cov['math.g8'], '缺少國二數學');
    ok(cov['math.g5'], '缺少小五數學');
    ok(cov['math.g8'].difficulties.length === 3, '三種難度都要有');
  });
});

/* ================================================================== */
/* 一千題正解驗算（Property 14）                                        */
/* ================================================================== */

const ROUNDS = 1000;

suite(`生成器：每個生成器 ${ROUNDS} 題的正解驗算（Property 14）`, () => {

  for (const g of allGenerators()) {
    test(`${g.id}`, () => {
      const failures = [];
      const structErrs = [];
      let produced = 0;

      for (let i = 0; i < ROUNDS; i++) {
        const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
        if (!g.levels.includes(difficulty)) continue;

        const seed = i * 7919 + 13;
        let q;
        try {
          q = generateOne(g, difficulty, seed);
        } catch (err) {
          failures.push(`seed=${seed} ${difficulty} 生成時丟出例外：${err.message}`);
          continue;
        }
        produced++;

        // 結構驗證（Property 15）
        const errs = validateQuestion(q, `${g.id} seed=${seed}`);
        if (errs.length && structErrs.length < 5) structErrs.push(...errs);

        // 獨立驗算（Property 14）
        let okFlag;
        try {
          okFlag = g.verify(q);
        } catch (err) {
          failures.push(`seed=${seed} ${difficulty} verify 丟出例外：${err.message}`);
          continue;
        }
        if (!okFlag && failures.length < 5) {
          failures.push(`seed=${seed} ${difficulty} 驗算不通過。題幹：${String(q.stem).slice(0, 70)}`);
        }
      }

      ok(produced > 0, '完全沒產出題目');
      ok(structErrs.length === 0, '結構錯誤：\n      ' + structErrs.join('\n      '));
      ok(failures.length === 0, '驗算失敗：\n      ' + failures.join('\n      '));
    });
  }
});

/* ================================================================== */
/* 可重現性                                                            */
/* ================================================================== */

suite('生成器：同一顆種子可重現同一題', () => {

  for (const g of allGenerators()) {
    test(`${g.id} 可重現`, () => {
      for (const difficulty of g.levels) {
        const a = generateOne(g, difficulty, 12345);
        const b = generateOne(g, difficulty, 12345);
        eq(JSON.stringify(a), JSON.stringify(b), `${g.id} / ${difficulty} 兩次結果不同`);
      }
    });
  }

  test('不同種子會產生不同題目', () => {
    // 變化度要看整題內容而不是只看題幹。
    // 像「下列分數中哪一個最大」這種題型，題幹只有兩種寫法，
    // 真正的變化在選項裡。
    const signature = q => JSON.stringify({
      stem: q.stem,
      options: q.options ? q.options.map(o => o.text).sort() : null,
      answer: q.answer ?? null
    });

    for (const g of allGenerators()) {
      const seen = new Set();
      for (let s = 1; s <= 40; s++) {
        seen.add(signature(generateOne(g, g.levels[0], s * 31)));
      }
      ok(seen.size >= 10, `${g.id} 在 40 顆種子下只產生 ${seen.size} 種題目，變化太少`);
    }
  });
});

/* ================================================================== */
/* 正解與答案比對引擎相容                                              */
/* ================================================================== */

suite('生成器：正解能被答案比對引擎判定為正確', () => {

  for (const g of allGenerators()) {
    test(`${g.id} 的正解可被判對`, () => {
      const bad = [];
      for (let i = 0; i < 60; i++) {
        const difficulty = g.levels[i % g.levels.length];
        const q = generateOne(g, difficulty, i * 977 + 5);

        let raw;
        if (q.type === 'mc') {
          raw = q.options.findIndex(o => o.correct);
        } else if (q.type === 'mmc') {
          raw = q.options.map((o, idx) => (o.correct ? idx : -1)).filter(x => x >= 0);
        } else if (q.type === 'calc') {
          raw = String(q.answer.value);
        } else if (q.type === 'fill') {
          raw = q.answer.accept[0];
        } else {
          continue;
        }

        const r = check(q, raw);
        if (r.correct !== true && bad.length < 5) {
          bad.push(`seed=${i * 977 + 5} ${q.type} 送出正解卻被判錯：${JSON.stringify(raw)}`);
        }
      }
      ok(bad.length === 0, bad.join('\n      '));
    });
  }
});

/* ================================================================== */
/* 組題                                                                */
/* ================================================================== */

suite('組題：時間預算（Property 5）', () => {

  test('國二數學一堂課落在 20 至 40 分鐘', () => {
    for (let s = 0; s < 40; s++) {
      const rng = seeded(s + 1);
      const { items, seconds, warnings } = pickQuestions({
        subject: 'math', level: 'g8', difficulty: 'advanced', budget: 1500, rng
      });
      ok(items.length > 0, `第 ${s} 次沒有組出題目`);
      ok(warnings.length === 0, warnings.join('\n      '));
      ok(seconds >= 1200 && seconds <= 2400,
        `第 ${s} 次總時長 ${seconds} 秒超出 20 至 40 分鐘`);
    }
  });

  test('小五數學一堂課落在 20 至 40 分鐘', () => {
    for (let s = 0; s < 40; s++) {
      const rng = seeded(s + 500);
      const { items, seconds, warnings } = pickQuestions({
        subject: 'math', level: 'g5', difficulty: 'basic', budget: 1500, rng
      });
      ok(items.length > 0);
      ok(warnings.length === 0, warnings.join('\n      '));
      ok(seconds >= 1200 && seconds <= 2400, `總時長 ${seconds} 秒超出範圍`);
    }
  });

  test('組出的題目全部通過結構驗證', () => {
    const rng = seeded(42);
    const { items } = pickQuestions({ subject: 'math', level: 'g8', difficulty: 'gifted', budget: 1500, rng });
    const errs = [];
    items.forEach((q, i) => errs.push(...validateQuestion(q, `#${i + 1}`)));
    ok(errs.length === 0, errs.join('\n      '));
  });

  test('同一堂課不會出現重複題目', () => {
    for (let s = 0; s < 20; s++) {
      const rng = seeded(s + 900);
      const { items } = pickQuestions({ subject: 'math', level: 'g8', difficulty: 'advanced', budget: 1500, rng });
      const keys = items.map(q => `${q.gen.id}:${q.gen.seed}`);
      const dup = keys.find((k, i) => keys.indexOf(k) !== i);
      ok(!dup, `重複題目 ${dup}`);
    }
  });

  test('exclude 可避開近期做過的題目', () => {
    const rng = seeded(7);
    const first = pickQuestions({ subject: 'math', level: 'g8', difficulty: 'basic', budget: 1500, rng });
    const exclude = new Set(first.items.map(q => `${q.gen.id}:${q.gen.seed}`));
    const second = pickQuestions({
      subject: 'math', level: 'g8', difficulty: 'basic', budget: 1500,
      rng: seeded(7), exclude
    });
    const overlap = second.items.filter(q => exclude.has(`${q.gen.id}:${q.gen.seed}`));
    eq(overlap.length, 0, '第二次組題不應包含已排除的題目');
  });

  test('複習知識點會被優先納入（需求 8.6）', () => {
    const rng = seeded(11);
    const { items } = pickQuestions({
      subject: 'math', level: 'g8', difficulty: 'basic', budget: 1500,
      topics: ['math.g8.factor.cross', 'math.g8.sqrt.simplify'], rng
    });
    const topics = items.map(q => q.topic);
    ok(topics.includes('math.g8.factor.cross'), '指定的複習知識點沒有出現');
    ok(topics.includes('math.g8.sqrt.simplify'), '指定的複習知識點沒有出現');
  });

  test('複習題不超過預算的四成', () => {
    // 這裡必須用 pickQuestions 回傳的 reviewSeconds 來判斷。
    // 若改用「題目的 topic 是否在複習清單中」來計算，
    // 會把第二階段抽到的同知識點新題也算成複習，量出來的數字沒有意義。
    const reviewTopics = topicsOf('math', 'g8');
    for (let s = 0; s < 20; s++) {
      const { reviewSeconds, reviewCount, items } = pickQuestions({
        subject: 'math', level: 'g8', difficulty: 'basic', budget: 1500,
        topics: reviewTopics, rng: seeded(s + 13)
      });
      ok(reviewCount > 0, '應該要有複習題');
      // 迴圈在超過 600 秒後停止追加，所以最多會超出最後一題的長度
      ok(reviewSeconds <= 1500 * 0.4 + 150,
        `複習題佔 ${reviewSeconds} 秒，超過四成預算太多`);
      ok(items.filter(q => q.is_review).length === reviewCount, '複習題標記與計數不一致');
    }
  });
});

/* ================================================================== */
/* 結構驗證器本身                                                      */
/* ================================================================== */

suite('結構驗證器', () => {

  const good = () => ({
    type: 'mc',
    stem: '題幹',
    options: [
      { text: 'A', correct: true, why: '因為這樣' },
      { text: 'B', correct: false, why: '因為那樣不對' }
    ],
    topic: 'math.g8.factor.cross',
    subject: 'math',
    difficulty: 'basic',
    est_seconds: 60,
    base_points: 2
  });

  test('合格的題目沒有錯誤', () => {
    eq(validateQuestion(good()).length, 0);
  });

  test('抓出缺少 why 的選項（Property 15）', () => {
    const q = good();
    q.options[1].why = '';
    const errs = validateQuestion(q);
    ok(errs.some(e => e.includes('why')), errs.join(' / '));
  });

  test('抓出沒有正解', () => {
    const q = good();
    q.options[0].correct = false;
    ok(validateQuestion(q).some(e => e.includes('沒有任何正解')));
  });

  test('抓出單選題有多個正解', () => {
    const q = good();
    q.options[1].correct = true;
    ok(validateQuestion(q).some(e => e.includes('個正解')));
  });

  test('抓出重複的選項', () => {
    const q = good();
    q.options[1].text = 'A';
    ok(validateQuestion(q).some(e => e.includes('重複')));
  });

  test('抓出未登記的知識點', () => {
    const q = good();
    q.topic = 'math.g8.nonexistent.topic';
    ok(validateQuestion(q).some(e => e.includes('未登記')));
  });

  test('抓出不合法的難度', () => {
    const q = good();
    q.difficulty = 'super';
    ok(validateQuestion(q).some(e => e.includes('難度')));
  });

  test('抓出配分與題型不符', () => {
    const q = good();
    q.base_points = 99;
    ok(validateQuestion(q).some(e => e.includes('base_points')));
  });

  test('抓出不合理的作答秒數', () => {
    const q = good();
    q.est_seconds = 99999;
    ok(validateQuestion(q).some(e => e.includes('est_seconds')));
  });

  test('計算題必須有分步驟推導（需求 6.3）', () => {
    const q = {
      type: 'calc', stem: '算', answer: { value: 1 },
      topic: 'math.g8.pythagoras.basic', subject: 'math',
      difficulty: 'basic', est_seconds: 90, base_points: 5
    };
    ok(validateQuestion(q).some(e => e.includes('分步驟')));
  });

  test('作文的評分規準總分必須等於配分', () => {
    const q = {
      type: 'essay', stem: '寫', prompt: '題目', min_words: 400,
      rubric: [{ item: '結構', points: 10, desc: '說明' }],
      sample: '範文',
      topic: 'chinese.g8.writing.narrative', subject: 'chinese',
      difficulty: 'basic', est_seconds: 1200, base_points: 30
    };
    ok(validateQuestion(q).some(e => e.includes('總分')));
  });
});
