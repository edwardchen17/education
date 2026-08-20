/* ===== bank/gen/math_g5.js — 小五數學生成器 =====
 *
 * 難度設定高於小五課綱基準（需求 4.5）。
 * 每個生成器都提供 verify()，且驗算刻意走與出題不同的路徑：
 * 小數乘除用整數運算驗算，避免浮點誤差被當成正確答案。
 */

import { ri, pick, gcd } from '../../core.js';
import { mc, calc, fill, m, pickWrong } from '../qbuild.js';
import {
  gcdBrute, lcmBrute, frac, fracAdd, fracSub, fracToMath, fracToText, fracVal
} from '../poly.js';

const SUB = 'math';

/* ================================================================== */
/* 1. 最大公因數與最小公倍數                                           */
/* ================================================================== */

const gcdLcm = {
  id: 'math_g5.gcd_lcm',
  topic: 'math.g5.factor.gcd',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const hi = difficulty === 'basic' ? 30 : difficulty === 'advanced' ? 60 : 120;
    let a, b;
    do {
      a = ri(6, hi, rng);
      b = ri(6, hi, rng);
    } while (a === b || gcdBrute(a, b) === 1);      // 避免互質，太簡單

    const askGcd = rng() < 0.5;
    const g = gcdBrute(a, b);
    const l = lcmBrute(a, b);

    if (askGcd) {
      return calc({
        stem: `求 ${a} 與 ${b} 的最大公因數。`,
        answer: { value: g, tolerance: 0 },
        steps: [
          { expr: `${a} = ${factorLine(a)}`, why: '先把兩個數各自分解成質因數的乘積。' },
          { expr: `${b} = ${factorLine(b)}`, why: '' },
          { expr: `最大公因數 = ${g}`, why: '取兩邊都有的質因數，次方取較小的，全部相乘。' }
        ],
        topic: 'math.g5.factor.gcd', subject: SUB, difficulty,
        est: difficulty === 'basic' ? 70 : 100,
        gen: { id: this.id, check: { a, b, kind: 'gcd', answer: g } }
      });
    }

    return calc({
      stem: `求 ${a} 與 ${b} 的最小公倍數。`,
      answer: { value: l, tolerance: 0 },
      steps: [
        { expr: `${a} = ${factorLine(a)}`, why: '先分解質因數。' },
        { expr: `${b} = ${factorLine(b)}`, why: '' },
        { expr: `最小公倍數 = ${l}`, why: '所有出現過的質因數都要取，次方取較大的。' },
        { expr: `檢查：${l} \\div ${a} = ${l / a}，${l} \\div ${b} = ${l / b}`,
          why: '最小公倍數必須能同時被兩個數整除。' }
      ],
      topic: 'math.g5.factor.lcm', subject: SUB, difficulty,
      est: difficulty === 'basic' ? 80 : 110,
      gen: { id: this.id, check: { a, b, kind: 'lcm', answer: l } }
    });
  },

  /** 驗算：用暴力法從 1 逐個試，與質因數分解法無關 */
  verify(q) {
    const { a, b, kind, answer } = q.gen.check;
    if (kind === 'gcd') {
      if (a % answer !== 0 || b % answer !== 0) return false;      // 必須是公因數
      for (let d = answer + 1; d <= Math.min(a, b); d++) {          // 必須是最大的
        if (a % d === 0 && b % d === 0) return false;
      }
    } else {
      if (answer % a !== 0 || answer % b !== 0) return false;       // 必須是公倍數
      for (let mm = Math.max(a, b); mm < answer; mm++) {            // 必須是最小的
        if (mm % a === 0 && mm % b === 0) return false;
      }
    }
    return Math.abs(q.answer.value - answer) < 1e-9;
  }
};

function factorLine(n) {
  const parts = [];
  let x = n;
  for (let p = 2; p * p <= x; p++) {
    while (x % p === 0) { parts.push(p); x /= p; }
  }
  if (x > 1) parts.push(x);
  return parts.join(' \\times ');
}

/* ================================================================== */
/* 2. 異分母分數加減                                                   */
/* ================================================================== */

