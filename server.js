
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const {
  validateRequest,
  validateResponse,
  callClaude,
  Limiter
} = require('./marking');

// Load .env if available
try {
  const envFile = path.join(__dirname, '.env');

  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);

    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
} catch (e) {
  // No .env file
}

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const MAX_BODY = 64 * 1024;

const limiter = new Limiter(
  Number(env.RATE_LIMIT_PER_MIN) || 20,
  Number(env.MAX_DAILY_CALLS) || 500
);

// HTML file is in the same folder as server.js
const FRONT = path.join(__dirname, 'ai-past-paper-marker.html');

function send(res, status, obj, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...extra
  });

  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {

  const cors =
    env.ALLOWED_ORIGIN &&
    req.headers.origin === env.ALLOWED_ORIGIN
      ? {
          'access-control-allow-origin': env.ALLOWED_ORIGIN,
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET,POST,OPTIONS'
        }
      : {};

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  // Health check
  if (req.method === 'GET' && req.url === '/api/health') {
    return send(res, 200, {
      ok: true,
      aiConfigured: !!env.ANTHROPIC_API_KEY,
      dailyRemaining: limiter.remaining
    }, cors);
  }

  // AI marking endpoint
  if (req.method === 'POST' && req.url === '/api/mark') {

    let size = 0;
    const chunks = [];

    for await (const chunk of req) {
      size += chunk.length;

      if (size > MAX_BODY) {
        return send(res, 413, {
          error: 'Request too large.'
        }, cors);
      }

      chunks.push(chunk);
    }

    let body;

    try {
      body = JSON.parse(
        Buffer.concat(chunks).toString('utf8')
      );
    } catch (e) {
      return send(res, 400, {
        error: 'Invalid JSON.'
      }, cors);
    }

    const validation = validateRequest(body);

    if (!validation.ok) {
      return send(res, 400, {
        error: validation.error
      }, cors);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return send(res, 503, {
        error: 'AI marking is not configured on the server.'
      }, cors);
    }

    const limit = limiter.check(
      req.socket.remoteAddress || 'unknown'
    );

    if (!limit.ok) {
      return send(res, limit.status, {
        error: limit.error
      }, cors);
    }

    try {
      const result = await callClaude(validation.req);

      console.log(
        'Marked question:',
        validation.req.question.id,
        'Tokens:',
        result.usage.input_tokens,
        result.usage.output_tokens
      );

      return send(
        res,
        200,
        validateResponse(result.model, validation.req),
        cors
      );

    } catch (error) {
      console.error('Marking failed:', error.message);

      return send(res, error.status || 502, {
        error: error.message
      }, cors);
    }
  }

  // Serve the frontend
  if (
    req.method === 'GET' &&
    (req.url === '/' || req.url === '/index.html')
  ) {
    if (fs.existsSync(FRONT)) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8'
      });

      return res.end(fs.readFileSync(FRONT));
    }

    return send(res, 404, {
      error: 'Frontend HTML file not found.'
    });
  }

  send(res, 404, {
    error: 'Not found.'
  }, cors);

});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(
      'AI Past Paper Marker running on port ' + PORT
    );
  });
}

module.exports = server;
    
