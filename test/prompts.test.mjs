import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_DEFINITIONS, getPrompt } from '../src/prompts.mjs';

test('prompt definitions declare their arguments', () => {
  assert.ok(PROMPT_DEFINITIONS.length > 0);
  for (const prompt of PROMPT_DEFINITIONS) {
    assert.equal(typeof prompt.name, 'string');
    assert.ok(Array.isArray(prompt.arguments));
  }
});

test('prompts render user messages and interpolate validated arguments', () => {
  const review = getPrompt('cycleo_team_review', {});
  assert.equal(review.messages[0].role, 'user');
  assert.match(review.messages[0].content.text, /cycleo_get_my_team/);

  const plan = getPrompt('cycleo_transfer_plan', { raceId: '2981', limit: '10' });
  assert.match(plan.messages[0].content.text, /race 2981/);
  assert.match(plan.messages[0].content.text, /at most 10 suggestions/);

  const preview = getPrompt('cycleo_race_preview', { raceId: '456' });
  assert.match(preview.messages[0].content.text, /race 456/);
});

test('prompts reject missing, invalid and unknown names', () => {
  assert.throws(() => getPrompt('cycleo_transfer_plan', {}), { jsonRpcCode: -32602 });
  assert.throws(() => getPrompt('cycleo_transfer_plan', { raceId: '0' }), { jsonRpcCode: -32602 });
  assert.throws(() => getPrompt('cycleo_transfer_plan', { raceId: '5', limit: '99' }), { jsonRpcCode: -32602 });
  assert.throws(() => getPrompt('cycleo_unknown', {}), { jsonRpcCode: -32602 });
});
