/* ===== bank/gen/math_g8.js — 國二數學生成器 =====
 *
 * 每個生成器都提供 verify()，以獨立於出題公式的方式驗算答案（Property 14）。
 * 例如展開題用公式算係數，驗算則用多項式摺積；兩者不一致就是 bug。
 *
 * 干擾選項的設計原則（design 文件）：每個錯誤選項對應一種具體的常見錯誤，
 * 這樣 why 才寫得出有教學價值的說明。
 */

import { ri, pick } from '../../core.js';
import { mc, calc, m, pickWrong, factorText } from '../qbuild.js';
import {
  polyMul, polyEval, polyEq, polyToMath, polyIdentical,
  simplifySqrt, isSquareFree, PYTHAGOREAN_TRIPLES, gcdBrute
} from '../poly.js';

const SUB = 'math';

/* ================================================================== */
/* 1. 乘法公式展開                                                     */
/* ================================================================== */

const multFormula = {
  id: 'math_g8.mult_formula',
  topic: 'math.g8.poly.mult_formula',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    // 基礎難度固定 a = 1，但三種公式與較寬的 b 範圍都開放，
    // 否則參數組合太少，同一個學生很快就會遇到重複的題目。
    const a = difficulty === 'basic' ? 1 : ri(2, difficulty === 'gifted' ? 7 : 5, rng);
    const b = ri(2, difficulty === 'basic' ? 12 : difficulty === 'gifted' ? 15 : 11, rng);
    const kind = pick(['square', 'negSquare', 'diff'], rng);

    let left, coeffs, why;
    if (kind === 'diff') {
      left = `(${lin(a, b)})(${lin(a, -b)})`;
      coeffs = polyMul([b, a], [-b, a]);
      why = `平方差公式：(A+B)(A-B) = A^{2} - B^{2}，中間項互相消掉。`;
    } else {
      const bb = kind === 'negSquare' ? -b : b;
      left = `(${lin(a, bb)})^{2}`;
      coeffs = polyMul([bb, a], [bb, a]);
      why = `完全平方公式：(A${bb < 0 ? '-' : '+'}B)^{2} = A^{2} ${bb < 0 ? '-' : '+'} 2AB + B^{2}。`;
    }

    const correctText = polyToMath(coeffs);
    const [c0, c1, c2] = [coeffs[0] ?? 0, coeffs[1] ?? 0, coeffs[2] ?? 0];

    /* 每個干擾項都帶上自己代表的多項式係數（chk），
     * 讓 verify() 能確認沒有任何干擾項在數學上等於正解。 */
    const cands = [
      { c: [c0, 0, c2],
        why: '漏掉了中間項。展開平方不是把每一項各自平方，還有 2AB 這一項。' },
      { c: [c0, Math.round(c1 / 2) || 1, c2],
        why: '中間項忘記乘以 2。交叉相乘會出現兩次，所以係數是 2AB 而不是 AB。' },
      { c: [-c0, c1, c2],
        why: '常數項的正負號錯了。任何數平方後都是正的。' },
      { c: [c0, -c1, c2],
        why: '中間項的正負號錯了。請對照括號內第二項的符號。' },
      { c: [c0, c1, c2 + 1],
        why: '最高次項的係數算錯了，應該是括號內第一項係數的平方。' }
    ]
      // 先剔除數學上等於正解的候選，再交給 pickWrong 處理文字重複
      .filter(x => !polyEq(x.c, coeffs))
      .map(x => ({ text: polyToMath(x.c), why: x.why, chk: { coeffs: x.c } }));

    const wrong = pickWrong(correctText, cands);

    return mc(rng, {
      stem: `展開下列各式：\n${left}`,
      correct: { text: correctText, why, chk: { coeffs } },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 60 : 80,
      gen: { id: this.id, check: { kind, a, b, coeffs } }
    });
  },

  /** 驗算：用摺積重算係數，並確認沒有任何干擾項在數學上等於正解 */
  verify(q) {
    const { kind, a, b, coeffs } = q.gen.check;
    const factors = kind === 'diff' ? [[b, a], [-b, a]]
                  : kind === 'negSquare' ? [[-b, a], [-b, a]]
                  : [[b, a], [b, a]];
    const byConvolution = polyMul(factors[0], factors[1]);
    if (!polyEq(byConvolution, coeffs)) return false;
    if (!polyIdentical(byConvolution, coeffs)) return false;

    const correct = q.options.find(o => o.correct);
    if (!correct || correct.text !== polyToMath(coeffs)) return false;

    // 沒有任何錯誤選項可以等於正解
    return q.options.filter(o => !o.correct)
      .every(o => o.chk && !polyIdentical(o.chk.coeffs, coeffs));
  }
};

