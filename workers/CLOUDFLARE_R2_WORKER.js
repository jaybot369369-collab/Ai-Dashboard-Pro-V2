// ═══════════════════════════════════════════════════════════
// CLOUDFLARE WORKER — R2 image proxy for AI Dashboard Pro
// Deploy this code to a free Cloudflare Worker.
//
// Setup:
//  1. Cloudflare Dashboard → Workers & Pages → Create → "Hello World" template
//  2. Paste this entire file as the Worker code
//  3. Settings → Variables → R2 bucket bindings:
//       Variable name: IMAGES
//       R2 bucket:     ai-dashboard-images   (create this in R2 first)
//  4. Settings → Variables → Environment Variables:
//       Variable name: PUBLIC_URL
//       Value:         https://pub-XXXXXXXXX.r2.dev   (from R2 bucket Settings → Public R2.dev URL)
//  5. Deploy → copy the worker URL (e.g. https://image-uploader.YOURACCOUNT.workers.dev)
//  6. Paste that URL into AI Dashboard Pro → Pro Tools → Storage tab
// ═══════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const cors = {
      'access-control-allow-origin':  '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/ping') {
      return new Response('pong', { headers: { ...cors, 'content-type': 'text/plain' } });
    }

    // Upload — body is raw binary image
    if (request.method === 'POST' && url.pathname === '/upload') {
      try {
        const contentType = request.headers.get('content-type') || 'image/webp';
        const ext = (contentType.split('/')[1] || 'bin').replace(/\W/g, '');
        const yyyymm = new Date().toISOString().slice(0,7);
        const key = `${yyyymm}/${crypto.randomUUID()}.${ext}`;
        const body = await request.arrayBuffer();
        if (!body.byteLength) return json({ error: 'empty body' }, 400, cors);
        await env.IMAGES.put(key, body, { httpMetadata: { contentType } });
        const publicUrl = `${env.PUBLIC_URL.replace(/\/$/, '')}/${key}`;
        return json({ url: publicUrl, key, size: body.byteLength }, 200, cors);
      } catch (e) {
        return json({ error: e.message }, 500, cors);
      }
    }

    // Delete by key
    if (request.method === 'DELETE') {
      const key = url.searchParams.get('key');
      if (!key) return json({ error: 'missing key' }, 400, cors);
      try {
        await env.IMAGES.delete(key);
        return json({ ok: true, key }, 200, cors);
      } catch (e) {
        return json({ error: e.message }, 500, cors);
      }
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
