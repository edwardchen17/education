/* ===== core.js — 核心工具函式 =====
 * 不依賴任何其他模組，可在瀏覽器與 Node 中直接使用。
 */

/* ------------------------------------------------------------------ */
/* 數值與隨機                                                          */
/* ------------------------------------------------------------------ */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 含頭含尾的整數隨機 */
export const ri = (a, b, rng = Math.random) => a + Math.floor(rng() * (b - a + 1));

/** 浮點隨機 */
export const rf = (a, b, rng = Math.random) => a + rng() * (b - a);

/** 從陣列隨機取一個 */
export const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

/** 百分比機率 */
export const chance = (p, rng = Math.random) => rng() * 100 < p;

/** 原地洗牌（Fisher-Yates），可傳入亂數器以取得可重現結果 */
export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 依權重挑選：list 為 [{ w: 權重, ... }] */
export function weighted(list, rng = Math.random) {
  const total = list.reduce((s, o) => s + o.w, 0);
  let r = rng() * total;
  for (const o of list) {
    r -= o.w;
    if (r <= 0) return o;
  }
  return list[list.length - 1];
}

/** FNV-1a 字串雜湊 */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 以字串或數字為種子的偽隨機器（xorshift32）。
 *  同一顆種子永遠產生同一串數列，用於可重現的題目生成。 */
export function seeded(seed) {
  let s = (typeof seed === 'number' ? seed >>> 0 : hash(String(seed))) || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/** 千分位格式化 */
export const fmtNum = v => Math.round(v).toLocaleString('en-US');

/** 保留小數位，去掉多餘的零 */
export function fmtFixed(v, digits = 2) {
  return String(Number(Number(v).toFixed(digits)));
}

export const wait = ms => new Promise(r => setTimeout(r, ms));

/** 最大公因數，用於分數化簡 */
export function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

/** 化簡分數，回傳 [分子, 分母]，分母恆為正 */
export function reduceFraction(num, den) {
  if (den === 0) throw new Error('分母不可為零');
  const sign = den < 0 ? -1 : 1;
  num *= sign; den *= sign;
  const g = gcd(num, den);
  return [num / g, den / g];
}

/* ------------------------------------------------------------------ */
/* 日期：一律以台灣當地時間計算                                         */
/*                                                                     */
/* 這件事必須嚴格處理。UTC 午夜與台灣午夜相差八小時，                    */
/* 若用 UTC 日期，晚上八點以後的練習會被記到隔天。                       */
/* 對應 design 文件的 Property 6。                                      */
/* ------------------------------------------------------------------ */

export const TZ = 'Asia/Taipei';

const pad2 = v => String(v).padStart(2, '0');

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

/** 台灣當地日期字串 YYYY-MM-DD */
export function todayTW(d = new Date()) {
  return dateFmt.format(d);
}

/** 台灣當地時間 HH:MM:SS */
export function timeTW(d = new Date()) {
  return timeFmt.format(d);
}

/** 台灣當地的小時數 0-23 */
export function hourTW(d = new Date()) {
  return Number(timeTW(d).slice(0, 2));
}

/** 日期字串加減天數。純日曆運算，不涉及時區。 */
export function addDays(dateStr, k) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + k * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** b - a，相差幾天（正數表示 b 在 a 之後） */
export function diffDays(a, b) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

/** 取出 MM-DD */
export function monthDay(dateStr) {
  return dateStr.slice(5);
}

/** 星期幾，0 = 週日 */
export function weekdayIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 中文星期名 */
export function weekdayName(dateStr) {
  return WEEK_NAMES[weekdayIndex(dateStr)];
}

/** 是否落在暑假範圍內。start / end 為 'MM-DD'。
 *  支援跨年的範圍（例如 12-20 到 01-05）。 */
export function isSummer(dateStr, start = '07-01', end = '08-31') {
  const md = monthDay(dateStr);
  if (start <= end) return md >= start && md <= end;
  return md >= start || md <= end;   // 跨年
}

/** 顯示用的中文日期 */
export function fmtDateTW(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日（${weekdayName(dateStr)}）`;
}

/** 把秒數轉為 M:SS 或 H:MM:SS */
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/* ------------------------------------------------------------------ */
/* 字串                                                                */
/* ------------------------------------------------------------------ */

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 全形轉半形（含空白），用於答案正規化 */
export function toHalfWidth(s) {
  return String(s)
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

/** 計算字數：中文以字為單位，英文以詞為單位 */
export function countWords(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  const cjk = (s.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) || []).length;
  const words = (s.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, ' ')
    .match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}
