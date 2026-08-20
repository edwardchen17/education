/* ===== engine/schedule.js — 排課 =====
 *
 * 核心原則（design 的 Property 3、4、6）：
 *   冪等      同一 (學生, 日期) 重複呼叫不會產生額外課堂
 *   不覆寫    管理者手動指派的課堂永不被自動排課動到
 *   台灣時間  日期一律以台灣當地時間計算
 *
 * 純函式（slotsForDate、chooseSubject、buildPlan）與需要資料庫的
 * ensureToday 分開，讓大部分邏輯可以獨立測試。
 */

import { todayTW, addDays, isSummer, seeded, hash } from '../core.js';
import { LESSON, DIFFICULTIES } from '../config/scoring.js';
import { DEFAULT_ROTATION, subjectsFor } from '../config/subjects.js';
import * as DB from '../db.js';
import { pickQuestions, loadPool } from '../bank/index.js';

/* ------------------------------------------------------------------ */
/* 純函式                                                              */
/* ------------------------------------------------------------------ */

/** 這一天該上幾堂課。暑假兩堂、平日一堂，堂數可由管理者調整。 */
export function slotsForDate(dateStr, settings = {}) {
  const start = settings.summer_start || '07-01';
  const end = settings.summer_end || '08-31';
  const summer = isSummer(dateStr, start, end);
  const n = summer ? (settings.lessons_summer ?? 2) : (settings.lessons_weekday ?? 1);
  return Math.max(0, Math.min(4, n));
}

/**
 * 決定某一天某一節要上什麼科目。
 *
 * 以「距離某個固定基準日的天數」推進輪替序，因此同一天算出來的結果永遠相同
 * （冪等），不會因為呼叫時間不同而變。
 *
 * @param {object} o
 *   rotation  科目輪替陣列
 *   dateStr   日期
 *   slot      當日第幾節（從 1 開始）
 *   avoid     要避開的科目（通常是前一天上過的）
 */
export function chooseSubject({ rotation, dateStr, slot = 1, avoid = [] }) {
  if (!rotation || !rotation.length) return null;

  const dayIndex = daysSinceEpoch(dateStr);
  const base = dayIndex * 2 + (slot - 1);       // 每天最多兩節，讓兩節不同科
  let idx = ((base % rotation.length) + rotation.length) % rotation.length;

  // 避開指定科目與同一天已排的科目，最多往後找一輪
  for (let step = 0; step < rotation.length; step++) {
    const cand = rotation[(idx + step) % rotation.length];
    if (!avoid.includes(cand)) return cand;
  }
  return rotation[idx];     // 全部都要避開時只能重複
}

const EPOCH = '2026-01-01';
function daysSinceEpoch(dateStr) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(dateStr) - p(EPOCH)) / 86400000);
}

/** 取得某學生的科目輪替序 */
export function rotationFor(student, settings = {}) {
  const custom = settings.rotation && settings.rotation[student.level];
  if (Array.isArray(custom) && custom.length) return custom;
  const fallback = DEFAULT_ROTATION[student.level];
  if (fallback) return fallback;
  return subjectsFor(student.level).map(s => s.code);
}

/**
 * 組出一堂課的題目。
 * @returns {{items, seconds, reviewCount, warnings}}
 */
export function buildPlan({ subject, level, difficulty, dueTopics = [], staticPool = [], settings = {}, seed }) {
  const target = (settings.target_minutes ?? LESSON.targetMinutes) * 60;
  const rng = seeded(seed ?? hash(`${subject}|${level}|${difficulty}|${dueTopics.join(',')}`));

  return pickQuestions({
    subject, level, difficulty,
    budget: target,
    topics: dueTopics,
    staticPool,
    rng,
    stopRatio: LESSON.fillStopRatio,
    reviewRatio: LESSON.reviewBudgetRatio
  });
}

/* ------------------------------------------------------------------ */
/* 需要資料庫的部分                                                    */
/* ------------------------------------------------------------------ */

