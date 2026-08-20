/* ===== screens/lesson.js — 作答畫面 =====
 *
 * 六種題型的呈現與輸入、可暫停的計時器、解題邏輯面板、續答。
 * 對應需求 5.3、6.5 至 6.7、7.3 至 7.8、9.1
 */

import { escapeHtml, fmtDuration, countWords } from '../core.js';
import { renderMath } from '../engine/mathfmt.js';
import { maxScore, DIFFICULTY_LABEL } from '../config/scoring.js';
import { subjectLabel } from '../config/subjects.js';
import { topicLabel } from '../config/topics.js';
import { Draft } from '../cache.js';
import * as DB from '../db.js';
import { submitLesson } from '../engine/grade.js';

const LETTERS = 'ABCDEFGH';
const TYPE_LABEL = { mc: '單選', mmc: '多選', fill: '填空', calc: '計算', short: '簡答', essay: '作文' };

/* 作答狀態。整份存進 localStorage，關掉頁面還能續答。 */
let S = null;
let tickHandle = null;

export default {
  async render(host, params) {
    const lessonId = Number(params[0]);
    const student = await currentStudent();
    if (!student) { location.hash = '#/students'; return; }

    const lesson = await DB.lessons.get(lessonId);
    if (!lesson || lesson.student_id !== student.id) {
      host.innerHTML = errorCard('找不到這堂課，或這不是你的課堂。');
      return;
    }
    if (lesson.status === 'submitted' || lesson.status === 'graded') {
      location.hash = `#/result/${lesson.id}`;
      return;
    }

    S = restore(lesson, student);
    startTicking();
    paint(host);

    if (lesson.status === 'pending') {
      await DB.lessons.update(lesson.id, { status: 'active', started_at: new Date().toISOString() });
    }
  },

  /* 離開畫面時停止計時並存檔 */
  teardown() {
    stopTicking();
    if (S) save();
  }
};

/* ------------------------------------------------------------------ */
/* 狀態                                                                */
/* ------------------------------------------------------------------ */

function restore(lesson, student) {
  const saved = Draft.load(lesson.id);
  const items = lesson.plan.items;

  const base = {
    lessonId: lesson.id,
    lesson,
    student,
    items,
    index: 0,
    answers: {},          // { seq: raw }
    revealed: [],         // 看過解答的題號
    perSeconds: {},       // { seq: 秒 }
    timer: 0,             // 計時器累計（暫停時不動）
    elapsedStart: Date.now(),
    elapsedBase: 0,       // 之前累積的實際經過時間
    paused: false,
    pauseCount: 0,
    submitting: false
  };

  if (!saved || saved.itemCount !== items.length) return base;

  return {
    ...base,
    index: Math.min(saved.index || 0, items.length - 1),
    answers: saved.answers || {},
    revealed: saved.revealed || [],
    perSeconds: saved.perSeconds || {},
    timer: saved.timer || 0,
    elapsedBase: saved.elapsed || 0,
    pauseCount: saved.pauseCount || 0
  };
}

function save() {
  if (!S) return;
  Draft.save(S.lessonId, {
    itemCount: S.items.length,
    index: S.index,
    answers: S.answers,
    revealed: S.revealed,
    perSeconds: S.perSeconds,
    timer: S.timer,
    elapsed: elapsedNow(),
    pauseCount: S.pauseCount
  });
}

const elapsedNow = () => S.elapsedBase + Math.round((Date.now() - S.elapsedStart) / 1000);

function startTicking() {
  stopTicking();
  tickHandle = setInterval(() => {
    if (!S) return stopTicking();
    if (!S.paused) {
      S.timer++;
      const seq = S.index + 1;
      S.perSeconds[seq] = (S.perSeconds[seq] || 0) + 1;
      const el = document.getElementById('timer');
      if (el) el.textContent = fmtDuration(S.timer);
    }
    if (S.timer % 10 === 0) save();
  }, 1000);
}

function stopTicking() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

async function currentStudent() {
  const id = Number(localStorage.getItem('edu.currentStudent') || 0);
  if (!id) return null;
  return DB.students.get(id);
}

/* ------------------------------------------------------------------ */
/* 繪製                                                                */
/* ------------------------------------------------------------------ */

