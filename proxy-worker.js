/**
 * TreeUi API Proxy — Cloudflare Worker
 * 
 * Forwards API requests to OpenAI, Anthropic, and Google Gemini
 * so that the AI provider sees Cloudflare's IP, not the user's.
 * 
 * DEPLOY:
 *   1. Create a free Cloudflare account at https://dash.cloudflare.com
 *   2. Install Wrangler CLI: npm install -g wrangler
 *   3. Login: wrangler login
 *   4. Deploy: wrangler deploy proxy-worker.js --name treeui-proxy
 *   5. Copy your Worker URL (e.g. https://treeui-proxy.YOUR_NAME.workers.dev)
 *   6. Paste it into TreeUi Settings → Proxy URL
 * 
 * ALLOWED TARGETS (whitelist):
 *   - api.openai.com
 *   - api.anthropic.com
 *   - generativelanguage.googleapis.com
 * 
 * OpenRouter is NOT proxied — it already hides your IP.
 */

const ALLOWED_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com'
];

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return jsonError('Method not allowed', 405);
    }

    try {
      const payload = await request.json();
      const { target, headers, body } = payload;

      if (!target) {
        return jsonError('Missing "target" URL', 400);
      }

      // Validate target against whitelist
      const url = new URL(target);
      if (!ALLOWED_HOSTS.includes(url.hostname)) {
        return jsonError(`Host "${url.hostname}" is not allowed. Allowed: ${ALLOWED_HOSTS.join(', ')}`, 403);
      }

      // Forward the request to the real API
      const apiResponse = await fetch(target, {
        method: 'POST',
        headers: headers || {},
        body: typeof body === 'string' ? body : JSON.stringify(body)
      });

      // Stream the response back
      return new Response(apiResponse.body, {
        status: apiResponse.status,
        headers: {
          ...corsHeaders(),
          'Content-Type': apiResponse.headers.get('Content-Type') || 'application/json',
          'X-Proxy': 'TreeUi-CF-Worker'
        }
      });

    } catch (err) {
      return jsonError(`Proxy error: ${err.message}`, 500);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json'
    }
  });
}
