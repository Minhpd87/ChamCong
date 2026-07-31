import { useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'

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

type AttendanceRecord = {
  WorkDate: string
  FirstCheckIn: string | null
  LastCheckOut: string | null
}

const employeesUrl = new URL('../../nhanvien.json', import.meta.url).href
const faceInfoUrl = 'https://chamcong.haiphong.gov.vn/api/LAY_FACEID'
const attendanceUrl =
  'https://chamcong.haiphong.gov.vn/api/mobile/attendance-history'

const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

export const Route = createFileRoute('/')({ component: App })

function App() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeesLoading, setEmployeesLoading] = useState(true)
  const [employeesError, setEmployeesError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [manualEmployeeId, setManualEmployeeId] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [faceInfo, setFaceInfo] = useState<FaceInfoResponse | null>(null)
  const [faceLoading, setFaceLoading] = useState(false)
  const [faceError, setFaceError] = useState<string | null>(null)
  const [attendanceMonth, setAttendanceMonth] = useState(
    getMonthInputValue(new Date()),
  )
  const [attendanceRecords, setAttendanceRecords] = useState<
    AttendanceRecord[]
  >([])
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadEmployees() {
      try {
        setEmployeesLoading(true)
        setEmployeesError(null)

        const response = await fetch(employeesUrl, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(
            `Không thể tải danh sách nhân viên (${response.status})`,
          )
        }

        const data = (await response.json()) as Employee[]
        setEmployees(Array.isArray(data) ? data : [])
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return
        }

        setEmployeesError(
          error instanceof Error
            ? error.message
            : 'Không thể tải danh sách nhân viên',
        )
      } finally {
        setEmployeesLoading(false)
      }
    }

    void loadEmployees()

    return () => {
      controller.abort()
    }
  }, [])

  // Chọn nhân viên xong thì tự động tải thông tin nhân viên,
  // không cần bấm nút riêng nữa.
  useEffect(() => {
    setFaceInfo(null)
    setFaceError(null)

    if (!selectedEmployeeId) {
      return
    }

    const controller = new AbortController()

    async function loadFaceInfo() {
      try {
        setFaceLoading(true)
        setFaceError(null)

        const response = await fetch(
          `${faceInfoUrl}?nhanvien=${encodeURIComponent(selectedEmployeeId)}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error(
            `Không thể tải thông tin nhân viên (${response.status})`,
          )
        }

        const data = (await response.json()) as FaceInfoResponse
        setFaceInfo(data)
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return
        }

        setFaceError(
          error instanceof Error
            ? error.message
            : 'Không thể tải thông tin nhân viên',
        )
      } finally {
        setFaceLoading(false)
      }
    }

    void loadFaceInfo()

    return () => {
      controller.abort()
    }
  }, [selectedEmployeeId])

  // Chọn nhân viên hoặc đổi tháng xong thì tự động tải lịch chấm công,
  // không cần bấm nút riêng nữa.
  useEffect(() => {
    setAttendanceRecords([])
    setAttendanceError(null)

    if (!selectedEmployeeId) {
      return
    }

    const startDate = parseMonthInput(attendanceMonth)

    if (!startDate) {
      setAttendanceError('Tháng đã chọn không hợp lệ.')
      return
    }

    const endDate = getMonthLastDay(startDate)
    const startDateInput = formatDateInput(startDate)
    const endDateInput = formatDateInput(endDate)

    const controller = new AbortController()

    async function loadAttendance() {
      try {
        setAttendanceLoading(true)
        setAttendanceError(null)

        const url = new URL(attendanceUrl)
        url.searchParams.set('sourceEmployeeId', selectedEmployeeId)
        url.searchParams.set('startDate', startDateInput)
        url.searchParams.set('endDate', endDateInput)

        const response = await fetch(url.toString(), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Không thể tải lịch chấm công (${response.status})`)
        }

        const data = (await response.json()) as AttendanceRecord[]
        setAttendanceRecords(
          Array.isArray(data) ? sortAttendanceRecords(data) : [],
        )
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return
        }

        setAttendanceError(
          error instanceof Error
            ? error.message
            : 'Không thể tải lịch chấm công',
        )
      } finally {
        setAttendanceLoading(false)
      }
    }

    void loadAttendance()

    return () => {
      controller.abort()
    }
  }, [selectedEmployeeId, attendanceMonth])

  const filteredEmployees = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    if (!keyword) {
      return employees
    }

    return employees.filter((employee) => {
      return (
        employee.ma_nv.toLowerCase().includes(keyword) ||
        employee.ten.toLowerCase().includes(keyword) ||
        employee.phong.toLowerCase().includes(keyword)
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
    let totalWorkDays = 0
    let lateDays = 0
    let lateCheckoutDays = 0

    for (const record of attendanceRecords) {
      totalWorkDays += 1

      const weekend = isWeekendDate(record.WorkDate)

      if (!weekend && isAfterCutoff(record.FirstCheckIn, '07:30:00')) {
        lateDays += 1
      }

      if (!weekend && isAfterCutoff(record.LastCheckOut, '18:00:00')) {
        lateCheckoutDays += 1
      }
    }

    return {
      totalWorkDays,
      lateDays,
      lateCheckoutDays,
    }
  }, [attendanceRecords])

  const attendanceSections = useMemo(() => {
    const recordsByDate = new Map(
      attendanceRecords.map((record) => [record.WorkDate, record]),
    )
    const startDate = parseMonthInput(attendanceMonth)
    const endDate = startDate ? getMonthLastDay(startDate) : null

    if (!startDate || !endDate) {
      return []
    }

    const today = formatDateInput(new Date())

    const sections: Array<{
      monthKey: string
      title: string
      items: Array<{
        date: string
        weekday: string
        isWeekend: boolean
        isFuture: boolean
        record: AttendanceRecord | undefined
      }>
    }> = []

    const cursor = new Date(endDate)

    while (cursor >= startDate) {
      const date = formatDateInput(cursor)
      const monthKey = date.slice(0, 7)
      const monthTitle = formatMonthTitle(cursor)
      const record = recordsByDate.get(date)
      const dayOfWeek = cursor.getDay()

      const item = {
        date,
        weekday: weekdayLabels[dayOfWeek],
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isFuture: date > today,
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

  async function handleReloadAttendance() {
    if (!selectedEmployeeId) {
      setAttendanceError('Hãy chọn một nhân viên trước.')
      return
    }

    const startDate = parseMonthInput(attendanceMonth)

    if (!startDate) {
      setAttendanceError('Tháng đã chọn không hợp lệ.')
      return
    }

    const endDate = getMonthLastDay(startDate)
    const startDateInput = formatDateInput(startDate)
    const endDateInput = formatDateInput(endDate)

    try {
      setAttendanceLoading(true)
      setAttendanceError(null)

      const url = new URL(attendanceUrl)
      url.searchParams.set('sourceEmployeeId', selectedEmployeeId)
      url.searchParams.set('startDate', startDateInput)
      url.searchParams.set('endDate', endDateInput)

      const response = await fetch(url.toString())

      if (!response.ok) {
        throw new Error(`Không thể tải lịch chấm công (${response.status})`)
      }

      const data = (await response.json()) as AttendanceRecord[]
      setAttendanceRecords(
        Array.isArray(data) ? sortAttendanceRecords(data) : [],
      )
    } catch (error) {
      setAttendanceError(
        error instanceof Error ? error.message : 'Không thể tải lịch chấm công',
      )
    } finally {
      setAttendanceLoading(false)
    }
  }

  return (
    <main className="demo-page demo-page-wide px-4 pb-10 pt-6 sm:pt-8">
      <section className="demo-panel relative overflow-hidden rounded-2xl px-5 py-6 sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.26),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.16),transparent_66%)]" />
        <div className="relative grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-[var(--kicker)]">
              Tra cứu thông tin chấm công
            </p>
            <h1 className="display-title m-0 text-3xl font-bold leading-[1.02] text-[var(--sea-ink)] sm:text-5xl">
              Danh sách nhân viên và lịch chấm công theo ngày
            </h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Nhân viên" value={String(employees.length)} />
            <StatCard label="Đã chọn" value={selectedEmployeeId || 'Chưa có'} />
            <StatCard
              label="Trạng thái"
              value={employeesLoading ? 'Đang tải' : 'Sẵn sàng'}
            />
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="demo-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="demo-section-title text-lg">
                Danh sách nhân viên
              </h2>
              <p className="demo-muted mt-1 text-sm">
                Tìm nhanh theo mã, tên hoặc phòng ban.
              </p>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-[var(--sea-ink)]">
              Tìm kiếm
            </span>
            <div className="relative">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Nhập mã NV, tên hoặc phòng ban"
                className="demo-input px-4 py-3 pr-10 text-sm"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('')
                    setManualEmployeeId('')
                    setSelectedEmployeeId('')
                  }}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--sea-ink-soft)] transition hover:bg-[rgba(23,58,64,0.08)] hover:text-[var(--sea-ink)]"
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

          <form
            onSubmit={(event) => {
              event.preventDefault()
              const trimmed = manualEmployeeId.trim()

              if (trimmed) {
                setSearchTerm('')
                setSelectedEmployeeId(trimmed)
              }
            }}
            className="mt-3 flex items-end gap-2"
          >
            <label className="flex-1">
              <span className="mb-2 block text-sm font-semibold text-[var(--sea-ink)]">
                Hoặc nhập mã nhân viên
              </span>
              <div className="relative">
                <input
                  value={manualEmployeeId}
                  onChange={(event) => setManualEmployeeId(event.target.value)}
                  placeholder="Nhập mã NV, không cần có trong danh sách"
                  className="demo-input px-4 py-3 pr-10 text-sm"
                />
                {manualEmployeeId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setManualEmployeeId('')
                      setSelectedEmployeeId('')
                    }}
                    aria-label="Xóa mã nhân viên"
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--sea-ink-soft)] transition hover:bg-[rgba(23,58,64,0.08)] hover:text-[var(--sea-ink)]"
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
            <button
              type="submit"
              disabled={!manualEmployeeId.trim()}
              className="rounded-md border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.16)] px-4 py-3 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Tra cứu
            </button>
          </form>

          {employeesError ? (
            <div className="mt-4 rounded-lg border border-rose-300/50 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {employeesError}
            </div>
          ) : null}

          <div className="mt-4 max-h-[620px] space-y-2 overflow-auto pr-1">
            {searchTerm.trim() === '' ? (
              <EmptyState
                title="Nhập từ khóa để tìm nhân viên"
                description="Nhập mã NV, tên hoặc phòng ban vào ô tìm kiếm ở trên để hiển thị kết quả."
              />
            ) : employeesLoading ? (
              <LoadingBlock label="Đang tải danh sách nhân viên..." />
            ) : filteredEmployees.length ? (
              filteredEmployees.map((employee) => {
                const isActive = employee.ma_nv === selectedEmployeeId

                return (
                  <button
                    key={employee.ma_nv}
                    type="button"
                    onClick={() => {
                      setManualEmployeeId('')
                      setSelectedEmployeeId(employee.ma_nv)
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      isActive
                        ? 'border-[rgba(50,143,151,0.55)] bg-[rgba(79,184,178,0.14)] shadow-[0_0_0_1px_rgba(79,184,178,0.15)]'
                        : 'border-[var(--line)] bg-[rgba(255,255,255,0.55)] hover:border-[rgba(50,143,151,0.28)] hover:bg-[rgba(255,255,255,0.72)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="m-0 text-sm font-bold text-[var(--sea-ink)]">
                          {employee.ten}
                        </p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--kicker)]">
                          Mã {employee.ma_nv}
                        </p>
                      </div>
                      <span className="rounded-md border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                        {employee.phong}
                      </span>
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

        <section className="space-y-6">
          <div className="demo-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="demo-section-title text-lg">
                  Thông tin nhân viên
                </h2>
                <p className="mt-1 text-sm">
                  {selectedEmployeeId ? (
                    <span className="font-semibold text-[var(--lagoon-deep)]">
                      {selectedEmployee
                        ? `${selectedEmployee.ten} - ${selectedEmployee.phong}`
                        : faceInfo
                          ? normalizeDisplayText(faceInfo.userName)
                          : `Mã ${selectedEmployeeId}`}
                    </span>
                  ) : (
                    <span className="demo-muted">
                      Hãy chọn hoặc nhập mã nhân viên để xem chi tiết.
                    </span>
                  )}
                </p>
              </div>

              {faceLoading ? (
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--kicker)]">
                  Đang tải thông tin...
                </span>
              ) : null}
            </div>

            {faceError ? (
              <div className="mt-4 rounded-lg border border-rose-300/50 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {faceError}
              </div>
            ) : null}

            {selectedEmployeeId ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <InfoCard
                  label="ID"
                  value={
                    faceInfo?.id ??
                    selectedEmployee?.ma_nv ??
                    selectedEmployeeId
                  }
                />
                <InfoCard
                  label="Tên nhân viên"
                  value={
                    faceInfo
                      ? normalizeDisplayText(faceInfo.userName)
                      : (selectedEmployee?.ten ?? 'Chưa có dữ liệu')
                  }
                />
                <InfoCard
                  label="Khoảng cách cho phép"
                  value={
                    faceInfo ? `${faceInfo.AllowedRadius} m` : 'Chưa có dữ liệu'
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
                <InfoCard
                  label="Đi công tác / Phê duyệt"
                  value={
                    faceInfo
                      ? `${faceInfo.IsBusinessTrip ? 'Công tác' : 'Không công tác'} / ${faceInfo.IsApprover ? 'Có duyệt' : 'Không duyệt'}`
                      : 'Chưa có dữ liệu'
                  }
                />
              </div>
            ) : (
              <EmptyState
                title="Chưa chọn nhân viên"
                description="Chọn nhân viên trong danh sách bên trái hoặc nhập mã nhân viên trực tiếp để xem thông tin và lịch chấm công."
              />
            )}
          </div>

          <div className="demo-panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="demo-section-title text-lg">Lịch chấm công</h2>
                <p className="demo-muted mt-1 text-sm">
                  {selectedEmployeeId
                    ? 'Chọn tháng rồi tải dữ liệu chấm công tương ứng.'
                    : 'Cần chọn nhân viên trước khi xem dữ liệu chấm công.'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-2 block text-sm font-semibold text-[var(--sea-ink)]">
                    Tháng
                  </span>
                  <input
                    type="month"
                    value={attendanceMonth}
                    onChange={(event) => setAttendanceMonth(event.target.value)}
                    className="demo-input px-4 py-3 text-sm"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleReloadAttendance}
                    disabled={!selectedEmployeeId || attendanceLoading}
                    className="w-full rounded-md border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.16)] px-5 py-3 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {attendanceLoading ? 'Đang tải...' : 'Tải lại'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryStat
                label="Ngày đi làm"
                value={String(attendanceStats.totalWorkDays)}
                // hint="Số ngày có workdate"
              />
              <SummaryStat
                label="Ngày đi muộn"
                value={String(attendanceStats.lateDays)}
                // hint="FirstCheckIn sau 07:30 (trừ T7, CN)"
              />
              <SummaryStat
                label="Ngày về sau 18h"
                value={String(attendanceStats.lateCheckoutDays)}
                // hint="LastCheckOut sau 18:00 (trừ T7, CN)"
              />
              <SummaryStat
                label="Tháng"
                value={formatMonthLabel(attendanceMonth).replace('Tháng ', '')}
                // hint="Dữ liệu đang hiển thị"
              />
            </div>

            {attendanceError ? (
              <div className="mt-4 rounded-lg border border-rose-300/50 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {attendanceError}
              </div>
            ) : null}

            {selectedEmployeeId ? (
              <div className="mt-5">
                {attendanceSections.length ? (
                  <div className="space-y-6">
                    {attendanceSections.map((section) => (
                      <section key={section.monthKey}>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <h3 className="m-0 text-base font-bold text-[var(--sea-ink)]">
                            {section.title}
                          </h3>
                          <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--kicker)]">
                            {section.items.length} ngày
                          </p>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-white/70 shadow-[0_10px_30px_rgba(23,58,64,0.05)]">
                          <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse text-left text-sm">
                              <thead className="bg-[rgba(79,184,178,0.12)] text-[var(--sea-ink)]">
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
                                    className={`border-t border-[var(--line)] ${
                                      item.isWeekend
                                        ? 'bg-[rgba(244,63,94,0.04)]'
                                        : 'odd:bg-white even:bg-[rgba(244,250,247,0.85)]'
                                    } ${item.isFuture ? 'opacity-60' : ''}`}
                                  >
                                    <td className="px-4 py-3 font-semibold text-[var(--sea-ink)]">
                                      {formatDayMonth(item.date)}
                                    </td>
                                    <td
                                      className={`px-4 py-3 font-semibold ${
                                        item.isWeekend
                                          ? 'text-rose-600'
                                          : 'text-[var(--sea-ink-soft)]'
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
                                        isFuture={item.isFuture}
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
                                        isFuture={item.isFuture}
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
                    description="Bấm tải lịch chấm công để xem dữ liệu theo các ngày trong khoảng đã chọn."
                  />
                )}
              </div>
            ) : (
              <EmptyState
                title="Chưa chọn nhân viên"
                description="Chọn nhân viên hoặc nhập mã nhân viên để xem lịch chấm công theo ngày."
              />
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.56)] px-4 py-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--kicker)]">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-bold text-[var(--sea-ink)]">
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
    <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.78)] px-4 py-4 shadow-[0_10px_24px_rgba(23,58,64,0.04)]">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--kicker)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-[var(--sea-ink)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">{hint}</p>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.6)] p-4">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--kicker)]">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold leading-6 text-[var(--sea-ink)]">
        {value}
      </p>
    </div>
  )
}

function AttendanceValue({
  value,
  isLate,
  isFuture,
  lateVariant = 'warning',
}: {
  value: string | null | undefined
  isLate: boolean
  isFuture: boolean
  lateVariant?: 'warning' | 'positive'
}) {
  if (!value) {
    return (
      <span className="text-[var(--sea-ink-soft)]">
        {isFuture ? 'Chưa có dữ liệu' : 'Không có dữ liệu'}
      </span>
    )
  }

  const badgeClasses =
    lateVariant === 'positive'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-amber-200 bg-amber-50 text-amber-700'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-[var(--sea-ink)]">
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
    <div className="rounded-lg border border-[var(--line)] bg-[rgba(255,255,255,0.5)] px-4 py-5 text-center text-sm text-[var(--sea-ink-soft)]">
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
    <div className="rounded-xl border border-dashed border-[rgba(50,143,151,0.22)] bg-[rgba(255,255,255,0.46)] px-5 py-10 text-center mt-4">
      <p className="m-0 text-base font-bold text-[var(--sea-ink)]">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[var(--sea-ink-soft)]">
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