function paint(host) {
  const q = S.items[S.index];
  const seq = S.index + 1;
  const total = S.items.length;
  const answered = Object.keys(S.answers).filter(k => hasAnswer(S.answers[k])).length;

  host.innerHTML = `
    <div class="lesson-top glass">
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <span class="t-gold">${escapeHtml(subjectLabel(S.lesson.subject, S.student.level))}</span>
        <span class="t-dim t-sm">${DIFFICULTY_LABEL[S.lesson.plan.difficulty] || ''}</span>
        <span class="grow"></span>
        <span class="timer-box">
          <b id="timer">${fmtDuration(S.timer)}</b>
          <button id="pause" class="btn-mini">${S.paused ? '繼續' : '暫停'}</button>
        </span>
      </div>
      <div id="navrow" class="navrow">${navHtml()}</div>
    </div>

    <div class="wrap">
      ${S.paused ? `<div class="banner banner-warn" style="margin-bottom:12px">
        已暫停計時。題目仍然看得到，想好了再按「繼續」。</div>` : ''}

      <div class="card">
        <div class="row-between t-sm t-dim" style="flex-wrap:wrap;gap:6px">
          <span><b class="t-gold">第 ${seq} 題</b> / ${total}　${TYPE_LABEL[q.type]}　
            ${maxScore(q.type, q.difficulty)} 分
            ${S.revealed.includes(seq) ? '　<span class="t-warn">已看解答，不計分</span>' : ''}
            ${q.is_review ? '　<span class="t-warn">複習題</span>' : ''}</span>
          <span>${escapeHtml(topicLabel(q.topic))}</span>
        </div>

        ${passageHtml(q)}
        ${stemHtml(q)}
        ${inputHtml(q, seq)}
      </div>

      <div class="card">
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button id="prev" ${S.index === 0 ? 'disabled' : ''}>上一題</button>
          <button id="next" ${S.index === total - 1 ? 'disabled' : ''}>下一題</button>
          <span class="grow"></span>
          <button id="reveal" ${S.revealed.includes(seq) ? 'disabled' : ''}>看解題邏輯</button>
          <button id="submit" class="btn-primary">交卷</button>
        </div>
        <div class="t-sm t-dim" style="margin-top:10px">
          已作答 ${answered} / ${total} 題
          ${answered < total ? '　<span class="t-warn">還有題目沒寫</span>' : ''}
        </div>
      </div>

      <div id="rationale"></div>
    </div>`;

  bind(host, q, seq);
  if (S.revealed.includes(seq)) showRationale(host, q);
}

function navHtml() {
  return S.items.map((q, i) => {
    const seq = i + 1;
    const cls = [
      'navdot',
      i === S.index ? 'cur' : '',
      hasAnswer(S.answers[seq]) ? 'done' : '',
      S.revealed.includes(seq) ? 'peeked' : ''
    ].filter(Boolean).join(' ');
    return `<button class="${cls}" data-jump="${i}" title="第 ${seq} 題">${seq}</button>`;
  }).join('');
}

function passageHtml(q) {
  if (!q.passage) return '';
  return `
    <div class="passage selectable">
      <div class="passage-head">${escapeHtml(q.passage.title)}　
        <span class="t-dim">${escapeHtml(q.passage.author)}</span></div>
      <div class="passage-body">${escapeHtml(q.passage.text).replace(/\n/g, '<br>')}</div>
    </div>`;
}

function stemHtml(q) {
  if (q.type === 'essay') {
    return `<div class="passage selectable"><div class="passage-body">${
      escapeHtml(q.prompt).replace(/\n/g, '<br>')}</div></div>`;
  }
  return `<div class="stem selectable">${renderMath(q.stem)}</div>`;
}

function inputHtml(q, seq) {
  const cur = S.answers[seq];

  if (q.type === 'mc' || q.type === 'mmc') {
    const chosen = q.type === 'mc'
      ? (cur === undefined ? -1 : Number(cur))
      : (Array.isArray(cur) ? cur.map(Number) : []);
    return `<div class="opts">${q.options.map((o, i) => {
      const on = q.type === 'mc' ? chosen === i : chosen.includes(i);
      return `<button class="opt ${on ? 'on' : ''}" data-opt="${i}">
        <span class="opt-key">${LETTERS[i]}</span>
        <span class="opt-text selectable">${renderMath(o.text)}</span>
      </button>`;
    }).join('')}
    ${q.type === 'mmc' ? '<div class="t-sm t-dim" style="margin-top:8px">多選題，可以選多個，必須全對才給分。</div>' : ''}
    </div>`;
  }

  if (q.type === 'fill' || q.type === 'calc') {
    const unit = q.answer?.unit ? `<span class="unit">${escapeHtml(q.answer.unit)}</span>` : '';
    return `
      <div class="answer-row">
        <input id="ans" value="${escapeHtml(cur ?? '')}" placeholder="在這裡填答案"
               autocomplete="off" inputmode="text">${unit}
      </div>
      ${q.type === 'calc' ? `<div class="t-sm t-dim" style="margin-top:8px">
        分數可以寫成 3/4，根號可以寫成 √2 或 sqrt2，也可以直接填小數。</div>` : ''}`;
  }

  if (q.type === 'essay' || q.type === 'short') {
    const text = cur ?? '';
    const min = q.min_words || 0;
    return `
      <textarea id="ans" rows="${q.type === 'essay' ? 16 : 6}"
        placeholder="${q.type === 'essay' ? '在這裡寫作文' : '寫下你的說明'}">${escapeHtml(text)}</textarea>
      <div class="row-between t-sm" style="margin-top:8px">
        <span id="wc" class="${countWords(text) >= min ? 't-ok' : 't-dim'}">
          ${countWords(text)} 字${min ? ` / 至少 ${min} 字` : ''}</span>
        <span class="t-dim">這題由老師批改</span>
      </div>`;
  }

  return '<div class="banner banner-bad">未知的題型</div>';
}