const fracAddSub = {
  id: 'math_g5.frac_add_sub',
  topic: 'math.g5.frac.add_sub',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const dMax = difficulty === 'basic' ? 9 : difficulty === 'advanced' ? 12 : 20;
    let d1, d2;
    do {
      d1 = ri(2, dMax, rng);
      d2 = ri(2, dMax, rng);
    } while (d1 === d2 || gcd(d1, d2) === Math.min(d1, d2) && difficulty === 'gifted');

    const n1 = ri(1, d1 - 1, rng);
    const n2 = ri(1, d2 - 1, rng);
    const f1 = frac(n1, d1), f2 = frac(n2, d2);

    const plus = rng() < 0.55;
    const res = plus ? fracAdd(f1, f2) : fracSub(f1, f2);
    if (!plus && res.n <= 0) return this.generate(difficulty, rng);   // 小五不做負數

    const lcd = lcmBrute(d1, d2);
    const accept = [fracToText(res)];
    if (res.d === 1) accept.push(String(res.n));
    if (Math.abs(res.n) > res.d && res.d !== 1) {
      const whole = Math.floor(res.n / res.d);
      accept.push(`${whole} ${res.n % res.d}/${res.d}`);
      accept.push(`${whole}又${res.n % res.d}/${res.d}`);
    }

    return fill({
      stem: `計算下式，答案請化為最簡分數：<br>` +
            `${fracToMath(f1)} ${plus ? '+' : '-'} ${fracToMath(f2)}`,
      answer: { accept, exact: true },
      steps: [
        { expr: `${d1} 與 ${d2} 的最小公倍數是 ${lcd}`, why: '異分母分數要先通分，公分母取最小公倍數。' },
        { expr: `${fracToMath(f1)} = ${m.frac(n1 * (lcd / d1), lcd)}，` +
                `${fracToMath(f2)} = ${m.frac(n2 * (lcd / d2), lcd)}`,
          why: '分子分母同乘相同的數，分數大小不變。' },
        { expr: `${m.frac(n1 * (lcd / d1), lcd)} ${plus ? '+' : '-'} ${m.frac(n2 * (lcd / d2), lcd)} = ` +
                `${m.frac(plus ? n1 * (lcd / d1) + n2 * (lcd / d2) : n1 * (lcd / d1) - n2 * (lcd / d2), lcd)}`,
          why: '分母相同時，分子直接相加減。' },
        { expr: `= ${fracToMath(res)}`, why: '最後約分到最簡分數。' }
      ],
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 90 : 120,
      gen: { id: this.id, check: { n1, d1, n2, d2, plus, res } }
    });
  },

  /** 驗算：用交叉相乘的整數運算重算一次，不經過浮點數 */
  verify(q) {
    const { n1, d1, n2, d2, plus, res } = q.gen.check;
    const num = plus ? n1 * d2 + n2 * d1 : n1 * d2 - n2 * d1;
    const den = d1 * d2;
    // res 必須與 num/den 相等（交叉相乘比較，全整數）
    if (res.n * den !== num * res.d) return false;
    // 必須已化到最簡
    if (gcdBrute(Math.abs(res.n), res.d) !== 1) return false;
    if (res.d <= 0) return false;
    return q.answer.accept.includes(fracToText(res));
  }
};

/* ================================================================== */
/* 3. 小數乘除                                                         */
/* ================================================================== */

