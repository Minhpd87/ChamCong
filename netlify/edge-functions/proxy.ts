export default async (request: Request) => {
  const url = new URL(request.url)
  
  // Trích xuất phần đuôi API và ghép vào URL của Hải Phòng
  const targetPath = url.pathname.replace(/^\/api-haiphong/, '')
  const targetUrl = new URL(targetPath + url.search, 'https://chamcong.haiphong.gov.vn')

  // Giả mạo hoàn toàn các header để đánh lừa tường lửa của chính phủ
  const modifiedHeaders = new Headers(request.headers)
  modifiedHeaders.set('Origin', 'https://chamcong.haiphong.gov.vn')
  modifiedHeaders.set('Referer', 'https://chamcong.haiphong.gov.vn/')
  modifiedHeaders.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )
  modifiedHeaders.delete('X-Forwarded-Host')
  modifiedHeaders.delete('X-Forwarded-For')

  try {
    // Gọi API đích bằng header đã giả mạo
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: modifiedHeaders,
      body: request.body
    })

    // Mở khóa CORS cho trình duyệt của bạn nhận data trả về
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    return new Response('Proxy Server Error', { status: 500 })
  }
}

// Cấu hình để Netlify tự động chạy function này khi gọi vào /api-haiphong/
export const config = {
  path: "/api-haiphong/*"
}
