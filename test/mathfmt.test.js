/* 任務 4.1 — 數學式渲染測試 */

import { suite, test, eq, ok } from './harness.js';
import { renderMath, mathToPlain, hasMath } from '../js/engine/mathfmt.js';

const has = (html, ...parts) => parts.every(p => html.includes(p));

suite('數學式渲染：分數', () => {

  test('基本分數', () => {
    const h = renderMath('\\frac{1}{2}');
    ok(has(h, 'class="frac"', 'class="num"', 'class="den"'), h);
    ok(h.includes('>1<') && h.includes('>2<'), h);
  });

  test('分數在算式中', () => {
    const h = renderMath('x = \\frac{a}{b} + 1');
    ok(has(h, 'x = ', 'class="frac"', ' + 1'), h);
  });

  test('嵌套分數', () => {
    const h = renderMath('\\frac{\\frac{1}{2}}{3}');
    eq((h.match(/class="frac"/g) || []).length, 2);
  });

  test('大括號沒閉合時不當掉', () => {
    const h = renderMath('\\frac{1');
    ok(typeof h === 'string' && h.length > 0);
  });
});

suite('數學式渲染：根號與上下標', () => {

  test('根號', () => {
    const h = renderMath('\\sqrt{2}');
    ok(has(h, 'class="sqrt"', 'radical', 'radicand'), h);
  });

  test('n 次方根', () => {
    const h = renderMath('\\sqrt[3]{8}');
    ok(has(h, 'root-idx'), h);
    ok(h.includes('>3<'), h);
  });

  test('上標：大括號與單字元', () => {
    ok(renderMath('x^{2}').includes('<sup>2</sup>'));
    ok(renderMath('x^2').includes('<sup>2</sup>'));
  });

  test('下標：大括號與單字元', () => {
    ok(renderMath('a_{1}').includes('<sub>1</sub>'));
    ok(renderMath('a_1').includes('<sub>1</sub>'));
  });

  test('多字元上標需要大括號', () => {
    ok(renderMath('x^{10}').includes('<sup>10</sup>'));
  });

  test('線段', () => {
    ok(renderMath('\\overline{AB}').includes('class="overline"'));
  });
});

suite('數學式渲染：符號', () => {

  const pairs = [
    ['\\times', '×'], ['\\div', '÷'], ['\\pm', '±'],
    ['\\le', '≤'], ['\\ge', '≥'], ['\\ne', '≠'],
    ['\\pi', 'π'], ['\\deg', '°'], ['\\angle', '∠'],
    ['\\triangle', '△'], ['\\perp', '⊥'], ['\\therefore', '∴']
  ];

  for (const [cmd, sym] of pairs) {
    test(`${cmd} → ${sym}`, () => ok(renderMath(cmd).includes(sym)));
  }

  test('不認識的命令原樣輸出', () => {
    ok(renderMath('\\unknown').includes('\\unknown'));
  });
});

suite('數學式渲染：HTML 轉義', () => {

  test('小於大於符號被轉義', () => {
    const h = renderMath('a < b > c');
    ok(h.includes('&lt;') && h.includes('&gt;'), h);
  });

  test('注入嘗試被擋下', () => {
    const h = renderMath('<script>alert(1)</script>');
    ok(!h.includes('<script>'), '不得輸出可執行的標籤');
    ok(h.includes('&lt;script&gt;'), h);
  });

  test('分數內容也會轉義', () => {
    const h = renderMath('\\frac{<b>}{2}');
    ok(!h.includes('<b>'));
  });
});

suite('數學式轉純文字', () => {

  test('分數', () => eq(mathToPlain('\\frac{1}{2}'), '1/2'));
  test('分數在算式中', () => eq(mathToPlain('x=\\frac{3}{4}'), 'x=3/4'));
  test('根號', () => eq(mathToPlain('\\sqrt{9}'), '根號9'));
  test('線段', () => eq(mathToPlain('\\overline{AB}'), '線段AB'));
  test('符號', () => eq(mathToPlain('3\\times4'), '3×4'));
  test('上標', () => eq(mathToPlain('x^{2}'), 'x^2'));
  test('下標', () => eq(mathToPlain('a_{1}'), 'a_1'));

  test('長短名稱不互相切壞', () => {
    eq(mathToPlain('\\therefore'), '∴');
    eq(mathToPlain('\\theta'), 'θ');
    eq(mathToPlain('\\parallel'), '∥');
    eq(mathToPlain('\\perp'), '⊥');
  });

  test('混合內容', () => {
    eq(mathToPlain('\\frac{1}{2}\\times\\frac{2}{3}'), '1/2×2/3');
  });
});

suite('數學式偵測', () => {

  test('含標記', () => {
    ok(hasMath('\\frac{1}{2}'));
    ok(hasMath('x^2'));
    ok(hasMath('a_1'));
  });

  test('純文字不含標記', () => {
    ok(!hasMath('這是一段普通的題目文字'));
    ok(!hasMath('1 + 2 = 3'));
  });
});