const decimalOps = {
  id: 'math_g5.decimal_ops',
  topic: 'math.g5.decimal.mult',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const mult = rng() < 0.55;

    if (mult) {
      // 以整數建構，避免浮點誤差
      const dp1 = difficulty === 'basic' ? 1 : ri(1, 2, rng);
      const dp2 = difficulty === 'gifted' ? ri(1, 2, rng) : 1;
      const i1 = ri(11, difficulty === 'basic' ? 99 : 999, rng);
      const i2 = ri(11, difficulty === 'basic' ? 49 : 199, rng);
      const a = i1 / 10 ** dp1;
      const b = i2 / 10 ** dp2;
      const prodInt = i1 * i2;
      const prodDp = dp1 + dp2;
      const answer = prodInt / 10 ** prodDp;

      return calc({
        stem: `計算：${fmt(a)} \\times ${fmt(b)}`,
        answer: { value: answer, tolerance: 1e-9 },
        steps: [
          { expr: `${i1} \\times ${i2} = ${prodInt}`, why: '先不管小數點，當成整數相乘。' },
          { expr: `兩個數的小數位數共 ${dp1} + ${dp2} = ${prodDp} 位`, why: '積的小數位數等於兩個因數的小數位數之和。' },
          { expr: `答案 = ${fmt(answer)}`, why: `從 ${prodInt} 的右邊往左數 ${prodDp} 位點上小數點。` }
        ],
        topic: 'math.g5.decimal.mult', subject: SUB, difficulty,
        est: difficulty === 'basic' ? 80 : 110,
        gen: { id: this.id, check: { kind: 'mult', i1, i2, dp1, dp2, answer } }
      });
    }

    // 除法：先決定商與除數，再乘出被除數，保證整除
    const dp = difficulty === 'basic' ? 1 : ri(1, 2, rng);
    const divisorInt = ri(2, difficulty === 'basic' ? 9 : 25, rng);
    const quotInt = ri(11, difficulty === 'basic' ? 99 : 499, rng);
    const dividendInt = divisorInt * quotInt;
    const dividend = dividendInt / 10 ** dp;
    const answer = quotInt / 10 ** dp;

    return calc({
      stem: `計算：${fmt(dividend)} \\div ${divisorInt}`,
      answer: { value: answer, tolerance: 1e-9 },
      steps: [
        { expr: `${dividendInt} \\div ${divisorInt} = ${quotInt}`, why: '先把被除數當成整數來除。' },
        { expr: `被除數有 ${dp} 位小數，除數是整數`, why: '除數是整數時，商的小數位數與被除數相同。' },
        { expr: `答案 = ${fmt(answer)}`, why: '在商的相同位置點上小數點。' }
      ],
      topic: 'math.g5.decimal.div', subject: SUB, difficulty,
      est: difficulty === 'basic' ? 85 : 115,
      gen: { id: this.id, check: { kind: 'div', dividendInt, divisorInt, dp, answer } }
    });
  },

  /** 驗算：全部用整數運算檢查，不依賴浮點乘除 */
  verify(q) {
    const c = q.gen.check;
    if (c.kind === 'mult') {
      const expectInt = c.i1 * c.i2;
      const gotInt = Math.round(c.answer * 10 ** (c.dp1 + c.dp2));
      if (expectInt !== gotInt) return false;
    } else {
      const gotInt = Math.round(c.answer * 10 ** c.dp);
      if (gotInt * c.divisorInt !== c.dividendInt) return false;    // 乘回去必須還原
    }
    return Math.abs(q.answer.value - c.answer) < 1e-9;
  }
};

function fmt(v) {
  return String(Number(v.toFixed(6)));
}

/* ================================================================== */
/* 4. 多邊形面積                                                       */
/* ================================================================== */

const areaPoly = {
  id: 'math_g5.area_poly',
  topic: 'math.g5.area.triangle',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const kind = difficulty === 'basic'
      ? pick(['triangle', 'parallelogram'], rng)
      : pick(['triangle', 'parallelogram', 'trapezoid'], rng);
    const hi = difficulty === 'basic' ? 20 : difficulty === 'advanced' ? 40 : 80;

    if (kind === 'triangle') {
      let b = ri(4, hi, rng), h = ri(3, hi, rng);
      if ((b * h) % 2 !== 0) h += 1;                       // 讓面積為整數
      const area = (b * h) / 2;
      return calc({
        stem: `一個三角形的底邊長 ${b} 公分，高 ${h} 公分，求面積（平方公分）。`,
        answer: { value: area, tolerance: 1e-9, unit: '平方公分' },
        steps: [
          { expr: `三角形面積 = 底 \\times 高 \\div 2`, why: '三角形是等底等高平行四邊形的一半。' },
          { expr: `= ${b} \\times ${h} \\div 2 = ${b * h} \\div 2 = ${area}`, why: '' }
        ],
        topic: 'math.g5.area.triangle', subject: SUB, difficulty,
        est: difficulty === 'basic' ? 70 : 95,
        gen: { id: this.id, check: { kind, b, h, area } }
      });
    }

    if (kind === 'parallelogram') {
      const b = ri(4, hi, rng), h = ri(3, hi, rng);
      const area = b * h;
      return calc({
        stem: `一個平行四邊形的底邊長 ${b} 公分，高 ${h} 公分，求面積（平方公分）。`,
        answer: { value: area, tolerance: 1e-9, unit: '平方公分' },
        steps: [
          { expr: `平行四邊形面積 = 底 \\times 高`, why: '把一角剪下移到另一邊，可以拼成長方形。' },
          { expr: `= ${b} \\times ${h} = ${area}`, why: '注意高是垂直距離，不是斜邊長。' }
        ],
        topic: 'math.g5.area.parallelogram', subject: SUB, difficulty,
        est: 70,
        gen: { id: this.id, check: { kind, b, h, area } }
      });
    }

    let a = ri(3, hi, rng), b = ri(3, hi, rng), h = ri(3, hi, rng);
    if (((a + b) * h) % 2 !== 0) h += 1;
    const area = ((a + b) * h) / 2;
    return calc({
      stem: `一個梯形的上底 ${a} 公分、下底 ${b} 公分、高 ${h} 公分，求面積（平方公分）。`,
      answer: { value: area, tolerance: 1e-9, unit: '平方公分' },
      steps: [
        { expr: `梯形面積 = (上底 + 下底) \\times 高 \\div 2`, why: '兩個相同的梯形可以拼成一個平行四邊形。' },
        { expr: `= (${a} + ${b}) \\times ${h} \\div 2 = ${a + b} \\times ${h} \\div 2 = ${area}`, why: '' }
      ],
      topic: 'math.g5.area.trapezoid', subject: SUB, difficulty,
      est: difficulty === 'gifted' ? 110 : 90,
      gen: { id: this.id, check: { kind, a, b, h, area } }
    });
  },

  /** 驗算：用整數乘法檢查，避免除法造成的誤差 */
  verify(q) {
    const c = q.gen.check;
    let ok;
    if (c.kind === 'triangle') ok = 2 * c.area === c.b * c.h;
    else if (c.kind === 'parallelogram') ok = c.area === c.b * c.h;
    else ok = 2 * c.area === (c.a + c.b) * c.h;
    return ok && Math.abs(q.answer.value - c.area) < 1e-9;
  }
};

