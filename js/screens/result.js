/* ===== screens/result.js — 交卷結果與考卷檢討 =====
 *
 * 交卷後全面開放解題邏輯，且不再計為「看過解答」（需求 6.8）。
 * 含作文的課堂顯示為暫定成績（需求 9.2）。
 * 這個畫面同時用於歷史考卷檢討（需求 9.8、任務 10.5）。
 */

import { escapeHtml, fmtDuration, fmtDateTW } from '../core.js';
import { renderMath } from '../engine/mathfmt.js';
import { answerDisplay } from '../engine/answer.js';
import { DIFFICULTY_LABEL } from '../config/scoring.js';
import { subjectLabel } from '../config/subjects.js';
import { topicLabel } from '../config/topics.js';
import * as DB from '../db.js';

const LETTERS = 'ABCDEFGH';
const TYPE_LABEL = { mc: '單選', mmc: '多選', fill: '填空', calc: '計算', short: '簡答', essay: '作文' };

export default {
  async render(host, params) {
    const lessonId = Number(params[0]);
    host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入成績</div></div>`;

    const lesson = await DB.lessons.get(lessonId);
    if (!lesson) {
      host.innerHTML = card('找不到考卷', '<div class="banner banner-bad">這堂課不存在。</div>');
      return;
    }
    const [student, rows] = await Promise.all([
      DB.students.get(lesson.student_id),
      DB.attempts.forLesson(lessonId)
    ]);

    const provisional = lesson.pending_grading > 0;
    const earned = Number(lesson.score_earned) || 0;
    const max = Number(lesson.score_max) || 0;
    const pct = max > 0 ? Math.round(earned / max * 100) : 0;

    const objective = rows.filter(r => !r.needs_grading && r.qtype !== 'essay' && r.qtype !== 'short');
    const correct = objective.filter(r => r.is_correct && !r.revealed).length;
    const peeked = rows.filter(r => r.revealed).length;

    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">
            ${escapeHtml(subjectLabel(lesson.subject, student?.level))}　
            ${escapeHtml(fmtDateTW(lesson.lesson_date))}
          </div>

          <div class="score-hero">
            <div class="score-num ${provisional ? 't-warn' : 't-gold'}">${round1(earned)}</div>
            <div class="score-sub">/ ${round1(max)} 分　${pct}%</div>
          </div>

          ${provisional ? `<div class="banner banner-warn">
            這是<b>暫定成績</b>。作文還要等老師批改，批改完成後分數會補上，
            下次進來會看到通知。</div>` : ''}

          <div class="grid-2" style="margin-top:12px">
            <div class="prow"><span>客觀題答對</span><b>${correct} / ${objective.length}</b></div>
            <div class="prow"><span>看過解答</span><b>${peeked} 題</b></div>
            <div class="prow"><span>作答時間</span><b>${fmtDuration(lesson.timer_seconds)}</b></div>
            <div class="prow"><span>獲得積分</span><b class="t-gold">${round1(lesson.points_awarded || 0)}</b></div>
          </div>

          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:14px">
            <button data-go="home" class="btn-primary">回到今日任務</button>
            <button id="expandAll">全部展開</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">逐題檢討</div>
          <div class="t-sm t-dim">
            交卷之後解題邏輯全部開放，看多少次都不會再扣分。
            答錯的題目過幾天會再出一次同類型的題目。
          </div>
        </div>

        ${rows.map((r, i) => attemptCard(r, i + 1, student)).join('')}
      </div>`;

    host.querySelectorAll('[data-go]').forEach(b =>
      b.onclick = () => { location.hash = '#/' + b.dataset.go; });
    host.querySelector('#expandAll').onclick = () =>
      host.querySelectorAll('details').forEach(d => { d.open = true; });
  }
};

/* ------------------------------------------------------------------ */

