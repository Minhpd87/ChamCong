import { useMemo, useState } from 'react'

import {
  createFileRoute,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'

type Employee = {
  ma_nv: string
  ten: string
  phong: string
}

type FaceInfoResponse = {
  id: string
  userName: string
  anhdangky: string
  x: number
  y: number
  distance: number
  AllowedRadius: number
  Latitude: number
  Longitude: number
  EnableEditAllowedRadius: boolean
  IsBusinessTrip: boolean
  IsApprover: boolean
}

type HighRadiusEmployee = Employee & { faceInfo: FaceInfoResponse }

type AttendanceRecord = {
  WorkDate: string
  FirstCheckIn: string | null
  LastCheckOut: string | null
}

type CheckedInOutEmployee = Employee & { record: AttendanceRecord | null }

type AttendanceSearch = {
  employeeId?: string
  month?: string
}

type AttendanceLoaderData = {
  employees: Employee[]
  employeesError: string | null
  faceInfo: FaceInfoResponse | null
  faceError: string | null
  attendanceRecords: AttendanceRecord[]
  attendanceError: string | null
}

// Panel hiển thị ở khu vực bên phải: chi tiết nhân viên, kết quả quét bán
// kính, hoặc kết quả quét chấm công vào/ra trong ngày.
type ActivePanel = 'detail' | 'highRadius' | 'checkedInOut'

const employeesUrl = new URL('../../nhanvien.json', import.meta.url).href

// Thay URL Cloudflare Worker của bạn vào đây:
const PROXY_WORKER = 'proxy-haiphong.minhpd-87.workers.dev
'

const faceInfoUrl = `${PROXY_WORKER}/api/LAY_FACEID`
const attendanceUrl = `${PROXY_WORKER}/api/mobile/attendance-history`


const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

// Ngưỡng khoảng cách cho phép (m) để coi là "bất thường" khi quét toàn bộ nhân viên
const HIGH_RADIUS_THRESHOLD = 1000
// Số request gọi song song khi quét toàn bộ danh sách nhân viên
const EMPLOYEE_SCAN_CONCURRENCY = 5

async function fetchEmployees(signal?: AbortSignal): Promise<Employee[]> {
  const response = await fetch(employeesUrl, { signal })

  if (!response.ok) {
    throw new Error(`Không thể tải danh sách nhân viên (${response.status})`)
  }

  const data = (await response.json()) as Employee[]
  return Array.isArray(data) ? data : []
}

async function fetchFaceInfo(
  employeeId: string,
  signal?: AbortSignal,
): Promise<FaceInfoResponse> {
  const response = await fetch(
    `${faceInfoUrl}?nhanvien=${encodeURIComponent(employeeId)}`,
    { signal },
  )

  if (!response.ok) {
    throw new Error(
      `Không thể tải thông tin nhân viên (${response.status})`,
    )
  }

  return (await response.json()) as FaceInfoResponse
}

async function fetchAttendance(
  employeeId: string,
  range: { start: Date; end: Date },
  signal?: AbortSignal,
): Promise<AttendanceRecord[]> {
  const url = new URL(attendanceUrl)
  url.searchParams.set('sourceEmployeeId', employeeId)
  url.searchParams.set('startDate', formatDateInput(range.start))
  url.searchParams.set('endDate', formatDateInput(range.end))

  const response = await fetch(url.toString(), { signal })

  if (!response.ok) {
    throw new Error(`Không thể tải lịch chấm công (${response.status})`)
  }

  const data = (await response.json()) as AttendanceRecord[]
  return Array.isArray(data) ? sortAttendanceRecords(data) : []
}

// Chạy `task` cho toàn bộ danh sách nhân viên với số lượng request song song
// giới hạn ở `concurrency`. Lỗi của từng nhân viên riêng lẻ không chặn cả quá
// trình quét — chỉ được đếm lại trong `failedCount`. `onProgress` được gọi
// sau mỗi nhân viên (thành công hoặc lỗi) để cập nhật thanh tiến trình.
async function scanEmployeesWithConcurrency<T>(
  employees: Employee[],
  concurrency: number,
  task: (employee: Employee) => Promise<T | null>,
  onProgress: () => void,
): Promise<{ results: T[]; failedCount: number }> {
  const results: T[] = []
  let cursorIndex = 0
  let failedCount = 0

  async function worker() {
    while (cursorIndex < employees.length) {
      const currentIndex = cursorIndex
      cursorIndex += 1
      const employee = employees[currentIndex]

      try {
        const result = await task(employee)

        if (result) {
          results.push(result)
        }
      } catch {
        failedCount += 1
      } finally {
        onProgress()
      }
    }
  }

  const workerCount = Math.min(concurrency, employees.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return { results, failedCount }
}

// Lưu ý: chữ ký chính xác của loader/validateSearch (tên field `signal`,
// cách đọc `deps`, v.v.) có thể lệch đôi chút giữa các bản TanStack Router —
// kiểm tra lại theo version đang dùng trong project nếu compiler báo lỗi type.
export const Route = createFileRoute('/')({
  // Bắt buộc chạy loader ở client: nhanvien.json (resolve qua import.meta.url)
  // và API chamcong.haiphong.gov.vn chỉ gọi được từ trình duyệt người dùng,
  // không gọi được từ server/Netlify Function lúc SSR — chạy trên server sẽ
  // báo lỗi "fetch failed".
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AttendanceSearch => ({
    employeeId:
      typeof search.employeeId === 'string' && search.employeeId
        ? search.employeeId
        : undefined,
    month:
      typeof search.month === 'string' && search.month
        ? search.month
        : undefined,
  }),
  loaderDeps: ({ search }) => ({
    employeeId: search.employeeId,
    month: search.month ?? getMonthInputValue(new Date()),
  }),
  loader: async ({ deps, signal }): Promise<AttendanceLoaderData> => {
    let employees: Employee[] = []
    let employeesError: string | null = null

    try {
      employees = await fetchEmployees(signal)
    } catch (error) {
      employeesError =
        error instanceof Error
          ? error.message
          : 'Không thể tải danh sách nhân viên'
    }

    let faceInfo: FaceInfoResponse | null = null
    let faceError: string | null = null
    let attendanceRecords: AttendanceRecord[] = []
    let attendanceError: string | null = null

    if (deps.employeeId) {
      try {
        faceInfo = await fetchFaceInfo(deps.employeeId, signal)
      } catch (error) {
        faceError =
          error instanceof Error
            ? error.message
            : 'Không thể tải thông tin nhân viên'
      }

      const range = getAttendanceRange(deps.month)

      if (!range) {
        attendanceError = 'Tháng đã chọn chưa tới, chưa có dữ liệu.'
      } else {
        try {
          attendanceRecords = await fetchAttendance(
            deps.employeeId,
            range,
            signal,
          )
        } catch (error) {
          attendanceError =
            error instanceof Error
              ? error.message
              : 'Không thể tải lịch chấm công'
        }
      }
    }

    return {
      employees,
      employeesError,
      faceInfo,
      faceError,
      attendanceRecords,
      attendanceError,
    }
  },
  component: App,
})

function App() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const isPending = useRouterState({
    select: (state) => state.status === 'pending',
  })

  const {
    employees,
    employeesError,
    faceInfo,
    faceError,
    attendanceRecords,
    attendanceError,
  } = Route.useLoaderData()

  const [searchTerm, setSearchTerm] = useState('')

  // Panel nào đang hiển thị ở khu vực bên phải
  const [activePanel, setActivePanel] = useState<ActivePanel>('detail')

  // --- Quét toàn bộ nhân viên để tìm ai có Khoảng cách cho phép > 1000m ---
  const [highRadiusResults, setHighRadiusResults] = useState<
    HighRadiusEmployee[] | null
  >(null)
  const [isScanningRadius, setIsScanningRadius] = useState(false)
  const [radiusScanError, setRadiusScanError] = useState<string | null>(null)
  const [radiusScanProgress, setRadiusScanProgress] = useState({
    done: 0,
    total: 0,
  })

  // --- Quét toàn bộ nhân viên để tìm ai đã chấm công vào & ra hôm nay ---
  const [checkedInOutResults, setCheckedInOutResults] = useState<
    CheckedInOutEmployee[] | null
  >(null)
  const [isScanningCheckedInOut, setIsScanningCheckedInOut] = useState(false)
  const [checkedInOutError, setCheckedInOutError] = useState<string | null>(
    null,
  )
  const [checkedInOutProgress, setCheckedInOutProgress] = useState({
    done: 0,
    total: 0,
  })

  const selectedEmployeeId = search.employeeId ?? ''
  const attendanceMonth = search.month ?? getMonthInputValue(new Date())

  function handleSelectEmployee(employeeId: string) {
    setActivePanel('detail')
    void navigate({
      search: (prev) => ({ ...prev, employeeId }),
    })
  }

  function handleChangeMonth(month: string) {
    void navigate({
      search: (prev) => ({ ...prev, month }),
    })
  }

  function handleSearchTermChange(value: string) {
    setSearchTerm(value)

    if (value.trim() === '') {
      void navigate({
        search: (prev) => ({ ...prev, month: undefined }),
      })
    }
  }

  function handleClearSearch() {
    handleSearchTermChange('')
    void navigate({
      search: (prev) => ({ ...prev, employeeId: undefined }),
    })
  }

  function handleReloadAttendance() {
    void router.invalidate()
  }

  function handleClosePanel() {
    setActivePanel('detail')
  }

  async function handleScanHighRadius() {
    if (isScanningRadius || employees.length === 0) {
      return
    }

    setIsScanningRadius(true)
    setRadiusScanError(null)
    setRadiusScanProgress({ done: 0, total: employees.length })
    setActivePanel('highRadius')

    try {
      const { results, failedCount } = await scanEmployeesWithConcurrency(
        employees,
        EMPLOYEE_SCAN_CONCURRENCY,
        async (employee) => {
          const info = await fetchFaceInfo(employee.ma_nv)

          if (info.AllowedRadius > HIGH_RADIUS_THRESHOLD) {
            return { ...employee, faceInfo: info }
          }

          return null
        },
        () =>
          setRadiusScanProgress((prev) => ({ ...prev, done: prev.done + 1 })),
      )

      results.sort(
        (a, b) => b.faceInfo.AllowedRadius - a.faceInfo.AllowedRadius,
      )
      setHighRadiusResults(results)

      if (failedCount > 0) {
        setRadiusScanError(
          `Không lấy được dữ liệu của ${failedCount} nhân viên, kết quả có thể chưa đầy đủ.`,
        )
      }
    } catch (error) {
      setRadiusScanError(
        error instanceof Error
          ? error.message
          : 'Không thể quét danh sách nhân viên',
      )
    } finally {
      setIsScanningRadius(false)
    }
  }

  async function handleScanCheckedInOut() {
    if (isScanningCheckedInOut || employees.length === 0) {
      return
    }

    setIsScanningCheckedInOut(true)
    setCheckedInOutError(null)
    setCheckedInOutProgress({ done: 0, total: employees.length })
    setActivePanel('checkedInOut')

    const today = new Date()
    const todayValue = formatDateInput(today)

    try {
      const { results, failedCount } = await scanEmployeesWithConcurrency(
        employees,
        EMPLOYEE_SCAN_CONCURRENCY,
        async (employee) => {
          try {
            const records = await fetchAttendance(employee.ma_nv, {
              start: today,
              end: today,
            })
            const record =
              records.find((item) => item.WorkDate === todayValue) ??
              records[0] ??
              null

            // Luôn trả về nhân viên dù có/chưa có dữ liệu chấm công, để danh
            // sách hiển thị đầy đủ tất cả nhân viên chứ không chỉ người đã
            // chấm công xong.
            return { ...employee, record }
          } catch {
            return { ...employee, record: null }
          }
        },
        () =>
          setCheckedInOutProgress((prev) => ({
            ...prev,
            done: prev.done + 1,
          })),
      )

      // Sắp xếp: chưa chấm công / mới chấm công vào lên trước để dễ theo
      // dõi ai còn thiếu dữ liệu, sau đó xếp theo tên.
      results.sort((a, b) => {
        const priorityDiff =
          getAttendanceStatusPriority(a.record) -
          getAttendanceStatusPriority(b.record)

        if (priorityDiff !== 0) {
          return priorityDiff
        }

        return a.ten.localeCompare(b.ten, 'vi')
      })
      setCheckedInOutResults(results)

      if (failedCount > 0) {
        setCheckedInOutError(
          `Không lấy được dữ liệu của ${failedCount} nhân viên, kết quả có thể chưa đầy đủ.`,
        )
      }
    } catch (error) {
      setCheckedInOutError(
        error instanceof Error
          ? error.message
          : 'Không thể quét danh sách nhân viên',
      )
    } finally {
      setIsScanningCheckedInOut(false)
    }
  }

  const filteredEmployees = useMemo(() => {
    const keyword = normalizeSearchText(searchTerm)

    if (!keyword) {
      return employees
    }

    return employees.filter((employee) => {
      return (
        normalizeSearchText(employee.ma_nv).includes(keyword) ||
        normalizeSearchText(employee.ten).includes(keyword) ||
        normalizeSearchText(employee.phong).includes(keyword)
      )
    })
  }, [employees, searchTerm])

  const selectedEmployee = useMemo(() => {
    return (
      employees.find((employee) => employee.ma_nv === selectedEmployeeId) ??
      null
    )
  }, [employees, selectedEmployeeId])

  const attendanceStats = useMemo(() => {
    let weekdayWorkedDays = 0
    let weekendWorkedDays = 0
    let lateDays = 0
    let lateCheckoutDays = 0
    const monthDayTotals = getMonthDayTotals(attendanceMonth)

    for (const record of attendanceRecords) {
      const weekend = isWeekendDate(record.WorkDate)

      if (weekend) {
        weekendWorkedDays += 1
      } else {
        weekdayWorkedDays += 1
      }

      if (!weekend && isAfterCutoff(record.FirstCheckIn, '07:30:00')) {
        lateDays += 1
      }

      if (!weekend && isAfterCutoff(record.LastCheckOut, '18:00:00')) {
        lateCheckoutDays += 1
      }
    }

    return {
      weekdayWorkedDays,
      weekendWorkedDays,
      totalWeekdaysInMonth: monthDayTotals.weekdays,
      totalWeekendDaysInMonth: monthDayTotals.weekends,
      lateDays,
      lateCheckoutDays,
    }
  }, [attendanceMonth, attendanceRecords])

  const attendanceSections = useMemo(() => {
    const recordsByDate = new Map(
      attendanceRecords.map((record) => [record.WorkDate, record]),
    )
    const range = getAttendanceRange(attendanceMonth)

    if (!range) {
      return []
    }

    const sections: Array<{
      monthKey: string
      title: string
      items: Array<{
        date: string
        weekday: string
        isWeekend: boolean
        record: AttendanceRecord | undefined
      }>
    }> = []

    const cursor = new Date(range.end)

    while (cursor >= range.start) {
      const date = formatDateInput(cursor)
      const monthKey = date.slice(0, 7)
      const monthTitle = formatMonthTitle(cursor)
      const record = recordsByDate.get(date)
      const dayOfWeek = cursor.getDay()

      const item = {
        date,
        weekday: weekdayLabels[dayOfWeek],
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        record,
      }

      if (
        sections.length === 0 ||
        sections[sections.length - 1].monthKey !== monthKey
      ) {
        sections.push({
          monthKey,
          title: monthTitle,
          items: [item],
        })
      } else {
        sections[sections.length - 1].items.push(item)
      }

      cursor.setDate(cursor.getDate() - 1)
    }

    return sections
  }, [attendanceMonth, attendanceRecords])

  return (
    <main className="demo-page demo-page-wide px-4 pb-10 pt-6 sm:pt-8">
      <section className="demo-panel relative overflow-hidden rounded-2xl border border-slate-300 bg-white px-5 py-6 shadow-sm sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(66,133,244,0.12),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(52,168,83,0.10),transparent_66%)]" />
        <div className="relative grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500">
              Tra cứu thông tin chấm công
            </p>
            <h1 className="display-title m-0 text-3xl font-bold leading-[1.02] text-slate-900 sm:text-5xl">
              Danh sách của Sở Tài chính
            </h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Nhân viên" value={String(employees.length)} />
            <StatCard
              label="Đã chọn"
              value={selectedEmployee ? selectedEmployee.ma_nv : 'Chưa có'}
            />
            <StatCard
              label="Trạng thái"
              value={isPending ? 'Đang tải' : 'Sẵn sàng'}
            />
          </div>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={handleScanHighRadius}
            disabled={isScanningRadius || employees.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 hover:cursor-pointer"
          >
            {isScanningRadius
              ? `Đang quét ${radiusScanProgress.done}/${radiusScanProgress.total}...`
              : `Kiểm tra khoảng cách cho phép > ${HIGH_RADIUS_THRESHOLD}m`}
          </button>

          <button
            type="button"
            onClick={handleScanCheckedInOut}
            disabled={isScanningCheckedInOut || employees.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-teal-300 bg-teal-50 px-5 py-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50 hover:cursor-pointer"
          >
            {isScanningCheckedInOut
              ? `Đang quét ${checkedInOutProgress.done}/${checkedInOutProgress.total}...`
              : 'Xem tình trạng chấm công hôm nay'}
          </button>

          {activePanel === 'highRadius' && highRadiusResults ? (
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {highRadiusResults.length} nhân viên vượt ngưỡng
            </span>
          ) : null}

          {activePanel === 'checkedInOut' && checkedInOutResults ? (
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {
                checkedInOutResults.filter(
                  (item) => getAttendanceStatusPriority(item.record) === 2,
                ).length
              }
              /{checkedInOutResults.length} đã chấm công đủ
            </span>
          ) : null}

          {activePanel !== 'detail' ? (
            <button
              type="button"
              onClick={handleClosePanel}
              className="ml-auto text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 underline-offset-2 hover:cursor-pointer hover:underline"
            >
              Đóng bảng kết quả
            </button>
          ) : null}
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="demo-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="demo-section-title text-lg text-slate-900">
                Danh sách nhân viên
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Tìm nhanh theo mã, tên hoặc phòng ban.
              </p>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Tìm kiếm
            </span>
            <div className="relative">
              <input
                value={searchTerm}
                onChange={(event) => handleSearchTermChange(event.target.value)}
                placeholder="Nhập mã NV, tên hoặc phòng ban"
                className=" w-full rounded-md border border-slate-400 bg-white px-4 py-3 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="hover:cursor-pointer absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M1 1L13 13M13 1L1 13"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </label>

          {employeesError ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {employeesError}
            </div>
          ) : null}

          <div className="mt-4 max-h-[320px] space-y-2 overflow-auto pr-1 sm:max-h-[620px]">
            {searchTerm.trim() === '' ? (
              <EmptyState
                title="Nhập từ khóa để tìm nhân viên"
                description="Nhập mã NV, tên hoặc phòng ban vào ô tìm kiếm ở trên để hiển thị kết quả."
              />
            ) : isPending ? (
              <LoadingBlock label="Đang tải danh sách nhân viên..." />
            ) : filteredEmployees.length ? (
              filteredEmployees.map((employee) => {
                const isActive = employee.ma_nv === selectedEmployeeId

                return (
                  <button
                    key={employee.ma_nv}
                    type="button"
                    onClick={() => handleSelectEmployee(employee.ma_nv)}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      isActive
                        ? 'border-blue-300 bg-blue-50 shadow-[0_0_0_1px_rgba(66,133,244,0.25)]'
                        : 'border-slate-300 bg-white hover:border-blue-200 hover:bg-slate-100 hover:cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="m-0 text-sm font-bold text-teal-700">
                          {employee.ten}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-600">
                          {employee.phong}
                        </p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Mã{' '}
                          <span className="font-bold text-slate-900">
                            {employee.ma_nv}
                          </span>
                        </p>
                      </div>
                      {/* <span className="rounded-md border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        {employee.phong}
                      </span> */}
                    </div>
                  </button>
                )
              })
            ) : (
              <EmptyState
                title="Không tìm thấy nhân viên"
                description="Thử thay đổi từ khóa tìm kiếm để mở rộng danh sách."
              />
            )}
          </div>
        </aside>

        {activePanel === 'highRadius' ? (
          <section className="demo-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="demo-section-title text-lg text-slate-900">
                  Nhân viên có khoảng cách cho phép &gt; {HIGH_RADIUS_THRESHOLD}m
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isScanningRadius
                    ? `Đang quét ${radiusScanProgress.done}/${radiusScanProgress.total} nhân viên...`
                    : highRadiusResults
                      ? `Tìm thấy ${highRadiusResults.length} nhân viên vượt ngưỡng.`
                      : 'Chưa có kết quả.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePanel}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:cursor-pointer"
              >
                Quay lại
              </button>
            </div>

            {radiusScanError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {radiusScanError}
              </div>
            ) : null}

            {isScanningRadius ? (
              <LoadingBlock
                label={`Đang kiểm tra từng nhân viên (${radiusScanProgress.done}/${radiusScanProgress.total})...`}
              />
            ) : highRadiusResults && highRadiusResults.length > 0 ? (
              <div className="mt-5 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3 font-semibold">
                          Mã NV
                        </th>
                        <th className="px-4 py-3 font-semibold">Tên</th>
                        <th className="px-4 py-3 font-semibold">Phòng</th>
                        <th className="px-4 py-3 font-semibold">
                          Khoảng cách cho phép
                        </th>
                        <th className="px-4 py-3 font-semibold">Vị trí</th>
                        <th className="px-4 py-3 font-semibold">
                          Cho phép sửa
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {highRadiusResults.map((item) => (
                        <tr
                          key={item.ma_nv}
                          className="cursor-pointer border-t border-slate-300 odd:bg-white even:bg-slate-50/70 hover:bg-amber-50"
                          onClick={() => handleSelectEmployee(item.ma_nv)}
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                            {item.ma_nv}
                          </td>
                          <td className="px-4 py-3 font-semibold text-teal-700">
                            {item.ten}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {item.phong}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                              {formatMeters(item.faceInfo.AllowedRadius)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {item.faceInfo.Latitude.toFixed(6)},{' '}
                            {item.faceInfo.Longitude.toFixed(6)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {item.faceInfo.EnableEditAllowedRadius
                              ? 'Có'
                              : 'Không'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Không có nhân viên nào vượt ngưỡng"
                description={`Không tìm thấy nhân viên nào có khoảng cách cho phép trên ${HIGH_RADIUS_THRESHOLD}m.`}
              />
            )}
          </section>
        ) : activePanel === 'checkedInOut' ? (
          <section className="demo-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="demo-section-title text-lg text-slate-900">
                  Tình trạng chấm công hôm nay
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isScanningCheckedInOut
                    ? `Đang quét ${checkedInOutProgress.done}/${checkedInOutProgress.total} nhân viên...`
                    : checkedInOutResults
                      ? `${checkedInOutResults.length} nhân viên — bao gồm cả người chưa chấm công.`
                      : 'Chưa có kết quả.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePanel}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:cursor-pointer"
              >
                Quay lại
              </button>
            </div>

            {checkedInOutError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {checkedInOutError}
              </div>
            ) : null}

            {isScanningCheckedInOut ? (
              <LoadingBlock
                label={`Đang kiểm tra từng nhân viên (${checkedInOutProgress.done}/${checkedInOutProgress.total})...`}
              />
            ) : checkedInOutResults && checkedInOutResults.length > 0 ? (
              <div className="mt-5 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3 font-semibold">
                          Mã NV
                        </th>
                        <th className="px-4 py-3 font-semibold">Tên</th>
                        <th className="px-4 py-3 font-semibold">Phòng</th>
                        <th className="px-4 py-3 font-semibold">
                          Trạng thái
                        </th>
                        <th className="px-4 py-3 font-semibold">
                          Chấm công vào
                        </th>
                        <th className="px-4 py-3 font-semibold">
                          Chấm công ra
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkedInOutResults.map((item) => {
                        const statusPriority = getAttendanceStatusPriority(
                          item.record,
                        )
                        const statusBadgeClasses =
                          statusPriority === 2
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : statusPriority === 1
                              ? 'border-amber-300 bg-amber-50 text-amber-800'
                              : 'border-slate-300 bg-slate-100 text-slate-500'

                        return (
                          <tr
                            key={item.ma_nv}
                            className="cursor-pointer border-t border-slate-300 odd:bg-white even:bg-slate-50/70 hover:bg-teal-50"
                            onClick={() => handleSelectEmployee(item.ma_nv)}
                          >
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                              {item.ma_nv}
                            </td>
                            <td className="px-4 py-3 font-semibold text-teal-700">
                              {item.ten}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {item.phong}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-bold ${statusBadgeClasses}`}
                              >
                                {getAttendanceStatusLabel(item.record)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <AttendanceValue
                                value={item.record?.FirstCheckIn}
                                isLate={false}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <AttendanceValue
                                value={item.record?.LastCheckOut}
                                isLate={false}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Chưa có dữ liệu"
                description="Không tìm thấy nhân viên nào để hiển thị tình trạng chấm công."
              />
            )}
          </section>
        ) : (
          <section className="space-y-6">
            <div className="demo-panel">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="demo-section-title text-lg text-slate-900">
                    Thông tin nhân viên
                  </h2>
                  <p className="mt-1 text-sm">
                    {selectedEmployee ? (
                      <span className="font-semibold text-blue-700">
                        {selectedEmployee.ten} - {selectedEmployee.phong}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Hãy chọn một nhân viên để xem chi tiết.
                      </span>
                    )}
                  </p>
                </div>

                {isPending && selectedEmployeeId ? (
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Đang tải thông tin...
                  </span>
                ) : null}
              </div>

              {faceError ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {faceError}
                </div>
              ) : null}

              {selectedEmployee ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <InfoCard
                    label="ID"
                    value={faceInfo?.id ?? selectedEmployee.ma_nv}
                  />
                  {/* <InfoCard
                  label="Tên nhân viên"
                  value={
                    faceInfo
                      ? normalizeDisplayText(faceInfo.userName)
                      : selectedEmployee.ten
                  }
                /> */}
                  <InfoCard
                    label="Khoảng cách cho phép"
                    value={
                      faceInfo
                        ? formatMeters(faceInfo.AllowedRadius)
                        : 'Chưa có dữ liệu'
                    }
                  />
                  <InfoCard
                    label="Vị trí"
                    value={
                      faceInfo
                        ? `${faceInfo.Latitude.toFixed(6)}, ${faceInfo.Longitude.toFixed(6)}`
                        : 'Chưa có dữ liệu'
                    }
                  />
                  <InfoCard
                    label="Cho phép sửa khoảng cách"
                    value={
                      faceInfo
                        ? faceInfo.EnableEditAllowedRadius
                          ? 'Có'
                          : 'Không'
                        : 'Chưa có dữ liệu'
                    }
                  />
                  {/* <InfoCard
                  label="Đi công tác / Phê duyệt"
                  value={
                    faceInfo
                      ? `${faceInfo.IsBusinessTrip ? 'Công tác' : 'Không công tác'} / ${faceInfo.IsApprover ? 'Có duyệt' : 'Không duyệt'}`
                      : 'Chưa có dữ liệu'
                  }
                /> */}
                </div>
              ) : (
                <EmptyState
                  title="Chưa chọn nhân viên"
                  description="Bấm vào một nhân viên trong danh sách bên trái để xem thông tin và lịch chấm công."
                />
              )}
            </div>

            <div className="demo-panel">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="demo-section-title text-lg text-slate-900">
                    Lịch chấm công
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedEmployee
                      ? 'Chọn tháng rồi tải dữ liệu chấm công tương ứng.'
                      : 'Cần chọn nhân viên trước khi xem dữ liệu chấm công.'}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Tháng
                    </span>
                    <input
                      type="month"
                      value={attendanceMonth}
                      onChange={(event) =>
                        handleChangeMonth(event.target.value)
                      }
                      className="demo-input rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleReloadAttendance}
                      disabled={!selectedEmployeeId || isPending}
                      className="w-full rounded-md border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isPending ? 'Đang tải...' : 'Tải lại'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryStat
                  label="Ngày đi làm ngày thường"
                  value={`${attendanceStats.weekdayWorkedDays}/${attendanceStats.totalWeekdaysInMonth}`}
                  // hint="Số ngày có workdate trên tổng số ngày làm việc trong tháng"
                />
                <SummaryStat
                  label="Ngày đi làm cuối tuần"
                  value={`${attendanceStats.weekendWorkedDays}/${attendanceStats.totalWeekendDaysInMonth}`}
                  // hint="Số ngày có workdate trên tổng số ngày Thứ bảy và Chủ nhật trong tháng"
                />
                <SummaryStat
                  label="Ngày đi muộn"
                  value={String(attendanceStats.lateDays)}
                  // hint="FirstCheckIn sau 07:30, chỉ tính ngày thường"
                />
                <SummaryStat
                  label="Ngày về sau 18h"
                  value={String(attendanceStats.lateCheckoutDays)}
                  // hint="LastCheckOut sau 18:00, chỉ tính ngày thường"
                />
                {/* <SummaryStat
                label="Tháng"
                value={formatMonthLabel(attendanceMonth).replace('Tháng ', '')}
                // hint="Dữ liệu đang hiển thị"
              /> */}
              </div>

              {attendanceError ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {attendanceError}
                </div>
              ) : null}

              {selectedEmployee ? (
                <div className="mt-5">
                  {attendanceSections.length ? (
                    <div className="space-y-6">
                      {attendanceSections.map((section) => (
                        <section key={section.monthKey}>
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="m-0 text-base font-bold text-red-800 uppercase">
                              {section.title}
                            </h3>
                            <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-red-800">
                              {section.items.length} ngày
                            </p>
                          </div>

                          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xs">
                            <div className="overflow-x-auto">
                              <table className="min-w-full border-collapse text-left text-sm">
                                <thead className="bg-slate-50 text-slate-700">
                                  <tr>
                                    <th className="px-4 py-3 font-semibold">
                                      Ngày
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Thứ
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Chấm công vào
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Chấm công ra
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.items.map((item) => (
                                    <tr
                                      key={item.date}
                                      className={`border-t border-slate-300 ${
                                        item.isWeekend
                                          ? 'bg-red-50/60'
                                          : 'odd:bg-white even:bg-slate-50/70'
                                      }`}
                                    >
                                      <td className="px-4 py-3 font-semibold text-slate-900">
                                        {formatDayMonth(item.date)}
                                      </td>
                                      <td
                                        className={`px-4 py-3 font-semibold ${
                                          item.isWeekend
                                            ? 'text-red-600'
                                            : 'text-slate-500'
                                        }`}
                                      >
                                        {item.weekday}
                                      </td>
                                      <td className="px-4 py-3">
                                        <AttendanceValue
                                          value={item.record?.FirstCheckIn}
                                          isLate={
                                            !item.isWeekend &&
                                            isAfterCutoff(
                                              item.record?.FirstCheckIn,
                                              '07:30:00',
                                            )
                                          }
                                        />
                                      </td>
                                      <td className="px-4 py-3">
                                        <AttendanceValue
                                          value={item.record?.LastCheckOut}
                                          isLate={
                                            !item.isWeekend &&
                                            isAfterCutoff(
                                              item.record?.LastCheckOut,
                                              '18:00:00',
                                            )
                                          }
                                          lateVariant="positive"
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="Chưa có dữ liệu chấm công"
                      description="Chưa có ngày nào tính đến hôm nay trong tháng đã chọn, hoặc chưa có dữ liệu được ghi nhận."
                    />
                  )}
                </div>
              ) : (
                <EmptyState
                  title="Chưa chọn nhân viên"
                  description="Chọn nhân viên để xem lịch chấm công theo ngày."
                />
              )}
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-4 py-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-bold text-slate-900">
        {value}
      </p>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white px-4 py-4 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-teal-800">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
        {label}
      </p>
      <p className="mt-2 break-words text-normal font-bold leading-6 text-teal-900">
        {value}
      </p>
    </div>
  )
}

function AttendanceValue({
  value,
  isLate,
  lateVariant = 'warning',
}: {
  value: string | null | undefined
  isLate: boolean
  lateVariant?: 'warning' | 'positive'
}) {
  if (!value) {
    return <span className="text-slate-400">Không có dữ liệu</span>
  }

  const badgeClasses =
    lateVariant === 'positive'
      ? 'border-green-200 bg-green-50 text-green-700'
      : 'border-amber-300 bg-amber-50 text-amber-800'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-slate-900">
        <span className="sm:hidden">{formatHHMM(value)}</span>
        <span className="hidden sm:inline">{value}</span>
      </span>
      {isLate ? (
        <span
          className={`hidden rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] sm:inline-flex ${badgeClasses}`}
        >
          Muộn
        </span>
      ) : null}
    </div>
  )
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
      {label}
    </div>
  )
}

function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-400 bg-slate-50 px-5 py-10 text-center">
      <p className="m-0 text-base font-bold text-slate-900">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  )
}

function parseDateInput(value: string) {
  if (!value) {
    return null
  }

  const [year, month, day] = value
    .split('-')
    .map((part) => Number.parseInt(part, 10))

  if (!year || !month || !day) {
    return null
  }

  return new Date(year, month - 1, day)
}

function formatDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatDayMonth(dateValue: string) {
  const [, month, day] = dateValue.split('-')

  return `${Number(day)}/${Number(month)}`
}

function formatHHMM(timeValue: string) {
  return timeValue.split(':').slice(0, 2).join(':')
}

// Định dạng số mét theo kiểu Việt Nam, dùng dấu chấm phân cách hàng nghìn:
// 1000 -> "1.000m", 50000 -> "50.000m"
function formatMeters(meters: number) {
  return `${meters.toLocaleString('vi-VN')}m`
}

// Thứ tự ưu tiên hiển thị trong bảng tình trạng chấm công hôm nay:
// 0 = chưa chấm công vào, 1 = đã vào nhưng chưa ra, 2 = đã chấm công đủ.
function getAttendanceStatusPriority(record: AttendanceRecord | null) {
  if (!record || !record.FirstCheckIn) {
    return 0
  }

  if (!record.LastCheckOut) {
    return 1
  }

  return 2
}

function getAttendanceStatusLabel(record: AttendanceRecord | null) {
  if (!record || !record.FirstCheckIn) {
    return 'Chưa chấm công'
  }

  if (!record.LastCheckOut) {
    return 'Đã vào, chưa ra'
  }

  return 'Đã chấm công đủ'
}

function getMonthInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')

  return `${year}-${month}`
}

function parseMonthInput(value: string) {
  if (!value) {
    return null
  }

  const [year, month] = value
    .split('-')
    .map((part) => Number.parseInt(part, 10))

  if (!year || !month) {
    return null
  }

  return new Date(year, month - 1, 1)
}

function getMonthLastDay(monthStart: Date) {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
}

function getMonthDayTotals(monthValue: string) {
  const monthStart = parseMonthInput(monthValue)

  if (!monthStart) {
    return { weekdays: 0, weekends: 0 }
  }

  const monthEnd = getMonthLastDay(monthStart)
  let weekdays = 0
  let weekends = 0

  for (
    const cursor = new Date(monthStart);
    cursor <= monthEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const day = cursor.getDay()

    if (day === 0 || day === 6) {
      weekends += 1
    } else {
      weekdays += 1
    }
  }

  return { weekdays, weekends }
}

// Chỉ trả về khoảng ngày từ đầu tháng đến hôm nay (nếu là tháng hiện tại)
// hoặc trọn tháng (nếu tháng đã qua). Trả về null nếu tháng chọn ở tương lai.
function getAttendanceRange(monthValue: string) {
  const start = parseMonthInput(monthValue)

  if (!start) {
    return null
  }

  const monthLastDay = getMonthLastDay(start)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const end = monthLastDay < today ? monthLastDay : today

  if (end < start) {
    return null
  }

  return { start, end }
}

function formatMonthTitle(date: Date) {
  return `Tháng ${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

function formatMonthLabel(value: string) {
  const date = parseMonthInput(value)

  return date ? formatMonthTitle(date) : 'Chưa chọn'
}

function normalizeDisplayText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeSearchText(value: string) {
  return normalizeDisplayText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
}

function sortAttendanceRecords(records: AttendanceRecord[]) {
  return [...records].sort((left, right) => {
    return left.WorkDate.localeCompare(right.WorkDate)
  })
}

function isAfterCutoff(timeValue: string | null | undefined, cutoff: string) {
  if (!timeValue) {
    return false
  }

  return toSeconds(timeValue) > toSeconds(cutoff)
}

function isWeekendDate(dateValue: string) {
  const date = parseDateInput(dateValue)

  if (!date) {
    return false
  }

  const day = date.getDay()

  return day === 0 || day === 6
}

function toSeconds(timeValue: string) {
  const [hours, minutes, seconds = '0'] = timeValue.split(':')

  return (
    Number.parseInt(hours ?? '0', 10) * 3600 +
    Number.parseInt(minutes ?? '0', 10) * 60 +
    Number.parseInt(seconds ?? '0', 10)
  )
}
