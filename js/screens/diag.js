/* ===== screens/diag.js — 診斷工具（給家長用） =====
 * 連線與 RLS 驗證、瀏覽器能力檢查、數學式與答案比對。
 */

import { APP_VERSION } from '../config.js';
import { escapeHtml, todayTW, fmtDateTW } from '../core.js';
import { renderMath } from '../engine/mathfmt.js';
import { parseNumeric } from '../engine/answer.js';
import { OfflineQueue, isOnline } from '../cache.js';
import * as Auth from '../auth.js';
import * as DB from '../db.js';

export default {
  async render(host) {
    const signed = await Auth.hasSession();

    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">診斷工具</div>
          <div class="t-sm t-dim">
            版本 ${APP_VERSION}　${fmtDateTW(todayTW())}<br>
            家庭登入：<b class="${signed ? 't-ok' : 't-warn'}">${signed ? '已登入' : '未登入'}</b>　
            網路：<b class="${isOnline() ? 't-ok' : 't-warn'}">${isOnline() ? '連線中' : '離線'}</b>　
            待補送 ${OfflineQueue.size()} 筆
          </div>
          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:14px">
            <button id="btnRead">讀取資料</button>
            <button id="btnRls">測試 RLS 保護</button>
            <button data-go="preview">題庫預覽</button>
            <button data-go="admin">回老師介面</button>
          </div>
          <div id="out" class="t-sm" style="margin-top:12px"></div>
        </div>

        <div class="card">
          <div class="card-title">瀏覽器能力</div>
          ${capsHtml()}
        </div>

        <div class="card">
          <div class="card-title">數學式呈現</div>
          ${SAMPLES.map(s => `
            <div style="padding:9px 0;border-bottom:1px solid var(--line)">
              <div style="font-size:1.12em">${renderMath(s)}</div>
              <div class="t-dim t-sm selectable" style="margin-top:3px">${escapeHtml(s)}</div>
            </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-title">答案比對</div>
          <div class="t-sm t-dim">
            試著輸入 3/4、0.75、6/8、1 1/2、2√3、18 km、１８，看系統讀不讀得懂。
          </div>
          <label for="ans" style="margin-top:10px">輸入一個答案</label>
          <input id="ans" placeholder="例如 3/4">
          <div id="parsed" class="t-sm" style="margin-top:8px"></div>
        </div>
      </div>`;

    host.querySelectorAll('[data-go]').forEach(b =>
      b.onclick = () => { location.hash = '#/' + b.dataset.go; });

    const out = html => host.querySelector('#out').innerHTML = html;

    host.querySelector('#btnRead').onclick = async () => {
      out('讀取中…');
      try {
        const [list, cfg] = await Promise.all([DB.students.list(), DB.settings.get()]);
        out(`<div class="banner banner-ok">讀到 ${list.length} 個學生檔位，整條路徑正常。</div>
          <div class="t-dim" style="margin-top:8px">
            ${list.map(s => `${escapeHtml(s.name)}（${s.level || '未設定'}）`).join('、')}<br>
            暑假 ${cfg.summer_start} 至 ${cfg.summer_end}、平日 ${cfg.lessons_weekday} 堂、
            暑假 ${cfg.lessons_summer} 堂、每堂 ${cfg.target_minutes} 分鐘
          </div>`);
      } catch (err) {
        out(`<span class="t-bad">${escapeHtml(err.message)}</span>`);
      }
    };

    host.querySelector('#btnRls').onclick = () => rlsTest(host, out);
  }
};

/* ------------------------------------------------------------------ */

const SAMPLES = [
  '\\frac{3}{4} + \\frac{1}{2}',
  'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
  '\\sqrt[3]{27} = 3',
  '\\triangle ABC \\parallel \\overline{DE}',
  '2^{10} = 1024',
  '\\angle A = 60\\deg'
];

function capsHtml() {
  const checks = [
    ['localStorage', hasLocalStorage()],
    ['Canvas 2D', !!document.createElement('canvas').getContext('2d')],
    ['WebAudio', !!(window.AudioContext || window.webkitAudioContext)],
    ['語音合成 SpeechSynthesis', 'speechSynthesis' in window],
    ['Service Worker', 'serviceWorker' in navigator],
    ['MathML 呈現', typeof MathMLElement === 'function'],
    ['Intl 時區支援', hasTimeZone()]
  ];
  return checks.map(([n, ok]) => `
    <div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--line)">
      <span>${escapeHtml(n)}</span>
      <span class="${ok ? 't-ok' : 't-warn'}">${ok ? '可用' : '不支援'}</span>
    </div>`).join('');
}

/**
 * RLS 三步驗證。
 * 重點：PostgREST 在 RLS 之下對 SELECT 是「過濾資料列」而不是回傳錯誤，
 * 所以未登入時讀到 0 筆才是正常。寫入才會觸發 42501 權限錯誤。
 */
async function rlsTest(host, out) {
  const steps = [];
  const paint = () => out(`<div class="stack">${steps.map(s => `
    <div class="row" style="gap:8px;align-items:flex-start">
      <span class="${s.pass === null ? 't-dim' : s.pass ? 't-ok' : 't-bad'}"
            style="flex:0 0 1.4em">${s.pass === null ? '…' : s.pass ? '✓' : '✗'}</span>
      <span>${s.text}</span>
    </div>`).join('')}</div>`);
  const step = text => { steps.push({ text, pass: null }); paint(); return steps[steps.length - 1]; };

  try {
    const s1 = step('已登入時讀取學生資料');
    if (!await Auth.hasSession()) {
      s1.pass = false;
      s1.text = '需要先登入才能測試';
      paint();
      return;
    }
    const before = await DB.students.list();
    s1.pass = before.length === 4;
    s1.text = `已登入時讀到 <b>${before.length}</b> 筆${s1.pass ? '' : '（預期 4 筆）'}`;
    paint();

    const s2 = step('登出後讀取');
    await Auth.signOutDevice();
    let after = [];
    try { after = await DB.students.list(); } catch { /* 被直接拒絕也算通過 */ }
    s2.pass = after.length === 0;
    s2.text = `登出後讀到 <b>${after.length}</b> 筆${
      s2.pass ? '（RLS 已把資料列全部過濾掉）' : '　<b>這是問題</b>'}`;
    paint();

    const s3 = step('登出後嘗試寫入');
    try {
      await DB.notifications.add(1, 'rls_probe', { note: '權限測試' });
      s3.pass = false;
      s3.text = '登出後竟然寫入成功　<b>這是嚴重問題</b>';
    } catch (err) {
      s3.pass = true;
      s3.text = `登出後寫入被拒絕：<span class="t-dim">${escapeHtml(err.message)}</span>`;
    }
    paint();

    const allPass = steps.every(s => s.pass);
    steps.push({
      pass: allPass,
      text: allPass
        ? '<b class="t-ok">RLS 設定正確。</b>外人拿到網頁裡的金鑰既讀不到也寫不進資料。'
        : '<b class="t-bad">有項目未通過</b>，請把畫面截圖給我。'
    });
    steps.push({ pass: true, text: '<span class="t-dim">測試過程中已登出，請重新輸入家庭密碼。</span>' });
    paint();
    setTimeout(() => { location.hash = '#/gate'; }, 2500);
  } catch (err) {
    out(`<span class="t-bad">${escapeHtml(err.message)}</span>`);
  }
}

function hasLocalStorage() {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
  catch { return false; }
}

function hasTimeZone() {
  try { return !!new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); }
  catch { return false; }
}
