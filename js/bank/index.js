/* ===== bank/index.js — 題庫載入與選題 =====
 *
 * 題庫由兩種來源組成：
 *   生成器  程式產生，數量無上限，用於數學與理化計算
 *   靜態題  JSON 檔，用於國文閱讀、英文、社會等需要文本的題目
 *
 * 選題時會避開學生近期做過的題目，並確保每題都通過結構驗證。
 */

import { seeded, ri, shuffle } from '../core.js';
import { DIFFICULTIES, LESSON } from '../config/scoring.js';

/** 一堂課的下限時長（需求 7.1）。低於此值會產生警告，提醒題庫需要補充。 */
const LESSON_MIN_SECONDS = LESSON.minMinutes * 60;
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

/** 各科目與程度對應的靜態題庫檔名。沒有列出的科目表示還沒有靜態題庫。 */
export const STATIC_FILES = {
  chinese: { g8: 'chinese_g8', g5: 'chinese_g5' }
};

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

/**
 * 取得某科目某程度的靜態題庫。沒有對應檔案時回傳空陣列。
 * 載入失敗時也回傳空陣列，讓課堂改用生成題撐過去，不要整堂課失敗。
 */
export async function loadPool(subject, level) {
  const name = STATIC_FILES[subject]?.[level];
  if (!name) return [];
  try {
    return await loadStatic(name);
  } catch (err) {
    console.warn('[bank] 靜態題庫載入失敗，改用生成題：', err.message);
    return [];
  }
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

  /* --- 第二步：作文要刻意安排，不能靠隨機抽中 --- */
  const gens = generatorsFor({ subject, level, difficulty });

  const isWriting = q => q.type === 'essay' || q.type === 'short';
  const mine = staticPool.filter(q => q.subject === subject && !exclude.has(keyOf(q)));
  const essayPool = mine.filter(isWriting);
  const itemPool = mine.filter(q => !isWriting(q));

  let statics = itemPool.filter(q => q.difficulty === difficulty);

  /* 靜態題庫是人工撰寫的，某個難度的題量可能不足。
   * 若該難度的總時長撐不到預算的一半，就把其他難度一起納入，
   * 否則國文這類科目會組不出一堂完整的課。 */
  const available = statics.reduce((s, q) => s + q.est_seconds, 0);
  if (available < budget * 0.5) statics = itemPool;

  /* 作文佔掉大半預算，必須先決定這堂課要不要寫作，再用短題補滿剩下的時間
   * （需求 7.2）。若讓作文和其他題目一起隨機抽，抽到作文時預算會瞬間爆掉。 */
  const wantEssay = opts.includeEssay === undefined
    ? (essayPool.length > 0 && rng() < 0.35)
    : !!opts.includeEssay;

  if (wantEssay) {
    const cand = essayPool.filter(q => q.est_seconds <= budget * 0.9);
    if (cand.length) tryAdd(cand[Math.floor(rng() * cand.length)]);
  }

  const stopAt = budget * stopRatio;
  let miss = 0;

  while (seconds < stopAt && miss < 30) {
    const useStatic = statics.length > 0 && (gens.length === 0 || rng() < 0.5);
    let q = null;

    if (useStatic) {
      const pool = statics.filter(x => !items.some(y => keyOf(y) === keyOf(x)));
      if (pool.length) {
        const chosen = pool[Math.floor(rng() * pool.length)];

        /* 同一篇文章的題目要連在一起出，否則同一段文章會在一堂課裡重複出現，
         * 學生也得為每一題重讀一次。整組一起放入時允許跨難度，
         * 讓同一篇文章上的題目由淺入深。 */
        if (chosen.group) {
          const siblings = mine
            .filter(x => x.group === chosen.group && !items.some(y => keyOf(y) === keyOf(x)))
            .slice(0, 3);
          let added = 0;
          for (const s of siblings) {
            if (seconds + s.est_seconds > budget) break;
            if (tryAdd(s)) added++;
          }
          if (added) { miss = 0; continue; }
        }
        q = chosen;
      }
    }
    if (!q && gens.length) {
      const g = gens[Math.floor(rng() * gens.length)];
      try {
        q = generateOne(g, difficulty, ri(1, 2 ** 30, rng));
      } catch (err) {
        // 生成器出錯時記錄並跳過，不讓整堂課失敗（需求 5.2）
        warnings.push(`生成器 ${g.id} 出錯：${err.message}`);
        miss++;
        continue;
      }
    }
    if (!q) break;                       // 題庫抽乾了

    /* 這一題塞不進剩餘預算時只是換一題，不能直接中止整堂課。
     * 否則一抽到長題目，課堂就會停在很短的時長上。 */
    if (seconds + q.est_seconds > budget) {
      if (items.length === 0 && tryAdd(q)) break;   // 至少要有一題
      miss++;
      continue;
    }
    if (tryAdd(q)) miss = 0; else miss++;
  }

  if (seconds < LESSON_MIN_SECONDS) {
    warnings.push(
      `這堂課只組出 ${seconds} 秒（低於 ${LESSON_MIN_SECONDS} 秒下限），` +
      `${subject} 的題庫題量不足，建議補充題目。`
    );
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