/* ================================================================== */
/* 2. 提出公因式                                                       */
/* ================================================================== */

const factorCommon = {
  id: 'math_g8.factor_common',
  topic: 'math.g8.factor.common',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const g = ri(2, difficulty === 'basic' ? 6 : 12, rng);   // 數字公因式
    const p = difficulty === 'basic' ? 1 : ri(1, 2, rng);     // x 的公同次方
    const termCount = difficulty === 'gifted' ? 3 : 2;

    // 內層多項式的係數必須互質，否則公因式沒提到最大
    let inner;
    do {
      inner = Array.from({ length: termCount }, () => ri(1, 9, rng));
    } while (inner.length > 1 && inner.reduce((x, y) => gcdBrute(x, y)) !== 1);

    // 原式 = g x^p × (inner[0] x^{n-1} + ... + inner[last])
    const innerCoeffs = [...inner].reverse();                  // 低次在前
    const factorCoeffs = Array(p).fill(0).concat([g]);         // g x^p
    const original = polyMul(factorCoeffs, innerCoeffs);

    const xPart = p === 0 ? '' : p === 1 ? 'x' : `x^{${p}}`;
    const xPow = Array(p).fill(0).concat([1]);
    const innerText = polyToMath(innerCoeffs);
    const correctText = `${g}${xPart}(${innerText})`;

    /* 「只提出數字」與「只提出 x」這兩個干擾項乘開後確實等於原式，
     * 但它們沒有把公因式提到最大，在因式分解的規則下是不完整的答案。
     * 這是有教學價值的干擾項，所以題幹必須明確要求「最大公因式」。
     * chk.full 標示這個選項是否已分解到底，verify() 會據此檢查。 */
    const numOnlyInner = polyMul(xPow, innerCoeffs);
    const xOnlyInner = innerCoeffs.map(c => c * g);

    const cands = [
      { text: `${g}(${polyToMath(numOnlyInner)})`,
        chk: { coeffs: polyMul([g], numOnlyInner), full: false },
        why: `只提出了數字 ${g}，忘記把 ${xPart} 也提出來。乘開來確實等於原式，` +
             `但括號裡還有共同的 ${xPart} 可以提出，沒有分解到底。` },
      { text: `${xPart}(${polyToMath(xOnlyInner)})`,
        chk: { coeffs: polyMul(xPow, xOnlyInner), full: false },
        why: `只提出了 ${xPart}，忘記數字部分還有公因數 ${g}。同樣沒有分解到底。` },
      { text: `${g}${xPart}(${polyToMath(innerCoeffs.map(c => c * 2))})`,
        chk: { coeffs: polyMul(polyMul([g], xPow), innerCoeffs.map(c => c * 2)), full: false },
        why: '括號內的係數算錯了。把答案乘開來檢查，並不等於原式。' },
      { text: `${g * 2}${xPart}(${polyToMath(innerCoeffs)})`,
        chk: { coeffs: polyMul(polyMul([g * 2], xPow), innerCoeffs), full: false },
        why: `提出的數字太大了。乘開後每一項都會變成原式的兩倍。` }
    ];

    const wrong = pickWrong(correctText, cands);

    return mc(rng, {
      // 題幹必須點明「最大」，否則只提出數字的答案也說得過去
      stem: `將下式因式分解，要提出最大公因式：\n${polyToMath(original)}`,
      correct: {
        text: correctText,
        chk: { coeffs: polyMul(polyMul([g], xPow), innerCoeffs), full: true },
        why: `各項係數的最大公因數是 ${g}，而每一項都至少含有 ${xPart || '1'}，` +
             `所以最大公因式為 ${g}${xPart}。提出後括號內的係數已經互質，無法再分解。`
      },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'gifted' ? 90 : 70,
      gen: { id: this.id, check: { original, factorCoeffs, innerCoeffs, g, p } }
    });
  },

  /**
   * 驗算：
   *   1. 正解乘回去必須還原成原式，且已分解到底
   *   2. 任何乘開後等於原式的干擾項，都必須是「沒分解到底」的那種
   */
  verify(q) {
    const { original, factorCoeffs, innerCoeffs, g } = q.gen.check;
    const back = polyMul(factorCoeffs, innerCoeffs);
    if (!polyEq(back, original)) return false;
    if (!polyIdentical(back, original)) return false;

    // 公因式必須是最大的：括號內係數的最大公因數要等於 1
    const nz = innerCoeffs.filter(c => c !== 0);
    const innerGcd = nz.length === 1 ? Math.abs(nz[0]) : nz.reduce((x, y) => gcdBrute(x, y));
    if (innerGcd !== 1 || g < 2) return false;

    const correct = q.options.find(o => o.correct);
    if (!correct?.chk?.full) return false;

    for (const o of q.options) {
      if (o.correct || !o.chk) continue;
      // 等於原式的干擾項只能是「沒分解到底」，不能是另一個完整答案
      if (polyIdentical(o.chk.coeffs, original) && o.chk.full) return false;
    }
    return true;
  }
};

