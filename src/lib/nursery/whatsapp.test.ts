import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWhatsAppNumber, waMeLink } from './whatsapp.ts';

test('a local Israeli number gets the leading 0 replaced with the country code', () => {
  assert.equal(toWhatsAppNumber('050-123 4567'), '972501234567');
});

test('a landline-style number normalizes the same way', () => {
  assert.equal(toWhatsAppNumber('03-123 4567'), '97231234567');
});

test('a number already carrying the country code is left as-is', () => {
  assert.equal(toWhatsAppNumber('+972 50-123-4567'), '972501234567');
});

test('a number with too few digits is rejected rather than producing a dead link', () => {
  assert.equal(toWhatsAppNumber('03-1'), null);
});

test('waMeLink embeds the normalized number and an encoded message', () => {
  const link = waMeLink('050-123 4567', 'Hi, is Monstera deliciosa available?');
  assert.equal(link, 'https://wa.me/972501234567?text=Hi%2C%20is%20Monstera%20deliciosa%20available%3F');
});

test('waMeLink returns null for an unusable phone number', () => {
  assert.equal(waMeLink('n/a', 'Hi'), null);
});
