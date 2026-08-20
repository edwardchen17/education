/* ===== main.js — 進入點與雜湊路由 =====
 * 目前為任務 1.1 的骨架：只有路由機制與一個佔位畫面。
 * 後續任務會逐步把真正的畫面模組註冊進來。
 */

const APP_VERSION = '0.1.0-skeleton';

const app = document.getElementById('app');

/* ---------- 畫面註冊表 ----------
 * 每個畫面是一個 { render(host, params) } 物件。
 * 後續任務以 import 的方式把真實模組掛進來，取代 placeholder。
 */
const routes = new Map();

function register(name, screen) {
  routes.set(name, screen);
}

/* ---------- 路由 ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: name || 'home', params: rest };
}

async function navigate() {
  const { name, params } = parseHash();
  const screen = routes.get(name) || routes.get('notfound');
  app.innerHTML = '';
  try {
    await screen.render(app, params);
  } catch (err) {
    console.error('[render]', err);
    showError(err);
  }
}

export function go(path) {
  location.hash = '#/' + path;
}

/* ---------- 錯誤與載入畫面 ---------- */
function showError(err) {
  app.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="card-title">發生錯誤</div>
        <div class="banner banner-bad">${escapeHtml(err && err.message || String(err))}</div>
        <div class="t-sm t-dim" style="margin-top:12px">
          如果反覆出現，請把這段訊息告訴爸爸。
        </div>
      </div>
    </div>`;
}

export function showLoading(host, text = '載入中') {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>${escapeHtml(text)}</div></div>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------- 佔位畫面（任務 1.1） ---------- */
register('home', {
  render(host) {
    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">練習系統</div>
          <div class="stack">
            <div class="banner banner-ok">骨架部署成功，前端可正常載入。</div>
            <div class="t-sm t-dim">
              版本 ${APP_VERSION}<br>
              這是任務 1.1 的骨架頁，尚未實作任何功能。<br>
              接下來的任務會依序加入家庭登入、選擇學生、今日任務與作答畫面。
            </div>
            <div class="row" style="flex-wrap:wrap">
              <button onclick="location.hash='#/selftest'">環境自我檢查</button>
            </div>
          </div>
        </div>
      </div>`;
  }
});

register('notfound', {
  render(host) {
    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">找不到頁面</div>
          <div class="stack">
            <div class="t-dim">網址可能輸入錯了。</div>
            <div><button onclick="location.hash='#/home'">回到首頁</button></div>
          </div>
        </div>
      </div>`;
  }
});

/* 環境自我檢查：確認後續任務會用到的瀏覽器功能是否可用 */
register('selftest', {
  render(host) {
    const checks = [
      ['ES Modules', true],
      ['localStorage', hasLocalStorage()],
      ['Canvas 2D', !!document.createElement('canvas').getContext('2d')],
      ['WebAudio', !!(window.AudioContext || window.webkitAudioContext)],
      ['語音合成 SpeechSynthesis', 'speechSynthesis' in window],
      ['Service Worker', 'serviceWorker' in navigator],
      ['MathML 呈現', typeof MathMLElement === 'function'],
      ['Intl 時區支援', hasTimeZone()]
    ];
    const rows = checks.map(([name, ok]) => `
      <div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${escapeHtml(name)}</span>
        <span class="${ok ? 't-ok' : 't-warn'}">${ok ? '可用' : '不支援'}</span>
      </div>`).join('');

    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">環境自我檢查</div>
          ${rows}
          <div class="t-sm t-dim" style="margin-top:12px">
            台灣當地日期：${localDateTW()}<br>
            不支援的項目會讓對應功能自動停用，不影響其他部分。
          </div>
          <div class="row" style="margin-top:14px">
            <button onclick="location.hash='#/home'">返回</button>
          </div>
        </div>
      </div>`;
  }
});

function hasLocalStorage() {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
  catch { return false; }
}

function hasTimeZone() {
  try { return !!new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); }
  catch { return false; }
}

/** 台灣當地日期字串 YYYY-MM-DD。正式實作會移到 core.js（任務 2.1）。 */
function localDateTW(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

/* ---------- 啟動 ---------- */
window.addEventListener('hashchange', navigate);
if (!location.hash) location.hash = '#/home';
navigate();

console.log(`練習系統 ${APP_VERSION}`);
