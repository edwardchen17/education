/* ===== engine/grade.js — 批改與計分 =====
 *
 * 交卷時的規則（需求 9、10）：
 *   客觀題立即批改；看過解答的題目一律零分
 *   作文與簡答標記待批改，該堂成績顯示為「暫定」
 *   積分 = 得分總和 + 連續天數加成，寫入流水帳（只增不改）
 *
 * 對應的不變量：Property 1、7、8、9
 */

import { todayTW, addDays } from '../core.js';
import { maxScore, streakBonus, DIFFICULTY_MULTIPLIER, SRS_INTERVALS } from '../config/scoring.js';
import { check } from './answer.js';
import * as DB from '../db.js';

const isWriting = q => q.type === 'essay' || q.type === 'short';

/* ------------------------------------------------------------------ */
/* 純函式：批改一堂課                                                  */
/* ------------------------------------------------------------------ */

/**
 * 批改整堂課，回傳要寫進資料庫的作答列與統計。
 * 這是純函式，不接觸資料庫，方便測試。
 *
 * @param {object} lesson  課堂（含 plan.items）
 * @param {object} input   { answers: {seq: raw}, revealed: number[], seconds: {seq: 秒} }
 */
export function gradeLesson(lesson, input = {}) {
  const answers = input.answers || {};
  const revealedSet = new Set(input.revealed || []);
  const secondsMap = input.seconds || {};

  const rows = [];
  let scoreEarned = 0;
  let scoreMax = 0;
  let pendingGrading = 0;
  let correctCount = 0;
  let gradedCount = 0;

  lesson.plan.items.forEach((q, i) => {
    const seq = i + 1;
    const revealed = revealedSet.has(seq);
    const max = maxScore(q.type, q.difficulty);
    scoreMax += max;

    const raw = answers[seq];
    const result = check(q, raw);

    let score = null;
    let needsGrading = false;

    if (isWriting(q)) {
      needsGrading = true;
      pendingGrading++;
    } else if (revealed) {
      // Property 7：看過解答一律零分
      score = 0;
      gradedCount++;
    } else {
      score = result.correct ? max : 0;
      scoreEarned += score;
      gradedCount++;
      if (result.correct) correctCount++;
    }

    rows.push({
      lesson_id: lesson.id,
      student_id: lesson.student_id,
      seq,
      question: q,
      subject: q.subject,
      topic: q.topic,
      qtype: q.type,
      difficulty: q.difficulty,
      answer: raw === undefined ? null : { raw, normalized: result.normalized },
      is_correct: isWriting(q) ? null : result.correct,
      revealed,
      needs_grading: needsGrading,
      score,
      max_score: max,
      seconds: Math.max(0, Math.round(secondsMap[seq] || 0))
    });
  });

  return {
    rows,
    scoreEarned: round2(scoreEarned),
    scoreMax: round2(scoreMax),
    pendingGrading,
    correctCount,
    gradedCount,
    /** 只計入已批改且未看解答的題目（Property 7、需求 12.7） */
    accuracyItems: rows.filter(r => !r.revealed && !r.needs_grading)
  };
}

const round2 = v => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ */
/* 交卷                                                                */
/* ------------------------------------------------------------------ */

/**
 * 交卷：批改、寫入作答、計分、更新複習佇列與各科近期紀錄。
 *
 * @param {object} o
 *   lesson, student
 *   answers  { seq: 學生作答 }
 *   revealed number[]  看過解答的題號
 *   seconds  { seq: 該題耗時 }
 *   timerSeconds   計時器累計（可暫停，學生看得到）
 *   elapsedSeconds 實際經過（不受暫停影響，只有管理者看得到）
 *   pauseCount     暫停次數
 * @returns {Promise<object>} 交卷結果摘要
 */