/* ================================================================== */
/* 3. 利用乘法公式因式分解                                             */
/* ================================================================== */

const factorFormula = {
  id: 'math_g8.factor_formula',
  topic: 'math.g8.factor.formula',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    // 基礎難度雖然固定 a = 1，但平方差與完全平方兩種型態都要出現，
    // 且 b 的範圍要夠寬，避免題目很快就重複。
    const useSquare = rng() < (difficulty === 'gifted' ? 0.5 : 0.4);
    const a = difficulty === 'basic' ? 1 : ri(2, difficulty === 'gifted' ? 6 : 4, rng);
    const b = ri(2, difficulty === 'basic' ? 12 : difficulty === 'gifted' ? 14 : 11, rng);

    let original, correctText, why, f1, f2;

    if (useSquare) {
      // a²x² + 2abx + b² = (ax + b)²
      f1 = [b, a]; f2 = [b, a];
      original = polyMul(f1, f2);
      correctText = `(${lin(a, b)})^{2}`;
      why = `觀察首項 ${a * a}x^{2} 是 (${lin(a, 0)})^{2}，末項 ${b * b} 是 ${b}^{2}，` +
            `而中間項 ${2 * a * b}x 剛好等於 2 \\times ${a}x \\times ${b}，符合完全平方式。`;
    } else {
      // a²x² - b² = (ax + b)(ax - b)
      f1 = [b, a]; f2 = [-b, a];
      original = polyMul(f1, f2);
      correctText = `(${lin(a, b)})(${lin(a, -b)})`;
      why = `${a * a}x^{2} 與 ${b * b} 都是完全平方，中間是減號，符合平方差公式 ` +
            `A^{2} - B^{2} = (A+B)(A-B)。`;
    }

    /* 每個干擾項都要附上它展開後的多項式，才能確認沒有任何一個
     * 在數學上等於原式。
     *
     * 特別注意：(x+b)(x+b) 與 (x+b)^2 是同一個式子，不能拿來當干擾項。
     * 以前這裡放了這個選項，導致學生選了正確答案卻被判錯。 */
    const cands = [
      { text: `(${lin(a, b)})^{2}`, factors: [[b, a], [b, a]],
        why: '這是完全平方式的結果。原式的兩項是相減，應該用平方差公式，' +
             '答案會是兩個符號相反的括號相乘。' },
      { text: `(${lin(a, -b)})^{2}`, factors: [[-b, a], [-b, a]],
        why: '乘開後會多出一個負的中間項，與原式不符。' },
      { text: `(${lin(a, b)})(${lin(a, b * 2)})`, factors: [[b, a], [b * 2, a]],
        why: `乘開後常數項會變成 ${b * b * 2}，與原式的 ${b * b} 不符。` },
      { text: `(${lin(a * a, b * b)})`, factors: null,
        why: '把係數各自開平方後寫成一個括號是錯的，因式分解的結果必須是兩個因式相乘。' },
      { text: `${a}(${lin(1, b)})(${lin(1, -b)})`, factors: [[b, 1], [-b, 1], [0, a]],
        why: `把首項係數提到括號外面時處理錯了，乘開後首項係數會是 ${a} 而不是 ${a * a}。` }
    ]
      .map(x => ({
        text: x.text,
        why: x.why,
        chk: { coeffs: x.factors ? x.factors.reduce((acc, f) => polyMul(acc, f), [1]) : null }
      }))
      // 剔除任何在數學上等於原式的候選
      .filter(x => !x.chk.coeffs || !polyIdentical(x.chk.coeffs, original));

    const wrong = pickWrong(correctText, cands);

    return mc(rng, {
      stem: `將下式因式分解：\n${polyToMath(original)}`,
      correct: { text: correctText, why, chk: { coeffs: original } },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 70 : 90,
      gen: { id: this.id, check: { original, f1, f2 } }
    });
  },

  /** 驗算：因式乘回去要還原成原式，且沒有任何干擾項等於原式 */
  verify(q) {
    const { original, f1, f2 } = q.gen.check;
    const back = polyMul(f1, f2);
    if (!polyEq(back, original) || !polyIdentical(back, original)) return false;

    return q.options.filter(o => !o.correct).every(o =>
      !o.chk?.coeffs || !polyIdentical(o.chk.coeffs, original));
  }
};

