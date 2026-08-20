/* ===== screens/history.js — 歷史考卷清單（任務 10.5） =====
 * 對應需求 9.8、13.1、13.7
 */

import { escapeHtml, fmtDateTW, fmtDuration } from '../core.js';
import { subjectLabel, SUBJECT_META } from '../config/subjects.js';
import { DIFFICULTY_LABEL } from '../config/scoring.js';
import * as DB from '../db.js';

export default {
  async render(host) {
    const id = Number(localStorage.getItem('edu.currentStudent') || 0);
    if (!id) { location.hash = '#/students'; return; }

    host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入紀錄</div></div>`;

    const student = await DB.students.get(id);
    const [list, total] = await Promise.all([
      DB.lessons.history(id, { limit: 60 }),
      DB.points.total(id)
    ]);

    const done = list.filter(l => l.status === 'submitted' || l.status === 'graded');

    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">${escapeHtml(student.name)} 的練習紀錄</div>
          <div class="grid-2">
            <div class="prow"><span>累積積分</span><b class="t-gold">${Math.round(total)}</b></div>
            <div class="prow"><span>完成堂數</span><b>${done.length}</b></div>
          </div>
        </div>

        ${done.length === 0 ? `
          <div class="card"><div class="banner banner-warn">
            還沒有完成任何課程。回到今日任務開始第一堂吧。
          </div></div>` : ''}

        ${bySubject(done, student)}

        <div class="card">
          <div class="card-title">全部紀錄</div>
          ${done.map(l => rowHtml(l, student)).join('') || '<div class="t-dim">沒有紀錄</div>'}
        </div>

        <div class="card">
          <div class="row"><button data-go="home">回到今日任務</button></div>
        </div>
      </div>`;

    host.querySelectorAll('[data-go]').forEach(b =>
      b.onclick = () => { location.hash = '#/' + b.dataset.go; });
    host.querySelectorAll('[data-open]').forEach(b =>
      b.onclick = () => { location.hash = `#/result/${b.dataset.open}`; });
  }
};

/** 各科目的正確率概況（需求 13.1） */
function bySubject(list, student) {
  if (!list.length) return '';

  const agg = {};
  for (const l of list) {
    const a = agg[l.subject] || (agg[l.subject] = { n: 0, earned: 0, max: 0 });
    a.n++;
    a.earned += Number(l.score_earned) || 0;
    a.max += Number(l.score_max) || 0;
  }

  const rows = Object.entries(agg).map(([sub, a]) => {
    const pct = a.max > 0 ? Math.round(a.earned / a.max * 100) : 0;
    const meta = SUBJECT_META[sub] || {};
    return `
      <div class="prow" style="align-items:center">
        <span><span class="dot" style="background:${meta.color || 'var(--accent)'}"></span>
          ${escapeHtml(subjectLabel(sub, student.level))}</span>
        <b>${pct}%<span class="t-dim t-sm"> · ${a.n} 堂</span></b>
      </div>
      <div class="bar"><i style="width:${pct}%;background:${meta.color || 'var(--accent)'}"></i></div>`;
  }).join('');

  return `<div class="card"><div class="card-title">各科表現</div>${rows}</div>`;
}

function rowHtml(l, student) {
  const meta = SUBJECT_META[l.subject] || {};
  const provisional = l.pending_grading > 0;
  const pct = l.score_max > 0 ? Math.round(l.score_earned / l.score_max * 100) : 0;

  return `
    <div class="task" style="cursor:pointer" data-open="${l.id}">
      <div class="task-icon" style="background:${meta.color || 'var(--accent)'}">${meta.icon || ''}</div>
      <div class="grow">
        <div class="task-title">
          ${escapeHtml(subjectLabel(l.subject, student.level))}
          <span class="t-dim t-sm">${escapeHtml(fmtDateTW(l.lesson_date))}</span>
        </div>
        <div class="t-sm t-dim">
          ${DIFFICULTY_LABEL[l.plan?.difficulty] || ''}　
          ${fmtDuration(l.timer_seconds)}　
          ${provisional ? '<span class="t-warn">作文待批改</span>' : ''}
        </div>
      </div>
      <div style="text-align:right">
        <b class="${provisional ? 't-warn' : pct >= 80 ? 't-ok' : pct >= 60 ? 't-gold' : 't-bad'}">${pct}%</b>
        <div class="t-dim t-sm">${round1(l.score_earned)} / ${round1(l.score_max)}</div>
      </div>
    </div>`;
}

const round1 = v => Math.round((Number(v) || 0) * 10) / 10;
