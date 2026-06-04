// Tests for the deterministic floors inside the specialized clean passes.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnknownTokens } from '../src/passes.js';

test('keeps system placeholder tokens verbatim', () => {
  assert.equal(normalizeUnknownTokens('bel [naam] op [telefoonnummer] terug', 'nl'),
    'bel [naam] op [telefoonnummer] terug');
  assert.equal(normalizeUnknownTokens('mail [e-mailadres] over [dossiernummer]', 'nl'),
    'mail [e-mailadres] over [dossiernummer]');
});

test('collapses an INVENTED bracket token to the neutral pronoun (no [bystander1])', () => {
  assert.equal(normalizeUnknownTokens('vraag [omstander1] en [bystander2] om hulp', 'nl'),
    'vraag iemand en iemand om hulp');
  assert.equal(normalizeUnknownTokens('ask [person] over there', 'en'),
    'ask someone over there');
});

test('case/space-insensitive on known tokens', () => {
  assert.equal(normalizeUnknownTokens('zie [Naam] en [ BSN ]', 'nl'), 'zie [Naam] en [ BSN ]');
});
