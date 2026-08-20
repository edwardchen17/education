/* ===== screens/admin/assign.js — 課堂指派（任務 12.3） =====
 * 對應需求 3.4、8.7：指派後標記為管理者指派，不被自動排課覆寫。
 */

import { escapeHtml, todayTW, addDays, fmtDateTW, fmtDuration } from '../../core.js';
import { subjectsFor, subjectLabel } from '../../config/subjects.js';
import { DIFFICULTIES, DIFFICULTY_LABEL } from '../../config/scoring.js';
import { STATIC_FILES } from '../../bank/index.js';
import { assignLesson, slotsForDate } from '../../engine/schedule.js';
import * as Auth from '../../auth.js';
import * as DB from '../../db.js';

let sel = { studentId: null, date: todayTW(), slot: 1, subject: null, difficulty: 'basic' };

export default { render };

async function render(host) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入中</div></div>`;

  const [students, settings] = await Promise.all([DB.students.list(), DB.settings.get()]);
  const usable = students.filter(s => s.level);

  if (!usable.length) {
    host.innerHTML = `<div class="card"><div class="banner banner-warn">
      還沒有學生設定程度。請先到「學生設定」指定國二上或小五上。
    </div></div>`;
    return;
  }

  if (!sel.studentId || !usable.some(s => s.id === sel.studentId)) sel.studentId = usable[0].id;
  const student = usable.find(s => s.id === sel.studentId);

  const subjects = subjectsFor(student.level);
  const ready = subjects.filter(s => s.code === 'math' || STATIC_FILES[s.code]?.[student.level]);
  if (!sel.subject || !ready.some(s => s.code === sel.subject)) sel.subject = ready[0]?.code || null;

  const maxSlot = Math.max(1, slotsForDate(sel.date, settings));
  if (sel.slot > maxSlot) sel.slot = maxSlot;

  const existing = await DB.lessons.forDate(student.id, sel.date);

  host.innerHTML = `
    <div class="card">
      <div class="card-title">課堂指派</div>
      <div class="t-sm t-dim">
        指派後這一堂會標記為老師指定，自動排課不會再動它。
        已經交卷的課堂不能重新指派。
      </div>
    </div>

    <div class="card">
      <div class="stack">
        <div>
          <label>學生</label>
          <div class="row" style="flex-wrap:wrap;gap:8px">
            ${usable.map(s => `<button data-stu="${s.id}"
              class="${sel.studentId === s.id ? 'btn-primary' : ''}">${escapeHtml(s.name)}</button>`).join('')}
          </div>
        </div>

        <div>
          <label>日期</label>
          <div class="row" style="flex-wrap:wrap;gap:8px">
            <button data-day="-1">前一天</button>
            <input type="date" id="date" value="${sel.date}" style="flex:1 1 160px">
            <button data-day="1">後一天</button>
          </div>
          <div class="t-sm t-dim" style="margin-top:6px">
            ${escapeHtml(fmtDateTW(sel.date))}　這一天預設 ${maxSlot} 堂
          </div>
        </div>

        <div>
          <label>第幾堂</label>
          <div class="row" style="flex-wrap:wrap;gap:8px">
            ${Array.from({ length: maxSlot }, (_, i) => i + 1).map(n => `
              <button data-slot="${n}" class="${sel.slot === n ? 'btn-primary' : ''}">第 ${n} 堂</button>`).join('')}
          </div>
        </div>

        <div>
          <label>科目</label>
          <div class="row" style="flex-wrap:wrap;gap:8px">
            ${subjects.map(s => {
              const ok = s.code === 'math' || !!STATIC_FILES[s.code]?.[student.level];
              return `<button data-sub="${s.code}" ${ok ? '' : 'disabled'}
                class="${sel.subject === s.code ? 'btn-primary' : ''}"
                title="${ok ? '' : '這一科還沒有題庫'}">${escapeHtml(s.label)}${ok ? '' : '（無題庫）'}</button>`;
            }).join('')}
          </div>
        </div>

        <div>
          <label>難度</label>
          <div class="row" style="flex-wrap:wrap;gap:8px">
            ${DIFFICULTIES.map(d => `<button data-diff="${d}"
              class="${sel.difficulty === d ? 'btn-primary' : ''}">${DIFFICULTY_LABEL[d]}</button>`).join('')}
          </div>
        </div>

        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:4px">
          <button id="go" class="btn-primary" ${sel.subject ? '' : 'disabled'}>指派這一堂</button>
          <span class="t-sm" id="msg"></span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${escapeHtml(student.name)} 在 ${escapeHtml(sel.date)} 的課堂</div>
      ${existing.length ? existing.map(l => `
        <div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--line)">
          <span>第 ${l.slot_of_day} 堂　<b>${escapeHtml(subjectLabel(l.subject, student.level))}</b>
            <span class="t-dim t-sm">${DIFFICULTY_LABEL[l.plan?.difficulty] || ''}　
              ${l.plan?.items?.length || 0} 題　${fmtDuration(l.plan?.seconds || 0)}</span></span>
          <span class="t-sm">
            ${l.assigned_by === 'admin' ? '<span class="t-warn">老師指定</span>' : '<span class="t-dim">自動</span>'}
            ${statusLabel(l.status)}
          </span>
        </div>`).join('')
        : '<div class="t-dim">這一天還沒有課堂。學生登入時會自動產生。</div>'}
    </div>`;

  bind(host, student, () => render(host));
}

function statusLabel(status) {
  return {
    pending: '<span class="t-dim">未開始</span>',
    active: '<span class="t-warn">作答中</span>',
    submitted: '<span class="t-warn">已交卷，待批改</span>',
    graded: '<span class="t-ok">已完成</span>'
  }[status] || '';
}

function bind(host, student, reload) {
  const $ = id => host.querySelector('#' + id);
  const touch = () => Auth.touchAdmin();

  host.querySelectorAll('[data-stu]').forEach(b => b.onclick = () => {
    touch(); sel.studentId = Number(b.dataset.stu); sel.subject = null; reload();
  });
  host.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => {
    touch(); sel.slot = Number(b.dataset.slot); reload();
  });
  host.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => {
    touch(); sel.subject = b.dataset.sub; reload();
  });
  host.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => {
    touch(); sel.difficulty = b.dataset.diff; reload();
  });
  host.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    touch(); sel.date = addDays(sel.date, Number(b.dataset.day)); reload();
  });
  $('date').onchange = e => {
    touch();
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { sel.date = e.target.value; reload(); }
  };

  $('go').onclick = async () => {
    touch();
    const msg = $('msg');
    msg.innerHTML = '<span class="t-dim">組課中…</span>';
    try {
      const lesson = await assignLesson({
        student, date: sel.date, slot: sel.slot,
        subject: sel.subject, difficulty: sel.difficulty
      });
      msg.innerHTML = `<span class="t-ok">已指派：${lesson.plan.items.length} 題，約 ${
        fmtDuration(lesson.plan.seconds)}</span>`;
      setTimeout(reload, 1200);
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };
}
