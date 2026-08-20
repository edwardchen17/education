/* 任務 2.3 — 日期歸屬測試
 * 對應 design 的 Property 6：所有日期一律以台灣當地時間計算。
 * 台灣為 UTC+8 且無日光節約時間。
 */

import { suite, test, eq, ok } from './harness.js';
import {
  todayTW, timeTW, hourTW, addDays, diffDays,
  monthDay, weekdayIndex, weekdayName, isSummer, fmtDateTW, fmtDuration
} from '../js/core.js';

/** 以 UTC 時刻建立 Date，方便驗證時區換算 */
const utc = iso => new Date(iso);

suite('日期：台灣時區歸屬（Property 6）', () => {

  test('UTC 15:59 屬於台灣當天 23:59', () => {
    const d = utc('2026-08-20T15:59:00Z');
    eq(todayTW(d), '2026-08-20');
    eq(timeTW(d), '23:59:00');
    eq(hourTW(d), 23);
  });

  test('UTC 16:01 已經是台灣的隔天 00:01', () => {
    const d = utc('2026-08-20T16:01:00Z');
    eq(todayTW(d), '2026-08-21');
    eq(timeTW(d), '00:01:00');
    eq(hourTW(d), 0);
  });

  test('台灣午夜整點的邊界', () => {
    eq(todayTW(utc('2026-08-20T15:59:59Z')), '2026-08-20', '23:59:59 仍是當天');
    eq(todayTW(utc('2026-08-20T16:00:00Z')), '2026-08-21', '00:00:00 已是隔天');
  });

  test('若誤用 UTC 日期會得到錯誤結果（反面驗證）', () => {
    const d = utc('2026-08-20T16:30:00Z');
    eq(d.toISOString().slice(0, 10), '2026-08-20', 'UTC 日期是 20 日');
    eq(todayTW(d), '2026-08-21', '台灣日期已經是 21 日');
  });

  test('跨月邊界', () => {
    eq(todayTW(utc('2026-07-31T16:00:00Z')), '2026-08-01');
    eq(todayTW(utc('2026-07-31T15:00:00Z')), '2026-07-31');
  });

  test('跨年邊界', () => {
    eq(todayTW(utc('2026-12-31T16:00:00Z')), '2027-01-01');
    eq(todayTW(utc('2026-12-31T15:00:00Z')), '2026-12-31');
  });
});

suite('日期：日曆運算', () => {

  test('addDays 正負與零', () => {
    eq(addDays('2026-08-20', 1), '2026-08-21');
    eq(addDays('2026-08-20', -1), '2026-08-19');
    eq(addDays('2026-08-20', 0), '2026-08-20');
  });

  test('addDays 跨月', () => {
    eq(addDays('2026-08-31', 1), '2026-09-01');
    eq(addDays('2026-09-01', -1), '2026-08-31');
  });

  test('addDays 跨年', () => {
    eq(addDays('2026-12-31', 1), '2027-01-01');
    eq(addDays('2027-01-01', -1), '2026-12-31');
  });

  test('addDays 閏年二月', () => {
    eq(addDays('2028-02-28', 1), '2028-02-29', '2028 是閏年');
    eq(addDays('2028-02-29', 1), '2028-03-01');
    eq(addDays('2026-02-28', 1), '2026-03-01', '2026 不是閏年');
  });

  test('複習間隔 3、7、14 天', () => {
    eq(addDays('2026-08-20', 3), '2026-08-23');
    eq(addDays('2026-08-20', 7), '2026-08-27');
    eq(addDays('2026-08-20', 14), '2026-09-03');
  });

  test('diffDays', () => {
    eq(diffDays('2026-08-20', '2026-08-27'), 7);
    eq(diffDays('2026-08-27', '2026-08-20'), -7);
    eq(diffDays('2026-08-20', '2026-08-20'), 0);
    eq(diffDays('2026-12-31', '2027-01-01'), 1);
  });

  test('monthDay 與星期', () => {
    eq(monthDay('2026-08-20'), '08-20');
    eq(weekdayIndex('2026-08-20'), 4, '2026-08-20 是星期四');
    eq(weekdayName('2026-08-20'), '四');
  });
});

suite('日期：暑假判定', () => {

  test('暑假預設範圍 07-01 至 08-31', () => {
    eq(isSummer('2026-06-30'), false, '6/30 還沒放假');
    eq(isSummer('2026-07-01'), true,  '7/1 開始放假');
    eq(isSummer('2026-08-20'), true);
    eq(isSummer('2026-08-31'), true,  '8/31 是最後一天');
    eq(isSummer('2026-09-01'), false, '9/1 開學');
  });

  test('自訂範圍', () => {
    eq(isSummer('2026-07-05', '07-10', '08-20'), false);
    eq(isSummer('2026-07-10', '07-10', '08-20'), true);
    eq(isSummer('2026-08-21', '07-10', '08-20'), false);
  });

  test('跨年的範圍（寒假）', () => {
    eq(isSummer('2026-12-25', '12-20', '01-05'), true);
    eq(isSummer('2027-01-03', '12-20', '01-05'), true);
    eq(isSummer('2026-11-30', '12-20', '01-05'), false);
    eq(isSummer('2027-02-01', '12-20', '01-05'), false);
  });

  test('每日堂數：平日一堂、暑假兩堂', () => {
    const slots = d => (isSummer(d) ? 2 : 1);
    eq(slots('2026-06-30'), 1);
    eq(slots('2026-07-01'), 2);
    eq(slots('2026-08-31'), 2);
    eq(slots('2026-09-01'), 1);
  });
});

suite('日期：顯示格式', () => {

  test('中文日期', () => {
    eq(fmtDateTW('2026-08-20'), '2026 年 8 月 20 日（四）');
  });

  test('時間長度格式', () => {
    eq(fmtDuration(0), '0:00');
    eq(fmtDuration(59), '0:59');
    eq(fmtDuration(60), '1:00');
    eq(fmtDuration(1500), '25:00');
    eq(fmtDuration(3661), '1:01:01');
  });

  test('負數與小數的防禦', () => {
    eq(fmtDuration(-5), '0:00');
    ok(/^\d+:\d\d$/.test(fmtDuration(90.7)));
  });
});
