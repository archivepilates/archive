import test from 'node:test';
import assert from 'node:assert/strict';
import { checkServerIdentity } from 'node:tls';
import { config, payload } from './helpers.mjs';
import { CONFIG_PATH, FIREBASE_CREDENTIAL_PATH, mqttOptions, MAX_PAYLOAD_BYTES } from '../config.mjs';
import { parseEvent } from '../router.mjs';

test('config accepts main-issued shape, normalizes host, defaults operator path', () => {
  const value = config({ mqttHost: 'mqtts://example-ats.iot.ap-northeast-2.amazonaws.com:8883' });
  assert.equal(value.mqttHost, 'example-ats.iot.ap-northeast-2.amazonaws.com');
  assert.equal(value.firebaseCredentialPath, FIREBASE_CREDENTIAL_PATH);
  assert.equal(CONFIG_PATH, '/Users/archivepilates/ArchiveIN/secrets/lg/thinq-events.json');
  assert.ok(Object.isFrozen(value.allowedDeviceIds));
  assert.ok(!Object.hasOwn(value, 'controlsEnabled'));
});

test('config rejects non-exact allowlist, unsafe domains, control fields, topics and paths', () => {
  for (const allowedDeviceIds of [[], ['one'], Array(8).fill('duplicate'), [...config().allowedDeviceIds, 'ninth']]) {
    assert.throws(() => config({ allowedDeviceIds }), { code: 'CONFIG_ALLOWLIST' });
  }
  for (const mqttHost of ['127.0.0.1', 'mqtt://example-ats.iot.ap-northeast-2.amazonaws.com',
    'example-ats.iot.ap-northeast-2.amazonaws.com.attacker.test',
    'user:pass@example-ats.iot.ap-northeast-2.amazonaws.com',
    'example-ats.iot.ap-northeast-2.amazonaws.com:443', 'mqtts://example-ats.iot.ap-northeast-2.amazonaws.com/path']) {
    assert.throws(() => config({ mqttHost }), { code: 'CONFIG_MQTT_HOST' });
  }
  for (const subscriptions of [[], ['a/#'], ['a/+'], ['a', 'a'], ['a\nsecret'], 'topic']) {
    assert.throws(() => config({ subscriptions }), { code: 'CONFIG_SUBSCRIPTIONS' });
  }
  assert.throws(() => config({ controlsEnabled: true }), { code: 'CONFIG_UNKNOWN_FIELD' });
  assert.throws(() => config({ privateKeyPath: '../key' }), { code: 'CONFIG_CERT_PATH' });
  assert.throws(() => config({ pat: 'bad\nheader' }), { code: 'CONFIG_IDENTITY' });
});

test('mTLS cannot disable hostname, CA verification or persistent QoS1 connection settings', () => {
  const options = mqttOptions(config(), { cert: Buffer.from('fake-cert'), key: Buffer.from('fake-key'), ca: Buffer.from('fake-ca') });
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.checkServerIdentity, checkServerIdentity);
  assert.equal(options.servername, config().mqttHost);
  assert.equal(options.clean, false); assert.equal(options.keepalive, 30);
  assert.equal(options.reconnectPeriod, 0); assert.equal(options.resubscribe, false);
  assert.equal(options.manualConnect, true); assert.equal(options.protocol, 'mqtts');
  assert.ok(!Object.hasOwn(options, 'password'));
  assert.throws(() => mqttOptions(config(), {}), { code: 'TLS_MATERIAL_MISSING' });
});

test('bounded parser accepts status hints and rejects malformed, oversized, non-status and unknown events', () => {
  const ids = config().allowedDeviceIds;
  assert.equal(parseEvent(payload(), ids).deviceId, 'device-0');
  for (const body of [Buffer.from('{'), Buffer.from([0xff]), Buffer.from('null'), Buffer.from('[]')]) {
    assert.ok(parseEvent(body, ids).code);
  }
  assert.equal(parseEvent(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), ids).code, 'EVENT_SIZE');
  for (const report of [null, [], true, 'state']) assert.equal(parseEvent(payload({ report }), ids).code, 'EVENT_SCHEMA');
  for (const pushType of ['DEVICE_EVENT', 'DEVICE_PUSH', '', null]) {
    assert.equal(parseEvent(payload({ pushType }), ids).code, 'EVENT_SCHEMA');
  }
  assert.equal(parseEvent(payload({ deviceId: 'unknown' }), ids).code, 'EVENT_DEVICE');
  assert.equal(parseEvent(payload({ messageId: {} }), ids).code, 'EVENT_MESSAGE_ID');
  const event = parseEvent(payload({ messageID: 'test-id' }), ids);
  assert.match(event.messageIdHash, /^[a-f\d]{64}$/);
  assert.deepEqual(Object.keys(event).sort(), ['deviceId', 'eventHash', 'messageIdHash']);
});
