/* ===== bank/poly.js — 多項式與數論工具 =====
 *
 * 這個檔案的存在目的是讓生成器的答案能被「獨立驗算」（Property 14）。
 *
 * 做法：生成器用代數公式算出答案（例如記憶中的 (a+b)^2 = a^2+2ab+b^2），
 * 驗算則走完全不同的路徑（多項式係數摺積），兩者結果必須一致。
 * 若生成器把公式記錯，摺積會抓到。
 *
 * 多項式一律表示為係數陣列，索引 = 次方：[c0, c1, c2] 代表 c0 + c1x + c2x^2
 */

import { gcd } from '../core.js';

/* ------------------------------------------------------------------ */
/* 多項式                                                              */
/* ------------------------------------------------------------------ */

/** 相乘。以摺積實作，與展開公式無關。 */
export function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] += a[i] * b[j];
    }
  }
  return trim(out);
}

export function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
  return trim(out);
}

export function polyScale(a, k) {
  return trim(a.map(c => c * k));
}

/** 在 x 處求值（Horner 法） */
export function polyEval(coeffs, x) {
  let v = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) v = v * x + coeffs[i];
  return v;
}

/** 去掉最高次的零係數 */
export function trim(a) {
  const out = a.slice();
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

/** 兩多項式是否相等 */
export function polyEq(a, b) {
  const x = trim(a), y = trim(b);
  return x.length === y.length && x.every((c, i) => Math.abs(c - y[i]) < 1e-9);
}

/**
 * 在多個點求值比較，這是最不依賴代數推導的驗算方式。
 * 用於確認「原式」與「答案式」是同一個多項式。
 */
export function polyIdentical(a, b, points = [-3, -2, -1, 0, 1, 2, 3, 5]) {
  return points.every(x => Math.abs(polyEval(a, x) - polyEval(b, x)) < 1e-9);
}

/**
 * 轉成數學標記字串，例如 [9, 12, 4] → 4x^2 + 12x + 9
 * @param {number[]} coeffs
 * @param {string} v 變數名稱
 */
export function polyToMath(coeffs, v = 'x') {
  const parts = [];
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    if (c === 0) continue;
    const abs = Math.abs(c);
    let term;
    if (i === 0) term = `${abs}`;
    else {
      const coefStr = abs === 1 ? '' : `${abs}`;
      term = i === 1 ? `${coefStr}${v}` : `${coefStr}${v}^{${i}}`;
    }
    parts.push({ sign: c < 0 ? '-' : '+', term });
  }
  if (!parts.length) return '0';
  let s = (parts[0].sign === '-' ? '-' : '') + parts[0].term;
  for (let i = 1; i < parts.length; i++) s += ` ${parts[i].sign} ${parts[i].term}`;
  return s;
}

/** 一次式 (ax + b) 的顯示，會處理 a=1 與 b 的正負號 */
export function linearToMath(a, b, v = 'x') {
  const av = a === 1 ? '' : a === -1 ? '-' : `${a}`;
  if (b === 0) return `${av}${v}`;
  return `${av}${v} ${b > 0 ? '+' : '-'} ${Math.abs(b)}`;
}

/* ------------------------------------------------------------------ */
/* 數論                                                                */
/* ------------------------------------------------------------------ */

export function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

/** 以暴力法求最大公因數，用於驗算 gcd 的結果 */
export function gcdBrute(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  let best = 1;
  for (let d = 1; d <= Math.min(a, b); d++) {
    if (a % d === 0 && b % d === 0) best = d;
  }
  return best;
}

/** 以暴力法求最小公倍數 */
export function lcmBrute(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  for (let m = Math.max(a, b); m <= a * b; m++) {
    if (m % a === 0 && m % b === 0) return m;
  }
  return a * b;
}

/** 質因數分解，回傳 { 質數: 次數 } */
export function factorize(n) {
  n = Math.abs(n);
  const out = {};
  for (let p = 2; p * p <= n; p++) {
    while (n % p === 0) { out[p] = (out[p] || 0) + 1; n /= p; }
  }
  if (n > 1) out[n] = (out[n] || 0) + 1;
  return out;
}

/** 是否為完全平方數 */
export function isPerfectSquare(n) {
  if (n < 0) return false;
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}

/**
 * 把 √n 化為 k√m 的形式，m 為無平方因子。
 * @returns {{k:number, m:number}}
 */
export function simplifySqrt(n) {
  let k = 1, m = n;
  for (let p = 2; p * p <= m; p++) {
    while (m % (p * p) === 0) { m /= p * p; k *= p; }
  }
  return { k, m };
}

/** m 是否無平方因子（用於驗算根式化簡是否化到底） */
export function isSquareFree(m) {
  for (let p = 2; p * p <= m; p++) {
    if (m % (p * p) === 0) return false;
  }
  return true;
}

/** 常見的畢氏三元數，用於產生整數邊長的直角三角形 */
export const PYTHAGOREAN_TRIPLES = [
  [3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25],
  [20, 21, 29], [9, 40, 41], [12, 35, 37], [11, 60, 61],
  [28, 45, 53], [33, 56, 65], [16, 63, 65], [48, 55, 73]
];

/* ------------------------------------------------------------------ */
/* 分數（精確有理數運算，避免浮點誤差）                                 */
/* ------------------------------------------------------------------ */

/** 建立化簡後的分數 */
export function frac(num, den) {
  if (den === 0) throw new Error('分母不可為零');
  const sign = den < 0 ? -1 : 1;
  num *= sign; den *= sign;
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

export function fracAdd(a, b) { return frac(a.n * b.d + b.n * a.d, a.d * b.d); }
export function fracSub(a, b) { return frac(a.n * b.d - b.n * a.d, a.d * b.d); }
export function fracMul(a, b) { return frac(a.n * b.n, a.d * b.d); }
export function fracDiv(a, b) { return frac(a.n * b.d, a.d * b.n); }
export function fracEq(a, b)  { return a.n * b.d === b.n * a.d; }
export function fracVal(a)    { return a.n / a.d; }

/** 分數的數學標記。整數與帶分數會做適當處理。 */
export function fracToMath(f, mixed = false) {
  if (f.d === 1) return `${f.n}`;
  if (!mixed || Math.abs(f.n) < f.d) {
    return f.n < 0 ? `-\\frac{${-f.n}}{${f.d}}` : `\\frac{${f.n}}{${f.d}}`;
  }
  const sign = f.n < 0 ? '-' : '';
  const a = Math.abs(f.n);
  const whole = Math.floor(a / f.d);
  const rest = a % f.d;
  return rest === 0 ? `${sign}${whole}` : `${sign}${whole}\\frac{${rest}}{${f.d}}`;
}

/** 分數的純文字，用於 accept 清單 */
export function fracToText(f) {
  return f.d === 1 ? `${f.n}` : `${f.n}/${f.d}`;
}
