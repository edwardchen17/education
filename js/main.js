/* ===== main.js — 進入點與路由 =====
 *
 * 路由規則：除了家庭密碼頁，所有畫面都需要已通過家庭驗證。
 * 注意不能靠「查詢有沒有出錯」判斷登入狀態——RLS 之下未登入的查詢
 * 會回傳空陣列而不是錯誤，所以一定要明確檢查 session。
 */

import { APP_VERSION } from './config.js';
import { escapeHtml } from './core.js';
import * as Auth from './auth.js';
import { watchNetwork, isOnline, OfflineQueue } from './cache.js';

import gate from './screens/gate.js';
import students from './screens/students.js';
import home from './screens/home.js';
import lesson from './screens/lesson.js';
import result from './screens/result.js';
import history from './screens/history.js';
import admin from './screens/admin.js';
import preview from './screens/preview.js';
import diag from './screens/diag.js';

const app = document.getElementById('app');

const routes = {
  gate, students, home, lesson, result, history, admin, preview, diag
};

/** 不需要家庭驗證就能開的畫面 */
const PUBLIC = new Set(['gate']);

let currentScreen = null;

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...params] = raw.split('/');
  return { name: name || 'home', params };
}

async function navigate() {
  const { name, params } = parseHash();

  // 離開前讓上一個畫面收尾（例如作答畫面要停掉計時器並存檔）
  if (currentScreen && typeof currentScreen.teardown === 'function') {
    try { currentScreen.teardown(); } catch (e) { console.error(e); }
  }
  currentScreen = null;

  const screen = routes[name];
  if (!screen) { renderNotFound(); return; }

  if (!PUBLIC.has(name)) {
    const signed = await Auth.hasSession();
    if (!signed) { location.hash = '#/gate'; return; }
  }

  app.innerHTML = '';
  currentScreen = screen;

  try {
    await screen.render(app, params);
  } catch (err) {
    console.error('[render]', err);
    renderError(err);
  }

  renderOfflineBadge();
}

function renderNotFound() {
  app.innerHTML = `
    <div class="wrap"><div class="card">
      <div class="card-title">找不到頁面</div>
      <div class="t-dim">網址可能輸入錯了。</div>
      <div class="row" style="margin-top:14px">
        <button onclick="location.hash='#/home'">回到首頁</button>
      </div>
      <div class="build-tag">版本 ${APP_VERSION}</div>
    </div></div>`;
}

function renderError(err) {
  app.innerHTML = `
    <div class="wrap"><div class="card">
      <div class="card-title">發生錯誤</div>
      <div class="banner banner-bad">${escapeHtml(err?.message || String(err))}</div>
      <div class="t-sm t-dim" style="margin-top:10px">
        如果一直出現，請把這段訊息告訴爸爸。
      </div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:14px">
        <button onclick="location.reload()">重新載入</button>
        <button onclick="location.hash='#/home'">回到今日任務</button>
      </div>
      <div class="build-tag">版本 ${APP_VERSION}</div>
    </div></div>`;
}

/* ------------------------------------------------------------------ */
/* 離線提示                                                            */
/* ------------------------------------------------------------------ */

function renderOfflineBadge() {
  document.getElementById('netbadge')?.remove();
  const pending = OfflineQueue.size();
  if (isOnline() && !pending) return;

  const el = document.createElement('div');
  el.id = 'netbadge';
  el.className = 'banner ' + (isOnline() ? 'banner-warn' : 'banner-bad');
  el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:60;text-align:center';
  el.innerHTML = isOnline()
    ? `有 ${pending} 筆資料還沒送出，連上網路後會自動補送。`
    : '目前沒有網路。你的作答會先存在這台裝置上，等連上網路再送出。';
  document.body.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* 啟動                                                                */
/* ------------------------------------------------------------------ */

watchNetwork();
window.addEventListener('online', renderOfflineBadge);
window.addEventListener('offline', renderOfflineBadge);
window.addEventListener('hashchange', navigate);

// 關閉或切走頁面時，讓作答畫面把進度存下來
window.addEventListener('beforeunload', () => {
  if (currentScreen && typeof currentScreen.teardown === 'function') currentScreen.teardown();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentScreen?.teardown) currentScreen.teardown();
});

if (!location.hash) location.hash = '#/home';
navigate();

console.log(`練習系統 ${APP_VERSION}`);