export async function submitLesson(o) {
  const { lesson, student } = o;
  const date = o.date || todayTW();

  const g = gradeLesson(lesson, {
    answers: o.answers, revealed: o.revealed, seconds: o.seconds
  });

  /* 1. 寫入作答紀錄 */
  await DB.attempts.bulkCreate(g.rows);

  /* 2. 積分。得分即積分，作文批改後再補（Property 8） */
  const ledger = [];
  if (g.scoreEarned > 0) {
    ledger.push({
      student_id: student.id, lesson_id: lesson.id,
      kind: 'question', points: g.scoreEarned,
      note: `${lesson.subject} 客觀題`
    });
  }

  /* 3. 連續天數加成。先把這堂算成已完成再計算天數。 */
  const streak = await streakIncluding(student.id, date);
  const bonusRate = streakBonus(streak);
  const bonus = round2(g.scoreEarned * bonusRate);
  if (bonus > 0) {
    ledger.push({
      student_id: student.id, lesson_id: lesson.id,
      kind: 'streak_bonus', points: bonus,
      note: `連續 ${streak} 天，加成 ${Math.round(bonusRate * 100)}%`
    });
  }
  if (ledger.length) await DB.points.addMany(ledger);

  /* 4. 更新各科最近二十題紀錄（供難度自動調整使用） */
  await updateRecent(student.id, lesson.subject, g.accuracyItems);

  /* 5. 答錯或看過解答的知識點進入複習佇列（需求 11.1） */
  await enqueueReview(student.id, g.rows, date);

  /* 6. 更新課堂狀態 */
  const status = g.pendingGrading > 0 ? 'submitted' : 'graded';
  const patch = {
    status,
    score_earned: g.scoreEarned,
    score_max: g.scoreMax,
    pending_grading: g.pendingGrading,
    points_awarded: round2(g.scoreEarned + bonus),
    timer_seconds: Math.max(0, Math.round(o.timerSeconds || 0)),
    elapsed_seconds: Math.max(0, Math.round(o.elapsedSeconds || 0)),
    pause_count: Math.max(0, Math.round(o.pauseCount || 0)),
    submitted_at: new Date().toISOString()
  };
  if (status === 'graded') patch.graded_at = new Date().toISOString();
  const updated = await DB.lessons.update(lesson.id, patch);

  return {
    lesson: updated[0],
    ...g,
    streak,
    bonusRate,
    bonus,
    provisional: g.pendingGrading > 0
  };
}

/** 把今天算進去之後的連續完成天數 */
async function streakIncluding(studentId, date) {
  const prior = await DB.lessons.streak(studentId, addDays(date, -1), addDays);
  return prior + 1;
}

/** 維護 subject_state.recent，只保留最後二十筆（Property 10） */
async function updateRecent(studentId, subject, accuracyItems) {
  if (!accuracyItems.length) return;
  const state = await DB.subjectState.get(studentId, subject);
  const recent = Array.isArray(state?.recent) ? state.recent.slice() : [];
  accuracyItems.forEach(r => recent.push(!!r.is_correct));
  const trimmed = recent.slice(-20);
  await DB.subjectState.upsert({
    student_id: studentId,
    subject,
    difficulty: state?.difficulty || 'basic',
    locked: !!state?.locked,
    recent: trimmed
  });
}

/**
 * 答錯或看過解答的知識點排入複習。
 * 這裡只處理「首次進入佇列」的轉移（box 0、三天後）；
 * 完整的間隔重複狀態機在任務 14 實作。
 */
async function enqueueReview(studentId, rows, date) {
  const need = rows.filter(r => r.revealed || r.is_correct === false);
  const seen = new Set();

  for (const r of need) {
    if (seen.has(r.topic)) continue;
    seen.add(r.topic);

    const cur = await DB.mastery.get(studentId, r.topic);
    await DB.mastery.upsert({
      student_id: studentId,
      topic: r.topic,
      subject: r.subject,
      box: 0,
      due_on: addDays(date, SRS_INTERVALS[0]),
      streak: 0,
      wrong_count: (cur?.wrong_count || 0) + 1,
      mastered: false,
      last_seen: new Date().toISOString()
    });
  }
}

/* ------------------------------------------------------------------ */
/* 老師批改                                                            */
/* ------------------------------------------------------------------ */

/**
 * 批改單一題（作文或簡答）。
 * 全部批改完成後，課堂成績由暫定轉為正式並補上積分（需求 9.5、9.6）。
 *
 * @param {object} o { attempt, grade: {score, comment, marks, items} }
 *   items 是評分規準逐項的原始給分，回頭修改分數時用來還原輸入框。
 */
export async function applyTeacherGrade({ attempt, grade }) {
  const max = Number(attempt.max_score);
  const score = clampScore(grade.score, max);

  await DB.attempts.update(attempt.id, {
    score,
    needs_grading: false,
    grade: {
      score,
      comment: grade.comment || '',
      marks: grade.marks || [],
      items: grade.items || null,
      graded_at: new Date().toISOString()
    }
  });

  return recomputeLesson(attempt.lesson_id);
}

