import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUniqueViolation } from './authErrors.ts';

test('recognizes the profiles.username unique constraint by name', () => {
  assert.equal(
    isUniqueViolation(
      'duplicate key value violates unique constraint "profiles_username_key"'
    ),
    true
  );
});

test('recognizes a generic Postgres duplicate-key message', () => {
  assert.equal(isUniqueViolation('duplicate key value violates unique constraint'), true);
});

test('does not flag an unrelated error message', () => {
  assert.equal(isUniqueViolation('invalid login credentials'), false);
});

test('does not flag an empty message', () => {
  assert.equal(isUniqueViolation(''), false);
});
