/* ===== screens/preview.js — 題庫預覽 =====
 *
 * 給家長評估題目品質與難度用的診斷頁，不是學生的作答畫面。
 * 學生的作答畫面在任務 9 才會實作。
 */

import { escapeHtml, fmtDuration, ri } from '../core.js';
import { renderMath } from '../engine/mathfmt.js';
import { answerDisplay } from '../engine/answer.js';
import { subjectsFor } from '../config/subjects.js';
import { DIFFICULTIES, DIFFICULTY_LABEL, maxScore } from '../config/scoring.js';
import { topicLabel, topicChapter } from '../config/topics.js';
import { pickQuestions, coverage } from '../bank/index.js';

const LEVELS = [
  { code: 'g8', label: '國二上（Bruce）' },
  { code: 'g5', label: '小五上（Melody）' }
];

let state = { level: 'g8', subject: 'math', difficulty: 'advanced', seed: 1 };

export default {
  render(host) {
    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">題庫預覽</div>
          <div class="t-sm t-dim" style="margin-bottom:12px">
            這裡會即時組出一堂課的題目。請幫我看兩件事：<b>難度是否合適</b>，
            以及<b>解題邏輯是否看得懂</b>。目前只有數學有題庫，其他科目在後續任務。
          </div>
          <div id="controls" class="stack"></div>
        </div>
        <div id="result"></div>
        <div class="build-tag" id="cov"></div>
      </div>`;

    renderControls(host);
    renderCoverage(host);
    build(host);
  }
};

function renderControls(host) {
  const box = host.querySelector('#controls');
  const subjects = subjectsFor(state.level);
  if (!subjects.some(s => s.code === state.subject)) state.subject = subjects[0].code;

  box.innerHTML = `
    <div>
      <label>程度</label>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${LEVELS.map(l => `
          <button data-level="${l.code}" class="${state.level === l.code ? 'btn-primary' : ''}">
            ${l.label}
          </button>`).join('')}
      </div>
    </div>
    <div>
      <label>科目</label>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${subjects.map(s => `
          <button data-subject="${s.code}" class="${state.subject === s.code ? 'btn-primary' : ''}">
            ${s.label}${s.code === 'math' ? '' : ' <span class="t-dim">（尚無題庫）</span>'}
          </button>`).join('')}
      </div>
    </div>
    <div>
      <label>難度</label>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${DIFFICULTIES.map(d => `
          <button data-diff="${d}" class="${state.difficulty === d ? 'btn-primary' : ''}">
            ${DIFFICULTY_LABEL[d]}
          </button>`).join('')}
      </div>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px">
      <button id="again" class="btn-primary">換一批題目</button>
      <button id="showAll">全部展開解題邏輯</button>
      <button data-go="home">返回</button>
    </div>`;

  box.querySelectorAll('[data-level]').forEach(b => b.onclick = () => {
    state.level = b.dataset.level; state.seed = ri(1, 1e9);
    renderControls(host); build(host);
  });
  box.querySelectorAll('[data-subject]').forEach(b => b.onclick = () => {
    state.subject = b.dataset.subject; state.seed = ri(1, 1e9);
    renderControls(host); build(host);
  });
  box.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => {
    state.difficulty = b.dataset.diff; state.seed = ri(1, 1e9);
    renderControls(host); build(host);
  });
  box.querySelector('#again').onclick = () => { state.seed = ri(1, 1e9); build(host); };
  box.querySelector('#showAll').onclick = () => {
    host.querySelectorAll('details').forEach(d => { d.open = true; });
  };
  box.querySelectorAll('[data-go]').forEach(el => {
    el.onclick = () => { location.hash = '#/' + el.dataset.go; };
  });
}

function renderCoverage(host) {
  const cov = coverage();
  const parts = Object.entries(cov).map(([k, v]) =>
    `${k}：${v.generators} 個生成器、${v.topics} 個知識點`);
  host.querySelector('#cov').textContent = '題庫涵蓋　' + (parts.join('　/　') || '無');
}

function build(host) {
  const out = host.querySelector('#result');

  const { items, seconds, reviewCount, warnings } = pickQuestions({
    subject: state.subject,
    level: state.level,
    difficulty: state.difficulty,
    budget: 1500,
    rng: makeRng(state.seed)
  });

  if (!items.length) {
    out.innerHTML = `<div class="card"><div class="banner banner-warn">
      這個科目還沒有題庫。目前只有數學（國二與小五）已完成，其餘在後續任務。
    </div></div>`;
    return;
  }

  const totalScore = items.reduce((s, q) => s + maxScore(q.type, q.difficulty), 0);

  let html = `
    <div class="card">
      <div class="row-between" style="flex-wrap:wrap;gap:8px">
        <div><b>${items.length}</b> 題　預估 <b>${fmtDuration(seconds)}</b>　滿分 <b>${round1(totalScore)}</b></div>
        <div class="t-sm t-dim">${reviewCount ? `含 ${reviewCount} 題複習　` : ''}種子 ${state.seed}</div>
      </div>
      ${seconds < 1200 || seconds > 2400
        ? `<div class="banner banner-bad" style="margin-top:10px">時長 ${fmtDuration(seconds)} 超出 20 至 40 分鐘</div>`
        : ''}
      ${warnings.length
        ? `<div class="banner banner-warn" style="margin-top:10px">${warnings.length} 個警告：${escapeHtml(warnings[0])}</div>`
        : ''}
    </div>`;

  items.forEach((q, i) => { html += questionCard(q, i + 1); });
  out.innerHTML = html;
}

function questionCard(q, no) {
  const typeLabel = {
    mc: '單選', mmc: '多選', fill: '填空', calc: '計算', short: '簡答', essay: '作文'
  }[q.type] || q.type;

  let body = `<div class="stem selectable" style="font-size:1.05em;margin:8px 0 12px">
    ${renderMath(q.stem)}</div>`;

  if (q.options) {
    body += '<div class="stack">' + q.options.map((o, i) => `
      <div class="row" style="gap:10px;align-items:flex-start">
        <span style="flex:0 0 1.6em;color:var(--dim)">(${'ABCDEFGH'[i]})</span>
        <span class="selectable">${renderMath(o.text)}</span>
      </div>`).join('') + '</div>';
  } else if (q.type === 'calc' || q.type === 'fill') {
    body += `<div class="t-dim t-sm">（作答欄${q.answer?.unit ? `，單位 ${escapeHtml(q.answer.unit)}` : ''}）</div>`;
  }

  /* 解題邏輯：預設收起，展開才看得到。刻意不寫「正確答案是 X」。 */
  let rationale = '';
  if (q.options) {
    rationale = q.options.map((o, i) => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div class="${o.correct ? 't-ok' : 't-bad'}" style="font-size:13px">
          (${'ABCDEFGH'[i]}) ${o.correct ? '成立' : '不成立'}
        </div>
        <div class="t-sm selectable" style="margin-top:2px">${renderMath(o.why)}</div>
      </div>`).join('');
  } else if (q.steps) {
    rationale = q.steps.map((s, i) => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div class="selectable">${renderMath(s.expr)}</div>
        ${s.why ? `<div class="t-sm t-dim" style="margin-top:2px">${renderMath(s.why)}</div>` : ''}
      </div>`).join('');
    rationale += `<div class="t-sm t-gold" style="margin-top:8px">答案：${renderMath(answerDisplay(q))}</div>`;
  }

  return `
    <div class="card">
      <div class="row-between t-sm t-dim" style="flex-wrap:wrap;gap:6px">
        <span><b class="t-gold">${no}.</b> ${typeLabel}　${DIFFICULTY_LABEL[q.difficulty]}
          ${q.is_review ? '　<span class="t-warn">複習</span>' : ''}</span>
        <span>${escapeHtml(topicChapter(q.topic))} · ${escapeHtml(topicLabel(q.topic))}　
              ${maxScore(q.type, q.difficulty)} 分　約 ${q.est_seconds} 秒</span>
      </div>
      ${body}
      <details style="margin-top:10px">
        <summary style="cursor:pointer;color:var(--accent-2);font-size:14px">看解題邏輯</summary>
        <div style="margin-top:8px">${rationale}</div>
      </details>
    </div>`;
}

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const rng = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 8; i++) rng();
  return rng;
}

const round1 = v => Math.round(v * 10) / 10;