/* ================================================================== */
/* 4. 十字交乘法                                                       */
/* ================================================================== */

const factorCross = {
  id: 'math_g8.factor_cross',
  topic: 'math.g8.factor.cross',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    let p, q;
    if (difficulty === 'basic') {
      p = ri(1, 6, rng); q = ri(1, 6, rng);
    } else if (difficulty === 'advanced') {
      p = ri(1, 9, rng); q = -ri(1, 9, rng);
      if (p === -q) q -= 1;                    // 避免變成平方差
    } else {
      p = ri(2, 12, rng) * (rng() < 0.5 ? 1 : -1);
      q = ri(2, 12, rng) * (rng() < 0.5 ? 1 : -1);
      if (p === q) q += 1;
    }

    const f1 = [p, 1], f2 = [q, 1];
    const original = polyMul(f1, f2);           // [pq, p+q, 1]
    const b = p + q, c = p * q;
    const correctText = `${factorText(p)}${factorText(q)}`;

    // 找一組乘積相同但和不同的整數，作為「相加相乘搞混」的干擾項
    const alt = altPair(c, b);

    const wrong = pickWrong(correctText, [
      { text: `${factorText(-p)}${factorText(-q)}`,
        why: `兩個括號的符號都反了。乘開後 x 的係數會變成 ${-b}，` +
             `與原式的 ${b} 不符。` },
      { text: `${factorText(p)}${factorText(-q)}`,
        why: `其中一個符號錯了。乘開後常數項會變成 ${-c}，與原式的 ${c} 不符。` },
      alt && { text: `${factorText(alt[0])}${factorText(alt[1])}`,
        why: `這兩個數相乘確實是 ${c}，但相加是 ${alt[0] + alt[1]} 而不是 ${b}。` +
             `十字交乘要同時滿足相乘等於常數項、相加等於一次項係數。` },
      { text: `${factorText(b)}${factorText(c)}`,
        why: '把一次項係數與常數項直接搬進括號是錯的。括號內要放的是「相加得一次項係數、' +
             '相乘得常數項」的那兩個數。' },
      { text: `${factorText(p + 1)}${factorText(q - 1)}`,
        why: `這兩數相加雖然是 ${b}，但相乘是 ${(p + 1) * (q - 1)} 而不是 ${c}。` }
    ].filter(Boolean));

    return mc(rng, {
      stem: `將下式因式分解：\n${polyToMath(original)}`,
      correct: {
        text: correctText,
        why: `要找兩個數相乘為 ${c}、相加為 ${b}，這兩個數是 ${p} 與 ${q}，` +
             `所以分解為 ${correctText}。`
      },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 75 : 100,
      gen: { id: this.id, check: { original, f1, f2, p, q, b, c } }
    });
  },

  verify(q) {
    const { original, f1, f2, p, q: qq, b, c } = q.gen.check;
    if (p + qq !== b || p * qq !== c) return false;          // 和與積的關係
    const back = polyMul(f1, f2);
    return polyEq(back, original) && polyIdentical(back, original);
  }
};