function attemptCard(r, no, student) {
  const q = r.question;
  const writing = r.qtype === 'essay' || r.qtype === 'short';

  let mark, markCls;
  if (writing) {
    if (r.needs_grading) { mark = '待批改'; markCls = 't-warn'; }
    else { mark = `${round1(r.score)} / ${round1(r.max_score)} 分`; markCls = 't-gold'; }
  } else if (r.revealed) {
    mark = '看過解答，不計分'; markCls = 't-warn';
  } else if (r.is_correct) {
    mark = '答對'; markCls = 't-ok';
  } else {
    mark = '答錯'; markCls = 't-bad';
  }

  return `
    <div class="card">
      <div class="row-between t-sm t-dim" style="flex-wrap:wrap;gap:6px">
        <span><b class="t-gold">${no}.</b> ${TYPE_LABEL[r.qtype]}　
          ${DIFFICULTY_LABEL[r.difficulty] || ''}　
          <span class="${markCls}">${mark}</span></span>
        <span>${escapeHtml(topicLabel(r.topic))}</span>
      </div>

      ${q.passage ? `
        <details style="margin-top:8px">
          <summary style="cursor:pointer;color:var(--accent-2);font-size:13px">
            ${escapeHtml(q.passage.title)}（點開看文章）</summary>
          <div class="passage selectable" style="margin-top:6px">
            <div class="passage-body">${escapeHtml(q.passage.text).replace(/\n/g, '<br>')}</div>
          </div>
        </details>` : ''}

      <div class="stem selectable" style="margin:10px 0">
        ${renderMath(writing ? (q.prompt || q.stem) : q.stem)}</div>

      ${answerBlock(r, q)}

      <details style="margin-top:10px">
        <summary style="cursor:pointer;color:var(--accent-2);font-size:14px">
          ${writing ? '看評分規準與範文' : '看解題邏輯'}</summary>
        <div style="margin-top:8px">${rationale(q, r)}</div>
      </details>
    </div>`;
}

function answerBlock(r, q) {
  const raw = r.answer?.raw;

  if (q.options) {
    const mine = q.type === 'mmc'
      ? (Array.isArray(raw) ? raw.map(Number) : [])
      : (raw === undefined || raw === null ? [] : [Number(raw)]);
    return `<div class="opts">${q.options.map((o, i) => {
      const chosen = mine.includes(i);
      const cls = ['opt', 'opt-static',
        chosen ? 'mine' : '',
        o.correct ? 'right' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}">
        <span class="opt-key">${LETTERS[i]}</span>
        <span class="opt-text selectable">${renderMath(o.text)}</span>
        <span class="opt-tag">${chosen ? '你選的' : ''}${o.correct ? '　成立' : ''}</span>
      </div>`;
    }).join('')}</div>`;
  }

  if (r.qtype === 'essay' || r.qtype === 'short') {
    const g = r.grade;
    return `
      <div class="passage selectable">
        <div class="passage-head">你寫的</div>
        <div class="passage-body">${escapeHtml(String(raw || '（空白）')).replace(/\n/g, '<br>')}</div>
      </div>
      ${g ? `
        <div class="banner banner-ok" style="margin-top:10px">
          <b>老師的評語</b><br>${escapeHtml(g.comment || '（沒有寫評語）').replace(/\n/g, '<br>')}
        </div>` : `
        <div class="banner banner-warn" style="margin-top:10px">還沒批改。</div>`}`;
  }

  const shown = raw === undefined || raw === '' ? '（沒有作答）' : String(raw);
  return `
    <div class="grid-2">
      <div class="prow"><span>你填的</span><b class="${r.is_correct ? 't-ok' : 't-bad'}">${escapeHtml(shown)}</b></div>
      <div class="prow"><span>答案</span><b class="t-gold">${renderMath(answerDisplay(q))}</b></div>
    </div>`;
}

function rationale(q, r) {
  if (q.options) {
    return q.options.map((o, i) => `
      <div class="rat-row">
        <div class="${o.correct ? 't-ok' : 't-bad'}" style="font-size:13px">
          (${LETTERS[i]}) ${o.correct ? '這個成立' : '這個不成立'}</div>
        <div class="t-sm selectable" style="margin-top:3px">${renderMath(o.why)}</div>
      </div>`).join('');
  }
  if (q.steps) {
    return q.steps.map(s => `
      <div class="rat-row">
        <div class="selectable">${renderMath(s.expr)}</div>
        ${s.why ? `<div class="t-sm t-dim" style="margin-top:3px">${renderMath(s.why)}</div>` : ''}
      </div>`).join('');
  }
  if (q.rubric) {
    const rows = q.rubric.map(x => `
      <div class="rat-row">
        <div class="t-gold" style="font-size:13px">${escapeHtml(x.item)}　${x.points} 分</div>
        <div class="t-sm t-dim" style="margin-top:3px">${escapeHtml(x.desc)}</div>
      </div>`).join('');
    /* 範文交卷後才顯示（需求 6.4） */
    return rows + (q.sample ? `
      <div class="t-gold" style="margin-top:12px;font-size:13px">範文</div>
      <div class="passage selectable" style="margin-top:6px">
        <div class="passage-body">${escapeHtml(q.sample).replace(/\n/g, '<br>')}</div>
      </div>` : '');
  }
  return '<div class="t-dim">這一題沒有提供解析。</div>';
}

const round1 = v => Math.round((Number(v) || 0) * 10) / 10;

function card(title, body) {
  return `<div class="wrap"><div class="card">
    <div class="card-title">${escapeHtml(title)}</div>${body}
    <div class="row" style="margin-top:14px">
      <button onclick="location.hash='#/home'">回到今日任務</button>
    </div>
  </div></div>`;
}