/* ================================================================== */
/* 5. 長方體體積                                                       */
/* ================================================================== */

const volumeCuboid = {
  id: 'math_g5.volume_cuboid',
  topic: 'math.g5.volume.cuboid',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const hi = difficulty === 'basic' ? 12 : difficulty === 'advanced' ? 25 : 40;
    const l = ri(2, hi, rng), w = ri(2, hi, rng), h = ri(2, hi, rng);

    if (difficulty === 'gifted' && rng() < 0.5) {
      // 反求高
      const v = l * w * h;
      return calc({
        stem: `一個長方體的體積是 ${v} 立方公分，底面是長 ${l} 公分、寬 ${w} 公分的長方形，求高（公分）。`,
        answer: { value: h, tolerance: 1e-9, unit: '公分' },
        steps: [
          { expr: `體積 = 長 \\times 寬 \\times 高`, why: '長方體體積公式。' },
          { expr: `底面積 = ${l} \\times ${w} = ${l * w}`, why: '先算出底面積。' },
          { expr: `高 = ${v} \\div ${l * w} = ${h}`, why: '體積除以底面積就是高。' }
        ],
        topic: this.topic, subject: SUB, difficulty, est: 110,
        gen: { id: this.id, check: { l, w, h, v, ask: 'h' } }
      });
    }

    const v = l * w * h;
    return calc({
      stem: `一個長方體的長 ${l} 公分、寬 ${w} 公分、高 ${h} 公分，求體積（立方公分）。`,
      answer: { value: v, tolerance: 1e-9, unit: '立方公分' },
      steps: [
        { expr: `體積 = 長 \\times 寬 \\times 高`, why: '' },
        { expr: `= ${l} \\times ${w} \\times ${h} = ${l * w} \\times ${h} = ${v}`,
          why: '先算底面積，再乘高。' }
      ],
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 70 : 90,
      gen: { id: this.id, check: { l, w, h, v, ask: 'v' } }
    });
  },

  verify(q) {
    const { l, w, h, v, ask } = q.gen.check;
    if (l * w * h !== v) return false;
    const want = ask === 'v' ? v : h;
    return Math.abs(q.answer.value - want) < 1e-9;
  }
};

/* ================================================================== */
/* 6. 百分率                                                           */
/* ================================================================== */

