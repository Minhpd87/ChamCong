export default async (request, context) => {
  const url = new URL(request.url)
  const path = url.pathname.replace('/.netlify/functions/chamcong-relay', '') + url.search
  const targetUrl = 'https://chamcong.haiphong.gov.vn' + path

  const headers = new Headers(request.headers)
  headers.set('host', 'chamcong.haiphong.gov.vn')
  headers.delete('x-forwarded-for') // avoid leaking Netlify's internal headers upstream

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: 'half',
    })

    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    responseHeaders.set('Access-Control-Allow-Headers', '*')

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502 })
  }
}
