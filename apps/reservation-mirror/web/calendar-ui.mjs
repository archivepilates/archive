import { DateTime } from 'luxon';

export const calendarViews = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'];
export function calendarView(value) { return calendarViews.includes(value) ? value : 'timeGridWeek'; }
export function weekDays(anchor, today = DateTime.now().setZone('Asia/Seoul').toISODate()) {
  const date = DateTime.fromISO(anchor, { zone: 'Asia/Seoul' }).setZone('Asia/Seoul');
  if (!date.isValid) return [];
  const monday = date.startOf('week');
  return Array.from({ length: 7 }, (_, i) => {
    const day = monday.plus({ days: i }).setLocale('ko');
    return { date: day.toISODate(), weekday: day.toFormat('ccc'), number: day.day, today: day.toISODate() === today };
  });
}
export function calendarTitle(anchor, view) {
  const day = DateTime.fromISO(anchor, { zone: 'Asia/Seoul' }).setZone('Asia/Seoul');
  if (!day.isValid) return '';
  if (view === 'dayGridMonth') return day.toFormat('yyyy년 M월');
  if (view === 'timeGridDay') return day.setLocale('ko').toFormat('yyyy.M.d (ccc)');
  const start = day.startOf('week'), end = start.plus({ days: 6 });
  return `${start.toFormat('yyyy.M.d')} ~ ${end.year !== start.year ? end.toFormat('yyyy.M.d') : end.month !== start.month ? end.toFormat('M.d') : end.toFormat('d')}`;
}