const percent = {
  id: 'math_g5.percent',
  topic: 'math.g5.percent.basic',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const kind = difficulty === 'basic' ? 'partOf'
               : pick(['partOf', 'whatPercent', 'findWhole'], rng);

    if (kind === 'partOf') {
      const p = pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80], rng);
      const whole = ri(2, difficulty === 'basic' ? 20 : 60, rng) * 20;   // 保證整數結果
      const part = whole * p / 100;
      return calc({
        stem: `${whole} 的 ${p}% 是多少？`,
        answer: { value: part, tolerance: 1e-9 },
        steps: [
          { expr: `${p}\\% = ${m.frac(p, 100)}`, why: '百分之幾就是分母為 100 的分數。' },
          { expr: `${whole} \\times ${m.frac(p, 100)} = ${part}`, why: '求「某數的幾分之幾」用乘法。' }
        ],
        topic: this.topic, subject: SUB, difficulty,
        est: difficulty === 'basic' ? 70 : 90,
        gen: { id: this.id, check: { kind, whole, p, part } }
      });
    }

    if (kind === 'whatPercent') {
      const p = pick([4, 5, 8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 75, 80], rng);
      const whole = ri(2, 25, rng) * 25;
      const part = whole * p / 100;
      return calc({
        stem: `${part} 是 ${whole} 的百分之幾？（答案填數字，例如 25 代表 25%）`,
        answer: { value: p, tolerance: 1e-9 },
        steps: [
          { expr: `${m.frac(part, whole)}`, why: '先寫成「部分 ÷ 全部」的分數。' },
          { expr: `= ${(part / whole).toFixed(2)} = ${p}\\%`, why: '化成小數後乘 100 就是百分率。' }
        ],
        topic: this.topic, subject: SUB, difficulty, est: 100,
        gen: { id: this.id, check: { kind, whole, p, part } }
      });
    }

    const p = pick([10, 20, 25, 40, 50, 75, 80], rng);
    const whole = ri(2, 20, rng) * 20;
    const part = whole * p / 100;
    return calc({
      stem: `某數的 ${p}% 是 ${part}，求這個數。`,
      answer: { value: whole, tolerance: 1e-9 },
      steps: [
        { expr: `某數 \\times ${m.frac(p, 100)} = ${part}`, why: '先把題意寫成算式。' },
        { expr: `某數 = ${part} \\div ${m.frac(p, 100)} = ${part} \\times ${m.frac(100, p)} = ${whole}`,
          why: '已知一部分求全部，用除法。' }
      ],
      topic: this.topic, subject: SUB, difficulty, est: 110,
      gen: { id: this.id, check: { kind, whole, p, part } }
    });
  },

  /** 驗算：用整數交叉相乘檢查 part × 100 = whole × p */
  verify(q) {
    const { kind, whole, p, part } = q.gen.check;
    if (Math.round(part * 100) !== Math.round(whole * p)) return false;
    const want = kind === 'partOf' ? part : kind === 'whatPercent' ? p : whole;
    return Math.abs(q.answer.value - want) < 1e-9;
  }
};

/* ================================================================== */
/* 7. 速率                                                             */
/* ================================================================== */

const speed = {
  id: 'math_g5.speed',
  topic: 'math.g5.speed.basic',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const v = ri(3, difficulty === 'basic' ? 12 : 30, rng) * 5;     // 速率，5 的倍數
    const t = difficulty === 'basic' ? ri(2, 6, rng)
            : pick([0.5, 1.5, 2, 2.5, 3, 4], rng);
    const d = v * t;
    const ask = difficulty === 'basic' ? 'distance' : pick(['distance', 'speed', 'time'], rng);

    if (ask === 'distance') {
      return calc({
        stem: `一輛車以每小時 ${v} 公里的速度行駛 ${fmt(t)} 小時，共行駛多少公里？`,
        answer: { value: d, tolerance: 1e-9, unit: '公里' },
        steps: [
          { expr: `距離 = 速率 \\times 時間`, why: '' },
          { expr: `= ${v} \\times ${fmt(t)} = ${fmt(d)}`, why: '注意時間的單位要與速率一致。' }
        ],
        topic: this.topic, subject: SUB, difficulty,
        est: difficulty === 'basic' ? 80 : 100,
        gen: { id: this.id, check: { v, t, d, ask } }
      });
    }

    if (ask === 'speed') {
      return calc({
        stem: `一輛車行駛 ${fmt(d)} 公里花了 ${fmt(t)} 小時，求平均速率（每小時幾公里）。`,
        answer: { value: v, tolerance: 1e-9, unit: '公里/小時' },
        steps: [
          { expr: `速率 = 距離 \\div 時間`, why: '' },
          { expr: `= ${fmt(d)} \\div ${fmt(t)} = ${v}`, why: '' }
        ],
        topic: this.topic, subject: SUB, difficulty, est: 100,
        gen: { id: this.id, check: { v, t, d, ask } }
      });
    }

    return calc({
      stem: `一輛車以每小時 ${v} 公里的速度行駛 ${fmt(d)} 公里，需要多少小時？`,
      answer: { value: t, tolerance: 1e-9, unit: '小時' },
      steps: [
        { expr: `時間 = 距離 \\div 速率`, why: '' },
        { expr: `= ${fmt(d)} \\div ${v} = ${fmt(t)}`, why: '' }
      ],
      topic: this.topic, subject: SUB, difficulty, est: 105,
      gen: { id: this.id, check: { v, t, d, ask } }
    });
  },

  /** 驗算：三者關係必須成立，且答案對應題目問的那一項 */
  verify(q) {
    const { v, t, d, ask } = q.gen.check;
    if (Math.abs(v * t - d) > 1e-9) return false;
    const want = ask === 'distance' ? d : ask === 'speed' ? v : t;
    return Math.abs(q.answer.value - want) < 1e-9;
  }
};

