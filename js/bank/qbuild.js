/* ===== bank/qbuild.js — 題目建構輔助 =====
 *
 * 統一產生題目快照的結構，讓生成器只需專注在數學內容。
 * 題目結構見 design 文件的「題目快照結構」。
 */

import { shuffle } from '../core.js';
import { BASE_POINTS } from '../config/scoring.js';

/** 選項標號 */
export const LETTERS = 'ABCDEFGH';

/**
 * 單選題。
 * @param {Function} rng 亂數器，用於打亂選項順序（可重現）
 * @param {object} spec
 *   stem        題幹（可含數學標記）
 *   correct     { text, why } 正解與其成立理由
 *   wrong       [{ text, why }] 每個錯誤選項都要說明錯在哪裡
 *   topic, subject, difficulty, est
 *   gen         { id, seed, check? } 生成資訊與驗算資料
 */
export function mc(rng, spec) {
  /* chk 是選項的結構化驗算資料（例如這個選項展開後的多項式係數）。
   * 它會隨著選項一起被打亂，因此 verify() 可以逐一檢查每個選項，
   * 抓出「寫法不同但數學上等價」的假干擾項。 */
  const opts = [
    { text: spec.correct.text, why: spec.correct.why, correct: true, ...pickChk(spec.correct) },
    ...spec.wrong.map(w => ({ text: w.text, why: w.why, correct: false, ...pickChk(w) }))
  ];
  shuffle(opts, rng);
  return base(spec, {
    type: 'mc',
    stem: spec.stem,
    options: opts
  });
}

/** 多選題。correct 為陣列。 */
export function mmc(rng, spec) {
  const opts = [
    ...spec.correct.map(c => ({ text: c.text, why: c.why, correct: true, ...pickChk(c) })),
    ...spec.wrong.map(w => ({ text: w.text, why: w.why, correct: false, ...pickChk(w) }))
  ];
  shuffle(opts, rng);
  return base(spec, {
    type: 'mmc',
    stem: spec.stem,
    options: opts
  });
}

/**
 * 計算題。
 * @param {object} spec
 *   answer  { value, tolerance?, unit?, form? } 或 { accept: [...] }
 *   steps   [{ expr, why }] 分步驟推導（需求 6.3）
 */
export function calc(spec) {
  return base(spec, {
    type: 'calc',
    stem: spec.stem,
    answer: {
      form: spec.answer.form || 'number',
      value: spec.answer.value,
      accept: spec.answer.accept,
      tolerance: spec.answer.tolerance ?? 1e-6,
      unit: spec.answer.unit || null
    },
    steps: spec.steps
  });
}

/**
 * 填空題。
 * @param {object} spec
 *   answer { accept: [...可接受的寫法], strict? }
 *   steps  分步驟說明
 */
export function fill(spec) {
  return base(spec, {
    type: 'fill',
    stem: spec.stem,
    answer: {
      accept: spec.answer.accept,
      strict: !!spec.answer.strict,
      exact: !!spec.answer.exact,     // 要求特定寫法（例如最簡分數）
      unit: spec.answer.unit || null
    },
    steps: spec.steps
  });
}

/** 作文題 */
export function essay(spec) {
  return base(spec, {
    type: 'essay',
    stem: spec.stem,
    prompt: spec.prompt,
    min_words: spec.min_words,
    rubric: spec.rubric,
    sample: spec.sample
  });
}

/** 簡答題 */
export function short(spec) {
  return base(spec, {
    type: 'short',
    stem: spec.stem,
    rubric: spec.rubric,
    reference: spec.reference
  });
}

/** 補上所有題型共用的欄位 */
function base(spec, body) {
  const q = {
    ...body,
    topic: spec.topic,
    subject: spec.subject,
    difficulty: spec.difficulty,
    est_seconds: spec.est,
    base_points: BASE_POINTS[body.type]
  };
  if (spec.gen) q.gen = spec.gen;
  if (spec.id) q.id = spec.id;
  if (spec.hint) q.hint = spec.hint;
  return q;
}

/* ------------------------------------------------------------------ */
/* 數學標記小工具                                                      */
/* ------------------------------------------------------------------ */

export const m = {
  frac: (a, b) => `\\frac{${a}}{${b}}`,
  sqrt: n => `\\sqrt{${n}}`,
  root: (k, n) => `\\sqrt[${k}]{${n}}`,
  pow: (a, b) => `${a}^{${b}}`,
  sq: a => `${a}^{2}`,
  times: ' \\times ',
  div: ' \\div ',
  pm: ' \\pm ',
  deg: '\\deg',
  seg: ab => `\\overline{${ab}}`,
  tri: abc => `\\triangle ${abc}`,
  /** k√m，k 為 1 時省略 */
  ksqrt: (k, mm) => (mm === 1 ? `${k}` : k === 1 ? `\\sqrt{${mm}}` : `${k}\\sqrt{${mm}}`)
};

/** 帶正負號的顯示，用於「+ 3」「- 3」 */
export function signed(n) {
  return n < 0 ? `- ${Math.abs(n)}` : `+ ${n}`;
}

/** (x + p) 這種括號因式 */
export function factorText(p, v = 'x') {
  if (p === 0) return v;
  return `(${v} ${p > 0 ? '+' : '-'} ${Math.abs(p)})`;
}

/**
 * 從候選干擾項中挑出 n 個，排除與正解重複或彼此重複的。
 * 候選不足時直接丟出例外——這代表生成器在某些參數下會產生重複選項，
 * 是必須修掉的 bug，讓一千次生成測試立刻抓到，而不是默默出一題壞題。
 */
export function pickWrong(correctText, candidates, n = 3) {
  const seen = new Set([norm(correctText)]);
  const out = [];
  for (const c of candidates) {
    const key = norm(c.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === n) return out;
  }
  throw new Error(
    `干擾選項不足：需要 ${n} 個，實際只有 ${out.length} 個。` +
    `正解「${correctText}」，候選 ${candidates.map(c => c.text).join(' / ')}`
  );
}

const norm = s => String(s).replace(/\s+/g, '');

const pickChk = spec => (spec.chk === undefined ? {} : { chk: spec.chk });