/**
 * 確保某位學生今天的課堂都已存在，回傳當日課堂陣列。
 *
 * 這個函式是冪等的：重複呼叫回傳相同結果，也不會多建課堂。
 * 多台裝置同時呼叫時，資料庫的唯一鍵會擋掉重複，後到的那一方讀回既有課堂。
 *
 * @param {object} student students 資料表的一列
 * @param {object} [opts] { date, settings }
 */
export async function ensureToday(student, opts = {}) {
  const date = opts.date || todayTW();
  const settings = opts.settings || await DB.settings.get();

  const existing = await DB.lessons.forDate(student.id, date);
  const want = slotsForDate(date, settings);

  // 已經齊了就直接回傳，不做任何寫入
  if (existing.length >= want) return existing.slice(0, Math.max(want, existing.length));

  if (!student.level) return existing;          // 還沒設定程度，不排課

  const rotation = rotationFor(student, settings);

  // 前一天上過的科目，用來避免連續兩天同一科（需求 8.5）
  const yesterday = await DB.lessons.forDate(student.id, addDays(date, -1));
  const avoidBase = yesterday.map(l => l.subject);

  // 到期的複習知識點（需求 8.6）
  const due = await DB.mastery.due(student.id, date);

  const states = await DB.subjectState.forStudent(student.id);
  const diffOf = subject =>
    states.find(s => s.subject === subject)?.difficulty || DIFFICULTIES[0];

  const usedToday = existing.map(l => l.subject);
  const out = existing.slice();

  for (let slot = 1; slot <= want; slot++) {
    if (out.some(l => l.slot_of_day === slot)) continue;

    const subject = chooseSubject({
      rotation, dateStr: date, slot,
      avoid: [...avoidBase, ...usedToday]
    });
    if (!subject) break;

    const difficulty = diffOf(subject);
    const dueTopics = due
      .filter(d => d.subject === subject)
      .map(d => d.topic);

    const staticPool = await loadPool(subject, student.level);

    const plan = buildPlan({
      subject, level: student.level, difficulty,
      dueTopics, staticPool, settings,
      seed: hash(`${student.id}|${date}|${slot}|${subject}`)
    });

    if (!plan.items.length) {
      // 這個科目還沒有題庫，換下一個科目再試
      usedToday.push(subject);
      slot--;
      if (usedToday.length > rotation.length + 2) break;   // 全都沒題庫就放棄
      continue;
    }

    const scoreMax = plan.items.reduce(
      (s, q) => s + q.base_points * multiplierOf(q.difficulty), 0);

    const lesson = await DB.lessons.createIfAbsent({
      student_id: student.id,
      lesson_date: date,
      slot_of_day: slot,
      subject,
      status: 'pending',
      assigned_by: 'auto',
      plan: {
        items: plan.items,
        seconds: plan.seconds,
        review_count: plan.reviewCount,
        difficulty
      },
      score_max: Math.round(scoreMax * 100) / 100,
      pending_grading: plan.items.filter(q => q.type === 'essay' || q.type === 'short').length
    });

    out.push(lesson);
    usedToday.push(subject);
  }

  return out.sort((a, b) => a.slot_of_day - b.slot_of_day);
}

function multiplierOf(difficulty) {
  return { basic: 1.0, advanced: 1.3, gifted: 1.6 }[difficulty] ?? 1;
}

/**
 * 管理者手動指派課堂。會覆蓋同一節次既有的自動排課，
 * 但不會動到已經開始作答或已交卷的課堂。
 */
