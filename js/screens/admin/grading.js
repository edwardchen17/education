/* ===== screens/admin/grading.js — 批改介面（任務 12.4） =====
 *
 * 對應需求 3.6、3.7、9.3 至 9.7、9.9：
 *   顯示題目、學生作答、評分規準與配分
 *   依評分規準逐項給分、標註問題段落、撰寫評語
 *   全部批改完成後課堂轉為正式成績、補上積分並產生通知
 *   可修改任何已批改過的分數與評語
 */

import { escapeHtml, fmtDuration, fmtDateTW, countWords } from '../../core.js';
import { renderMath } from '../../engine/mathfmt.js';
import { subjectLabel } from '../../config/subjects.js';
import { DIFFICULTY_LABEL } from '../../config/scoring.js';
import { applyTeacherGrade, reviseGrade, scaleRubric } from '../../engine/grade.js';
import * as Auth from '../../auth.js';
import * as DB from '../../db.js';

export default { render };

async function render(host) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入待批改</div></div>`;

  const [pending, students] = await Promise.all([
    DB.attempts.needingGrading(),
    DB.students.list()
  ]);

  const lessonIds = [...new Set(pending.map(a => a.lesson_id))];
  const lessons = {};
  for (const id of lessonIds) lessons[id] = await DB.lessons.get(id);

  const nameOf = id => students.find(s => s.id === id)?.name || `學生 ${id}`;
  const levelOf = id => students.find(s => s.id === id)?.level;

  host.innerHTML = `
    <div class="card">
      <div class="card-title">待批改　${pending.length} 篇</div>
      ${pending.length === 0
        ? '<div class="banner banner-ok">目前沒有待批改的作文或簡答。</div>'
        : `<div class="t-sm t-dim">
             批改完一堂課的全部作文後，該堂的成績會從「暫定」轉為正式，
             積分自動補上，學生下次登入會收到通知。
           </div>`}
      <div class="row" style="margin-top:12px">
        <button id="showGraded" class="btn-mini">看已批改的（可修改分數）</button>
      </div>
    </div>

    <div id="queue">
      ${pending.map(a => cardHtml(a, lessons[a.lesson_id], nameOf(a.student_id), levelOf(a.student_id))).join('')}
    </div>
    <div id="gradedBox"></div>`;

  pending.forEach(a => bindCard(host, a, () => render(host)));

  host.querySelector('#showGraded').onclick = () => showGraded(host, students);
}

/* ------------------------------------------------------------------ */
/* 單篇批改卡                                                          */
/* ------------------------------------------------------------------ */

function cardHtml(a, lesson, name, level, isRevise = false) {
  const q = a.question;
  const rubric = q.rubric || [];
  const rubricMax = rubric.reduce((s, r) => s + r.points, 0) || Number(a.max_score);
  const written = String(a.answer?.raw ?? '');
  const words = countWords(written);
  const g = a.grade || {};
  const cur = {};
  (g.items || []).forEach((v, i) => { cur[i] = v; });

  return `
    <div class="card grade-card" data-att="${a.id}">
      <div class="row-between t-sm t-dim" style="flex-wrap:wrap;gap:6px">
        <span><b class="t-gold">${escapeHtml(name)}</b>　
          ${escapeHtml(subjectLabel(a.subject, level))}　
          ${lesson ? escapeHtml(fmtDateTW(lesson.lesson_date)) : ''}　
          ${DIFFICULTY_LABEL[a.difficulty] || ''}</span>
        <span>${a.qtype === 'essay' ? '作文' : '簡答'}　滿分 ${round1(a.max_score)}</span>
      </div>

      <details style="margin-top:8px">
        <summary style="cursor:pointer;color:var(--accent-2);font-size:13px">題目</summary>
        <div class="passage" style="margin-top:6px">
          <div class="passage-body selectable">${renderMath(q.prompt || q.stem || '')}</div>
        </div>
      </details>

      <div class="row-between t-sm" style="margin:12px 0 6px">
        <span class="t-dim">學生寫的</span>
        <span class="${words >= (q.min_words || 0) ? 't-ok' : 't-warn'}">
          ${words} 字${q.min_words ? ` / 要求 ${q.min_words} 字` : ''}　
          <span class="t-dim">寫了 ${fmtDuration(a.seconds)}</span>
        </span>
      </div>

      <div class="passage essay-body selectable" data-essay="${a.id}">
        <div class="passage-body">${escapeHtml(written || '（空白）').replace(/\n/g, '<br>')}</div>
      </div>

      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
        <button class="btn-mini" data-mark="${a.id}">把選取的文字加為標註</button>
        <span class="t-dim t-sm">先用滑鼠選取文中的一段，再按這個鈕</span>
      </div>
      <div class="marks" data-marks="${a.id}">${marksHtml(g.marks || [])}</div>

      ${rubric.length ? `
        <div class="t-sm t-dim" style="margin:14px 0 6px">
          評分規準（以 ${rubricMax} 分為基準，系統會依難度換算為滿分 ${round1(a.max_score)} 分）
        </div>
        <div class="rubric">
          ${rubric.map((r, i) => `
            <div class="rubric-row">
              <div class="grow">
                <div>${escapeHtml(r.item)}</div>
                <div class="t-dim t-sm">${escapeHtml(r.desc)}</div>
              </div>
              <div class="rubric-input">
                <input type="number" min="0" max="${r.points}" step="0.5"
                       data-rub="${a.id}:${i}" value="${cur[i] ?? ''}"
                       placeholder="0" inputmode="decimal">
                <span class="t-dim">/ ${r.points}</span>
              </div>
            </div>`).join('')}
        </div>
        <div class="row-between" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
          <span>合計</span>
          <b data-sum="${a.id}" class="t-gold">—</b>
        </div>` : `
        <div style="margin-top:12px">
          <label>分數（滿分 ${round1(a.max_score)}）</label>
          <input type="number" min="0" max="${a.max_score}" step="0.5"
                 data-direct="${a.id}" value="${a.score ?? ''}" inputmode="decimal">
        </div>`}

      <div style="margin-top:12px">
        <label for="cm-${a.id}">評語</label>
        <textarea id="cm-${a.id}" rows="3" data-comment="${a.id}"
          placeholder="寫給孩子的話，例如哪裡寫得好、哪裡可以再想一想">${escapeHtml(g.comment || '')}</textarea>
      </div>

      <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:12px">
        <button class="btn-primary" data-save="${a.id}">${isRevise ? '更新分數' : '完成批改'}</button>
        <span class="t-sm" data-msg="${a.id}"></span>
      </div>
    </div>`;
}

function marksHtml(marks) {
  if (!marks.length) return '';
  return marks.map((m, i) => `
    <div class="mark-row">
      <div class="grow">
        <div class="mark-quote">「${escapeHtml(m.text)}」</div>
        <input value="${escapeHtml(m.note || '')}" data-marknote="${i}" placeholder="這裡想說什麼">
      </div>
      <button class="btn-mini" data-markdel="${i}">刪除</button>
    </div>`).join('');
}

/* ------------------------------------------------------------------ */
/* 互動                                                                */
/* ------------------------------------------------------------------ */

function bindCard(host, a, onDone, isRevise = false) {
  const card = host.querySelector(`[data-att="${a.id}"]`);
  if (!card) return;

  const q = a.question;
  const rubric = q.rubric || [];
  const marks = [...((a.grade && a.grade.marks) || [])];

  const msg = card.querySelector(`[data-msg="${a.id}"]`);
  const sumEl = card.querySelector(`[data-sum="${a.id}"]`);

  const rubricInputs = [...card.querySelectorAll(`[data-rub^="${a.id}:"]`)];

  const recalc = () => {
    if (!rubric.length) return null;
    const items = rubricInputs.map(el => Number(el.value) || 0);
    const r = scaleRubric(items, rubric, Number(a.max_score));
    if (sumEl) {
      sumEl.textContent = `${round1(r.sum)} / ${r.rubricMax}　→　實得 ${round1(r.score)}`;
    }
    return { items, ...r };
  };

  rubricInputs.forEach(el => el.oninput = () => { Auth.touchAdmin(); recalc(); });
  recalc();

  /* 標註：把選取的文字存下來 */
  card.querySelector(`[data-mark="${a.id}"]`).onclick = () => {
    Auth.touchAdmin();
    const sel = String(window.getSelection?.() || '').trim();
    if (!sel) { msg.innerHTML = '<span class="t-warn">請先在作文裡選取一段文字</span>'; return; }
    if (sel.length > 120) { msg.innerHTML = '<span class="t-warn">選取的範圍太長了</span>'; return; }
    marks.push({ text: sel, note: '' });
    redrawMarks();
    msg.innerHTML = '';
  };

  function redrawMarks() {
    const box = card.querySelector(`[data-marks="${a.id}"]`);
    box.innerHTML = marksHtml(marks);
    box.querySelectorAll('[data-marknote]').forEach(el =>
      el.oninput = () => { marks[Number(el.dataset.marknote)].note = el.value; });
    box.querySelectorAll('[data-markdel]').forEach(el =>
      el.onclick = () => { marks.splice(Number(el.dataset.markdel), 1); redrawMarks(); });
  }
  redrawMarks();

  /* 儲存 */
  card.querySelector(`[data-save="${a.id}"]`).onclick = async () => {
    Auth.touchAdmin();
    const comment = card.querySelector(`[data-comment="${a.id}"]`).value;

    let score, items;
    if (rubric.length) {
      const blank = rubricInputs.filter(el => el.value === '');
      if (blank.length) {
        msg.innerHTML = '<span class="t-warn">每一項都要給分</span>';
        blank[0].focus();
        return;
      }
      const r = recalc();
      score = r.score;
      items = r.items;
    } else {
      const direct = card.querySelector(`[data-direct="${a.id}"]`);
      if (direct.value === '') { msg.innerHTML = '<span class="t-warn">請輸入分數</span>'; return; }
      score = Number(direct.value);
    }

    msg.innerHTML = '<span class="t-dim">儲存中…</span>';
    try {
      const payload = { score, comment, marks, items };
      const r = isRevise
        ? await reviseGrade({ attempt: a, grade: payload })
        : await applyTeacherGrade({ attempt: a, grade: payload });

      msg.innerHTML = r.pending === 0
        ? '<span class="t-ok">已完成，這堂課的成績轉為正式</span>'
        : `<span class="t-ok">已儲存，這堂課還有 ${r.pending} 篇待批改</span>`;

      setTimeout(onDone, 900);
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };
}

/* ------------------------------------------------------------------ */
/* 已批改（可修改分數，需求 9.7）                                       */
/* ------------------------------------------------------------------ */

async function showGraded(host, students) {
  const box = host.querySelector('#gradedBox');
  box.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入已批改</div></div>`;

  const list = await DB.attempts.gradedWriting(10).catch(() => []);

  if (!list.length) {
    box.innerHTML = '<div class="card"><div class="banner banner-warn">還沒有批改過的作文。</div></div>';
    return;
  }

  const lessons = {};
  for (const id of [...new Set(list.map(a => a.lesson_id))]) lessons[id] = await DB.lessons.get(id);
  const nameOf = id => students.find(s => s.id === id)?.name || `學生 ${id}`;
  const levelOf = id => students.find(s => s.id === id)?.level;

  box.innerHTML = `
    <div class="card">
      <div class="card-title">已批改（最近 ${list.length} 篇）</div>
      <div class="t-sm t-dim">
        調高分數會補上差額。調低分數只會更新這堂課的得分，
        已經給出的累積積分不會倒扣，避免孩子看到積分變少。
      </div>
    </div>
    ${list.map(a => cardHtml(a, lessons[a.lesson_id], nameOf(a.student_id), levelOf(a.student_id), true)).join('')}`;

  list.forEach(a => bindCard(host, a, () => render(host), true));
}

const round1 = v => Math.round((Number(v) || 0) * 10) / 10;
