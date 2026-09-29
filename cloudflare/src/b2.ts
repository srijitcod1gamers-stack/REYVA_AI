export interface B2Env {
  B2_ENDPOINT?: string;
  B2_REGION?: string;
  B2_BUCKET?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(value));
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function configured(env: B2Env): env is Required<B2Env> {
  return Boolean(
    env.B2_ENDPOINT && env.B2_REGION && env.B2_BUCKET && env.B2_KEY_ID && env.B2_APPLICATION_KEY,
  );
}

export function b2IsConfigured(env: B2Env): boolean {
  return configured(env);
}

export async function getB2Object(env: B2Env, objectKey: string): Promise<Response> {
  if (!configured(env)) throw new Error('Backblaze B2 is not configured');
  if (!/^[a-z0-9-]+$/.test(env.B2_REGION)) throw new Error('Invalid Backblaze B2 region');

  const endpoint = new URL(env.B2_ENDPOINT);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Backblaze B2 endpoint must be an HTTPS origin');

  const canonicalPath = `/${encodePathPart(env.B2_BUCKET)}/${objectKey
    .split('/')
    .map(encodePathPart)
    .join('/')}`;
  const upstream = new URL(canonicalPath, `${endpoint.origin}/`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${env.B2_REGION}/s3/aws4_request`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders =
    `host:${upstream.host}\n` + `x-amz-content-sha256:${EMPTY_SHA256}\n` + `x-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    'GET',
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    EMPTY_SHA256,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalRequest)].join('\n');

  const dateKey = await hmac(encoder.encode(`AWS4${env.B2_APPLICATION_KEY}`), dateStamp);
  const regionKey = await hmac(dateKey, env.B2_REGION);
  const serviceKey = await hmac(regionKey, 's3');
  const signingKey = await hmac(serviceKey, 'aws4_request');
  const signature = hex(await hmac(signingKey, stringToSign));

  return fetch(upstream, {
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': amzDate,
    },
    signal: AbortSignal.timeout(15_000),
  });
}
