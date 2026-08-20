/* ===== screens/admin.js — 老師介面外殼 =====
 * 密碼閘門、閒置自動退出、分頁切換。各分頁在 screens/admin/ 下。
 */

import { escapeHtml } from '../core.js';
import { ADMIN_IDLE_MS, APP_VERSION } from '../config.js';
import * as Auth from '../auth.js';
import * as DB from '../db.js';

import grading from './admin/grading.js';
import studentsPanel from './admin/studentsPanel.js';
import assign from './admin/assign.js';
import settings from './admin/settings.js';

const TABS = [
  { id: 'grading', label: '批改', panel: grading },
  { id: 'students', label: '學生', panel: studentsPanel },
  { id: 'assign', label: '指派', panel: assign },
  { id: 'settings', label: '設定', panel: settings }
];

let activeTab = 'grading';
let unsubscribe = null;

export default {
  async render(host, params) {
    if (params?.[0] && TABS.some(t => t.id === params[0])) activeTab = params[0];

    if (!Auth.isAdmin()) { renderGate(host); return; }
    Auth.touchAdmin();
    await renderShell(host);
  },

  teardown() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }
};

/* ------------------------------------------------------------------ */
/* 密碼閘門                                                            */
/* ------------------------------------------------------------------ */

function renderGate(host) {
  host.innerHTML = `
    <div class="gate-wrap">
      <div class="card gate-card">
        <div class="gate-title">老師</div>
        <div class="t-sm t-dim" style="margin-bottom:16px">
          請輸入管理者密碼。閒置 ${Math.round(ADMIN_IDLE_MS / 60000)} 分鐘會自動退出。
        </div>
        <label for="pw">管理者密碼</label>
        <input id="pw" type="password" inputmode="numeric" enterkeyhint="go">
        <div class="row" style="margin-top:14px">
          <button id="go" class="btn-primary grow">進入</button>
        </div>
        <div class="row" style="margin-top:10px">
          <button data-go="students" class="grow t-dim">回學生選擇</button>
        </div>
        <div id="msg" class="t-sm" style="margin-top:12px"></div>
        <div class="build-tag">版本 ${APP_VERSION}</div>
      </div>
    </div>`;

  const pw = host.querySelector('#pw');
  const msg = host.querySelector('#msg');

  const submit = async () => {
    if (Auth.enterAdmin(pw.value)) {
      pw.value = '';
      await renderShell(host);
    } else {
      msg.innerHTML = '<span class="t-bad">密碼不對</span>';
      pw.select();
    }
  };

  host.querySelector('#go').onclick = submit;
  pw.onkeydown = e => { if (e.key === 'Enter') submit(); };
  host.querySelector('[data-go]').onclick = () => { location.hash = '#/students'; };
  pw.focus();
}

/* ------------------------------------------------------------------ */
/* 外殼                                                                */
/* ------------------------------------------------------------------ */

async function renderShell(host) {
  const pendingCount = await DB.attempts.needingGrading().then(r => r.length).catch(() => 0);

  host.innerHTML = `
    <div class="admin-top glass">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <b class="t-gold">老師</b>
        <span class="grow"></span>
        <button id="exit" class="btn-mini">退出</button>
      </div>
      <div class="tabs">
        ${TABS.map(t => `
          <button class="tab ${activeTab === t.id ? 'on' : ''}" data-tab="${t.id}">
            ${t.label}${t.id === 'grading' && pendingCount ? `<span class="tab-badge">${pendingCount}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>
    <div class="wrap" id="panel"></div>
    <div class="wrap">
      <div class="card">
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button data-go="preview">題庫預覽</button>
          <button data-go="diag">診斷工具</button>
          <button data-go="students">回學生選擇</button>
        </div>
        <div class="build-tag">版本 ${APP_VERSION}</div>
      </div>
    </div>`;

  host.querySelector('#exit').onclick = () => { Auth.exitAdmin(); location.hash = '#/students'; };
  host.querySelectorAll('[data-go]').forEach(b =>
    b.onclick = () => { location.hash = '#/' + b.dataset.go; });
  host.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    Auth.touchAdmin();
    activeTab = b.dataset.tab;
    renderShell(host);
  });

  const panel = host.querySelector('#panel');
  const tab = TABS.find(t => t.id === activeTab) || TABS[0];
  try {
    await tab.panel.render(panel);
  } catch (err) {
    panel.innerHTML = `<div class="card">
      <div class="card-title">這個分頁載入失敗</div>
      <div class="banner banner-bad">${escapeHtml(err.message)}</div>
    </div>`;
  }

  /* 閒置逾時後把畫面收回密碼頁 */
  if (unsubscribe) unsubscribe();
  unsubscribe = Auth.onAdminChange(on => {
    if (!on && location.hash.startsWith('#/admin')) renderGate(host);
  });
}
