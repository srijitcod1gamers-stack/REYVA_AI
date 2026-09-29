const WORKER_API_ORIGIN = 'https://weather-intelligence-api.srijitcod1gamers.workers.dev';

export async function onRequest({ request, params }) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Read-only API' }, { status: 405 });
  }

  const path = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  const incoming = new URL(request.url);
  const upstream = new URL(`/api/${path}`, WORKER_API_ORIGIN);
  upstream.search = incoming.search;

  try {
    const response = await fetch(upstream, {
      headers: { Accept: request.headers.get('Accept') || 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return Response.json({ error: 'Weather API unavailable' }, { status: 502 });
  }
}