/** 修改已批改過的分數（需求 9.7） */
export async function reviseGrade({ attempt, grade }) {
  const max = Number(attempt.max_score);
  const score = clampScore(grade.score, max);
  const prev = Number(attempt.score) || 0;

  await DB.attempts.update(attempt.id, {
    score,
    grade: {
      ...(attempt.grade || {}),
      score,
      comment: grade.comment ?? attempt.grade?.comment ?? '',
      marks: grade.marks ?? attempt.grade?.marks ?? [],
      items: grade.items ?? attempt.grade?.items ?? null,
      revised_at: new Date().toISOString()
    }
  });

  /* 積分只增不改（Property 1）。分數調降時不追回已給的積分，
   * 只在調升時補上差額，避免學生的累積積分倒退。 */
  const delta = round2(score - prev);
  if (delta > 0) {
    await DB.points.add({
      student_id: attempt.student_id,
      lesson_id: attempt.lesson_id,
      kind: 'grading',
      points: delta,
      note: '老師調整分數'
    });
  }

  return recomputeLesson(attempt.lesson_id);
}

function clampScore(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return round2(Math.min(Math.max(n, 0), max));
}

/**
 * 把評分規準的逐項給分換算成該題的實得分數（需求 9.3）。
 *
 * 規準的配分總和（例如 30 分）與該題滿分（會隨難度倍率變動，例如 39 分）
 * 通常不相等，所以用比例換算，而不是直接相加。
 *
 * @param {number[]} items    每一項的給分，順序對應 rubric
 * @param {object[]} rubric   [{ item, points, desc }]
 * @param {number}   max      該題滿分
 * @returns {{ sum:number, rubricMax:number, score:number }}
 */
export function scaleRubric(items, rubric, max) {
  const list = Array.isArray(rubric) ? rubric : [];
  const rubricMax = list.reduce((s, r) => s + (Number(r.points) || 0), 0);
  const sum = round2(list.reduce(
    (s, r, i) => s + clampScore(items?.[i], Number(r.points) || 0), 0));

  /* 規準沒有配分時無法換算，退回把逐項分數當成實得分數 */
  if (rubricMax <= 0) return { sum, rubricMax: 0, score: clampScore(sum, max) };

  return { sum, rubricMax, score: clampScore(sum / rubricMax * Number(max), max) };
}

/** 重新計算課堂的得分與待批改數，必要時轉為正式成績 */
async function recomputeLesson(lessonId) {
  const lesson = await DB.lessons.get(lessonId);
  const rows = await DB.attempts.forLesson(lessonId);

  const pending = rows.filter(r => r.needs_grading).length;
  const earned = round2(rows.reduce((s, r) => s + (Number(r.score) || 0), 0));

  const patch = { pending_grading: pending, score_earned: earned };

  if (pending === 0 && lesson.status !== 'graded') {
    patch.status = 'graded';
    patch.graded_at = new Date().toISOString();

    /* 補上作文的積分：課堂總得分減去交卷時已給的客觀題積分 */
    const already = await givenPoints(lesson.student_id, lessonId, 'question');
    const diff = round2(earned - already);
    if (diff > 0) {
      await DB.points.add({
        student_id: lesson.student_id, lesson_id: lessonId,
        kind: 'grading', points: diff, note: '作文批改完成'
      });
    }
    patch.points_awarded = round2(earned + await givenPoints(lesson.student_id, lessonId, 'streak_bonus'));

    await DB.notifications.add(lesson.student_id, 'graded', {
      lesson_id: lessonId,
      subject: lesson.subject,
      date: lesson.lesson_date,
      score: earned,
      max: Number(lesson.score_max) || 0
    });
  }

  const updated = await DB.lessons.update(lessonId, patch);
  return { lesson: updated[0], pending, earned };
}

/** 某堂課某類別已經給出的積分總額 */
async function givenPoints(studentId, lessonId, kind) {
  const rows = await DB.points.ledger(studentId, 500);
  return round2(rows
    .filter(r => r.lesson_id === lessonId && r.kind === kind)
    .reduce((s, r) => s + Number(r.points), 0));
}

/* ------------------------------------------------------------------ */
/* 統計輔助                                                            */
/* ------------------------------------------------------------------ */

/** 某科的答對率，排除看過解答的題目（需求 12.7） */
export function accuracyOf(recent) {
  const list = Array.isArray(recent) ? recent : [];
  if (!list.length) return null;
  return list.filter(Boolean).length / list.length;
}

/** 單題滿分，供介面顯示 */
export { maxScore, DIFFICULTY_MULTIPLIER };
