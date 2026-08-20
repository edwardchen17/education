/* ===== test/run.js — 測試進入點 =====
 * 執行：node test/run.js
 *
 * 先安裝瀏覽器環境替身，再載入各測試檔，最後統一輸出結果。
 */

import { installBrowserStubs, runAll } from './harness.js';

installBrowserStubs();

const FILES = [
  './date.test.js',
  './mathfmt.test.js',
  './answer.test.js',
  './data.test.js',
  './bank.test.js',
  './schedule.test.js',
  './grade.test.js',
  './grading.test.js',
  './selection.test.js',
  './e2e.test.js'
];

console.log('\n' + '='.repeat(60));
console.log('  練習系統　測試套件');
console.log('='.repeat(60));

for (const f of FILES) {
  await import(f);
}

const result = await runAll();

if (result.failed > 0) {
  console.log('\n失敗項目：');
  for (const f of result.failures) {
    console.log(`  · ${f.suite} → ${f.test}`);
  }
  console.log('');
}

process.exit(result.failed > 0 ? 1 : 0);
