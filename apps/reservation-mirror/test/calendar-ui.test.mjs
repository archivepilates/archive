import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarTitle, calendarView, calendarViews, weekDays } from '../web/calendar-ui.mjs';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_MS = 86400000;

test('calendarView accepts exactly the supported month, week and day views', () => {
  assert.deepEqual(calendarViews, ['dayGridMonth', 'timeGridWeek', 'timeGridDay']);
  for (const view of calendarViews) assert.equal(calendarView(view), view);
});

test('calendarView defaults to week for missing, falsy, malformed and object values without coercion', () => {
  const invalid = [
    undefined, null, false, true, '', 0, -0, NaN, Infinity, 1, 0n,
    'week', 'month', 'timegridweek', ' timeGridWeek', 'timeGridDay ',
    'constructor', '__proto__', {}, [], ['timeGridDay'], new String('timeGridDay'),
    Symbol('timeGridDay'), () => 'timeGridDay',
    { toString() { throw new Error('View values must not be coerced'); } },
  ];
  assert.equal(calendarView(), 'timeGridWeek');
  for (const value of invalid) assert.equal(calendarView(value), 'timeGridWeek');
});

function assertWeek(anchor, expectedDates, today) {
  const days = weekDays(anchor, today);
  assert.equal(days.length, 7);
  assert.equal(new Set(days.map((day) => day.date)).size, 7);
  assert.deepEqual(days.map((day) => day.date), expectedDates);
  assert.deepEqual(days.map((day) => day.weekday), WEEKDAYS);
  for (const [index, day] of days.entries()) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    const instant = new Date(`${day.date}T00:00:00Z`);
    assert.equal(instant.toISOString().slice(0, 10), day.date);
    assert.equal(instant.getUTCDay(), (index + 1) % 7);
    assert.equal(day.number, instant.getUTCDate());
    assert.equal(day.today, day.date === today);
    if (index) assert.equal(instant.getTime() - Date.parse(`${days[index - 1].date}T00:00:00Z`), DAY_MS);
  }
  return days;
}

const OCTOBER_WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const PREVIOUS_WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const NEW_YEAR_WEEK = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'];
const LEAP_WEEK = ['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03'];

for (const [anchor, expected] of [
  ['2026-10-19', OCTOBER_WEEK],
  ['2026-10-23', OCTOBER_WEEK],
  ['2026-10-25', OCTOBER_WEEK],
  ['2026-11-01', ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']],
  ['2026-12-31', NEW_YEAR_WEEK],
  ['2027-01-01', NEW_YEAR_WEEK],
  ['2024-02-29', LEAP_WEEK],
  ['2024-03-01', LEAP_WEEK],
  ['2023-02-28', ['2023-02-27', '2023-02-28', '2023-03-01', '2023-03-02', '2023-03-03', '2023-03-04', '2023-03-05']],
]) {
  test(`weekDays(${anchor}) has exactly seven distinct ISO dates ordered Monday through Sunday`, () => {
    assertWeek(anchor, expected, expected[3]);
  });
}

for (const [anchor, expected] of [
  ['2026-10-18T14:59:59.999Z', PREVIOUS_WEEK],
  ['2026-10-18T15:00:00.000Z', OCTOBER_WEEK],
  ['2026-10-18T23:30:00-07:00', OCTOBER_WEEK],
  ['2026-10-19T00:30:00+14:00', PREVIOUS_WEEK],
  ['2026-10-19T00:30:00+09:00', OCTOBER_WEEK],
  ['2026-10-19T00:30:00', OCTOBER_WEEK],
]) {
  test(`weekDays converts ${anchor} to the KST week before finding Monday`, () => {
    assertWeek(anchor, expected, expected[0]);
  });
}

test('today marks exactly the matching date, including Monday and Sunday, and no other dates', () => {
  for (const today of OCTOBER_WEEK) {
    const days = assertWeek('2026-10-23', OCTOBER_WEEK, today);
    assert.deepEqual(days.filter((day) => day.today).map((day) => day.date), [today]);
  }
  for (const today of ['2026-10-18', '2026-10-26', '2026-10-230', '', null]) {
    const days = assertWeek('2026-10-23', OCTOBER_WEEK, today);
    assert.equal(days.filter((day) => day.today).length, 0);
  }
});

test('the default today uses the current KST date, not the current UTC date', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-18T15:30:00.000Z'));
  const days = weekDays('2026-10-19');
  assert.deepEqual(days.filter((day) => day.today).map((day) => day.date), ['2026-10-19']);
  assert.equal(days[0].today, true);
  assert.ok(days.slice(1).every((day) => day.today === false));
});

const INVALID_ANCHORS = [
  '', 'not-a-date', '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-32',
  '2026-10-23T25:00:00Z', '2026-10-23T12:60:00Z', null, undefined, false, 0, {}, [],
];

test('weekDays returns an empty array for bad anchors rather than inventing a week', () => {
  for (const anchor of INVALID_ANCHORS) assert.deepEqual(weekDays(anchor, '2026-10-23'), []);
});

for (const [anchor, day, week, month] of [
  ['2026-10-23', '2026.10.23 (금)', '2026.10.19 ~ 25', '2026년 10월'],
  ['2026-11-01', '2026.11.1 (일)', '2026.10.26 ~ 11.1', '2026년 11월'],
  ['2026-12-31', '2026.12.31 (목)', '2026.12.28 ~ 2027.1.3', '2026년 12월'],
  ['2027-01-01', '2027.1.1 (금)', '2026.12.28 ~ 2027.1.3', '2027년 1월'],
  ['2024-02-29', '2024.2.29 (목)', '2024.2.26 ~ 3.3', '2024년 2월'],
  ['2026-12-31T15:30:00Z', '2027.1.1 (금)', '2026.12.28 ~ 2027.1.3', '2027년 1월'],
  ['2027-01-01T00:30:00+14:00', '2026.12.31 (목)', '2026.12.28 ~ 2027.1.3', '2026년 12월'],
]) {
  test(`calendarTitle(${anchor}) formats day, week and month using KST dates`, () => {
    assert.equal(calendarTitle(anchor, 'timeGridDay'), day);
    assert.equal(calendarTitle(anchor, 'timeGridWeek'), week);
    assert.equal(calendarTitle(anchor, 'dayGridMonth'), month);
  });
}

test('calendarTitle uses the week title when no supported day/month view is selected', () => {
  for (const view of [undefined, null, '', 'unsupported']) {
    assert.equal(calendarTitle('2027-01-01', view), '2026.12.28 ~ 2027.1.3');
  }
});

test('calendarTitle returns empty text for bad anchors in every supported view', () => {
  for (const anchor of INVALID_ANCHORS) {
    for (const view of calendarViews) assert.equal(calendarTitle(anchor, view), '');
  }
});
