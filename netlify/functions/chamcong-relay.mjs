// netlify/functions/chamcong-relay.mjs
import https from 'node:https'
import crypto from 'node:crypto'

export default async (request) => {
  const url = new URL(request.url)
  const path = url.pathname.replace('/.netlify/functions/chamcong-relay', '') + url.search
  const bodyBuffer = ['GET', 'HEAD'].includes(request.method)
    ? null
    : Buffer.from(await request.arrayBuffer())

  return new Promise((resolve) => {
    const proxyReq = https.request(
      {
        hostname: 'chamcong.haiphong.gov.vn',
        path,
        method: request.method,
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT, // <-- allows the legacy renegotiation this server uses
        headers: {
          host: 'chamcong.haiphong.gov.vn',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          origin: 'https://chamcong.haiphong.gov.vn',
          referer: 'https://chamcong.haiphong.gov.vn/',
          ...(bodyBuffer ? { 'content-type': request.headers.get('content-type') || 'application/json' } : {}),
        },
      },
      (proxyRes) => {
        const chunks = []
        proxyRes.on('data', (c) => chunks.push(c))
        proxyRes.on('end', () => {
          const responseHeaders = new Headers()
          responseHeaders.set('Access-Control-Allow-Origin', '*')
          responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          responseHeaders.set('Access-Control-Allow-Headers', '*')
          responseHeaders.set('Content-Type', proxyRes.headers['content-type'] || 'application/json')
          resolve(new Response(Buffer.concat(chunks), { status: proxyRes.statusCode, headers: responseHeaders }))
        })
      }
    )

    proxyReq.on('error', (err) => {
      resolve(new Response(JSON.stringify({ error: err.message }), { status: 502 }))
    })

    if (bodyBuffer) proxyReq.write(bodyBuffer)
    proxyReq.end()
  })
}
