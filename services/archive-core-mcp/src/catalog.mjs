import { ACTIONS as CALLABLE_ACTIONS, UNSUPPORTED as EXCLUDED } from './actions.mjs';
import { DIRECT_ACTIONS } from './direct.mjs';

export const ACTIONS = Object.freeze([...CALLABLE_ACTIONS, ...DIRECT_ACTIONS]);
export const UNSUPPORTED = EXCLUDED.filter(item => !['renewalCases', 'sequenceNotes / sequenceNoteImages'].includes(item.name));
