/* ===== bank/index.js — 題庫載入與選題 =====
 *
 * 題庫由兩種來源組成：
 *   生成器  程式產生，數量無上限，用於數學與理化計算
 *   靜態題  JSON 檔，用於國文閱讀、英文、社會等需要文本的題目
 *
 * 選題時會避開學生近期做過的題目，並確保每題都通過結構驗證。
 */

import { seeded, ri, shuffle } from '../core.js';
import { DIFFICULTIES } from '../config/scoring.js';
import { validateQuestion } from './validate.js';
import mathG8 from './gen/math_g8.js';
import mathG5 from './gen/math_g5.js';

/* ------------------------------------------------------------------ */
/* 生成器登記                                                          */
/* ------------------------------------------------------------------ */

const GENERATORS = [...mathG8, ...mathG5];

const byId = new Map(GENERATORS.map(g => [g.id, g]));

/** 全部生成器 */
export function allGenerators() {
  return GENERATORS.slice();
}

export function generatorById(id) {
  return byId.get(id) || null;
}

/**
 * 取出符合條件的生成器。
 * @param {object} f { subject, level, topic, difficulty }
 */
export function generatorsFor({ subject, level, topic, difficulty } = {}) {
  return GENERATORS.filter(g => {
    if (subject && g.subject !== subject) return false;
    if (topic && g.topic !== topic) return false;
    if (level && !g.topic.startsWith(`${g.subject}.${level}.`)) return false;
    if (difficulty && !g.levels.includes(difficulty)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 產生單題                                                            */
/* ------------------------------------------------------------------ */

/**
 * 用指定生成器產生一題。
 * 種子會寫進 question.gen.seed，讓同一題可以重現。
 */
export function generateOne(generator, difficulty, seed = ri(1, 2 ** 30)) {
  const rng = seeded(seed);
  const q = generator.generate(difficulty, rng);
  q.gen = { ...(q.gen || {}), id: generator.id, seed };
  return q;
}

/* ------------------------------------------------------------------ */
/* 靜態題庫                                                            */
/* ------------------------------------------------------------------ */

const staticCache = new Map();

/**
 * 載入靜態題庫檔。瀏覽器用 fetch，Node 測試可先用 injectStatic 注入。
 * @param {string} name 例如 'chinese_g8'
 */
export async function loadStatic(name) {
  if (staticCache.has(name)) return staticCache.get(name);
  const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`載入題庫 ${name} 失敗（HTTP ${res.status}）`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data.questions || []);
  staticCache.set(name, list);
  return list;
}

/** 測試用：直接放入靜態題庫，避免 fetch */
export function injectStatic(name, list) {
  staticCache.set(name, list);
}

export function clearStaticCache() {
  staticCache.clear();
}

/* ------------------------------------------------------------------ */
/* 組題                                                                */
/* ------------------------------------------------------------------ */

/**
 * 依條件抽出一批題目。
 *
 * @param {object} opts
 *   subject      科目
 *   level        程度 g8 / g5
 *   difficulty   目前難度階級
 *   budget       時間預算（秒）
 *   topics       指定知識點（複習用），會優先出這些
 *   exclude      要避開的題目鍵（近期做過的）
 *   rng          亂數器
 *   staticPool   靜態題陣列（可選）
 * @returns {{items: object[], seconds: number, warnings: string[]}}
 */
export function pickQuestions(opts) {
  const {
    subject, level, difficulty = 'basic', budget = 1500,
    topics = [], exclude = new Set(), rng = Math.random,
    staticPool = [], stopRatio = 0.9, reviewRatio = 0.4
  } = opts;

  const items = [];
  const warnings = [];
  let seconds = 0;
  let reviewSeconds = 0;
  let reviewCount = 0;

  const keyOf = q => q.id || (q.gen ? `${q.gen.id}:${q.gen.seed}` : JSON.stringify(q.stem).slice(0, 40));

  const tryAdd = (q, isReview = false) => {
    if (!q) return false;
    const errs = validateQuestion(q, q.gen?.id || q.id || '?');
    if (errs.length) { warnings.push(...errs); return false; }
    if (exclude.has(keyOf(q))) return false;
    if (items.some(x => keyOf(x) === keyOf(q))) return false;
    if (isReview) {
      q.is_review = true;          // 記進快照，日後統計複習成效用得到
      reviewSeconds += q.est_seconds;
      reviewCount++;
    }
    items.push(q);
    seconds += q.est_seconds;
    return true;
  };

  /* --- 第一步：複習題優先，但不超過預算的 reviewRatio --- */
  const reviewBudget = budget * reviewRatio;
  for (const topic of topics) {
    if (reviewSeconds >= reviewBudget) break;
    const q = pickForTopic({ topic, subject, level, difficulty, rng, staticPool, exclude });
    if (q) tryAdd(q, true);
  }

  /* --- 第二步：用當前難度的新題填滿剩餘預算 --- */
  const gens = generatorsFor({ subject, level, difficulty });
  const statics = staticPool.filter(q =>
    q.subject === subject &&
    q.difficulty === difficulty &&
    !exclude.has(keyOf(q))
  );

  const stopAt = budget * stopRatio;
  let guard = 0;

  while (seconds < stopAt && guard++ < 200) {
    const useStatic = statics.length > 0 && (gens.length === 0 || rng() < 0.4);
    let q = null;

    if (useStatic) {
      const pool = statics.filter(x => !items.some(y => keyOf(y) === keyOf(x)));
      if (pool.length) q = pool[Math.floor(rng() * pool.length)];
    }
    if (!q && gens.length) {
      const g = gens[Math.floor(rng() * gens.length)];
      try {
        q = generateOne(g, difficulty, ri(1, 2 ** 30, rng));
      } catch (err) {
        // 生成器出錯時記錄並跳過，不讓整堂課失敗（需求 5.2）
        warnings.push(`生成器 ${g.id} 出錯：${err.message}`);
        continue;
      }
    }
    if (!q) break;

    // 超出上限就不要硬塞
    if (seconds + q.est_seconds > budget) {
      if (items.length === 0) tryAdd(q);      // 至少要有一題
      break;
    }
    tryAdd(q);
  }

  return { items, seconds, reviewSeconds, reviewCount, warnings };
}

/** 針對單一知識點取一題，複習時使用 */
function pickForTopic({ topic, subject, level, difficulty, rng, staticPool, exclude }) {
  // 優先用同知識點的生成器產新題（需求 11.6）
  const gens = generatorsFor({ topic, difficulty });
  if (gens.length) {
    const g = gens[Math.floor(rng() * gens.length)];
    try {
      return generateOne(g, difficulty, ri(1, 2 ** 30, rng));
    } catch { /* 落到靜態題 */ }
  }
  // 其次用同知識點的靜態題
  const pool = staticPool.filter(q => q.topic === topic && !exclude.has(q.id));
  if (pool.length) return pool[Math.floor(rng() * pool.length)];
  return null;
}

/* ------------------------------------------------------------------ */
/* 統計                                                                */
/* ------------------------------------------------------------------ */

/** 題庫涵蓋範圍摘要，供管理者檢視 */
export function coverage() {
  const out = {};
  for (const g of GENERATORS) {
    const [subject, level] = g.topic.split('.');
    const key = `${subject}.${level}`;
    out[key] = out[key] || { generators: 0, topics: new Set(), difficulties: new Set() };
    out[key].generators++;
    out[key].topics.add(g.topic);
    g.levels.forEach(l => out[key].difficulties.add(l));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, {
    generators: v.generators,
    topics: v.topics.size,
    difficulties: [...v.difficulties].sort((a, b) => DIFFICULTIES.indexOf(a) - DIFFICULTIES.indexOf(b))
  }]));
}