/** 找另一組整數 (u,v) 使 u*v = c 但 u+v ≠ b */
function altPair(c, b) {
  const lim = Math.min(Math.abs(c), 200);
  for (let u = 1; u <= lim; u++) {
    if (c % u !== 0) continue;
    for (const s of [1, -1]) {
      const uu = u * s, vv = c / uu;
      if (!Number.isInteger(vv)) continue;
      if (uu + vv !== b) return [uu, vv];
    }
  }
  return null;
}

/* ================================================================== */
/* 5. 根式化簡                                                         */
/* ================================================================== */

const SQ_FREE = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22];

const sqrtSimplify = {
  id: 'math_g8.sqrt_simplify',
  topic: 'math.g8.sqrt.simplify',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const kMax = difficulty === 'basic' ? 4 : difficulty === 'advanced' ? 7 : 12;
    const k = ri(2, kMax, rng);
    const mm = pick(difficulty === 'basic' ? SQ_FREE.slice(0, 5) : SQ_FREE, rng);
    const n = k * k * mm;

    const correctText = m.ksqrt(k, mm);

    const wrong = pickWrong(correctText, [
      { text: `${k * mm}`,
        why: `把根號整個去掉了。\\sqrt{${n}} 不等於 ${k}\\times${mm}，` +
             `因為 ${n} 不是完全平方數。` },
      { text: m.ksqrt(mm, k),
        why: `根號內外弄反了。要開出來的是平方因數 ${k * k}，開出後變成 ${k}，` +
             `留在根號內的是 ${mm}。` },
      { text: `\\sqrt{${k * mm}}`,
        why: `只把一半開出來。${n} = ${k * k} \\times ${mm}，` +
             `${k * k} 是完全平方，要整個開出來。` },
      { text: m.ksqrt(k + 1, mm),
        why: `開出來的係數算錯了。請檢查 ${k + 1}^{2} \\times ${mm} 是否等於 ${n}。` },
      { text: m.ksqrt(k, mm + 1),
        why: `根號內的數算錯了。請檢查 ${k}^{2} \\times ${mm + 1} 是否等於 ${n}。` }
    ]);

    return mc(rng, {
      stem: `化簡下式（根號內要化到最簡）：\n${m.sqrt(n)}`,
      correct: {
        text: correctText,
        why: `${n} = ${k}^{2} \\times ${mm}，把完全平方因數 ${k * k} 開出來得 ${k}，` +
             `剩下 ${mm} 已無平方因數，所以答案是 ${correctText}。`
      },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 60 : 80,
      gen: { id: this.id, check: { n, k, m: mm } }
    });
  },

  /** 驗算：k²m 必須等於 n，且 m 必須無平方因子（確認化到底了） */
  verify(q) {
    const { n, k, m: mm } = q.gen.check;
    if (k * k * mm !== n) return false;
    if (!isSquareFree(mm)) return false;
    const s = simplifySqrt(n);                    // 獨立走一次化簡
    return s.k === k && s.m === mm;
  }
};

/* ================================================================== */
/* 6. 根式四則運算                                                     */
/* ================================================================== */

