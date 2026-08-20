/* ===== auth.js — 家庭驗證與管理者閘門 =====
 *
 * 家庭驗證：以固定的 email 加上使用者輸入的密碼登入 Supabase。
 * session 由 supabase-js 保存在 localStorage 並自動續期，
 * 因此每台裝置只需要輸入一次密碼。本檔不保存密碼本身。
 *
 * 管理者閘門：純前端比對密碼，用來避免小孩誤入老師介面。
 * 這不是安全邊界，是刻意的設計取捨（見 requirements 需求 3.10）。
 */

import { FAMILY_EMAIL, ADMIN_PASSWORD, ADMIN_IDLE_MS } from './config.js';
import { getClient, DBError } from './db.js';

/* ------------------------------------------------------------------ */
/* 家庭驗證                                                            */
/* ------------------------------------------------------------------ */

/** 目前是否已通過家庭驗證 */
export async function hasSession() {
  try {
    const c = await getClient();
    const { data } = await c.auth.getSession();
    return !!data?.session;
  } catch {
    return false;
  }
}

/** 以家庭密碼登入。成功回傳 true，密碼錯誤丟出 DBError。 */
export async function signIn(password) {
  const c = await getClient();
  const { data, error } = await c.auth.signInWithPassword({
    email: FAMILY_EMAIL,
    password: String(password || '')
  });

  if (error) {
    if (/Invalid login credentials/i.test(error.message)) {
      throw new DBError('家庭密碼不正確，請再試一次。');
    }
    if (/Failed to fetch|NetworkError|fetch failed/i.test(error.message)) {
      throw new DBError('無法連上伺服器。請檢查網路，或確認 Supabase 專案沒有因閒置被暫停。');
    }
    throw new DBError(error.message);
  }

  return !!data?.session;
}

/** 登出此裝置，清除本機的登入狀態 */
export async function signOutDevice() {
  const c = await getClient();
  await c.auth.signOut();
  exitAdmin();
}

/** 註冊登入狀態變化的監聽器 */
export async function onSessionChange(fn) {
  const c = await getClient();
  return c.auth.onAuthStateChange((event, session) => fn(event, session));
}

/* ------------------------------------------------------------------ */
/* 管理者閘門                                                          */
/* ------------------------------------------------------------------ */

let adminUntil = 0;
let idleTimer = null;
const adminListeners = new Set();

function notify() {
  const on = isAdmin();
  adminListeners.forEach(fn => { try { fn(on); } catch (e) { console.error(e); } });
}

/** 訂閱管理者狀態變化（例如閒置自動退出時要收起管理選單） */
export function onAdminChange(fn) {
  adminListeners.add(fn);
  return () => adminListeners.delete(fn);
}

/** 嘗試進入管理者模式 */
export function enterAdmin(password) {
  if (String(password) !== ADMIN_PASSWORD) return false;
  touchAdmin();
  notify();
  return true;
}

/** 目前是否在管理者模式 */
export function isAdmin() {
  return Date.now() < adminUntil;
}

/** 有操作時呼叫，重置閒置計時 */
export function touchAdmin() {
  if (adminUntil === 0 && idleTimer === null) {
    // 首次進入
  } else if (!isAdmin() && adminUntil !== 0) {
    return;   // 已經逾時，不因操作而復活
  }
  adminUntil = Date.now() + ADMIN_IDLE_MS;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    adminUntil = 0;
    idleTimer = null;
    notify();
  }, ADMIN_IDLE_MS);
}

/** 主動退出管理者模式 */
export function exitAdmin() {
  adminUntil = 0;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  notify();
}

/** 剩餘的管理者時間（毫秒），供介面顯示 */
export function adminRemaining() {
  return Math.max(0, adminUntil - Date.now());
}

/** 若未在管理者模式則丟出例外，供管理功能的入口自我保護 */
export function requireAdmin() {
  if (!isAdmin()) throw new DBError('需要老師權限，請重新輸入管理者密碼。');
}
