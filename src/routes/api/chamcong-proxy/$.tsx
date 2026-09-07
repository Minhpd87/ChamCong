// src/routes/api/chamcong-proxy/$.tsx
import { createFileRoute } from '@tanstack/react-router'
import https from 'node:https'
import crypto from 'node:crypto'

async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/chamcong-proxy', '') + url.search
  const method = request.method

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    })
  }

  const bodyBuffer =
    method === 'GET' || method === 'HEAD'
      ? null
      : Buffer.from(await request.arrayBuffer())

  return new Promise<Response>((resolve) => {
    const proxyReq = https.request(
      {
        hostname: 'chamcong.haiphong.gov.vn',
        path,
        method,
        // Server uses legacy TLS renegotiation; OpenSSL 3.x (Node 17+) rejects it by default
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
        // Server doesn't send its intermediate certificate, so the chain can't be
        // verified up to a trusted root — deliberate trade-off, see note in project docs.
        rejectUnauthorized: false,
        headers: {
          host: 'chamcong.haiphong.gov.vn',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          origin: 'https://chamcong.haiphong.gov.vn',
          referer: 'https://chamcong.haiphong.gov.vn/',
          ...(bodyBuffer
            ? {
                'content-type':
                  request.headers.get('content-type') || 'application/json',
                'content-length': String(bodyBuffer.length),
              }
            : {}),
        },
      },
      (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk) => chunks.push(chunk))
        proxyRes.on('end', () => {
          const responseHeaders = new Headers()
          responseHeaders.set('Access-Control-Allow-Origin', '*')
          responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          responseHeaders.set('Access-Control-Allow-Headers', '*')
          responseHeaders.set(
            'Content-Type',
            proxyRes.headers['content-type'] || 'application/json'
          )

          resolve(
            new Response(Buffer.concat(chunks), {
              status: proxyRes.statusCode,
              headers: responseHeaders,
            })
          )
        })
      }
    )

    proxyReq.on('error', (err) => {
      resolve(
        new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    if (bodyBuffer) proxyReq.write(bodyBuffer)
    proxyReq.end()
  })
}

export const Route = createFileRoute('/api/chamcong-proxy/$')({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
      OPTIONS: ({ request }) => proxy(request),
    },
  },
})
