// Keep the v1 flat moves arrays for existing readers; the editor stores optional
// stage-local positions and associates each movement with a positionId.
(function (root) {
  'use strict';
  const stages = ['warm', 'main', 'cool'];
  const maxGroups = 30;
  const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
  const catalog = Object.freeze({
    체어: ['sit', 'stand', 'kneel', 'side'],
    캐딜락: ['supine', 'prone', 'sit', 'kneel', 'allfours', 'stand'],
    바렐: ['sit', 'side', 'prone', 'stand'],
    리포머: ['supine', 'prone', 'sit', 'kneel', 'allfours', 'stand', 'side'],
    매트: ['supine', 'prone', 'side', 'sit', 'kneel', 'allfours', 'stand'],
    기타: ['supine', 'prone', 'side', 'sit', 'kneel', 'allfours', 'stand'],
  });
  const labels = Object.freeze({supine:'바로 누운 자세', prone:'엎드린 자세', side:'옆으로 기대는 자세', sit:'앉은 자세', kneel:'무릎 선 자세', allfours:'네발기기', stand:'선 자세'});
  function options(equipment) {
    return [...(Object.hasOwn(catalog, equipment) ? catalog[equipment] : catalog.기타), 'custom'];
  }
  function readGroups(raw) {
    const seen = new Set();
    return (Array.isArray(raw) ? raw : []).slice(0, maxGroups).flatMap(g => {
      if (!g || typeof g.id !== 'string' || !idPattern.test(g.id) || seen.has(g.id) || typeof g.label !== 'string' || !g.label.trim() || g.label.length > 40) return [];
      seen.add(g.id);
      const equipment = typeof g.equipment === 'string' && Object.hasOwn(catalog, g.equipment) ? g.equipment : '기타';
      const kind = options(equipment).includes(g.kind) ? g.kind : 'custom';
      return [{id:g.id, kind, equipment, label:g.label.trim()}];
    });
  }
  function restore(target, source) {
    for (const stage of stages) {
      const groups = readGroups(source.positions?.[stage]);
      target.positions[stage] = groups;
      const ids = new Set(groups.map(g => g.id));
      target.moves[stage].forEach((m, i) => {
        const group = source.moves[stage][i].positionId;
        if (typeof group === 'string' && ids.has(group)) m.positionId = group;
      });
    }
    return target;
  }
  function label(group) { return group?.label || '포지션 미지정'; }
  const groupId = move => move.positionId || '';
  function sync(state, stage) {
    const moves = state.moves[stage];
    const bucket = new Map([['', []], ...state.positions[stage].map(g => [g.id, []])]);
    for (const move of moves) (bucket.get(groupId(move)) || bucket.get('')).push(move);
    // The existing flat reader sees exactly the same order as the new editor.
    state.moves[stage] = [...bucket.values()].flat();
  }
  function moveTo(state, stage, move, id) {
    if (id && !state.positions[stage].some(g => g.id === id)) return false;
    const arr = state.moves[stage];
    const at = arr.indexOf(move);
    if (at < 0) return false;
    arr.splice(at, 1);
    if (id) move.positionId = id;
    else delete move.positionId;
    arr.push(move);
    sync(state, stage);
    return true;
  }
  function reorderMove(state, stage, index, delta) {
    const list = state.moves[stage];
    if (!list[index]) return;
    const direction = Math.sign(delta);
    for (let j = index + direction; direction && j >= 0 && j < list.length; j += direction) {
      if (groupId(list[index]) !== groupId(list[j])) continue;
      [list[index], list[j]] = [list[j], list[index]];
      break;
    }
  }
  function removeGroup(state, stage, id) {
    state.positions[stage] = state.positions[stage].filter(group => group.id !== id);
    for (const move of state.moves[stage]) if (move.positionId === id) delete move.positionId;
    sync(state, stage);
  }
  const bodies = {
    supine:'<circle cx="24" cy="34" r="4"/><path d="M29 39h28l14-12 12 12M42 39l15-4"/>',
    prone:'<circle cx="78" cy="32" r="4"/><path d="M72 40H44L22 39m43-7 6 8 13 1"/>',
    side:'<circle cx="70" cy="28" r="4"/><path d="m66 34-19 5-23 1m42-6 6 7 10-1m-33-1-10 5-17-2"/>',
    sit:'<circle cx="53" cy="12" r="4"/><path d="M53 17v20h17v12m-17-27 14 7"/>',
    kneel:'<circle cx="49" cy="12" r="4"/><path d="M49 17v23H33m16-18 16 2m-16 8 12 8"/>',
    stand:'<circle cx="56" cy="9" r="4"/><path d="M56 14v17l-6 14m6-14 7 14m-7-26-10 9m10-9 11 7"/>',
    allfours:'<circle cx="71" cy="26" r="4"/><path d="M66 30H40l-5 13H24m38-13 4 13h9"/>',
    custom:'<path d="M43 25h22m-11-11v22"/>',
  };
  const apparatus = {
    체어:'M9 50h85M40 45h20v-7H40zM60 44l12 4h12',
    캐딜락:'M7 48h90M12 44V12h82v32M13 44h80',
    바렐:'M7 50h89M24 46q17-19 42 0m19 0V20m0 6h9m-9 9h9',
    리포머:'M7 48h91M11 42h80m-80 0v6m80-6v6m-8-7 9-14',
    매트:'M13 47h78',
    기타:'M13 47h78',
  };
  function illustration(equipment, kind) {
    const icon = Object.hasOwn(bodies, kind) ? bodies[kind] : bodies.custom;
    const frame = Object.hasOwn(apparatus, equipment) ? apparatus[equipment] : apparatus.기타;
    return '<svg aria-hidden="true" viewBox="0 0 104 54" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="'+frame+'" stroke="#63766b" stroke-width="2"/><g stroke="#29413b" stroke-width="2.4">'+icon+'</g></svg>';
  }
  root.SequencePositions = Object.freeze({stages, maxGroups, options, labels, readGroups, restore, label, groupId, sync, moveTo, reorderMove, removeGroup, illustration});
})(globalThis);