export async function assignLesson({ student, date, slot = 1, subject, difficulty, settings }) {
  const cfg = settings || await DB.settings.get();
  const existing = await DB.lessons.forDate(student.id, date);
  const hit = existing.find(l => l.slot_of_day === slot);

  if (hit && (hit.status === 'submitted' || hit.status === 'graded')) {
    throw new Error('這一堂已經交卷了，不能重新指派。');
  }

  const due = await DB.mastery.due(student.id, date);
  const staticPool = await loadPool(subject, student.level);
  const plan = buildPlan({
    subject, level: student.level,
    difficulty: difficulty || DIFFICULTIES[0],
    dueTopics: due.filter(d => d.subject === subject).map(d => d.topic),
    staticPool, settings: cfg,
    seed: hash(`manual|${student.id}|${date}|${slot}|${subject}|${Date.now()}`)
  });

  if (!plan.items.length) throw new Error(`${subject} 目前還沒有題庫可以出題。`);

  const scoreMax = plan.items.reduce(
    (s, q) => s + q.base_points * multiplierOf(q.difficulty), 0);

  const payload = {
    subject,
    status: 'pending',
    assigned_by: 'admin',
    plan: {
      items: plan.items,
      seconds: plan.seconds,
      review_count: plan.reviewCount,
      difficulty: difficulty || DIFFICULTIES[0]
    },
    score_max: Math.round(scoreMax * 100) / 100,
    pending_grading: plan.items.filter(q => q.type === 'essay' || q.type === 'short').length
  };

  if (hit) {
    const rows = await DB.lessons.update(hit.id, payload);
    return rows[0];
  }
  return DB.lessons.createIfAbsent({
    student_id: student.id, lesson_date: date, slot_of_day: slot, ...payload
  });
}

/**
 * 建立一張額外的練習卷，不受每日堂數限制。
 *
 * 和 ensureToday 的差別是這個函式刻意「不冪等」：每次呼叫都排在下一個空節次、
 * 用新的隨機種子，因此每次拿到的都是不同的題目。訪客試用模式用它做到
 * 「不限次數、每次換一張」。
 *
 * @param {object} o
 *   student     學生列
 *   subject     科目
 *   difficulty  難度
 *   date        日期（預設今天）
 *   settings    系統設定
 *   seed        指定種子（測試用；不給就用時間加亂數）
 */
export async function createPracticeLesson({ student, subject, difficulty, date, settings, seed }) {
  const day = date || todayTW();
  const cfg = settings || await DB.settings.get();
  const diff = difficulty || DIFFICULTIES[0];

  const existing = await DB.lessons.forDate(student.id, day);
  const slot = existing.reduce((m, l) => Math.max(m, l.slot_of_day), 0) + 1;

  const staticPool = await loadPool(subject, student.level);
  const plan = buildPlan({
    subject, level: student.level, difficulty: diff,
    dueTopics: [], staticPool, settings: cfg,
    seed: seed ?? hash(`practice|${student.id}|${day}|${slot}|${subject}|${Date.now()}|${Math.random()}`)
  });

  if (!plan.items.length) throw new Error(`${subject} 目前還沒有題庫可以出題。`);

  const scoreMax = plan.items.reduce(
    (s, q) => s + q.base_points * multiplierOf(q.difficulty), 0);

  return DB.lessons.createIfAbsent({
    student_id: student.id,
    lesson_date: day,
    slot_of_day: slot,
    subject,
    status: 'pending',
    assigned_by: 'admin',
    plan: {
      items: plan.items,
      seconds: plan.seconds,
      review_count: plan.reviewCount,
      difficulty: diff
    },
    score_max: Math.round(scoreMax * 100) / 100,
    pending_grading: plan.items.filter(q => q.type === 'essay' || q.type === 'short').length
  });
}

/** 今日任務摘要，供首頁顯示 */
export async function todaySummary(student, date = todayTW()) {
  const lessons = await ensureToday(student, { date });
  const done = lessons.filter(l => l.status === 'submitted' || l.status === 'graded');
  const streak = await DB.lessons.streak(student.id, date, addDays);
  return {
    date,
    lessons,
    total: lessons.length,
    done: done.length,
    allDone: lessons.length > 0 && done.length === lessons.length,
    streak
  };
}
