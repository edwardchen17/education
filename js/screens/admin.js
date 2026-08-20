/* ===== screens/admin.js — 老師介面 =====
 *
 * 目前完成：密碼閘門、閒置自動退出、學生設定。
 * 批改介面、課堂指派、系統設定、統計報表在任務 12 完成。
 */

import { escapeHtml } from '../core.js';
import { LEVELS, ADMIN_IDLE_MS } from '../config.js';
import { DIFFICULTIES, DIFFICULTY_LABEL } from '../config/scoring.js';
import { subjectsFor } from '../config/subjects.js';
import * as Auth from '../auth.js';
import * as DB from '../db.js';

export default {
  async render(host) {
    if (!Auth.isAdmin()) { renderGate(host); return; }
    Auth.touchAdmin();
    await renderDash(host);
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
      </div>
    </div>`;

  const pw = host.querySelector('#pw');
  const msg = host.querySelector('#msg');

  const submit = async () => {
    if (Auth.enterAdmin(pw.value)) {
      pw.value = '';
      await renderDash(host);
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
/* 主畫面                                                              */
/* ------------------------------------------------------------------ */

async function renderDash(host) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入中</div></div>`;

  const [list, pendingLessons, pendingAttempts] = await Promise.all([
    DB.students.list(),
    DB.lessons.pending().catch(() => []),
    DB.attempts.needingGrading().catch(() => [])
  ]);

  host.innerHTML = `
    <div class="wrap">
      <div class="card">
        <div class="row-between" style="flex-wrap:wrap;gap:8px">
          <div class="card-title" style="border:none;padding:0;margin:0">老師介面</div>
          <button id="exit" class="btn-mini">退出</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">待批改</div>
        ${pendingAttempts.length
          ? `<div class="banner banner-warn">
               有 <b>${pendingAttempts.length}</b> 篇作文或簡答等待批改，
               分佈在 ${pendingLessons.length} 堂課。
             </div>
             <div class="t-sm t-dim" style="margin-top:10px">
               批改介面正在開發（任務 12.4）。在完成之前，學生交卷後看得到客觀題的分數，
               作文會顯示為「暫定成績」並排在這裡等候。
             </div>`
          : '<div class="banner banner-ok">目前沒有待批改的作文。</div>'}
      </div>

      <div class="card">
        <div class="card-title">學生設定</div>
        <div id="students"></div>
      </div>

      <div class="card">
        <div class="card-title">其他</div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button data-go="preview">題庫預覽</button>
          <button data-go="diag">診斷工具</button>
          <button data-go="students">回學生選擇</button>
        </div>
        <div class="t-sm t-dim" style="margin-top:10px">
          課堂指派、系統設定（暑假日期、每日堂數、科目輪替）與統計報表在任務 12 完成。
        </div>
      </div>
    </div>`;

  host.querySelector('#exit').onclick = () => { Auth.exitAdmin(); location.hash = '#/students'; };
  host.querySelectorAll('[data-go]').forEach(b =>
    b.onclick = () => { location.hash = '#/' + b.dataset.go; });

  await renderStudents(host, list);

  /* 閒置自動退出後把畫面收回密碼頁 */
  Auth.onAdminChange(on => {
    if (!on && location.hash.startsWith('#/admin')) renderGate(host);
  });
}

/* ------------------------------------------------------------------ */
/* 學生設定（需求 3.3、2.4、12.6）                                     */
/* ------------------------------------------------------------------ */

async function renderStudents(host, list) {
  const box = host.querySelector('#students');
  const states = {};
  for (const s of list) {
    states[s.id] = await DB.subjectState.forStudent(s.id).catch(() => []);
  }

  box.innerHTML = list.map(s => {
    const subjects = s.level ? subjectsFor(s.level) : [];
    const st = states[s.id] || [];
    return `
      <div class="admin-student">
        <div class="row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
          <div style="flex:1 1 160px">
            <label>名字</label>
            <input data-name="${s.id}" value="${escapeHtml(s.name)}" maxlength="12">
          </div>
          <div style="flex:1 1 160px">
            <label>程度</label>
            <select data-level="${s.id}">
              <option value="" ${!s.level ? 'selected' : ''}>未設定</option>
              ${Object.values(LEVELS).map(l =>
                `<option value="${l.code}" ${s.level === l.code ? 'selected' : ''}>${l.label}</option>`
              ).join('')}
            </select>
          </div>
          <button data-save="${s.id}" class="btn-primary">儲存</button>
        </div>

        ${subjects.length ? `
          <div class="t-sm t-dim" style="margin:10px 0 6px">各科難度（鎖定後不會自動調整）</div>
          <div class="admin-diffs">
            ${subjects.map(sub => {
              const cur = st.find(x => x.subject === sub.code);
              const d = cur?.difficulty || 'basic';
              return `
                <div class="admin-diff">
                  <span>${escapeHtml(sub.label)}</span>
                  <select data-diff="${s.id}:${sub.code}">
                    ${DIFFICULTIES.map(x =>
                      `<option value="${x}" ${d === x ? 'selected' : ''}>${DIFFICULTY_LABEL[x]}</option>`
                    ).join('')}
                  </select>
                  <label class="lockbox">
                    <input type="checkbox" data-lock="${s.id}:${sub.code}" ${cur?.locked ? 'checked' : ''}>
                    鎖定
                  </label>
                </div>`;
            }).join('')}
          </div>` : ''}

        <div class="t-sm" data-msg="${s.id}" style="margin-top:8px"></div>
      </div>`;
  }).join('');

  box.querySelectorAll('[data-save]').forEach(btn => btn.onclick = async () => {
    Auth.touchAdmin();
    const id = Number(btn.dataset.save);
    const msg = box.querySelector(`[data-msg="${id}"]`);
    const name = box.querySelector(`[data-name="${id}"]`).value.trim();
    const level = box.querySelector(`[data-level="${id}"]`).value || null;

    if (!name) { msg.innerHTML = '<span class="t-warn">名字不能空白</span>'; return; }

    try {
      await DB.students.update(id, { name, level, name_locked: true });

      // 各科難度
      const diffs = box.querySelectorAll(`[data-diff^="${id}:"]`);
      for (const sel of diffs) {
        const subject = sel.dataset.diff.split(':')[1];
        const lock = box.querySelector(`[data-lock="${id}:${subject}"]`);
        const cur = await DB.subjectState.get(id, subject);
        await DB.subjectState.upsert({
          student_id: id,
          subject,
          difficulty: sel.value,
          locked: !!lock?.checked,
          recent: Array.isArray(cur?.recent) ? cur.recent : []
        });
      }
      msg.innerHTML = '<span class="t-ok">已儲存</span>';
      setTimeout(() => { msg.innerHTML = ''; }, 2500);
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  });
}
