# AI Past Paper Marker: backend marking service

Unofficial practice tool. Marks are not Cambridge-certified.

## Run
1. Install Node 18 or newer. There are no npm dependencies.
2. `cp .env.example .env`, then put your key in `ANTHROPIC_API_KEY` (server side only; never in the HTML).
3. `node server.js`, then open http://localhost:3000 (the server also serves the app, so `/api/mark` is same-origin).
Without a key the app still works with the local rule-based engine.

## Test
`npm test` (16 tests, no network or key needed; Claude is mocked).

## API
`GET /api/health` returns `{aiConfigured, dailyRemaining}`.
`POST /api/mark` takes `{question:{id,text,marks,type}, scheme:{raw,answers,criteria:[{code,marks,desc}]}, student:{answer,work}}`
and returns `{awarded,max,confidence,needsReview,expected,awards:[{criterion,maxMarks,marks,met,evidence,justification}],correct,wrong,improve,explanation,flags}`.
The server re-checks every reply: marks need a known scheme criterion plus evidence and justification, totals are recomputed, and confidence under 0.7 is flagged.
Limits: 64 KB body, 2000 characters per answer, 20 requests per minute per IP, daily cap, 25 s timeout, one retry on 429/5xx.
