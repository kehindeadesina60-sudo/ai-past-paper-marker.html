'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const M = require('../marking');
/* Load the real local engine out of the frontend file so the tests exercise shipped code. */
const html = fs.readFileSync(path.join(__dirname, '../../ai-past-paper-marker.html'), 'utf8');
const pre = html.match(/const N=s=>[^\n]*\nfunction V\([^\n]*\nconst eq=[^\n]*/)[0];
const L = new Function(pre + html.split('/*PURE-START*/')[1].split('/*PURE-END*/')[0] + ';return{parseScheme,LocalEngine}')();
const mark = (text, marks, type, scheme, answer, work = '') =>
  L.LocalEngine.mark({ n: 1, text, marks, type }, L.parseScheme(scheme, type), { answer, work });
const SOLVE = 'Solve 3x - 7 = 11.', SCH = '6 M1 for 3x = 18 A1';

test('1 completely correct answer gets full marks', async () => {
  const r = await mark(SOLVE, 2, 'written', SCH, 'x = 6', '3x = 18');
  assert.equal(r.got, 2); assert.equal(r.flags.length, 0); assert.ok(r.done.length);
});
test('2 incorrect answer gets no marks and an explanation', async () => {
  const r = await mark(SOLVE, 2, 'written', SCH, '4');
  assert.equal(r.got, 0); assert.match(r.why, /does not match/); assert.ok(r.improve.length);
});
test('3 alternative correct forms are accepted (0.6 = 3/5 = 60%)', async () => {
  for (const a of ['3/5', '0.6', '60%']) assert.equal((await mark('P(not red)?', 2, 'written', '3/5 or 0.6 M1 for 6/10 A1', a)).got, 2, a);
});
test('3b alternative wording of a text criterion earns the mark but is flagged for review', async () => {
  const r = await mark('Explain.', 1, 'written', 'Valid explanation M1 for angles on a straight line add up to 180', 'The angles along a straight line sum to 180 degrees');
  assert.equal(r.got, 1); assert.equal(r.review !== false, true); assert.ok(r.flags.length);
});
test('3c a convincing answer with none of the required content earns nothing', async () => {
  const r = await mark('Explain.', 1, 'written', 'Valid explanation M1 for angles on a straight line add up to 180',
    'This is clearly true by a rigorous and well-established mathematical principle that every expert accepts.');
  assert.equal(r.got, 0);
});
test('4 partial marks: method shown, answer wrong', async () => {
  const r = await mark(SOLVE, 2, 'written', SCH, '5', '3x = 18');
  assert.equal(r.got, 1); assert.match(r.done.join(' '), /M1/);
});
test('5 missing answer gets zero', async () => {
  const r = await mark(SOLVE, 2, 'written', SCH, '', '');
  assert.equal(r.got, 0); assert.match(r.why, /No answer/);
});
test('6 correct method but incorrect final answer keeps the method mark only', async () => {
  const r = await mark('Pythagoras: 8 and 15, find hypotenuse.', 3, 'written', '17 M1 for 64 + 225 M1 for 289 A1', '23', '64 + 225 = 289');
  assert.equal(r.got, 2); assert.ok(r.wrong.length);
});
test('unclear scheme entry is flagged, not invented', async () => {
  const r = await mark('Explain.', 2, 'written', 'Valid explanation using parallel lines M1 A1', 'because');
  assert.ok(r.flags.some(f => /final answer could not be identified/.test(f)));
});

/* ---- backend validation (no network: Claude is mocked) ---- */
const req = M.validateRequest({ question: { id: 1, text: 'Solve 3x-7=11', marks: 2 }, scheme: { raw: '6 M1 A1', criteria: [{ code: 'M', marks: 1, desc: 'for 3x=18' }, { code: 'A', marks: 1, desc: 'x=6' }] }, student: { answer: 'x=6', work: '3x=18' } }).req;
const good = { awarded: 2, confidence: 0.95, needsReview: false, expected: 'x = 6', explanation: 'ok', awards: [
  { criterion: 'M1', maxMarks: 1, marks: 1, met: true, evidence: '3x=18', justification: 'Adds 7 to both sides.' },
  { criterion: 'A1', maxMarks: 1, marks: 1, met: true, evidence: 'x=6', justification: 'Correct answer.' }] };

test('valid model reply passes through unflagged', () => {
  const v = M.validateResponse(good, req); assert.equal(v.awarded, 2); assert.equal(v.needsReview, false);
});
test('marks without evidence/justification are removed and flagged', () => {
  const v = M.validateResponse({ ...good, awards: [{ ...good.awards[0], evidence: '' }, good.awards[1]] }, req);
  assert.equal(v.awarded, 1); assert.equal(v.needsReview, true);
});
test('inflated totals and unknown criteria cannot add marks', () => {
  const v = M.validateResponse({ ...good, awarded: 5, awards: [...good.awards, { criterion: 'B9', maxMarks: 3, marks: 3, met: true, evidence: 'x', justification: 'y' }] }, req);
  assert.equal(v.awarded, 2); assert.equal(v.needsReview, true);
});
test('low confidence is flagged for human review', () => {
  assert.equal(M.validateResponse({ ...good, confidence: 0.4 }, req).needsReview, true);
});
test('request validation rejects bad and oversized input', () => {
  assert.equal(M.validateRequest({}).ok, false);
  assert.equal(M.validateRequest({ question: { text: 'q' }, scheme: { raw: 's' }, student: { answer: 'x'.repeat(5000) } }).ok, false);
});
test('callClaude: no key, retry then success, and provider errors', async () => {
  await assert.rejects(M.callClaude(req, { env: {} }), e => e.status === 503);
  let n = 0; const env = { ANTHROPIC_API_KEY: 'test', RETRY_DELAY_MS: 1 };
  const ok = { ok: true, status: 200, json: async () => ({ content: [{ text: 'Here: ' + JSON.stringify(good) }], usage: {} }) };
  const out = await M.callClaude(req, { env, fetchImpl: async () => (n++ ? ok : { ok: false, status: 429 }) });
  assert.equal(n, 2); assert.equal(out.model.awarded, 2);
  await assert.rejects(M.callClaude(req, { env, fetchImpl: async () => ({ ok: false, status: 401 }) }), e => e.status === 502);
  await assert.rejects(M.callClaude(req, { env, fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ text: 'no json' }] }) }) }), e => e.status === 502);
});
test('rate limiter enforces per-minute and daily caps', () => {
  const l = new M.Limiter(2, 3); assert.ok(l.check('a', 0).ok); assert.ok(l.check('a', 1).ok);
  assert.equal(l.check('a', 2).ok, false); assert.ok(l.check('b', 3).ok); assert.equal(l.check('c', 4).ok, false);
});
