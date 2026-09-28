import { downscaling, events } from './fixtures';
import { alertsFor, frameFor, riskFor } from './simulation';
export function demoApi(url: URL): { status: number; body: unknown } {
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const hour = Number(url.searchParams.get('hour') ?? 96),
    replay = url.searchParams.get('replay') === 'true';
  if (!Number.isFinite(hour) || hour < 72 || hour > 240)
    return { status: 422, body: { error: 'hour must be between 72 and 240' } };
  const id =
    url.searchParams.get('event_id') ||
    path.match(/^\/(?:events|trajectory|downscaled)\/([^/]+)$/)?.[1] ||
    'WX-024';
  const event = events.find((e) => e.id === id);
  if (!event) return { status: 404, body: { error: `Event ${id} not found` } };
  const frame = frameFor(event, hour, replay);
  if (path === '/events') return { status: 200, body: events };
  if (path === `/events/${id}`) return { status: 200, body: event };
  if (path === '/forecast') return { status: 200, body: frame };
  if (path === '/alerts') return { status: 200, body: alertsFor(events) };
  if (path === '/impact')
    return {
      status: 200,
      body: {
        event_id: id,
        timestamp: frame.timestamp,
        impact: frame.impact,
        provenance: event.provenance,
      },
    };
  if (path === `/trajectory/${id}`) return { status: 200, body: event.trajectory };
  if (path === `/downscaled/${id}`) return { status: 200, body: downscaling };
  if (path === '/risk') {
    const lat = Number(url.searchParams.get('lat')),
      lon = Number(url.searchParams.get('lon'));
    if (
      !url.searchParams.has('lat') ||
      !url.searchParams.has('lon') ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return { status: 422, body: { error: 'Provide valid lat [-90,90] and lon [-180,180]' } };
    return {
      status: 200,
      body: riskFor(
        [lon, lat],
        url.searchParams.get('name') || 'Selected coordinates',
        event,
        hour,
        replay,
      ),
    };
  }
  if (path === '/health')
    return {
      status: 200,
      body: {
        status: 'ok',
        mode: 'demo',
        services: { simulation: 'ready', inference: 'not_connected', ncmrwf: 'not_connected' },
        trained_models: false,
      },
    };
  return { status: 404, body: { error: 'Endpoint not found' } };
}