/* ================================================================== */
/* 8. 分數比較（選擇題，練習通分概念）                                  */
/* ================================================================== */

const fracCompare = {
  id: 'math_g5.frac_compare',
  topic: 'math.g5.frac.compare',
  subject: SUB,
  levels: ['basic', 'advanced', 'gifted'],

  generate(difficulty, rng) {
    const dMax = difficulty === 'basic' ? 9 : difficulty === 'advanced' ? 15 : 24;
    const list = [];
    let guard = 0;
    while (list.length < 4 && guard++ < 200) {
      const d = ri(2, dMax, rng);
      const n = ri(1, d - 1, rng);
      const f = frac(n, d);
      if (list.some(x => Math.abs(fracVal(x) - fracVal(f)) < 1e-9)) continue;
      if (list.some(x => x.n === f.n && x.d === f.d)) continue;
      list.push(f);
    }
    if (list.length < 4) return this.generate('basic', rng);

    const askMax = rng() < 0.5;
    const sorted = [...list].sort((a, b) => fracVal(a) - fracVal(b));
    const target = askMax ? sorted[sorted.length - 1] : sorted[0];
    const lcd = list.reduce((acc, f) => lcmBrute(acc, f.d), 1);

    const wrong = pickWrong(fracToMath(target),
      list.filter(f => f !== target).map(f => ({
        text: fracToMath(f),
        why: `通分後 ${fracToMath(f)} = ${m.frac(f.n * (lcd / f.d), lcd)}，` +
             `分子 ${f.n * (lcd / f.d)} ${askMax ? '小於' : '大於'} ` +
             `${target.n * (lcd / target.d)}，所以不是${askMax ? '最大' : '最小'}的。`
      })));

    return mc(rng, {
      stem: `下列分數中，哪一個${askMax ? '最大' : '最小'}？`,
      correct: {
        text: fracToMath(target),
        why: `把四個分數通分成分母 ${lcd}：` +
             list.map(f => `${fracToMath(f)} = ${m.frac(f.n * (lcd / f.d), lcd)}`).join('、') +
             `。分子${askMax ? '最大' : '最小'}的是 ${target.n * (lcd / target.d)}，` +
             `所以 ${fracToMath(target)} ${askMax ? '最大' : '最小'}。`
      },
      wrong,
      topic: this.topic, subject: SUB, difficulty,
      est: difficulty === 'basic' ? 80 : 105,
      gen: { id: this.id, check: { list, target, askMax } }
    });
  },

  /** 驗算：把所有分數轉為精確有理數比較，確認選出的真的是最大或最小 */
  verify(q) {
    const { list, target, askMax } = q.gen.check;
    for (const f of list) {
      if (f.n === target.n && f.d === target.d) continue;
      // 交叉相乘比較，全整數
      const cmp = target.n * f.d - f.n * target.d;
      if (askMax && cmp <= 0) return false;
      if (!askMax && cmp >= 0) return false;
    }
    const correct = q.options.find(o => o.correct);
    return correct && correct.text === fracToMath(target);
  }
};

export default [
  gcdLcm,
  fracAddSub,
  decimalOps,
  areaPoly,
  volumeCuboid,
  percent,
  speed,
  fracCompare
];
