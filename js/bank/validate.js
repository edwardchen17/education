/* ===== bank/validate.js — 題目結構驗證 =====
 *
 * 對應 design 的 Property 15：
 *   每道題目必帶 topic、difficulty、est_seconds、base_points
 *   選擇題至少有一個正解，且每個選項都有非空的 why 說明
 *
 * 這個驗證器會對整個靜態題庫與每個生成器的輸出執行，
 * 出題品質的底線靠它守住。
 */

import { DIFFICULTIES, BASE_POINTS } from '../config/scoring.js';
import { isKnownTopic } from '../config/topics.js';

const TYPES = ['mc', 'mmc', 'fill', 'calc', 'short', 'essay'];

/** 合理的作答秒數範圍，用來抓明顯設錯的值 */
const EST_RANGE = { min: 15, max: 2400 };

/**
 * 驗證單一題目。
 * @returns {string[]} 錯誤訊息陣列，空陣列表示通過
 */
export function validateQuestion(q, where = '') {
  const errs = [];
  const at = msg => errs.push(where ? `${where}：${msg}` : msg);

  if (!q || typeof q !== 'object') { return [`${where}：題目不是物件`]; }

  /* ---- 共同欄位 ---- */
  if (!TYPES.includes(q.type)) at(`未知的題型 ${JSON.stringify(q.type)}`);

  if (!q.topic) at('缺少 topic');
  else if (!isKnownTopic(q.topic)) at(`topic 未登記於 config/topics.js：${q.topic}`);

  if (!q.subject) at('缺少 subject');

  if (!DIFFICULTIES.includes(q.difficulty)) at(`難度不合法：${q.difficulty}`);

  if (typeof q.est_seconds !== 'number' || !Number.isFinite(q.est_seconds)) {
    at('est_seconds 必須是數字');
  } else if (q.est_seconds < EST_RANGE.min || q.est_seconds > EST_RANGE.max) {
    at(`est_seconds 超出合理範圍：${q.est_seconds}`);
  }

  if (typeof q.base_points !== 'number' || q.base_points <= 0) {
    at('base_points 必須是正數');
  } else if (q.type && BASE_POINTS[q.type] !== undefined && q.base_points !== BASE_POINTS[q.type]) {
    at(`base_points ${q.base_points} 與題型 ${q.type} 的基準 ${BASE_POINTS[q.type]} 不符`);
  }

  const stemText = q.stem ?? q.prompt;
  if (!stemText || !String(stemText).trim()) at('題幹為空');

  /* 題目文字會經過 HTML 轉義後才顯示，寫死的標籤會變成可見的字。
   * 需要斷行請用 \n。 */
  const rawTag = /<\s*\/?\s*[A-Za-z][^>]*>/;
  if (stemText && rawTag.test(String(stemText))) {
    at('題幹含有 HTML 標籤，會被原樣顯示出來。斷行請改用 \\n');
  }
  (q.options || []).forEach((o, i) => {
    const tag = `選項 ${'ABCDEFGH'[i] || i}`;
    if (o && rawTag.test(String(o.text ?? ''))) at(`${tag} 的內容含有 HTML 標籤`);
    if (o && rawTag.test(String(o.why ?? ''))) at(`${tag} 的解析含有 HTML 標籤`);
  });

  /* ---- 選擇題 ---- */
  if (q.type === 'mc' || q.type === 'mmc') {
    if (!Array.isArray(q.options) || q.options.length < 2) {
      at('選擇題至少要有兩個選項');
    } else {
      const correct = q.options.filter(o => o && o.correct);

      if (correct.length === 0) at('沒有任何正解選項');
      if (q.type === 'mc' && correct.length > 1) at(`單選題有 ${correct.length} 個正解`);
      if (q.type === 'mmc' && correct.length === q.options.length) at('多選題的所有選項都是正解');

      q.options.forEach((o, i) => {
        const tag = `選項 ${'ABCDEFGH'[i] || i}`;
        if (!o || typeof o !== 'object') { at(`${tag} 不是物件`); return; }
        if (!o.text || !String(o.text).trim()) at(`${tag} 內容為空`);
        // Property 15 的核心：每個選項都要說明為什麼對或為什麼錯
        if (!o.why || !String(o.why).trim()) at(`${tag} 缺少 why 說明`);
      });

      // 選項不可重複，否則會有兩個「正確答案」
      const texts = q.options.map(o => String(o?.text ?? '').trim());
      const dup = texts.find((t, i) => texts.indexOf(t) !== i);
      if (dup) at(`選項內容重複：${dup}`);
    }
  }

  /* ---- 計算題 ---- */
  if (q.type === 'calc') {
    const a = q.answer;
    if (!a || typeof a !== 'object') at('缺少 answer');
    else {
      const hasValue = typeof a.value === 'number' && Number.isFinite(a.value);
      const hasAccept = Array.isArray(a.accept) && a.accept.length > 0;
      if (!hasValue && !hasAccept) at('answer 必須有 value 或 accept');
      if (a.tolerance !== undefined && (typeof a.tolerance !== 'number' || a.tolerance < 0)) {
        at('tolerance 必須是非負數');
      }
    }
    if (!Array.isArray(q.steps) || q.steps.length === 0) {
      at('計算題必須提供分步驟推導');
    } else {
      q.steps.forEach((s, i) => {
        if (!s || !String(s.expr ?? '').trim()) at(`第 ${i + 1} 步缺少算式`);
      });
    }
  }

  /* ---- 填空題 ---- */
  if (q.type === 'fill') {
    const a = q.answer;
    if (!a || !Array.isArray(a.accept) || a.accept.length === 0) {
      at('填空題必須提供 answer.accept 清單');
    } else if (a.accept.some(v => v === null || v === undefined || String(v).trim() === '')) {
      at('answer.accept 含有空白項目');
    }
    if (!Array.isArray(q.steps) || q.steps.length === 0) at('填空題需要解題說明');
  }

  /* ---- 作文 ---- */
  if (q.type === 'essay') {
    if (!q.prompt || !String(q.prompt).trim()) at('作文缺少題目說明');
    if (typeof q.min_words !== 'number' || q.min_words <= 0) at('作文缺少 min_words');
    if (!Array.isArray(q.rubric) || q.rubric.length === 0) at('作文缺少評分規準');
    else {
      const total = q.rubric.reduce((s, r) => s + (Number(r.points) || 0), 0);
      if (total !== q.base_points) {
        at(`評分規準總分 ${total} 與配分 ${q.base_points} 不符`);
      }
      q.rubric.forEach((r, i) => {
        if (!r.item) at(`評分規準第 ${i + 1} 項缺少名稱`);
        if (!r.desc) at(`評分規準第 ${i + 1} 項缺少說明`);
      });
    }
    if (!q.sample || !String(q.sample).trim()) at('作文缺少範文');
  }

  /* ---- 簡答 ---- */
  if (q.type === 'short') {
    if (!q.reference || !String(q.reference).trim()) at('簡答題缺少參考答案');
  }

  return errs;
}

