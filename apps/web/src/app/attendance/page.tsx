'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { FriendAttendanceConfig, FriendClockRecordItem, FriendShiftItem, FriendAttendanceTarget, FriendMonthlyConfItem } from '@/lib/api'
import Header from '@/components/layout/header'

const DAYS = ['日', '月', '火', '水', '木', '金', '土']

export default function AttendancePage() {
  const [tab, setTab] = useState<'records' | 'targets' | 'settings' | 'monthly'>('records')
  const [config, setConfig] = useState<FriendAttendanceConfig | null>(null)
  const [records, setRecords] = useState<FriendClockRecordItem[]>([])
  const [targets, setTargets] = useState<FriendAttendanceTarget[]>([])
  const [shifts, setShifts] = useState<FriendShiftItem[]>([])
  const [monthly, setMonthly] = useState<FriendMonthlyConfItem[]>([])
  const [loading, setLoading] = useState(true)

  const [dateRange, setDateRange] = useState(() => {
    const now = new Date(Date.now() + 9 * 60 * 60_000)
    const start = new Date(now)
    start.setUTCDate(1)
    return { startDate: start.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10) }
  })
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date(Date.now() + 9 * 60 * 60_000)
    return now.toISOString().slice(0, 7)
  })

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.attendance.config()
      if (res.success) setConfig(res.data)
    } catch { /* ignore */ }
  }, [])

  const loadRecords = useCallback(async () => {
    try {
      const res = await api.attendance.records(dateRange)
      if (res.success) setRecords(res.data)
    } catch { /* ignore */ }
  }, [dateRange])

  const loadTargets = useCallback(async () => {
    try {
      const [targetsRes, shiftsRes] = await Promise.all([
        api.attendance.targets(),
        api.attendance.shifts(),
      ])
      if (targetsRes.success) setTargets(targetsRes.data)
      if (shiftsRes.success) setShifts(shiftsRes.data)
    } catch { /* ignore */ }
  }, [])

  const loadMonthly = useCallback(async () => {
    try {
      const res = await api.attendance.monthly(selectedMonth)
      if (res.success) setMonthly(res.data)
    } catch { /* ignore */ }
  }, [selectedMonth])

  useEffect(() => {
    Promise.all([loadConfig(), loadRecords(), loadTargets()]).finally(() => setLoading(false))
  }, [loadConfig, loadRecords, loadTargets])

  useEffect(() => { loadRecords() }, [loadRecords])
  useEffect(() => { loadMonthly() }, [loadMonthly])

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-64 bg-gray-100 rounded" />
      </div>
    )
  }

  return (
    <div>
      <Header title="勤怠管理" description="1:1チャットベースの出勤・退勤管理" />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'records' as const, label: '打刻記録' },
          { key: 'targets' as const, label: '対象者管理' },
          { key: 'settings' as const, label: '設定' },
          { key: 'monthly' as const, label: '月次確認' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 打刻記録 */}
      {tab === 'records' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-xs text-gray-500">期間:</label>
            <input type="date" value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg" />
            <span className="text-gray-400">〜</span>
            <input type="date" value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg" />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {records.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">この期間の打刻記録はありません</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">日付</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">出勤</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">退勤</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働時間</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">方法</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 text-sm text-gray-900">{r.targetDate}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.displayName || '(不明)'}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{r.clockIn || '-'}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{r.clockOut || '-'}</td>
                      <td className="px-4 py-3 text-sm text-center font-medium text-gray-900">
                        {r.workHours != null ? `${r.workHours}h` : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[10px] text-gray-400">
                          {r.clockInSource === 'button' ? 'ボタン' : r.clockInSource === 'richmenu' ? 'メニュー' : r.clockInSource === 'reminder' ? 'リマインド' : r.clockInSource === 'manual' ? '手動' : '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 対象者管理 */}
      {tab === 'targets' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">勤務日</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">出勤時刻</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">退勤時刻</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">除外</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => {
                  const shift = shifts.find(s => s.friendId === t.friendId)
                  const days = t.workDays.split(',').map(Number)
                  return (
                    <tr key={t.friendId} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.displayName || t.lineUserId.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs text-gray-600">
                          {days.map(d => DAYS[d]).join(' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{t.clockInTime || config?.clockInTime || '09:00'}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{t.clockOutTime || config?.clockOutTime || '18:00'}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={async () => {
                            const currentlyExcluded = shift?.isExcluded || false
                            await api.attendance.updateShift(t.friendId, { isExcluded: !currentlyExcluded })
                            loadTargets()
                          }}
                          className={`text-xs px-2 py-1 rounded ${
                            shift?.isExcluded ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {shift?.isExcluded ? '除外中' : '対象'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {targets.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">勤怠対象の友だちがいません。友だち登録を待っています。</div>
            )}
          </div>
        </div>
      )}

      {/* 設定 */}
      {tab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">勤怠打刻システム</h4>
                <p className="text-xs text-gray-500 mt-1">1:1チャットで出勤・退勤ボタンを自動送信</p>
              </div>
              <button
                onClick={async () => {
                  await api.attendance.updateConfig({ isEnabled: !config?.isEnabled })
                  loadConfig()
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config?.isEnabled ? 'bg-gray-900' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config?.isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {config?.isEnabled && (
              <div className="border-t border-gray-200 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">出勤ボタン送信</label>
                  <input type="time" value={config.clockInTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockInTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">出勤リマインド</label>
                  <input type="time" value={config.clockInReminderTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockInReminderTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">退勤ボタン送信</label>
                  <input type="time" value={config.clockOutTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockOutTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">退勤リマインド</label>
                  <input type="time" value={config.clockOutReminderTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockOutReminderTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
            )}
          </div>

          {/* リッチメニュー */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">リッチメニュー</h4>
            <p className="text-xs text-gray-500 mb-4">出勤・退勤ボタンのリッチメニューを作成します（画像は別途アップロードが必要）</p>
            <button
              onClick={async () => {
                const res = await api.attendance.setupRichMenu()
                if (res.success) {
                  alert(`リッチメニュー作成完了: ${res.data.richMenuId}\n${res.data.message}`)
                }
              }}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-gray-900 hover:bg-gray-800"
            >
              リッチメニューを作成
            </button>
          </div>
        </div>
      )}

      {/* 月次確認 */}
      {tab === 'monthly' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-xs text-gray-500">月:</label>
            <input type="month" value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg" />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {monthly.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">{selectedMonth} の月次確認データはありません</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働日数</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働時間</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((mc) => (
                    <tr key={mc.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{mc.displayName || '(不明)'}</td>
                      <td className="px-4 py-3 text-sm text-center">{mc.totalDays ?? '-'}日</td>
                      <td className="px-4 py-3 text-sm text-center">{mc.totalHours ?? '-'}h</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                          mc.status === 'confirmed' ? 'bg-green-50 text-green-700'
                            : mc.status === 'revision_requested' ? 'bg-yellow-50 text-yellow-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {mc.status === 'confirmed' ? '確認済' : mc.status === 'revision_requested' ? '修正依頼' : '未確認'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
