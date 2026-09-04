import type { Config } from '@netlify/functions'
import https from 'node:https'

export default async (request: Request) => {
  const url = new URL(request.url)
  
  // 1. Ghép URL đích
  const targetPath = url.pathname.replace(/^\/api-haiphong/, '')
  const targetUrl = `https://chamcong.haiphong.gov.vn${targetPath}${url.search}`

  // 2. Giả mạo Headers trình duyệt
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

    // 3. Sử dụng https Agent trong Node.js để BỎ QUA kiểm tra SSL (rejectUnauthorized: false)
    const agent = new https.Agent({
      rejectUnauthorized: false,
    })

    // @ts-ignore - truyền custom agent vào fetch Node.js
    fetchOptions.agent = agent

    const response = await fetch(targetUrl, fetchOptions)

    // 4. Mở CORS headers cho phía Client
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
    console.error('Proxy Node Fetch Error:', error)
    return new Response(
      JSON.stringify({
        error: 'Proxy Node Fetch Failed',
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export const config: Config = {
  path: '/api-haiphong/*',
}