/**
 * 驗證一批題目。
 * @returns {{ok:boolean, errors:string[], count:number}}
 */
export function validateBatch(list, label = '') {
  const errors = [];
  list.forEach((q, i) => {
    errors.push(...validateQuestion(q, `${label}#${i + 1}`));
  });
  return { ok: errors.length === 0, errors, count: list.length };
}

/**
 * 驗證生成器本身的介面是否完整。
 */
export function validateGenerator(g) {
  const errs = [];
  if (!g || typeof g !== 'object') return ['生成器不是物件'];
  if (!g.id) errs.push('生成器缺少 id');
  if (!g.topic) errs.push(`${g.id || '?'} 缺少 topic`);
  else if (!isKnownTopic(g.topic)) errs.push(`${g.id} 的 topic 未登記：${g.topic}`);
  if (!g.subject) errs.push(`${g.id || '?'} 缺少 subject`);
  if (typeof g.generate !== 'function') errs.push(`${g.id || '?'} 缺少 generate()`);
  if (typeof g.verify !== 'function') {
    errs.push(`${g.id || '?'} 缺少 verify()。Property 14 要求每個生成器都能獨立驗算自己的答案。`);
  }
  if (!Array.isArray(g.levels) || g.levels.length === 0) {
    errs.push(`${g.id || '?'} 缺少 levels`);
  }
  return errs;
}
