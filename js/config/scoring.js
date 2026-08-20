/* ===== config/scoring.js — 計分、難度、複習、課堂長度的設定 =====
 *
 * 設計文件把這些設定寫成 JSON，實作時改為 JS 模組：
 * 瀏覽器要 import JSON 需要 import attributes，各家支援度不一，
 * 改用 .js 模組可以讓瀏覽器與 Node 測試用完全相同的方式載入，不需 fetch。
 */

/** 題型基準配分（需求 10.1） */
export const BASE_POINTS = {
  mc:    2,    // 單選
  mmc:   3,    // 多選
  fill:  3,    // 填空
  calc:  5,    // 計算
  short: 8,    // 簡答
  essay: 30    // 作文
};

/** 難度倍率（需求 10.2） */
export const DIFFICULTY_MULTIPLIER = {
  basic:    1.0,
  advanced: 1.3,
  gifted:   1.6
};

export const DIFFICULTIES = ['basic', 'advanced', 'gifted'];

export const DIFFICULTY_LABEL = {
  basic:    '基礎',
  advanced: '進階',
  gifted:   '資優'
};

/** 連續完成天數加成（需求 10.4、Property 9） */
export const STREAK = {
  perDays: 7,      // 每滿幾天加一段
  bonus:   0.05,   // 每段加成
  max:     0.25    // 加成上限
};

/** 難度自動調整（需求 12.1 至 12.3） */
export const DIFFICULTY_TUNING = {
  window: 20,      // 觀察最近幾題
  up:     0.85,    // 答對率達此值升一階
  down:   0.50     // 答對率低於此值降一階
};

/** 間隔重複的天數（需求 11.2） */
export const SRS_INTERVALS = [3, 7, 14];

/** 課堂長度（需求 7.1、Property 5） */
export const LESSON = {
  targetMinutes: 25,
  minMinutes:    20,
  maxMinutes:    40,
  /** 複習題最多佔預算的比例 */
  reviewBudgetRatio: 0.4,
  /** 累計達目標的幾成即停止填題 */
  fillStopRatio: 0.9
};

/** 勳章門檻（需求 10.7、10.8） */
export const BADGES = {
  points:     { label: '積分',   levels: [500, 2000, 5000, 12000, 30000] },
  mastery:    { label: '精熟',   levels: [10, 30, 60, 100] },
  streak:     { label: '恆心',   levels: [7, 30, 100, 365] },
  correction: { label: '修正',   levels: [20, 80, 200, 500] }
};

export const BADGE_TIER_NAME = ['銅', '銀', '金', '白金', '鑽石'];

/** 計算單題滿分 */
export function maxScore(qtype, difficulty) {
  const base = BASE_POINTS[qtype] ?? 0;
  const mult = DIFFICULTY_MULTIPLIER[difficulty] ?? 1;
  return Math.round(base * mult * 100) / 100;
}

/** 連續天數對應的加成率，恆落在 [0, max]（Property 9） */
export function streakBonus(days) {
  const steps = Math.floor(Math.max(0, days) / STREAK.perDays);
  return Math.min(steps * STREAK.bonus, STREAK.max);
}
