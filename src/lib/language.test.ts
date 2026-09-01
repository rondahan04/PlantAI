import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANGUAGE,
  isRTLLanguage,
  localeTag,
  needsDirectionChange,
  resolveLanguage,
} from './language.ts';

test('a saved choice beats the device locale', () => {
  assert.equal(resolveLanguage('en', 'he'), 'en');
  assert.equal(resolveLanguage('he', 'en'), 'he');
});

test('with nothing saved, the device locale decides', () => {
  assert.equal(resolveLanguage(null, 'he'), 'he');
  assert.equal(resolveLanguage(null, 'he-IL'), 'he');
  assert.equal(resolveLanguage(null, 'en-US'), 'en');
});

test('the legacy Hebrew locale code is still Hebrew', () => {
  // Some Android builds report 'iw', the pre-1989 ISO code. A user whose phone
  // says 'iw' is holding a Hebrew phone, and falling back to English for them
  // would be the single most visible bug this module could have.
  assert.equal(resolveLanguage(null, 'iw'), 'he');
  assert.equal(resolveLanguage(null, 'iw-IL'), 'he');
});

test('an unknown locale falls to English rather than guessing', () => {
  assert.equal(resolveLanguage(null, 'fr-FR'), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage(null, null), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage(null, ''), DEFAULT_LANGUAGE);
});

test('a corrupt saved value is ignored, not trusted', () => {
  // A hand-edited or half-written kv value must not wedge the app in a
  // language that has no copy tree - it falls through to the locale.
  assert.equal(resolveLanguage('klingon', 'he'), 'he');
  assert.equal(resolveLanguage('', 'he'), 'he');
});

test('case and region noise in a locale does not change the answer', () => {
  assert.equal(resolveLanguage(null, 'HE'), 'he');
  assert.equal(resolveLanguage(null, 'EN-GB'), 'en');
});

test('Hebrew is right-to-left and English is not', () => {
  assert.equal(isRTLLanguage('he'), true);
  assert.equal(isRTLLanguage('en'), false);
});

test('locale tags are explicit, so dates never follow the device by accident', () => {
  assert.equal(localeTag('he'), 'he-IL');
  assert.equal(localeTag('en'), 'en-US');
});

test('a relaunch is needed only when the running direction disagrees', () => {
  assert.equal(needsDirectionChange('he', false), true);
  assert.equal(needsDirectionChange('he', true), false);
  assert.equal(needsDirectionChange('en', true), true);
  assert.equal(needsDirectionChange('en', false), false);
});
