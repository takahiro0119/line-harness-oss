'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { GroupDetail, GroupMessage, AttendanceScheduleItem, AttendanceRecordItem, AttendanceSummaryItem, ClockSettings, ClockRecordItem, ShiftPatternItem, MonthlyConfirmationItem } from '@/lib/api'
import Header from '@/components/layout/header'

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  present: { label: '出勤', color: 'text-green-700', bg: 'bg-green-50' },
  absent: { label: '休み', color: 'text-red-700', bg: 'bg-red-50' },
  late: { label: '遅刻', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  pending: { label: '未回答', color: 'text-gray-500', bg: 'bg-gray-100' },
  other: { label: 'その他', color: 'text-blue-700', bg: 'bg-blue-50' },
}

function GroupDetailContent() {
  const searchParams = useSearchParams()
  const groupId = searchParams.get('id') || ''

  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [schedules, setSchedules] = useState<AttendanceScheduleItem[]>([])
  const [records, setRecords] = useState<AttendanceRecordItem[]>([])
  const [summary, setSummary] = useState<AttendanceSummaryItem[]>([])
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'chat' | 'members' | 'clock' | 'attendance' | 'send'>('chat')
  // 勤怠打刻 state
  const [clockSettings, setClockSettings] = useState<ClockSettings | null>(null)
  const [clockRecords, setClockRecords] = useState<ClockRecordItem[]>([])
  const [shifts, setShifts] = useState<ShiftPatternItem[]>([])
  const [monthlyConfirmations, setMonthlyConfirmations] = useState<MonthlyConfirmationItem[]>([])
  const [clockDateRange, setClockDateRange] = useState(() => {
    const now = new Date(Date.now() + 9 * 60 * 60_000)
    const start = new Date(now)
    start.setUTCDate(1)
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    }
  })
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date(Date.now() + 9 * 60 * 60_000)
    return now.toISOString().slice(0, 7)
  })
  const [clockSubTab, setClockSubTab] = useState<'records' | 'settings' | 'shifts' | 'monthly'>('records')
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date(Date.now() + 9 * 60 * 60_000)
    return now.toISOString().slice(0, 10)
  })
  const [sendMessage, setSendMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState('')

  // Schedule creation
  const [showCreateSchedule, setShowCreateSchedule] = useState(false)
  const [newScheduleName, setNewScheduleName] = useState('')
  const [newScheduleMessage, setNewScheduleMessage] = useState('本日の出勤予定を返信してください。\n出勤 / 休み / 遅刻 のいずれかで回答してください。')
  const [newScheduleCron, setNewScheduleCron] = useState('0 9 * * 1-5')

  const loadGroup = useCallback(async () => {
    if (!groupId) return
    setLoading(true)
    try {
      const res = await api.groups.get(groupId)
      if (res.success) setGroup(res.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [groupId])

  const loadSchedules = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.attendanceSchedules(groupId)
      if (res.success) setSchedules(res.data)
    } catch { /* ignore */ }
  }, [groupId])

  const loadRecords = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.attendanceRecords(groupId, { date: selectedDate })
      if (res.success) setRecords(res.data)
    } catch { /* ignore */ }
  }, [groupId, selectedDate])

  const loadSummary = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.attendanceSummary(groupId)
      if (res.success) setSummary(res.data)
    } catch { /* ignore */ }
  }, [groupId])

  const loadMessages = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.messages(groupId, { limit: 100 })
      if (res.success) setMessages(res.data.reverse())
    } catch { /* ignore */ }
  }, [groupId])

  const loadClockSettings = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.clockSettings(groupId)
      if (res.success) setClockSettings(res.data)
    } catch { /* ignore */ }
  }, [groupId])

  const loadClockRecords = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.clockRecords(groupId, clockDateRange)
      if (res.success) setClockRecords(res.data)
    } catch { /* ignore */ }
  }, [groupId, clockDateRange])

  const loadShifts = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.clockShifts(groupId)
      if (res.success) setShifts(res.data)
    } catch { /* ignore */ }
  }, [groupId])

  const loadMonthlyConfirmations = useCallback(async () => {
    if (!groupId) return
    try {
      const res = await api.groups.monthlyConfirmations(groupId, selectedMonth)
      if (res.success) setMonthlyConfirmations(res.data)
    } catch { /* ignore */ }
  }, [groupId, selectedMonth])

  useEffect(() => { loadGroup() }, [loadGroup])
  useEffect(() => { loadMessages() }, [loadMessages])
  useEffect(() => { loadSchedules() }, [loadSchedules])
  useEffect(() => { loadRecords() }, [loadRecords])
  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadClockSettings() }, [loadClockSettings])
  useEffect(() => { loadClockRecords() }, [loadClockRecords])
  useEffect(() => { loadShifts() }, [loadShifts])
  useEffect(() => { loadMonthlyConfirmations() }, [loadMonthlyConfirmations])

  const handleSendMessage = async () => {
    if (!sendMessage.trim() || !groupId) return
    setSending(true)
    setSendResult('')
    try {
      const res = await api.groups.send(groupId, { content: sendMessage })
      if (res.success) {
        setSendResult('送信しました')
        setSendMessage('')
      }
    } catch {
      setSendResult('送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  const handleSendAttendance = async (scheduleId: string) => {
    if (!groupId) return
    setSending(true)
    try {
      const res = await api.groups.sendAttendance(groupId, scheduleId)
      if (res.success) {
        setSendResult(`勤怠確認を送信しました（${res.data.memberCount}人、${res.data.targetDate}）`)
        loadRecords()
      }
    } catch {
      setSendResult('送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  const handleCreateSchedule = async () => {
    if (!newScheduleName.trim() || !groupId) return
    try {
      await api.groups.createAttendanceSchedule(groupId, {
        name: newScheduleName,
        message: newScheduleMessage,
        cronExpression: newScheduleCron,
      })
      setShowCreateSchedule(false)
      setNewScheduleName('')
      loadSchedules()
    } catch { /* ignore */ }
  }

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return
    await api.groups.deleteAttendanceSchedule(scheduleId)
    loadSchedules()
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-4 bg-gray-100 rounded w-32" />
        <div className="h-64 bg-gray-100 rounded" />
      </div>
    )
  }

  if (!group) {
    return <div className="text-center py-12 text-gray-500">グループが見つかりません</div>
  }

  return (
    <div>
      <Header
        title={group.name || 'グループ詳細'}
        description={`メンバー ${group.memberCount}人 · ${group.isActive ? 'アクティブ' : '退出済み'}`}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'chat' as const, label: 'チャット' },
          { key: 'members' as const, label: 'メンバー' },
          { key: 'clock' as const, label: '勤怠打刻' },
          { key: 'attendance' as const, label: '出欠確認' },
          { key: 'send' as const, label: 'メッセージ送信' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chat Tab */}
      {tab === 'chat' && (
        <div className="bg-white rounded-lg border border-gray-200 flex flex-col" style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ backgroundColor: '#f0f0f0' }}>
            {messages.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                メッセージがありません。グループ内でメッセージが送受信されるとここに表示されます。
              </div>
            ) : (
              messages.map((msg) => {
                const isOutgoing = msg.direction === 'outgoing'
                const member = !isOutgoing && group
                  ? group.members.find(m => m.lineUserId === msg.line_user_id)
                  : null
                const memberName = isOutgoing ? 'Bot' : (member?.displayName || msg.line_user_id?.slice(0, 8) || '不明')
                const memberPicture = member?.pictureUrl || null
                const time = new Date(msg.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

                return (
                  <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                    {!isOutgoing && (
                      <div className="shrink-0 mr-2 mt-4">
                        {memberPicture ? (
                          <img src={memberPicture} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600">
                            {memberName.charAt(0)}
                          </div>
                        )}
                      </div>
                    )}
                    <div className={`max-w-[70%] ${isOutgoing ? 'items-end' : 'items-start'}`}>
                      {!isOutgoing && (
                        <p className="text-[11px] text-gray-500 mb-1">{memberName}</p>
                      )}
                      <div className={`flex items-end gap-1.5 ${isOutgoing ? 'flex-row-reverse' : ''}`}>
                        <div
                          className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                            isOutgoing
                              ? 'bg-[#06C755] text-white rounded-br-md'
                              : 'bg-white text-gray-900 rounded-bl-md shadow-sm'
                          }`}
                        >
                          {msg.content}
                        </div>
                        <span className="text-[10px] text-gray-400 shrink-0">{time}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Quick send from chat */}
          <div className="border-t border-gray-200 p-3 flex gap-2">
            <input
              type="text"
              placeholder="メッセージを入力..."
              value={sendMessage}
              onChange={(e) => setSendMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && sendMessage.trim()) {
                  e.preventDefault()
                  handleSendMessage().then(() => loadMessages())
                }
              }}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              onClick={() => handleSendMessage().then(() => loadMessages())}
              disabled={sending || !sendMessage.trim()}
              className="px-4 py-2 text-sm font-medium text-white rounded-full disabled:opacity-50 transition-colors shrink-0"
              style={{ backgroundColor: '#06C755' }}
            >
              送信
            </button>
          </div>
        </div>
      )}

      {/* Members Tab */}
      {tab === 'members' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {group.members.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">メンバー情報がありません</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">LINE User ID</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">参加日</th>
                </tr>
              </thead>
              <tbody>
                {group.members.map((member) => (
                  <tr key={member.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                          {(member.displayName || '?').charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {member.displayName || '(不明)'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{member.lineUserId.slice(0, 12)}...</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(member.joinedAt).toLocaleDateString('ja-JP')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Clock (勤怠打刻) Tab */}
      {tab === 'clock' && (
        <div className="space-y-4">
          {/* Sub tabs */}
          <div className="flex gap-2 border-b border-gray-200 pb-2">
            {[
              { key: 'records' as const, label: '打刻記録' },
              { key: 'settings' as const, label: '設定' },
              { key: 'shifts' as const, label: 'シフト' },
              { key: 'monthly' as const, label: '月次確認' },
            ].map((st) => (
              <button
                key={st.key}
                onClick={() => setClockSubTab(st.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  clockSubTab === st.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* 打刻記録 */}
          {clockSubTab === 'records' && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <label className="text-xs text-gray-500">期間:</label>
                <input
                  type="date"
                  value={clockDateRange.startDate}
                  onChange={(e) => setClockDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                  className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                <span className="text-gray-400">〜</span>
                <input
                  type="date"
                  value={clockDateRange.endDate}
                  onChange={(e) => setClockDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                  className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {clockRecords.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">
                    この期間の打刻記録はありません
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">日付</th>
                        <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">出勤</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">退勤</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働時間</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">打刻方法</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clockRecords.map((record) => (
                        <tr key={record.id} className="border-b border-gray-100 last:border-0">
                          <td className="px-4 py-3 text-sm text-gray-900">{record.targetDate}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{record.displayName || '(不明)'}</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{record.clockIn || '-'}</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{record.clockOut || '-'}</td>
                          <td className="px-4 py-3 text-sm text-center font-medium text-gray-900">
                            {record.workHours != null ? `${record.workHours}h` : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-[10px] text-gray-400">
                              {record.clockInSource === 'button' ? 'ボタン' : record.clockInSource === 'reminder' ? 'リマインド' : record.clockInSource === 'manual' ? '手動' : '-'}
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

          {/* 設定 */}
          {clockSubTab === 'settings' && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">勤怠打刻システム</h4>
                  <p className="text-xs text-gray-500 mt-1">出勤・退勤ボタンを自動送信し、打刻を管理します</p>
                </div>
                <button
                  onClick={async () => {
                    const newEnabled = !clockSettings?.isEnabled
                    await api.groups.updateClockSettings(groupId, { isEnabled: newEnabled })
                    loadClockSettings()
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    clockSettings?.isEnabled ? 'bg-gray-900' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    clockSettings?.isEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {clockSettings?.isEnabled && (
                <>
                  <div className="border-t border-gray-200 pt-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">出勤ボタン送信時刻</label>
                      <input
                        type="time"
                        value={clockSettings.clockInTime}
                        onChange={async (e) => {
                          await api.groups.updateClockSettings(groupId, { clockInTime: e.target.value })
                          loadClockSettings()
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">出勤リマインド時刻</label>
                      <input
                        type="time"
                        value={clockSettings.clockInReminderTime}
                        onChange={async (e) => {
                          await api.groups.updateClockSettings(groupId, { clockInReminderTime: e.target.value })
                          loadClockSettings()
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">退勤ボタン送信時刻</label>
                      <input
                        type="time"
                        value={clockSettings.clockOutTime}
                        onChange={async (e) => {
                          await api.groups.updateClockSettings(groupId, { clockOutTime: e.target.value })
                          loadClockSettings()
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">退勤リマインド時刻</label>
                      <input
                        type="time"
                        value={clockSettings.clockOutReminderTime}
                        onChange={async (e) => {
                          await api.groups.updateClockSettings(groupId, { clockOutReminderTime: e.target.value })
                          loadClockSettings()
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                      />
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-4">
                    <label className="text-xs text-gray-500 block mb-1">月次確認送信日（毎月N日）</label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={clockSettings.monthlyConfirmDay}
                      onChange={async (e) => {
                        await api.groups.updateClockSettings(groupId, { monthlyConfirmDay: parseInt(e.target.value) })
                        loadClockSettings()
                      }}
                      className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* シフト */}
          {clockSubTab === 'shifts' && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">グループデフォルト</h4>
                {(() => {
                  const defaultShift = shifts.find(s => !s.lineUserId)
                  const DAYS = ['日', '月', '火', '水', '木', '金', '土']
                  const currentDays = defaultShift?.workDays?.split(',').map(Number) ?? [1, 2, 3, 4, 5]
                  return (
                    <div className="space-y-3">
                      <div className="flex gap-1.5">
                        {DAYS.map((d, i) => (
                          <button
                            key={i}
                            onClick={async () => {
                              const newDays = currentDays.includes(i)
                                ? currentDays.filter(x => x !== i)
                                : [...currentDays, i].sort()
                              await api.groups.updateClockShift(groupId, {
                                lineUserId: null,
                                patternType: 'weekday',
                                workDays: newDays.join(','),
                                excludeHolidays: defaultShift?.excludeHolidays ?? true,
                              })
                              loadShifts()
                            }}
                            className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                              currentDays.includes(i)
                                ? 'bg-gray-900 text-white'
                                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={defaultShift?.excludeHolidays ?? true}
                          onChange={async (e) => {
                            await api.groups.updateClockShift(groupId, {
                              lineUserId: null,
                              patternType: 'weekday',
                              workDays: currentDays.join(','),
                              excludeHolidays: e.target.checked,
                            })
                            loadShifts()
                          }}
                          className="rounded"
                        />
                        祝日を除外する
                      </label>
                    </div>
                  )
                })()}
              </div>

              {/* メンバー個別シフト */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">メンバー個別シフト</h4>
                {shifts.filter(s => s.lineUserId).length === 0 ? (
                  <p className="text-xs text-gray-500">個別シフトは設定されていません。全メンバーがデフォルトシフトに従います。</p>
                ) : (
                  <div className="space-y-2">
                    {shifts.filter(s => s.lineUserId).map((shift) => {
                      const member = group?.members.find(m => m.lineUserId === shift.lineUserId)
                      const DAYS = ['日', '月', '火', '水', '木', '金', '土']
                      const days = shift.workDays.split(',').map(Number)
                      return (
                        <div key={shift.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                          <div>
                            <span className="text-sm font-medium text-gray-900">{member?.displayName || shift.lineUserId?.slice(0, 8) || '不明'}</span>
                            <span className="text-xs text-gray-500 ml-2">
                              {days.map(d => DAYS[d]).join(' ')}
                              {shift.excludeHolidays ? ' (祝日除外)' : ''}
                            </span>
                          </div>
                          <button
                            onClick={async () => {
                              await api.groups.deleteClockShift(shift.id)
                              loadShifts()
                            }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            削除
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* メンバー追加 */}
                {group && group.members.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <select
                      onChange={async (e) => {
                        const userId = e.target.value
                        if (!userId) return
                        await api.groups.updateClockShift(groupId, {
                          lineUserId: userId,
                          patternType: 'custom',
                          workDays: '1,2,3,4,5',
                          excludeHolidays: true,
                        })
                        loadShifts()
                        e.target.value = ''
                      }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    >
                      <option value="">+ メンバーの個別シフトを追加...</option>
                      {group.members
                        .filter(m => !shifts.some(s => s.lineUserId === m.lineUserId))
                        .map(m => (
                          <option key={m.lineUserId} value={m.lineUserId}>
                            {m.displayName || m.lineUserId.slice(0, 12)}
                          </option>
                        ))
                      }
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 月次確認 */}
          {clockSubTab === 'monthly' && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <label className="text-xs text-gray-500">月:</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {monthlyConfirmations.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">
                    {selectedMonth} の月次確認データはありません
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働日数</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働時間</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">ステータス</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">確認日</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyConfirmations.map((mc) => (
                        <tr key={mc.id} className="border-b border-gray-100 last:border-0">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{mc.displayName || '(不明)'}</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{mc.totalDays ?? '-'}日</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{mc.totalHours ?? '-'}h</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                              mc.status === 'confirmed' ? 'bg-green-50 text-green-700'
                                : mc.status === 'revision_requested' ? 'bg-yellow-50 text-yellow-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {mc.status === 'confirmed' ? '確認済' : mc.status === 'revision_requested' ? '修正依頼' : '未確認'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-center text-gray-500">
                            {mc.confirmedAt ? new Date(mc.confirmedAt).toLocaleDateString('ja-JP') : '-'}
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
      )}

      {/* Attendance Tab */}
      {tab === 'attendance' && (
        <div className="space-y-6">
          {/* Schedules Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">勤怠スケジュール</h3>
              <button
                onClick={() => setShowCreateSchedule(!showCreateSchedule)}
                className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
                style={{ backgroundColor: '#06C755' }}
              >
                + 新規作成
              </button>
            </div>

            {showCreateSchedule && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3">
                <input
                  type="text"
                  placeholder="スケジュール名（例: 朝の勤怠確認）"
                  value={newScheduleName}
                  onChange={(e) => setNewScheduleName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <textarea
                  placeholder="送信メッセージ"
                  value={newScheduleMessage}
                  onChange={(e) => setNewScheduleMessage(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <div>
                  <label className="text-xs text-gray-500">Cron式（デフォルト: 平日9時）</label>
                  <input
                    type="text"
                    value={newScheduleCron}
                    onChange={(e) => setNewScheduleCron(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 mt-1"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowCreateSchedule(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">キャンセル</button>
                  <button onClick={handleCreateSchedule} className="px-4 py-1.5 text-xs font-medium text-white rounded-lg" style={{ backgroundColor: '#06C755' }}>作成</button>
                </div>
              </div>
            )}

            {schedules.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500">
                スケジュールがありません。「新規作成」から勤怠確認スケジュールを作成してください。
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.map((schedule) => (
                  <div key={schedule.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">{schedule.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Cron: {schedule.cronExpression}
                          <span className={`ml-2 inline-flex px-1.5 py-0.5 text-[10px] rounded-full ${schedule.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {schedule.isActive ? '有効' : '無効'}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSendAttendance(schedule.id)}
                          disabled={sending}
                          className="px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          今すぐ送信
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(schedule.id)}
                          className="px-2 py-1.5 text-xs text-red-500 hover:text-red-700"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {sendResult && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{sendResult}</div>
          )}

          {/* Date Picker & Records */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-sm font-semibold text-gray-900">勤怠記録</h3>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {records.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">
                  {selectedDate} の勤怠記録はありません
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">ステータス</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">回答内容</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">回答時刻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const st = STATUS_LABELS[record.status] || STATUS_LABELS.other
                      return (
                        <tr key={record.id} className="border-b border-gray-100 last:border-0">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{record.displayName || '(不明)'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${st.bg} ${st.color}`}>
                              {st.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{record.rawReply || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {record.repliedAt ? new Date(record.repliedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Summary */}
          {summary.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">集計</h3>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">日付</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">出勤</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">休み</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">遅刻</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">未回答</th>
                      <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.slice(0, 14).map((row) => (
                      <tr key={row.targetDate} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2.5 text-sm text-gray-900">{row.targetDate}</td>
                        <td className="px-4 py-2.5 text-sm text-center text-green-700 font-medium">{row.present}</td>
                        <td className="px-4 py-2.5 text-sm text-center text-red-600">{row.absent}</td>
                        <td className="px-4 py-2.5 text-sm text-center text-yellow-600">{row.late}</td>
                        <td className="px-4 py-2.5 text-sm text-center text-gray-400">{row.pending}</td>
                        <td className="px-4 py-2.5 text-sm text-center text-gray-900 font-medium">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Send Message Tab */}
      {tab === 'send' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">グループにメッセージを送信</h3>
          <textarea
            placeholder="メッセージを入力..."
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex items-center justify-between">
            {sendResult && <p className="text-sm text-green-600">{sendResult}</p>}
            <button
              onClick={handleSendMessage}
              disabled={sending || !sendMessage.trim()}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors ml-auto"
              style={{ backgroundColor: '#06C755' }}
            >
              {sending ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function GroupDetailPage() {
  return (
    <Suspense fallback={<div className="animate-pulse"><div className="h-8 bg-gray-200 rounded w-48 mb-4" /><div className="h-64 bg-gray-100 rounded" /></div>}>
      <GroupDetailContent />
    </Suspense>
  )
}