/* ------------------------------------------------------------------ */
/* 互動                                                                */
/* ------------------------------------------------------------------ */

function bind(host, q, seq) {
  const $ = id => host.querySelector('#' + id);

  host.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
    S.index = Number(b.dataset.jump); save(); paint(host);
  });

  $('prev').onclick = () => { if (S.index > 0) { S.index--; save(); paint(host); } };
  $('next').onclick = () => { if (S.index < S.items.length - 1) { S.index++; save(); paint(host); } };

  $('pause').onclick = () => {
    S.paused = !S.paused;
    if (S.paused) S.pauseCount++;
    save(); paint(host);
  };

  $('reveal').onclick = async () => {
    if (S.revealed.includes(seq)) return;
    const okToPeek = confirm(
      '看了解題邏輯之後，這一題就不計分了，而且之後會再出一次類似的題目。\n\n要看嗎？'
    );
    if (!okToPeek) return;
    S.revealed.push(seq);
    save(); paint(host);
  };

  $('submit').onclick = () => doSubmit(host);

  /* 選擇題 */
  host.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.opt);
    if (q.type === 'mc') {
      S.answers[seq] = i;
    } else {
      const set = new Set(Array.isArray(S.answers[seq]) ? S.answers[seq].map(Number) : []);
      set.has(i) ? set.delete(i) : set.add(i);
      S.answers[seq] = [...set].sort((a, b) => a - b);
    }
    save(); paint(host);
  });

  /* 填空、計算、作文 */
  const input = $('ans');
  if (input) {
    input.oninput = () => {
      S.answers[seq] = input.value;
      const wc = $('wc');
      if (wc) {
        const n = countWords(input.value);
        wc.textContent = `${n} 字${q.min_words ? ` / 至少 ${q.min_words} 字` : ''}`;
        wc.className = n >= (q.min_words || 0) ? 't-ok' : 't-dim';
      }
      const dot = host.querySelector(`[data-jump="${S.index}"]`);
      if (dot) dot.classList.toggle('done', hasAnswer(input.value));
    };
    input.onblur = save;
  }
}

function showRationale(host, q) {
  const box = host.querySelector('#rationale');
  box.innerHTML = `
    <div class="card">
      <div class="card-title">解題邏輯</div>
      ${rationaleBody(q)}
      <div class="t-sm t-dim" style="margin-top:10px">
        這一題已標記為看過解答，不計分。之後會再出一次同類型的題目讓你練。
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function rationaleBody(q) {
  if (q.options) {
    return q.options.map((o, i) => `
      <div class="rat-row">
        <div class="${o.correct ? 't-ok' : 't-bad'}" style="font-size:13px">
          (${LETTERS[i]}) ${o.correct ? '這個成立' : '這個不成立'}
        </div>
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
    return q.rubric.map(r => `
      <div class="rat-row">
        <div class="t-gold" style="font-size:13px">${escapeHtml(r.item)}　${r.points} 分</div>
        <div class="t-sm t-dim" style="margin-top:3px">${escapeHtml(r.desc)}</div>
      </div>`).join('') +
      '<div class="t-sm t-dim" style="margin-top:10px">範文要等交卷之後才看得到。</div>';
  }
  return '<div class="t-dim">這一題沒有提供解析。</div>';
}

/* ------------------------------------------------------------------ */
/* 交卷                                                                */
/* ------------------------------------------------------------------ */

async function doSubmit(host) {
  if (S.submitting) return;

  const total = S.items.length;
  const answered = Object.keys(S.answers).filter(k => hasAnswer(S.answers[k])).length;
  if (answered < total) {
    if (!confirm(`還有 ${total - answered} 題沒有作答，沒寫的會算錯。\n\n確定要交卷嗎？`)) return;
  } else if (!confirm('確定要交卷嗎？交卷之後就不能修改答案了。')) {
    return;
  }

  S.submitting = true;
  stopTicking();

  const body = host.querySelector('.wrap');
  if (body) body.innerHTML = `<div class="loading"><div class="spinner"></div><div>批改中</div></div>`;

  try {
    await submitLesson({
      lesson: S.lesson,
      student: S.student,
      answers: S.answers,
      revealed: S.revealed,
      seconds: S.perSeconds,
      timerSeconds: S.timer,
      elapsedSeconds: elapsedNow(),
      pauseCount: S.pauseCount
    });
    Draft.clear(S.lessonId);
    const id = S.lessonId;
    S = null;
    location.hash = `#/result/${id}`;
  } catch (err) {
    S.submitting = false;
    startTicking();
    host.innerHTML = errorCard(
      `交卷沒有成功：${escapeHtml(err.message)}<br><br>` +
      '你的答案還留在這台裝置上，請檢查網路後重新進入這堂課再交一次。'
    );
  }
}

const hasAnswer = v =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

function errorCard(html) {
  return `<div class="wrap"><div class="card">
    <div class="card-title">發生問題</div>
    <div class="banner banner-bad">${html}</div>
    <div class="row" style="margin-top:14px">
      <button onclick="location.hash='#/home'">回到今日任務</button>
    </div>
  </div></div>`;
}
