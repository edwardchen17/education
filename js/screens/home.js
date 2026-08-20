/* ===== screens/home.js — 今日任務 =====
 *
 * 對應需求 8.8 至 8.11、9.6：
 *   顯示今日任務與完成狀態、未完成提示、連續天數、未讀通知
 *   過往未完成的任務不累積成待辦清單，避免造成壓力
 */

import { escapeHtml, todayTW, fmtDateTW, fmtDuration } from '../core.js';
import { LEVELS } from '../config.js';
import { subjectLabel, SUBJECT_META } from '../config/subjects.js';
import { DIFFICULTY_LABEL } from '../config/scoring.js';
import { todaySummary } from '../engine/schedule.js';
import { Draft } from '../cache.js';
import * as DB from '../db.js';

export default {
  async render(host) {
    const id = Number(localStorage.getItem('edu.currentStudent') || 0);
    if (!id) { location.hash = '#/students'; return; }

    host.innerHTML = `<div class="loading"><div class="spinner"></div><div>看看今天要做什麼</div></div>`;

    let student, summary, points, notes;
    try {
      student = await DB.students.get(id);
      if (!student) { localStorage.removeItem('edu.currentStudent'); location.hash = '#/students'; return; }
      [summary, points, notes] = await Promise.all([
        todaySummary(student, todayTW()),
        DB.points.total(id),
        DB.notifications.unread(id)
      ]);
    } catch (err) {
      host.innerHTML = `<div class="wrap"><div class="card">
        <div class="card-title">連不上資料</div>
        <div class="banner banner-bad">${escapeHtml(err.message)}</div>
        <div class="row" style="margin-top:14px">
          <button onclick="location.reload()">重試</button>
          <button data-go="students">換人</button>
        </div></div></div>`;
      bindNav(host);
      return;
    }

    const drafts = Draft.list();

    host.innerHTML = `
      <div class="wrap">
        <div class="card hero">
          <div class="row-between" style="flex-wrap:wrap;gap:10px">
            <div>
              <div class="hero-name">${escapeHtml(student.name)}</div>
              <div class="t-sm t-dim">${LEVELS[student.level]?.label || ''}　${fmtDateTW(summary.date)}</div>
            </div>
            <div class="hero-stats">
              <div><b class="t-gold">${Math.round(points)}</b><span class="t-dim t-sm"> 積分</span></div>
              <div><b class="${summary.streak > 0 ? 't-ok' : 't-dim'}">${summary.streak}</b><span class="t-dim t-sm"> 天連續</span></div>
            </div>
          </div>
        </div>

        ${noticeHtml(notes)}

        <div class="card">
          <div class="card-title">今天的課</div>
          ${taskHtml(summary, student, drafts)}
        </div>

        <div class="card">
          <div class="row" style="flex-wrap:wrap;gap:8px">
            <button data-go="history">看以前的考卷</button>
            <button data-go="help">怎麼用</button>
            <span class="grow"></span>
            <button data-go="students">換人</button>
          </div>
        </div>
      </div>`;

    bindNav(host);

    /* 通知讀過就標記，避免每次進來都跳同一則 */
    if (notes.length) {
      DB.notifications.markRead(notes.map(n => n.id)).catch(() => {});
    }
  }
};

function taskHtml(summary, student, drafts) {
  if (!summary.lessons.length) {
    return `<div class="banner banner-warn">
      今天沒有排到課。可能是題庫還沒準備好，或是老師還沒設定程度。
    </div>`;
  }

  const rows = summary.lessons.map(l => {
    const meta = SUBJECT_META[l.subject] || {};
    const done = l.status === 'submitted' || l.status === 'graded';
    const draft = drafts.find(d => d.lessonId === l.id);
    const started = l.status === 'active' || draft;

    let action, cls, note;
    if (done) {
      const provisional = l.pending_grading > 0;
      action = '看成績';
      cls = 'task-done';
      note = provisional
        ? `<span class="t-warn">暫定 ${round1(l.score_earned)} / ${round1(l.score_max)} 分，作文待批改</span>`
        : `<span class="t-ok">${round1(l.score_earned)} / ${round1(l.score_max)} 分</span>`;
    } else if (started) {
      action = '繼續作答';
      cls = 'task-active';
      note = `<span class="t-warn">寫到一半，可以接著寫</span>`;
    } else {
      action = '開始';
      cls = '';
      note = `<span class="t-dim">${l.plan.items.length} 題　約 ${fmtDuration(l.plan.seconds)}</span>`;
    }

    return `
      <div class="task ${cls}">
        <div class="task-icon" style="background:${meta.color || 'var(--accent)'}">${meta.icon || ''}</div>
        <div class="grow">
          <div class="task-title">
            ${escapeHtml(subjectLabel(l.subject, student.level))}
            <span class="t-dim t-sm">第 ${l.slot_of_day} 堂　${DIFFICULTY_LABEL[l.plan.difficulty] || ''}</span>
            ${l.assigned_by === 'admin' ? '<span class="t-warn t-sm">　老師指定</span>' : ''}
          </div>
          <div class="t-sm">${note}</div>
        </div>
        <button class="${done ? '' : 'btn-primary'}"
          data-open="${done ? 'result' : 'lesson'}:${l.id}">${action}</button>
      </div>`;
  }).join('');

  const hint = summary.allDone
    ? `<div class="banner banner-ok" style="margin-top:12px">
         今天的課都完成了，辛苦了。連續 ${summary.streak} 天。
       </div>`
    : `<div class="banner banner-warn" style="margin-top:12px">
         <b>你今天有 ${summary.total - summary.done} 堂課還沒完成</b>，記得做完喔。
       </div>`;

  return rows + hint;
}

function noticeHtml(notes) {
  if (!notes.length) return '';
  const items = notes.map(n => {
    if (n.kind === 'graded') {
      const p = n.payload || {};
      return `老師改好你的<b>${escapeHtml(p.date || '')} ${escapeHtml(subjectLabel(p.subject) || '')}</b>了，
              成績是 ${round1(p.score)} / ${round1(p.max)} 分。`;
    }
    if (n.kind === 'difficulty') {
      const p = n.payload || {};
      return `你的${escapeHtml(subjectLabel(p.subject) || '')}難度調整為
              <b>${DIFFICULTY_LABEL[p.to] || p.to}</b>了。`;
    }
    if (n.kind === 'badge') {
      return `你獲得了新的勳章：<b>${escapeHtml(n.payload?.name || '')}</b>。`;
    }
    return escapeHtml(JSON.stringify(n.payload || {}));
  });

  return `<div class="card">
    <div class="card-title">有新消息</div>
    ${items.map(t => `<div class="banner banner-ok" style="margin-bottom:8px">${t}</div>`).join('')}
  </div>`;
}

function bindNav(host) {
  host.querySelectorAll('[data-go]').forEach(b =>
    b.onclick = () => { location.hash = '#/' + b.dataset.go; });
  host.querySelectorAll('[data-open]').forEach(b =>
    b.onclick = () => {
      const [screen, id] = b.dataset.open.split(':');
      location.hash = `#/${screen}/${id}`;
    });
}

const round1 = v => Math.round((Number(v) || 0) * 10) / 10;
