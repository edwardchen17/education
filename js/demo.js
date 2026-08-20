/* ===== demo.js — 訪客試用模式 =====
 *
 * 一條可以公開分享的連結：#/demo
 *
 * 為什麼不直接在資料庫開第五個檔位：
 *   RLS 的規則是「登入家庭帳號就能讀寫全部資料」。若訪客走正式流程，
 *   就必須知道家庭密碼，那他也能看到並修改兩個孩子的姓名、成績與作文。
 *   所以訪客模式完全不連後端，改注入一個瀏覽器內的本機資料庫。
 *
 * 模式旗標放在 sessionStorage，所以：
 *   · 同一個分頁重新載入仍在試用模式，作答不會中斷
 *   · 關掉分頁就結束，痕跡不留
 *   · 家人在同一台電腦另開分頁，完全不受影響
 */

import { injectClient } from './db.js';
import { makeLocalClient, clearLocalStore } from './local.js';

const FLAG = 'edu.demo.on';

/** 訪客的學生 id。刻意用大號碼，與正式檔位的 1~4 分開。 */
export const DEMO_STUDENT_ID = 9001;

export const DEMO_NAME = '我只是遊學生';

/** 試用模式只練這一科。國二數學，進階難度起跳。 */
export const DEMO_SUBJECT = 'math';
export const DEMO_LEVEL = 'g8';
export const DEMO_DEFAULT_DIFFICULTY = 'advanced';

/** 試用模式下可以走的路由，其餘一律導回試用首頁 */
export const DEMO_ROUTES = new Set(['demo', 'lesson', 'result', 'help']);

let active = false;

/* ------------------------------------------------------------------ */
/* 模式切換                                                            */
/* ------------------------------------------------------------------ */

export function isDemo() { return active; }

/** 進入試用模式：注入本機資料庫並備好訪客檔位 */
export function enterDemo() {
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* 無痕模式可能不給寫，記憶體旗標仍有效 */ }
  activate();
}

/** 頁面啟動時呼叫。若這個分頁先前已進入試用模式就恢復。 */
export function resumeDemo() {
  let flagged = false;
  try { flagged = sessionStorage.getItem(FLAG) === '1'; } catch { /* 讀不到就當作沒有 */ }
  if (flagged) activate();
  return flagged;
}

function activate() {
  active = true;
  injectClient(makeLocalClient(seedData()));
}

/** 離開試用模式。必須重新載入頁面，才能讓 db.js 重建真正的 Supabase 用戶端。 */
export function exitDemo() {
  try { sessionStorage.removeItem(FLAG); } catch { /* 忽略 */ }
  clearLocalStore();
  active = false;
}

/** 清空試用資料但留在試用模式，等於「重新開始」 */
export function resetDemo() {
  clearLocalStore();
  activate();
}

/** 取得目前的學生 id。試用模式恆為訪客檔位，不看 localStorage。 */
export function currentStudentId() {
  if (active) return DEMO_STUDENT_ID;
  return Number(localStorage.getItem('edu.currentStudent') || 0);
}

/* ------------------------------------------------------------------ */
/* 種子資料                                                            */
/* ------------------------------------------------------------------ */

function seedData() {
  return {
    students: [{
      id: DEMO_STUDENT_ID,
      name: DEMO_NAME,
      level: DEMO_LEVEL,
      name_locked: true,
      settings: {},
      active: true,
      created_at: new Date().toISOString()
    }],

    subject_state: [{
      student_id: DEMO_STUDENT_ID,
      subject: DEMO_SUBJECT,
      difficulty: DEMO_DEFAULT_DIFFICULTY,
      locked: true,           // 試用不做自動升降難度，難度由訪客自己選
      recent: [],
      updated_at: new Date().toISOString()
    }],

    app_settings: [{
      id: 1,
      summer_start: '07-01', summer_end: '08-31',
      lessons_weekday: 1, lessons_summer: 2,
      target_minutes: 25, rotation: {}
    }],

    lessons: [], attempts: [], topic_mastery: [],
    points_ledger: [], badges: [], notifications: [],
    custom_questions: []
  };
}
