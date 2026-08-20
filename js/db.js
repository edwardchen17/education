/* ===== db.js — 資料存取層 =====
 *
 * 這是唯一接觸 supabase-js 的檔案。所有其他模組只透過這裡的方法讀寫資料，
 * 因此將來若要換後端或退回純本機儲存，只需改寫這一個檔案。
 *
 * 所有方法在失敗時丟出帶中文訊息的 Error。
 */

import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_JS } from './config.js';

let client = null;

/** 測試用：注入假的用戶端 */
export function injectClient(c) { client = c; }

/** 取得用戶端，必要時動態載入 supabase-js。
 *  刻意用動態 import，這樣 Node 測試載入本檔時不會去連 CDN。 */
export async function getClient() {
  if (client) return client;
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  return client;
}

/* ------------------------------------------------------------------ */
/* 錯誤處理                                                            */
/* ------------------------------------------------------------------ */

export class DBError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DBError';
    this.cause = cause;
  }
}

/** 把 Supabase 的錯誤碼轉成看得懂的中文訊息 */
function describe(error) {
  const code = error?.code || '';
  const raw = error?.message || '未知錯誤';

  if (code === '23505') return '資料重複，這筆記錄已經存在。';
  if (code === '23503') return '關聯的資料不存在，可能是學生檔位已被刪除。';
  if (code === '42501' || /row-level security/i.test(raw))
    return '沒有存取權限。請確認已登入家庭帳號。';
  if (code === 'PGRST116') return '查詢預期一筆資料，實際筆數不符。';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(raw))
    return '無法連上資料庫。可能是網路中斷，或 Supabase 專案因閒置七天被暫停（請家長到 Supabase 後台按 Restore）。';
  if (/Invalid login credentials/i.test(raw)) return '家庭密碼不正確。';
  return raw;
}

/** 展開 { data, error }，有錯就丟例外 */
function unwrap(res) {
  if (res.error) throw new DBError(describe(res.error), res.error);
  return res.data;
}

async function q(fn) {
  const c = await getClient();
  return unwrap(await fn(c));
}

/* ------------------------------------------------------------------ */
/* 學生                                                                */
/* ------------------------------------------------------------------ */

export const students = {
  list: () => q(c => c.from('students').select('*').order('id', { ascending: true })),

  get: id => q(c => c.from('students').select('*').eq('id', id).maybeSingle()),

  update: (id, patch) =>
    q(c => c.from('students').update(patch).eq('id', id).select()),

  /** 首次改名。name_locked 為 true 時拒絕，由呼叫端改走管理者途徑。 */
  async rename(id, name) {
    const s = await students.get(id);
    if (!s) throw new DBError('找不到這個學生檔位。');
    if (s.name_locked) throw new DBError('這個名字已經設定過，只有老師可以修改。');
    return students.update(id, { name, name_locked: true });
  }
};

/* ------------------------------------------------------------------ */
/* 各科難度狀態                                                        */
/* ------------------------------------------------------------------ */

export const subjectState = {
  forStudent: studentId =>
    q(c => c.from('subject_state').select('*').eq('student_id', studentId)),

  get: (studentId, subject) =>
    q(c => c.from('subject_state').select('*')
      .eq('student_id', studentId).eq('subject', subject).maybeSingle()),

  upsert: row =>
    q(c => c.from('subject_state')
      .upsert({ ...row, updated_at: new Date().toISOString() },
              { onConflict: 'student_id,subject' }).select())
};

/* ------------------------------------------------------------------ */
/* 課堂                                                                */
/* ------------------------------------------------------------------ */

export const lessons = {
  forDate: (studentId, date) =>
    q(c => c.from('lessons').select('*')
      .eq('student_id', studentId).eq('lesson_date', date)
      .order('slot_of_day', { ascending: true })),

  get: id => q(c => c.from('lessons').select('*').eq('id', id).maybeSingle()),

  /**
   * 建立課堂。若同一天同一節次已存在（多裝置同時開啟），
   * 不視為錯誤，改回傳既有的那一筆。對應 Property 3。
   */
  async createIfAbsent(row) {
    const c = await getClient();
    const res = await c.from('lessons')
      .upsert(row, { onConflict: 'student_id,lesson_date,slot_of_day', ignoreDuplicates: true })
      .select();

    if (!res.error && res.data && res.data.length) return res.data[0];
    if (res.error && res.error.code !== '23505') throw new DBError(describe(res.error), res.error);

    const existing = await lessons.forDate(row.student_id, row.lesson_date);
    const hit = existing.find(l => l.slot_of_day === row.slot_of_day);
    if (!hit) throw new DBError('建立課堂失敗，且找不到既有的課堂。');
    return hit;
  },

  update: (id, patch) =>
    q(c => c.from('lessons').update(patch).eq('id', id).select()),

  history: (studentId, { limit = 30 } = {}) =>
    q(c => c.from('lessons').select('*')
      .eq('student_id', studentId)
      .order('lesson_date', { ascending: false })
      .limit(limit)),

  /** 待批改的課堂（管理者用） */
  pending: () =>
    q(c => c.from('lessons').select('*')
      .gt('pending_grading', 0)
      .order('submitted_at', { ascending: true })),

  /** 連續完成天數。從今天往回數，遇到沒完成的那天就停。 */
  async streak(studentId, todayStr, addDaysFn) {
    const rows = await q(c => c.from('lessons').select('lesson_date,status')
      .eq('student_id', studentId)
      .order('lesson_date', { ascending: false })
      .limit(400));

    const done = new Set(
      rows.filter(r => r.status === 'submitted' || r.status === 'graded')
          .map(r => r.lesson_date)
    );

    let n = 0, cursor = todayStr;
    while (done.has(cursor)) { n++; cursor = addDaysFn(cursor, -1); }
    return n;
  }
};

