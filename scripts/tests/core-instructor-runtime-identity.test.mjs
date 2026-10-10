import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const path = new URL('../../firebase/kangsain-functions/functions/src/exports/app.ts', import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
const variables = source.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]);

test('only the mandatory first-change callable selects the dedicated runtime', () => {
  const accountAssignments = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'serviceAccount') accountAssignments.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(accountAssignments.length, 1);
  const callable = variables.find(d => d.name.getText(source) === 'completeCoreFirstLogin');
  assert.ok(ts.isCallExpression(callable.initializer));
  const options = callable.initializer.arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options));
  assert.ok(options.properties.some(p => ts.isSpreadAssignment(p) && p.expression.getText(source) === 'secretlessCallableOptions'));
  assert.ok(options.properties.includes(accountAssignments[0]));
  assert.equal(accountAssignments[0].initializer.text, 'archive-core-auth@archive-pilates.iam.gserviceaccount.com');
});

test('shared secretless callables retain their original runtime and no secrets', () => {
  const shared = variables.find(d => d.name.getText(source) === 'secretlessCallableOptions').initializer;
  assert.ok(ts.isObjectLiteralExpression(shared));
  assert.ok(shared.properties.some(p => ts.isSpreadAssignment(p) && p.expression.getText(source) === 'callableOptions'));
  const secrets = shared.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'secrets');
  assert.ok(ts.isArrayLiteralExpression(secrets.initializer));
  assert.equal(secrets.initializer.elements.length, 0);
  assert.ok(!shared.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'serviceAccount'));
});
