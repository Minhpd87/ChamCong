export default async (request: Request) => {
  const url = new URL(request.url)
  
  const targetPath = url.pathname.replace(/^\/api-haiphong/, '')
  const targetUrl = `https://chamcong.haiphong.gov.vn${targetPath}${url.search}`

  const modifiedHeaders = new Headers(request.headers)
  modifiedHeaders.set('Host', 'chamcong.haiphong.gov.vn')
  modifiedHeaders.set('Origin', 'https://chamcong.haiphong.gov.vn')
  modifiedHeaders.set('Referer', 'https://chamcong.haiphong.gov.vn/')
  modifiedHeaders.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )
  
  modifiedHeaders.delete('x-forwarded-host')
  modifiedHeaders.delete('x-forwarded-for')
  modifiedHeaders.delete('x-netlify-hostname')

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: modifiedHeaders,
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body
    }

    // Bỏ qua lỗi chứng chỉ SSL không hợp lệ bằng cách fetch qua HTTP Client tùy chỉnh của Deno
    // @ts-ignore - Deno global namespace
    const client = Deno.createHttpClient({
      unsafelyIgnoreCertificateErrors: ["chamcong.haiphong.gov.vn"],
    })

    // @ts-ignore
    const response = await fetch(targetUrl, {
      ...fetchOptions,
      client,
    })

    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
    responseHeaders.set('Access-Control-Allow-Headers', '*')

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: responseHeaders, status: 204 })
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('Proxy Execution Error:', error)
    return new Response(
      JSON.stringify({
        error: 'Proxy Fetch Failed',
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export const config = {
  path: "/api-haiphong/*"
}
