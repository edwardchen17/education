/* 任務 4.3 — 答案正規化與比對測試
 * 對應需求 5.6、5.7
 */

import { suite, test, eq, ok, approx } from './harness.js';
import { parseNumeric, normalizeText, check, correctIndices, answerDisplay } from '../js/engine/answer.js';

suite('數值解析：等價形式', () => {

  const table = [
    // [輸入, 期望值, 說明]
    ['3/4',        0.75,  '分數'],
    ['0.75',       0.75,  '小數'],
    ['.75',        0.75,  '省略前導零'],
    ['6/8',        0.75,  '未化簡的分數'],
    ['１８',       18,    '全形數字'],
    ['６/８',      0.75,  '全形分數'],
    ['1,200',      1200,  '千分位逗號'],
    ['  42  ',     42,    '前後空白'],
    ['-3/4',      -0.75,  '負分數'],
    ['1 1/2',      1.5,   '帶分數（空白分隔）'],
    ['1又1/2',     1.5,   '帶分數（又）'],
    ['2^3',        8,     '次方'],
    ['2^-1',       0.5,   '負指數'],
    ['1.2e3',      1200,  '科學記號'],
    ['2*10^3',     2000,  '乘冪'],
    ['2×10^3',     2000,  '全形乘號'],
    ['sqrt9',      3,     'sqrt 無括號'],
    ['√9',         3,     '根號符號'],
    ['√(16)',      4,     '根號加括號'],
    ['(2+3)*4',    20,    '括號運算'],
    ['100/4',      25,    '除法'],
    ['35%',        35,    '百分比視為數值'],
    ['\\frac{3}{4}', 0.75, 'LaTeX 分數'],
  ];

  for (const [input, expected, label] of table) {
    test(`${label}：${input} → ${expected}`, () => {
      approx(parseNumeric(input), expected, 1e-9);
    });
  }

  test('圓周率', () => {
    approx(parseNumeric('pi'), Math.PI, 1e-9);
    approx(parseNumeric('π'), Math.PI, 1e-9);
    approx(parseNumeric('2π'), 2 * Math.PI, 1e-9, '隱含乘法');
  });

  test('根號的隱含乘法', () => {
    approx(parseNumeric('2√3'), 2 * Math.sqrt(3), 1e-9);
    approx(parseNumeric('3sqrt2'), 3 * Math.sqrt(2), 1e-9);
  });
});

suite('數值解析：帶單位', () => {

  const units = [
    ['18 km', 18], ['18km', 18], ['18公里', 18],
    ['250 公克', 250], ['3.5 小時', 3.5],
    ['90度', 90], ['1200元', 1200],
    ['45 cm', 45], ['12.5 m/s', 12.5], ['100℃', 100]
  ];

  for (const [input, expected] of units) {
    test(`去單位：${input} → ${expected}`, () => {
      approx(parseNumeric(input), expected, 1e-9);
    });
  }
});

suite('數值解析：無法解析的輸入', () => {

  const bad = ['', '   ', 'abc', '不知道', '?', '3/0', '一半', '+-', '((1)'];

  for (const input of bad) {
    test(`回傳 NaN 且不丟例外：${JSON.stringify(input)}`, () => {
      const v = parseNumeric(input);
      ok(Number.isNaN(v), `應為 NaN，實際 ${v}`);
    });
  }
});

suite('文字正規化', () => {

  test('全形轉半形、去空白、轉小寫', () => {
    eq(normalizeText('　Hello　'), 'hello');
    eq(normalizeText('ＡＢＣ'), 'abc');
    eq(normalizeText('a   b'), 'a b');
  });

  test('中文不受大小寫影響', () => {
    eq(normalizeText(' 光合作用 '), '光合作用');
  });
});

suite('比對：單選題', () => {

  const q = {
    type: 'mc',
    options: [
      { text: 'x = 2 或 x = 3', correct: true,  why: '因式分解得 (x-2)(x-3)=0' },
      { text: 'x = -2 或 x = -3', correct: false, why: '符號錯了' },
      { text: 'x = 1 或 x = 6', correct: false, why: '兩根相加應為 5' },
      { text: '無實數解', correct: false, why: '判別式大於零' }
    ]
  };

  test('選對', () => eq(check(q, 0).correct, true));
  test('選錯', () => eq(check(q, 2).correct, false));
  test('字串索引也接受', () => eq(check(q, '0').correct, true));
  test('未作答視為錯', () => {
    eq(check(q, null).correct, false);
    eq(check(q, '').correct, false);
  });
  test('correctIndices', () => eq(correctIndices(q).join(','), '0'));
  test('答案顯示', () => eq(answerDisplay(q), '(A)'));
});