const sqrtOperation = {
  id: 'math_g8.sqrt_operation',
  topic: 'math.g8.sqrt.operation',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const mm = pick(SQ_FREE.slice(0, difficulty === 'basic' ? 4 : 8), rng);

    if (difficulty === 'basic') {
      // 同根式加減。刻意讓結果的係數至少為 2，
      // 否則 1\sqrt{m} 會寫成 \sqrt{m}，與其他干擾項的寫法撞在一起。
      const a = ri(3, 9, rng);
      const plus = rng() < 0.5;
      const b = plus ? ri(1, a - 1, rng) : ri(1, a - 2, rng);
      const res = plus ? a + b : a - b;          // 恆 >= 2
      const wrongOp = plus ? a - b : a + b;      // 加減弄反的結果
      const stem = `計算：${m.ksqrt(a, mm)} ${plus ? '+' : '-'} ${m.ksqrt(b, mm)}`;
      const correctText = m.ksqrt(res, mm);

      const wrong = pickWrong(correctText, [
        { text: m.ksqrt(wrongOp, mm),
          why: `係數的加減弄反了。題目是 ${a} ${plus ? '+' : '-'} ${b}，答案應該是 ${res}。` },
        { text: `\\sqrt{${res * mm}}`,
          why: '不能把係數乘進根號裡。係數留在根號外面直接相加減即可。' },
        { text: `${res}`,
          why: `根號不會消失。${mm} 不是完全平方數，答案必須保留根號。` },
        { text: `${res * mm}`,
          why: '把根號拿掉又把裡面的數乘出來，這兩步都不成立。' }
      ]);

      return mc(rng, {
        stem, correct: {
          text: correctText,
          why: `兩項的根號內都是 ${mm}，屬於同類根式，係數 ${a} ${plus ? '+' : '-'} ${b} = ${res}，` +
               `根號部分不變。`
        },
        wrong,
        topic: this.topic, subject: SUB, difficulty, est: 65,
        gen: { id: this.id, check: { kind: 'addsub', value: res * Math.sqrt(mm), k: res, m: mm } }
      });
    }

    if (difficulty === 'advanced') {
      // 先化簡再相加
      const k1 = ri(2, 6, rng), k2 = ri(2, 6, rng);
      if (k1 === k2) return this.generate('basic', rng);
      const n1 = k1 * k1 * mm, n2 = k2 * k2 * mm;
      const res = k1 + k2;
      const correctText = m.ksqrt(res, mm);

      const wrong = pickWrong(correctText, [
        { text: `\\sqrt{${n1 + n2}}`,
          why: `根號不能直接相加：\\sqrt{A} + \\sqrt{B} 不等於 \\sqrt{A+B}。` +
               `要先各自化簡成同類根式再合併。` },
        { text: m.ksqrt(k1 * k2, mm),
          why: '化簡後的係數應該相加而不是相乘。' },
        { text: `${res * mm}`,
          why: '根號不會消失，也不能把根號內的數乘出來。' },
        { text: `${res}`,
          why: '根號不會消失，答案要保留根式。' }
      ]);

      return mc(rng, {
        stem: `計算：${m.sqrt(n1)} + ${m.sqrt(n2)}`,
        correct: {
          text: correctText,
          why: `先化簡：\\sqrt{${n1}} = ${m.ksqrt(k1, mm)}，\\sqrt{${n2}} = ${m.ksqrt(k2, mm)}。` +
               `兩者是同類根式，係數相加 ${k1} + ${k2} = ${res}。`
        },
        wrong,
        topic: this.topic, subject: SUB, difficulty, est: 95,
        gen: { id: this.id, check: { kind: 'simplify_add', value: res * Math.sqrt(mm), k: res, m: mm, n1, n2 } }
      });
    }

    // gifted：根式相乘。
    // 必須挑到乘積含平方因數的組合（s.k > 1），否則「沒化簡」的干擾項會與正解完全相同。
    const k1 = ri(2, 5, rng);
    const pool = SQ_FREE.slice(0, 8).filter(x => simplifySqrt(mm * x).k > 1);
    const m2 = pool.length ? pick(pool, rng) : mm;
    const prod = mm * m2;
    const s = simplifySqrt(prod);
    const outK = k1 * s.k;
    const correctText = m.ksqrt(outK, s.m);

    const wrong = pickWrong(correctText, [
      { text: m.ksqrt(k1, prod),
        why: `根號內的 ${prod} 還可以再化簡，因為它含有平方因數 ${s.k * s.k}。` },
      { text: m.ksqrt(outK, prod),
        why: `係數化簡對了，但根號內的 ${prod} 忘記把平方因數拿掉。` },
      { text: m.ksqrt(k1 + s.k, s.m),
        why: '兩個根式相乘時，外面的係數要相乘而不是相加。' },
      { text: `${outK * (s.m === 1 ? 2 : s.m)}`,
        why: '根號不能直接去掉，除非根號內是完全平方數。' },
      { text: m.ksqrt(outK + 1, s.m),
        why: '根號外的係數算錯了，請重新做一次質因數分解。' }
    ]);

    return mc(rng, {
      stem: `計算並化到最簡：\n${m.ksqrt(k1, mm)}${m.times}${m.sqrt(m2)}`,
      correct: {
        text: correctText,
        why: `\\sqrt{${mm}} \\times \\sqrt{${m2}} = \\sqrt{${prod}}` +
             (s.k > 1 ? ` = ${m.ksqrt(s.k, s.m)}` : '') +
             `，再乘上原本的係數 ${k1}，得 ${correctText}。`
      },
      wrong,
      topic: this.topic, subject: SUB, difficulty, est: 120,
      gen: { id: this.id, check: { kind: 'multiply', value: k1 * Math.sqrt(mm) * Math.sqrt(m2), k: outK, m: s.m } }
    });
  },

  /** 驗算：以浮點數重算整個運算式，與宣稱的 k√m 比較 */
  verify(q) {
    const c = q.gen.check;
    const claimed = c.k * Math.sqrt(c.m);
    if (Math.abs(claimed - c.value) > 1e-9) return false;
    if (!isSquareFree(c.m)) return false;          // 必須化到最簡
    const correct = q.options.find(o => o.correct);
    return correct && correct.text === m.ksqrt(c.k, c.m);
  }
};

