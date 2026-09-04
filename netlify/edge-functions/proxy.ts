export default async (request: Request) => {
  const url = new URL(request.url)
  
  // 1. Tách phần path để ghép sang domain máy chủ chấm công
  const targetPath = url.pathname.replace(/^\/api-haiphong/, '')
  const targetUrl = `https://chamcong.haiphong.gov.vn${targetPath}${url.search}`

  // 2. Tùy chỉnh Headers giả mạo trình duyệt Chrome
  const modifiedHeaders = new Headers(request.headers)
  modifiedHeaders.set('Host', 'chamcong.haiphong.gov.vn')
  modifiedHeaders.set('Origin', 'https://chamcong.haiphong.gov.vn')
  modifiedHeaders.set('Referer', 'https://chamcong.haiphong.gov.vn/')
  modifiedHeaders.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )
  
  // Xóa các headers gây lộ IP/Domain của Netlify
  modifiedHeaders.delete('x-forwarded-host')
  modifiedHeaders.delete('x-forwarded-for')
  modifiedHeaders.delete('x-netlify-hostname')

  try {
    // 3. Chuẩn bị options cho fetch (Xử lý an toàn cho request.body)
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: modifiedHeaders,
    }

    // Chỉ gửi body nếu không phải method GET hoặc HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body
    }

    // 4. Thực hiện request tới server Hải Phòng
    const response = await fetch(targetUrl, fetchOptions)

    // 5. Cấu hình Headers trả về để vượt qua CORS ở Browser
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
    responseHeaders.set('Access-Control-Allow-Headers', '*')

    // Xử lý request Preflight (OPTIONS) từ trình duyệt
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