suite('比對：多選題', () => {

  const q = {
    type: 'mmc',
    options: [
      { text: '甲', correct: true,  why: '' },
      { text: '乙', correct: false, why: '' },
      { text: '丙', correct: true,  why: '' },
      { text: '丁', correct: false, why: '' }
    ]
  };

  test('完全選對', () => eq(check(q, [0, 2]).correct, true));
  test('順序不影響', () => eq(check(q, [2, 0]).correct, true));
  test('重複選取不影響', () => eq(check(q, [0, 2, 2]).correct, true));
  test('少選一個算錯', () => eq(check(q, [0]).correct, false));
  test('多選一個算錯', () => eq(check(q, [0, 1, 2]).correct, false));
  test('全錯', () => eq(check(q, [1, 3]).correct, false));
  test('不給部分分', () => {
    const r = check(q, [0]);
    eq(r.correct, false);
    ok(r.detail.includes('完全選對'));
  });
});

suite('比對：填空題', () => {

  const q = { type: 'fill', answer: { accept: ['光合作用'] } };

  test('完全相符', () => eq(check(q, '光合作用').correct, true));
  test('前後空白', () => eq(check(q, ' 光合作用 ').correct, true));
  test('中間空白也接受', () => eq(check(q, '光合 作用').correct, true));
  test('答錯', () => eq(check(q, '呼吸作用').correct, false));

  test('多個可接受答案', () => {
    const q2 = { type: 'fill', answer: { accept: ['台北', '臺北'] } };
    eq(check(q2, '台北').correct, true);
    eq(check(q2, '臺北').correct, true);
    eq(check(q2, '新北').correct, false);
  });

  test('英文忽略大小寫', () => {
    const q2 = { type: 'fill', answer: { accept: ['Photosynthesis'] } };
    eq(check(q2, 'photosynthesis').correct, true);
    eq(check(q2, 'PHOTOSYNTHESIS').correct, true);
  });

  test('數值型填空接受等價寫法', () => {
    const q2 = { type: 'fill', answer: { accept: ['8'] } };
    eq(check(q2, '08').correct, true, '08 與 8 數值相等');
    eq(check(q2, '8').correct, true);
  });

  test('strict 模式關閉正規化', () => {
    const q2 = { type: 'fill', answer: { accept: ['ABC'], strict: true } };
    eq(check(q2, 'ABC').correct, true);
    eq(check(q2, 'abc').correct, false, 'strict 下大小寫有別');
  });
});

suite('比對：計算題', () => {

  const q = { type: 'calc', answer: { value: 18, tolerance: 0.01, unit: 'km' } };

  test('整數', () => eq(check(q, '18').correct, true));
  test('帶單位', () => eq(check(q, '18 km').correct, true));
  test('中文單位', () => eq(check(q, '18公里').correct, true));
  test('容許誤差內', () => eq(check(q, '18.005').correct, true));
  test('超出容許誤差', () => eq(check(q, '18.5').correct, false));
  test('答錯', () => eq(check(q, '20').correct, false));

  test('分數答案', () => {
    const q2 = { type: 'calc', answer: { value: 0.75, tolerance: 1e-6 } };
    eq(check(q2, '3/4').correct, true);
    eq(check(q2, '0.75').correct, true);
    eq(check(q2, '6/8').correct, true);
    eq(check(q2, '0.7').correct, false);
  });

  test('無理數以誤差比對', () => {
    const q2 = { type: 'calc', answer: { value: Math.sqrt(2), tolerance: 0.001 } };
    eq(check(q2, '√2').correct, true);
    eq(check(q2, '1.414').correct, true);
    eq(check(q2, '1.41').correct, false);
  });

  test('多個可接受答案', () => {
    const q2 = { type: 'calc', answer: { accept: ['2', '-2'], tolerance: 1e-9 } };
    eq(check(q2, '2').correct, true);
    eq(check(q2, '-2').correct, true);
    eq(check(q2, '3').correct, false);
  });

  test('看不懂的寫法：算錯但保留原始輸入', () => {
    const r = check(q, '大概十八');
    eq(r.correct, false);
    eq(r.normalized, '大概十八', '原始輸入必須保留供老師複核');
    ok(r.detail.includes('看不懂'));
  });

  test('未作答', () => eq(check(q, '').correct, false));
});

suite('比對：作文與簡答送批改', () => {

  test('作文回傳待批改', () => {
    const q = { type: 'essay', prompt: '題目', min_words: 400 };
    const r = check(q, '這是一篇作文……');
    eq(r.correct, null, '不自動判定對錯');
    eq(r.needsGrading, true);
  });

  test('簡答回傳待批改', () => {
    const q = { type: 'short' };
    eq(check(q, '因為……').needsGrading, true);
  });

  test('作文即使空白也送批改', () => {
    const q = { type: 'essay' };
    eq(check(q, '').needsGrading, true, '空白作文由老師判定，不自動給零');
  });
});