/* ================================================================== */
/* 7. 畢氏定理                                                         */
/* ================================================================== */

const pythagoras = {
  id: 'math_g8.pythagoras',
  topic: 'math.g8.pythagoras.basic',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const pool = difficulty === 'basic' ? PYTHAGOREAN_TRIPLES.slice(0, 4) : PYTHAGOREAN_TRIPLES;
    const [a0, b0, c0] = pick(pool, rng);
    const scale = difficulty === 'gifted' ? ri(1, 4, rng) : 1;
    const a = a0 * scale, b = b0 * scale, c = c0 * scale;

    const findHyp = difficulty !== 'gifted' ? rng() < 0.6 : rng() < 0.4;

    if (findHyp) {
      return calc({
        stem: `直角三角形的兩股長分別為 ${a} 與 ${b}，求斜邊長。`,
        answer: { value: c, tolerance: 0.01, unit: null },
        steps: [
          { expr: `a^{2} + b^{2} = c^{2}`, why: '畢氏定理：兩股的平方和等於斜邊的平方。' },
          { expr: `${a}^{2} + ${b}^{2} = ${a * a} + ${b * b} = ${a * a + b * b}`, why: '先算出兩股平方和。' },
          { expr: `c = \\sqrt{${a * a + b * b}} = ${c}`, why: `${a * a + b * b} 是 ${c} 的平方。` }
        ],
        topic: this.topic, subject: SUB, difficulty,
        est: difficulty === 'gifted' ? 120 : 90,
        gen: { id: this.id, check: { a, b, c, ask: 'c' } }
      });
    }

    const known = rng() < 0.5 ? a : b;
    const other = known === a ? b : a;
    return calc({
      stem: `直角三角形的斜邊長為 ${c}，一股長為 ${known}，求另一股長。`,
      answer: { value: other, tolerance: 0.01 },
      steps: [
        { expr: `a^{2} + b^{2} = c^{2}`, why: '畢氏定理。' },
        { expr: `x^{2} = ${c}^{2} - ${known}^{2} = ${c * c} - ${known * known} = ${other * other}`,
          why: '要求的是股，所以用斜邊的平方減去已知股的平方。' },
        { expr: `x = \\sqrt{${other * other}} = ${other}`, why: '開平方得另一股。' }
      ],
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'gifted' ? 130 : 100,
      gen: { id: this.id, check: { a, b, c, ask: 'leg', known, answer: other } }
    });
  },

  /** 驗算：三邊必須滿足 a²+b²=c²，且答案與題目要求的那一邊一致 */
  verify(q) {
    const { a, b, c, ask } = q.gen.check;
    if (a * a + b * b !== c * c) return false;
    const want = ask === 'c' ? c : q.gen.check.answer;
    return Math.abs(q.answer.value - want) < 1e-9;
  }
};