/* ------------------------------------------------------------------ */
/* 作答紀錄                                                            */
/* ------------------------------------------------------------------ */

export const attempts = {
  forLesson: lessonId =>
    q(c => c.from('attempts').select('*')
      .eq('lesson_id', lessonId).order('seq', { ascending: true })),

  bulkCreate: rows =>
    q(c => c.from('attempts').insert(rows).select()),

  update: (id, patch) =>
    q(c => c.from('attempts').update(patch).eq('id', id).select()),

  /** 管理者的批改佇列 */
  needingGrading: () =>
    q(c => c.from('attempts').select('*')
      .eq('needs_grading', true)
      .order('created_at', { ascending: true })),

  /** 某學生某科的近期紀錄，用於難度評估與統計 */
  recent: (studentId, subject, limit = 40) =>
    q(c => c.from('attempts').select('*')
      .eq('student_id', studentId).eq('subject', subject)
      .order('created_at', { ascending: false }).limit(limit)),

  /** 某學生做過的題目 id，用於避免短期內重複出題 */
  async recentQuestionKeys(studentId, limit = 200) {
    const rows = await q(c => c.from('attempts').select('question')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false }).limit(limit));
    return new Set(rows.map(r => r.question?.id || r.question?.gen?.id + ':' + r.question?.gen?.seed)
                       .filter(Boolean));
  }
};

/* ------------------------------------------------------------------ */
/* 知識點精熟                                                          */
/* ------------------------------------------------------------------ */

export const mastery = {
  forStudent: studentId =>
    q(c => c.from('topic_mastery').select('*').eq('student_id', studentId)),

  get: (studentId, topic) =>
    q(c => c.from('topic_mastery').select('*')
      .eq('student_id', studentId).eq('topic', topic).maybeSingle()),

  /** 到期該複習的知識點 */
  due: (studentId, date) =>
    q(c => c.from('topic_mastery').select('*')
      .eq('student_id', studentId).eq('mastered', false)
      .lte('due_on', date)
      .order('due_on', { ascending: true })),

  upsert: row =>
    q(c => c.from('topic_mastery')
      .upsert(row, { onConflict: 'student_id,topic' }).select())
};

/* ------------------------------------------------------------------ */
/* 積分                                                                */
/* ------------------------------------------------------------------ */

export const points = {
  /** 新增一筆流水。這張表只增不改，因此積分總額單調遞增（Property 1）。 */
  add: entry => q(c => c.from('points_ledger').insert(entry).select()),

  addMany: entries => q(c => c.from('points_ledger').insert(entries).select()),

  async total(studentId) {
    const rows = await q(c => c.from('points_ledger').select('points').eq('student_id', studentId));
    return rows.reduce((s, r) => s + Number(r.points), 0);
  },

  ledger: (studentId, limit = 100) =>
    q(c => c.from('points_ledger').select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false }).limit(limit))
};

/* ------------------------------------------------------------------ */
/* 勳章                                                                */
/* ------------------------------------------------------------------ */

export const badges = {
  list: studentId =>
    q(c => c.from('badges').select('*').eq('student_id', studentId)),

  /** 已擁有時不重複授予 */
  async grant(studentId, code, level) {
    const c = await getClient();
    const res = await c.from('badges')
      .upsert({ student_id: studentId, code, level },
              { onConflict: 'student_id,code,level', ignoreDuplicates: true })
      .select();
    if (res.error && res.error.code !== '23505') throw new DBError(describe(res.error), res.error);
    return res.data?.[0] ?? null;
  }
};

/* ------------------------------------------------------------------ */
/* 通知                                                                */
/* ------------------------------------------------------------------ */

export const notifications = {
  unread: studentId =>
    q(c => c.from('notifications').select('*')
      .eq('student_id', studentId).is('read_at', null)
      .order('created_at', { ascending: false })),

  add: (studentId, kind, payload = {}) =>
    q(c => c.from('notifications').insert({ student_id: studentId, kind, payload }).select()),

  markRead: ids =>
    q(c => c.from('notifications')
      .update({ read_at: new Date().toISOString() }).in('id', ids).select())
};

/* ------------------------------------------------------------------ */
/* 系統設定                                                            */
/* ------------------------------------------------------------------ */

export const settings = {
  async get() {
    const row = await q(c => c.from('app_settings').select('*').eq('id', 1).maybeSingle());
    return row || {
      id: 1, summer_start: '07-01', summer_end: '08-31',
      lessons_weekday: 1, lessons_summer: 2, target_minutes: 25, rotation: {}
    };
  },

  update: patch =>
    q(c => c.from('app_settings')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select())
};

/* ------------------------------------------------------------------ */
/* 管理者自訂題目                                                      */
/* ------------------------------------------------------------------ */

export const customQuestions = {
  list: (subject) => q(c => {
    let query = c.from('custom_questions').select('*').eq('enabled', true);
    if (subject) query = query.eq('subject', subject);
    return query;
  }),
  add: row => q(c => c.from('custom_questions').insert(row).select()),
  update: (id, patch) => q(c => c.from('custom_questions').update(patch).eq('id', id).select()),
  remove: id => q(c => c.from('custom_questions').delete().eq('id', id))
};

/* ------------------------------------------------------------------ */
/* 連線檢查                                                            */
/* ------------------------------------------------------------------ */

/** 輕量的連線測試，用於顯示離線狀態 */
export async function ping() {
  try {
    await q(c => c.from('app_settings').select('id').limit(1));
    return true;
  } catch {
    return false;
  }
}
