/* ===== screens/admin/studentsPanel.js — 學生設定 =====
 * 對應需求 2.4、3.3、12.6：改名、設定程度、各科難度與鎖定。
 */

import { escapeHtml } from '../../core.js';
import { LEVELS } from '../../config.js';
import { DIFFICULTIES, DIFFICULTY_LABEL } from '../../config/scoring.js';
import { subjectsFor } from '../../config/subjects.js';
import { accuracyOf } from '../../engine/grade.js';
import * as Auth from '../../auth.js';
import * as DB from '../../db.js';

export default { render };

async function render(host) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入學生</div></div>`;

  const list = await DB.students.list();
  const states = {};
  const totals = {};
  for (const s of list) {
    states[s.id] = await DB.subjectState.forStudent(s.id).catch(() => []);
    totals[s.id] = await DB.points.total(s.id).catch(() => 0);
  }

  host.innerHTML = `
    <div class="card">
      <div class="card-title">學生設定</div>
      <div class="t-sm t-dim">
        難度會依最近 20 題的答對率自動調整（答對率八成五以上升一階、五成以下降一階）。
        勾選「鎖定」就固定在你設定的階級，不再自動變動。
      </div>
    </div>
    ${list.map(s => cardHtml(s, states[s.id], totals[s.id])).join('')}`;

  list.forEach(s => bindCard(host, s, states[s.id], () => render(host)));
}

function cardHtml(s, st, total) {
  const subjects = s.level ? subjectsFor(s.level) : [];
  return `
    <div class="card" data-stu="${s.id}">
      <div class="row-between" style="flex-wrap:wrap;gap:8px">
        <div class="row" style="gap:10px;align-items:center">
          <div class="student-avatar" style="width:38px;height:38px;font-size:17px;margin:0">
            ${escapeHtml(s.name.slice(0, 1))}</div>
          <div>
            <div style="font-size:17px">${escapeHtml(s.name)}</div>
            <div class="t-dim t-sm">累積 ${Math.round(total)} 積分</div>
          </div>
        </div>
        <button data-save="${s.id}" class="btn-primary">儲存</button>
      </div>

      <div class="grid-2" style="margin-top:12px">
        <div>
          <label>名字</label>
          <input data-name="${s.id}" value="${escapeHtml(s.name)}" maxlength="12">
        </div>
        <div>
          <label>程度</label>
          <select data-level="${s.id}">
            <option value="" ${!s.level ? 'selected' : ''}>未設定</option>
            ${Object.values(LEVELS).map(l =>
              `<option value="${l.code}" ${s.level === l.code ? 'selected' : ''}>${l.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      ${subjects.length ? `
        <div class="t-sm t-dim" style="margin:14px 0 6px">各科難度</div>
        <div class="admin-diffs">
          ${subjects.map(sub => {
            const cur = (st || []).find(x => x.subject === sub.code);
            const d = cur?.difficulty || 'basic';
            const acc = accuracyOf(cur?.recent);
            const n = Array.isArray(cur?.recent) ? cur.recent.length : 0;
            return `
              <div class="admin-diff">
                <span>${escapeHtml(sub.label)}</span>
                <select data-diff="${s.id}:${sub.code}">
                  ${DIFFICULTIES.map(x =>
                    `<option value="${x}" ${d === x ? 'selected' : ''}>${DIFFICULTY_LABEL[x]}</option>`
                  ).join('')}
                </select>
                <label class="lockbox">
                  <input type="checkbox" data-lock="${s.id}:${sub.code}" ${cur?.locked ? 'checked' : ''}>鎖定
                </label>
                <span class="t-dim t-sm" style="flex:0 0 5.5em;text-align:right">
                  ${acc === null ? '尚無紀錄' : `${Math.round(acc * 100)}%（${n} 題）`}
                </span>
              </div>`;
          }).join('')}
        </div>` : `
        <div class="banner banner-warn" style="margin-top:12px">
          還沒設定程度，這個檔位無法開始練習。
        </div>`}

      <div class="t-sm" data-msg="${s.id}" style="margin-top:10px"></div>
    </div>`;
}

function bindCard(host, s, st, reload) {
  const card = host.querySelector(`[data-stu="${s.id}"]`);
  if (!card) return;

  card.querySelectorAll('input,select').forEach(el => {
    el.oninput = () => Auth.touchAdmin();
    el.onchange = () => Auth.touchAdmin();
  });

  card.querySelector(`[data-save="${s.id}"]`).onclick = async () => {
    Auth.touchAdmin();
    const msg = card.querySelector(`[data-msg="${s.id}"]`);
    const name = card.querySelector(`[data-name="${s.id}"]`).value.trim();
    const level = card.querySelector(`[data-level="${s.id}"]`).value || null;

    if (!name) { msg.innerHTML = '<span class="t-warn">名字不能空白</span>'; return; }

    msg.innerHTML = '<span class="t-dim">儲存中…</span>';
    try {
      await DB.students.update(s.id, { name, level, name_locked: true });

      for (const selEl of card.querySelectorAll(`[data-diff^="${s.id}:"]`)) {
        const subject = selEl.dataset.diff.split(':')[1];
        const lock = card.querySelector(`[data-lock="${s.id}:${subject}"]`);
        const cur = (st || []).find(x => x.subject === subject);
        await DB.subjectState.upsert({
          student_id: s.id,
          subject,
          difficulty: selEl.value,
          locked: !!lock?.checked,
          recent: Array.isArray(cur?.recent) ? cur.recent : []
        });
      }
      msg.innerHTML = '<span class="t-ok">已儲存</span>';
      setTimeout(reload, 1200);
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };
}