/* ================================================================== */
/* 8. 一元二次方程式（因式分解法）                                      */
/* ================================================================== */

const quadFactoring = {
  id: 'math_g8.quad_factoring',
  topic: 'math.g8.quad.factoring',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    // 根為 r1, r2；方程式 (x - r1)(x - r2) = 0 → x² - (r1+r2)x + r1r2 = 0
    let r1, r2;
    if (difficulty === 'basic') {
      r1 = ri(1, 6, rng); r2 = ri(1, 6, rng);
    } else if (difficulty === 'advanced') {
      r1 = ri(1, 9, rng); r2 = -ri(1, 9, rng);
    } else {
      r1 = ri(2, 12, rng) * (rng() < 0.5 ? 1 : -1);
      r2 = ri(2, 12, rng) * (rng() < 0.5 ? 1 : -1);
    }
    if (r1 === r2 && difficulty !== 'basic') r2 = r1 + 1;

    const coeffs = polyMul([-r1, 1], [-r2, 1]);       // [r1r2, -(r1+r2), 1]
    const eq = `${polyToMath(coeffs)} = 0`;
    const roots = [r1, r2].sort((x, y) => x - y);
    const correctText = r1 === r2 ? `x = ${r1}` : `x = ${roots[0]} 或 x = ${roots[1]}`;

    const flip = [-r1, -r2].sort((x, y) => x - y);
    const wrong = pickWrong(correctText, [
      { text: `x = ${flip[0]} 或 x = ${flip[1]}`,
        why: `符號反了。因式分解成 ${factorText(-r1)}${factorText(-r2)} = 0 之後，` +
             `讓每個括號為零，${factorText(-r1)} = 0 解得 x = ${r1}，不是 ${-r1}。` },
      { text: `x = ${r1} 或 x = ${-r2}`,
        why: '其中一個根的符號錯了。把答案代回原式檢查就會發現不成立。' },
      { text: `x = ${coeffs[1]} 或 x = ${coeffs[0]}`,
        why: '把方程式的係數直接當成答案了。係數要先經過因式分解才能得到根。' },
      { text: `x = ${r1 + r2}`,
        why: '這是兩根之和，不是根本身。一元二次方程式通常有兩個根。' },
      { text: '無實數解',
        why: `這個式子可以因式分解成 ${factorText(-r1)}${factorText(-r2)}，` +
             `代表有實根，不是無解。` }
    ]);

    return mc(rng, {
      stem: `解一元二次方程式：\n${eq}`,
      correct: {
        text: correctText,
        why: `因式分解得 ${factorText(-r1)}${factorText(-r2)} = 0。` +
             `兩數相乘為零，則其中至少一個為零，` +
             `所以 x = ${r1} 或 x = ${r2}。`
      },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 85 : 110,
      gen: { id: this.id, check: { coeffs, roots: [r1, r2] } }
    });
  },

  /** 驗算：把根代回方程式，必須等於零 */
  verify(q) {
    const { coeffs, roots } = q.gen.check;
    return roots.every(r => Math.abs(polyEval(coeffs, r)) < 1e-9);
  }
};

/* ------------------------------------------------------------------ */

/** (ax + b) 的括號內文字 */
function lin(a, b) {
  const av = a === 1 ? 'x' : a === -1 ? '-x' : `${a}x`;
  if (b === 0) return av;
  return `${av} ${b > 0 ? '+' : '-'} ${Math.abs(b)}`;
}

export default [
  multFormula,
  factorCommon,
  factorFormula,
  factorCross,
  sqrtSimplify,
  sqrtOperation,
  pythagoras,
  quadFactoring
];
