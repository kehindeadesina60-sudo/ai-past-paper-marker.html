
async function callClaude(req, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.ANTHROPIC_API_KEY) {
    throw Object.assign(
      new Error('AI marking is not configured on the server.'),
      { status: 503 }
    );
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-5-5',
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: '<data>\n' + JSON.stringify(req) + '\n</data>'
    }]
  });

  for (let n = 0; n < 2; n++) {
    const ctl = new AbortController();
    const t = setTimeout(
      () => ctl.abort(),
      +env.AI_TIMEOUT_MS || 25000
    );

    try {
      const r = await fetchImpl(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          signal: ctl.signal,
          body,
          headers: {
            'content-type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        }
      );

      const responseText = await r.text();
      let j;

      try {
        j = JSON.parse(responseText);
      } catch {
        j = {};
      }

      if (!r.ok) {
        const message =
          j.error?.message || 'Unknown Anthropic API error';

        throw Object.assign(
          new Error('Anthropic API error (' + r.status + '): ' + message),
          { status: r.status === 429 ? 429 : 502 }
        );
      }

      return {
        model: parseModelJson(
          (j.content || [])
            .map(c => c.text || '')
            .join('')
        ),
        usage: j.usage || {}
      };

    } catch (e) {
      if (e.status) throw e;

      if (e.name === 'AbortError') {
        throw Object.assign(
          new Error('The AI provider timed out.'),
          { status: 504 }
        );
      }

      throw Object.assign(
        new Error('Could not read the AI reply: ' + e.message),
        { status: 502 }
      );

    } finally {
      clearTimeout(t);
    }
  }

  throw Object.assign(
    new Error('The AI provider is unavailable.'),
    { status: 502 }
  );
     }
