import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const STUDIO = '5330';
const PROJECT = 'archive-pilates';
const MAX_MEASUREMENTS = 30;
const MAX_PHONE_MATCHES = 10;

const nativeId = value => /^[1-9]\d{0,15}$/.test(String(value ?? ''));
const text = value => String(value ?? '').trim();
const name = value => text(value).normalize('NFC').replace(/\s+/g, '');
export const phone = value => {
  const digits = text(value).replace(/[\s()-]/g, '').replace(/^\+82(?=10)/, '0');
  return /^010\d{8}$/.test(digits) ? digits : '';
};
export const testTime = value => {
  const str = text(value);
  if (/^\d{14}$/.test(str)) return str;
  return str.match(/^([0-9]{4})[-./](\d{2})[-./](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)?.slice(1).join('') ?? '';
};

export function inspectMeasurement(id, row, event) {
  if (row.source !== 'lookinbody' || text(row.studioId) !== STUDIO ||
      row.detailStatus !== 'synced' || row.isTempData !== false) return { hold: 'source_not_verified' };
  if (!event) return { hold: 'source_event_missing' };
  if (event.source !== row.source || text(event.studioId) !== STUDIO ||
      event.isTempData !== false) return { hold: 'source_event_scope_mismatch' };
  if (event.lookupStatus !== 'synced' || event.measurementId !== id) {
    return { hold: 'source_event_backlink_not_verified' };
  }

  const raw = row.detailRaw ?? {};
  const providerPhone = phone(raw.MobileNumber);
  const providerName = name(raw.Name);
  const providerTime = testTime(raw['TestDate/Time']);
  const eventTime = testTime(event.testDatetimes);
  if (!text(raw.ID) || text(raw.ID) !== text(event.userId) || !providerPhone ||
      providerPhone !== phone(event.userToken) || !providerName ||
      !providerTime || providerTime !== eventTime ||
      providerTime !== testTime(row.testDatetimes)) return { hold: 'provider_identity_not_verified' };

  const { weightKg, skeletalMuscleMassKg, percentBodyFat } = row.summary ?? {};
  if (!Number.isFinite(weightKg) || weightKg <= 0 ||
      !Number.isFinite(skeletalMuscleMassKg) || skeletalMuscleMassKg <= 0 || skeletalMuscleMassKg > weightKg ||
      !Number.isFinite(percentBodyFat) || percentBodyFat < 0 || percentBodyFat > 100) {
    return { hold: 'metric_missing_or_invalid' };
  }

  return { phone: providerPhone, name: providerName };
}

export function inspectMember(identity, records) {
  if (records.length >= MAX_PHONE_MATCHES) return { hold: 'ambiguous_phone' };
  const candidates = records.filter(({ profile }) =>
    text(profile.studioId) === STUDIO && phone(profile.phone) === identity.phone);
  if (!candidates.length) return { hold: 'no_member_candidate' };
  if (candidates.length !== 1) return { hold: 'ambiguous_phone' };
  const { id, profile } = candidates[0];
  if (name(profile.name) !== identity.name) return { hold: 'member_name_mismatch' };
  const explicit = text(profile.studiomateMemberId);
  const stored = text(profile.memberId) || id;
  if (profile.mergedInto || profile.canonicalMemberId ||
      (explicit && !nativeId(explicit)) ||
      (nativeId(stored) && nativeId(id) && stored !== id) ||
      (explicit && nativeId(stored) && explicit !== stored) ||
      !nativeId(explicit || stored)) return { hold: 'native_member_id_not_verified' };
  return { memberId: explicit || stored };
}

async function runPreflight() {
  if (process.argv.length !== 2) throw new Error('read_only_no_arguments');
  const require = createRequire(import.meta.url);
  const admin = require(process.env.ARCHIVE_PREFLIGHT_FIREBASE_ADMIN ||
    '../firebase/kangsain-functions/functions/node_modules/firebase-admin');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('credentials_not_configured');
  const app = admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore(app);
  try {
    const source = db.collection('inbodyMeasurements');
    const [count, measurements] = await Promise.all([
      source.count().get(),
      source.select('source', 'studioId', 'detailStatus', 'isTempData', 'eventId', 'testDatetimes',
        'detailRaw.ID', 'detailRaw.Name', 'detailRaw.MobileNumber',
        new admin.firestore.FieldPath('detailRaw', 'TestDate/Time'),
        'summary.weightKg', 'summary.skeletalMuscleMassKg', 'summary.percentBodyFat')
        .limit(MAX_MEASUREMENTS).get(),
    ]);
    const holds = {};
    const members = new Set();
    const phoneChecks = new Map();
    const hold = reason => { holds[reason] = (holds[reason] ?? 0) + 1; };
    let candidates = 0;
    for (const measurement of measurements.docs) {
      const row = measurement.data();
      const eventId = text(row.eventId);
      const linked = /^inbody_[a-f0-9]{32}$/.test(eventId)
        ? (await db.getAll(db.collection('inbodyWebhookEvents').doc(eventId), {
          fieldMask: ['source', 'studioId', 'lookupStatus', 'measurementId',
            'isTempData', 'userId', 'userToken', 'testDatetimes'],
        }))[0].data()
        : null;
      const identity = inspectMeasurement(measurement.id, row, linked);
      if (identity.hold) { hold(identity.hold); continue; }

      if (!phoneChecks.has(identity.phone)) {
        const digits = identity.phone;
        const grouped = [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)];
        const result = await db.collection('memberProfiles')
          .where('phone', 'in', [digits, grouped.join('-'), grouped.join(' ')])
          .limit(MAX_PHONE_MATCHES)
          .select('studioId', 'phone', 'name', 'memberId', 'studiomateMemberId', 'mergedInto', 'canonicalMemberId')
          .get();
        phoneChecks.set(digits, result.docs.map(doc => ({ id: doc.id, profile: doc.data() })));
      }
      const matched = inspectMember(identity, phoneChecks.get(identity.phone));
      if (matched.hold) { hold(matched.hold); continue; }
      members.add(matched.memberId);
      candidates++;
    }
    return { project: PROJECT, readOnly: true, sourceCount: count.data().count,
      inspected: measurements.size, candidates, distinctCandidateMembers: members.size, holds };
  } finally {
    await db.terminate();
    await app.delete();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPreflight()
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      const known = ['read_only_no_arguments', 'credentials_not_configured'];
      const code = known.includes(error?.message) ? error.message
        : (typeof error?.code === 'number' ? error.code : 'preflight_failed');
      console.error(JSON.stringify({ readOnly: true, error: code }));
      process.exitCode = 1;
    });
}
