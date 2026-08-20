/* ===== screens/students.js — 選擇學生 =====
 * 對應需求 2.1 至 2.4：點名字就能開始，不需要密碼；
 * 未曾改名的檔位可自行改名一次，之後只有老師能改。
 */

import { escapeHtml } from '../core.js';
import { LEVELS } from '../config.js';
import { subjectsFor } from '../config/subjects.js';
import * as DB from '../db.js';
import * as Auth from '../auth.js';

export default {
  async render(host) {
    host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入中</div></div>`;

    let list;
    try {
      list = await DB.students.list();
    } catch (err) {
      host.innerHTML = `<div class="wrap"><div class="card">
        <div class="card-title">連不上資料</div>
        <div class="banner banner-bad">${escapeHtml(err.message)}</div>
        <div class="row" style="margin-top:14px">
          <button id="relogin">重新輸入家庭密碼</button>
        </div></div></div>`;
      host.querySelector('#relogin').onclick = async () => {
        await Auth.signOutDevice();
        location.hash = '#/gate';
      };
      return;
    }

    /* session 過期時查詢會回傳空陣列而不是錯誤，所以要另外判斷 */
    if (!list.length) {
      await Auth.signOutDevice();
      location.hash = '#/gate';
      return;
    }

    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">今天誰要練習？</div>
          <div class="student-grid">
            ${list.map(cardHtml).join('')}
          </div>
        </div>

        <div class="card">
          <div class="row" style="flex-wrap:wrap;gap:8px">
            <button data-go="admin">老師登入</button>
            <span class="grow"></span>
            <button id="logout" class="t-dim">登出這台裝置</button>
          </div>
        </div>
      </div>`;

    host.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => {
      const id = Number(el.dataset.pick);
      const s = list.find(x => x.id === id);
      if (!s.level) { askLevel(host, s); return; }
      if (!s.name_locked) { askName(host, s); return; }
      enter(id);
    });

    host.querySelectorAll('[data-go]').forEach(b =>
      b.onclick = () => { location.hash = '#/' + b.dataset.go; });

    host.querySelector('#logout').onclick = async () => {
      if (!confirm('登出後，這台裝置下次要重新輸入家庭密碼。要登出嗎？')) return;
      localStorage.removeItem('edu.currentStudent');
      await Auth.signOutDevice();
      location.hash = '#/gate';
    };
  }
};

function cardHtml(s) {
  const subjects = s.level ? subjectsFor(s.level) : [];
  return `
    <button class="student-card" data-pick="${s.id}">
      <div class="student-avatar">${escapeHtml(s.name.slice(0, 1))}</div>
      <div class="student-name">${escapeHtml(s.name)}</div>
      <div class="t-sm t-dim">${s.level ? LEVELS[s.level].label : '還沒設定程度'}</div>
      ${subjects.length ? `<div class="t-sm t-dim" style="margin-top:4px">${
        subjects.map(x => x.label).join('、')}</div>` : ''}
      ${!s.name_locked ? '<div class="t-sm t-warn" style="margin-top:6px">可以改成自己的名字</div>' : ''}
    </button>`;
}

function enter(id) {
  localStorage.setItem('edu.currentStudent', String(id));
  location.hash = '#/home';
}

/* ------------------------------------------------------------------ */
/* 首次改名（需求 2.3）                                                */
/* ------------------------------------------------------------------ */

function askName(host, s) {
  host.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="card-title">你想用什麼名字？</div>
        <div class="t-sm t-dim" style="margin-bottom:14px">
          這個名字只能自己改一次，之後要請爸爸幫你改。
          目前是「${escapeHtml(s.name)}」，想保留就直接按「就用這個」。
        </div>
        <label for="nm">名字</label>
        <input id="nm" value="${escapeHtml(s.name)}" maxlength="12" enterkeyhint="go">
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:14px">
          <button id="save" class="btn-primary">改成這個名字</button>
          <button id="keep">就用這個，不改</button>
          <button data-back>回上一頁</button>
        </div>
        <div id="msg" class="t-sm" style="margin-top:10px"></div>
      </div>
    </div>`;

  const nm = host.querySelector('#nm');
  const msg = host.querySelector('#msg');

  host.querySelector('#save').onclick = async () => {
    const name = nm.value.trim();
    if (!name) { msg.innerHTML = '<span class="t-warn">名字不能空白</span>'; return; }
    try {
      await DB.students.rename(s.id, name);
      enter(s.id);
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };

  /* 不改名字也要上鎖，否則每次進來都會被問一次 */
  host.querySelector('#keep').onclick = async () => {
    try { await DB.students.rename(s.id, s.name); } catch { /* 已上鎖就算了 */ }
    enter(s.id);
  };

  host.querySelector('[data-back]').onclick = () => { location.hash = '#/students'; location.reload(); };
  nm.focus();
  nm.select();
}

/* ------------------------------------------------------------------ */
/* 尚未設定程度                                                        */
/* ------------------------------------------------------------------ */

function askLevel(host, s) {
  host.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="card-title">${escapeHtml(s.name)} 還沒有設定程度</div>
        <div class="banner banner-warn">
          要先由老師設定程度（國二上或小五上），才能開始練習。
        </div>
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:14px">
          <button data-go="admin" class="btn-primary">去老師介面設定</button>
          <button data-go="students">回上一頁</button>
        </div>
      </div>
    </div>`;
  host.querySelectorAll('[data-go]').forEach(b =>
    b.onclick = () => {
      location.hash = '#/' + b.dataset.go;
      if (b.dataset.go === 'students') location.reload();
    });
}
