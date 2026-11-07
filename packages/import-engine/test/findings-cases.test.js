'use strict';

// Every anonymised findings case (fixtures/cases/findings-cases.json) must pass on the engine.
// Today's grouper is run on the same files so the before/after stays measured.

const test = require('node:test');
const assert = require('node:assert/strict');
const { cases, rules } = require('../../../fixtures/cases/findings-cases.json');
const { evaluateCase } = require('../../../fixtures/cases/evaluate');

for (const testCase of cases) {
    test(`findings row ${testCase.row}: the engine meets every expectation`, () => {
        const result = evaluateCase(testCase, rules);
        assert.deepEqual(result.engine.failures, []);
    });
}

test('today\'s grouper still fails the rows the brief measured (rows 1, 2 and 26)', () => {
    const failing = (row) => evaluateCase(cases.find((testCase) => testCase.row === row), rules).today.failures.length > 0;
    assert.ok(failing(1), 'row 1: Untitled projects merge today');
    assert.ok(failing(2), 'row 2: SKY FINAL is split today');
    assert.ok(failing(26), 'row 26: different Morning 5 days merge today');
});
