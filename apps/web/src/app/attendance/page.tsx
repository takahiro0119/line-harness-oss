'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { FriendAttendanceConfig, FriendClockRecordItem, FriendShiftItem, FriendAttendanceTarget, FriendMonthlyConfItem, GroupItem } from '@/lib/api'
import Header from '@/components/layout/header'

const DAYS = ['日', '月', '火', '水', '木', '金', '土']

export default function AttendancePage() {
  const [tab, setTab] = useState<'records' | 'targets' | 'settings' | 'monthly'>('records')
  const [config, setConfig] = useState<FriendAttendanceConfig | null>(null)
  const [records, setRecords] = useState<FriendClockRecordItem[]>([])
  const [targets, setTargets] = useState<FriendAttendanceTarget[]>([])
  const [shifts, setShifts] = useState<FriendShiftItem[]>([])
  const [monthly, setMonthly] = useState<FriendMonthlyConfItem[]>([])
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [loading, setLoading] = useState(true)

  // 記録編集モーダル
  const [editRecord, setEditRecord] = useState<{ friendId: string; lineUserId: string; displayName: string | null; targetDate: string; clockIn: string; clockOut: string } | null>(null)
  // 新規追加モーダル
  const [addRecord, setAddRecord] = useState<{ friendId: string; lineUserId: string; displayName: string | null; targetDate: string; clockIn: string; clockOut: string } | null>(null)
  // 個別シフト編集モーダル
  const [editShift, setEditShift] = useState<{ friendId: string; displayName: string | null; workDays: string; clockInTime: string; clockOutTime: string } | null>(null)

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

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.groups.list()
      if (res.success) setGroups(res.data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    Promise.all([loadConfig(), loadRecords(), loadTargets(), loadGroups()]).finally(() => setLoading(false))
  }, [loadConfig, loadRecords, loadTargets, loadGroups])

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
      <Header title="稼働管理" description="1:1チャットベースの稼働開始・終了の記録" />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'records' as const, label: '稼働記録' },
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

      {/* 稼働記録 */}
      {tab === 'records' && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <label className="text-xs text-gray-500">期間:</label>
            <input type="date" value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg" />
            <span className="text-gray-400">〜</span>
            <input type="date" value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg" />
            <div className="ml-auto flex gap-2">
              {targets[0] && (
                <button
                  onClick={() => {
                    const today = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10)
                    setAddRecord({ friendId: targets[0].friendId, lineUserId: targets[0].lineUserId, displayName: targets[0].displayName, targetDate: today, clockIn: '', clockOut: '' })
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                >
                  + 記録を追加
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {records.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">この期間の稼働記録はありません</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">日付</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">名前</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働開始</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働終了</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働時間</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">方法</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
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
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setEditRecord({ friendId: r.friendId, lineUserId: r.lineUserId, displayName: r.displayName, targetDate: r.targetDate, clockIn: r.clockIn || '', clockOut: r.clockOut || '' })}
                          className="text-xs text-blue-600 hover:text-blue-800 mr-2"
                        >
                          編集
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`${r.targetDate}の${r.displayName || ''}の記録を削除しますか？`)) return
                            await api.attendance.deleteRecord(r.friendId, r.targetDate)
                            loadRecords()
                          }}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          削除
                        </button>
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
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働日</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働開始時刻</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">稼働終了時刻</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">除外</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase px-4 py-3">操作</th>
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
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setEditShift({
                            friendId: t.friendId,
                            displayName: t.displayName,
                            workDays: t.workDays,
                            clockInTime: t.clockInTime || '',
                            clockOutTime: t.clockOutTime || '',
                          })}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          シフト編集
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {targets.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">稼働対象の友だちがいません。友だち登録を待っています。</div>
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
                <h4 className="text-sm font-semibold text-gray-900">稼働記録システム</h4>
                <p className="text-xs text-gray-500 mt-1">1:1チャットで稼働開始・終了ボタンを自動送信</p>
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
                  <label className="text-xs text-gray-500 block mb-1">稼働開始ボタン送信</label>
                  <input type="time" value={config.clockInTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockInTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">稼働開始リマインド</label>
                  <input type="time" value={config.clockInReminderTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockInReminderTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">稼働終了ボタン送信</label>
                  <input type="time" value={config.clockOutTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockOutTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">稼働終了リマインド</label>
                  <input type="time" value={config.clockOutReminderTime}
                    onChange={async (e) => { await api.attendance.updateConfig({ clockOutReminderTime: e.target.value }); loadConfig() }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
            )}
          </div>

          {/* 修正依頼の通知先 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">修正依頼の通知先</h4>
            <p className="text-xs text-gray-500 mb-4">月次確認で「修正依頼」が押された時に、選択したLINEグループへ通知を送信します</p>
            <select
              value={config?.csNotificationGroupId || ''}
              onChange={async (e) => {
                const value = e.target.value || null
                await api.attendance.updateConfig({ csNotificationGroupId: value })
                loadConfig()
              }}
              className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
            >
              <option value="">通知しない</option>
              {groups.map((g) => (
                <option key={g.id} value={g.lineGroupId}>{g.name || `(無名グループ ${g.lineGroupId.slice(0, 8)}...)`}</option>
              ))}
            </select>
            {groups.length === 0 && (
              <p className="text-xs text-gray-400 mt-2">通知先にできるグループがありません。先に「グループ」ページでBotをグループに招待してください。</p>
            )}
          </div>

          {/* リッチメニュー */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">リッチメニュー</h4>
            <p className="text-xs text-gray-500 mb-4">稼働開始・終了ボタンのリッチメニューを作成します（画像は別途アップロードが必要）</p>
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
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <label className="text-xs text-gray-500">月:</label>
            <input type="month" value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg" />
            <div className="ml-auto">
              <button
                onClick={async () => {
                  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : ''
                  const url = api.attendance.exportUrl(selectedMonth)
                  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
                  const blob = await res.blob()
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `attendance_${selectedMonth}.csv`
                  a.click()
                  URL.revokeObjectURL(a.href)
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
              >
                CSV ダウンロード
              </button>
            </div>
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

      {/* 記録編集モーダル */}
      {editRecord && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditRecord(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">稼働記録を編集</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">名前</label>
                <div className="text-sm text-gray-900">{editRecord.displayName || '(不明)'}</div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">日付</label>
                <div className="text-sm text-gray-900">{editRecord.targetDate}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">稼働開始</label>
                  <input type="time" value={editRecord.clockIn} onChange={(e) => setEditRecord({ ...editRecord, clockIn: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">稼働終了</label>
                  <input type="time" value={editRecord.clockOut} onChange={(e) => setEditRecord({ ...editRecord, clockOut: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditRecord(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button
                onClick={async () => {
                  await api.attendance.updateRecord(editRecord.friendId, editRecord.targetDate, {
                    clockIn: editRecord.clockIn || null,
                    clockOut: editRecord.clockOut || null,
                  })
                  setEditRecord(null)
                  loadRecords()
                }}
                className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 記録追加モーダル */}
      {addRecord && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAddRecord(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">稼働記録を追加</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">対象者</label>
                <select value={addRecord.friendId} onChange={(e) => {
                  const t = targets.find(x => x.friendId === e.target.value)
                  if (t) setAddRecord({ ...addRecord, friendId: t.friendId, lineUserId: t.lineUserId, displayName: t.displayName })
                }} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
                  {targets.map(t => <option key={t.friendId} value={t.friendId}>{t.displayName || t.lineUserId.slice(0, 8)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">日付</label>
                <input type="date" value={addRecord.targetDate} onChange={(e) => setAddRecord({ ...addRecord, targetDate: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">稼働開始</label>
                  <input type="time" value={addRecord.clockIn} onChange={(e) => setAddRecord({ ...addRecord, clockIn: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">稼働終了</label>
                  <input type="time" value={addRecord.clockOut} onChange={(e) => setAddRecord({ ...addRecord, clockOut: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setAddRecord(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button
                onClick={async () => {
                  await api.attendance.createRecord({
                    friendId: addRecord.friendId,
                    lineUserId: addRecord.lineUserId,
                    displayName: addRecord.displayName || undefined,
                    targetDate: addRecord.targetDate,
                    clockIn: addRecord.clockIn || undefined,
                    clockOut: addRecord.clockOut || undefined,
                  })
                  setAddRecord(null)
                  loadRecords()
                }}
                className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 個別シフト編集モーダル */}
      {editShift && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditShift(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">{editShift.displayName || '(不明)'} さんのシフト</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-2">稼働曜日</label>
                <div className="flex gap-1 flex-wrap">
                  {DAYS.map((d, i) => {
                    const days = editShift.workDays.split(',').filter(Boolean).map(Number)
                    const checked = days.includes(i)
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          const newDays = checked ? days.filter(x => x !== i) : [...days, i].sort((a, b) => a - b)
                          setEditShift({ ...editShift, workDays: newDays.join(',') })
                        }}
                        className={`px-3 py-1.5 text-xs rounded ${checked ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">稼働開始時刻（個別）</label>
                  <input type="time" value={editShift.clockInTime} onChange={(e) => setEditShift({ ...editShift, clockInTime: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                  <p className="text-[10px] text-gray-400 mt-1">空欄で全体設定を使用</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">稼働終了時刻（個別）</label>
                  <input type="time" value={editShift.clockOutTime} onChange={(e) => setEditShift({ ...editShift, clockOutTime: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditShift(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button
                onClick={async () => {
                  await api.attendance.updateShift(editShift.friendId, {
                    workDays: editShift.workDays,
                    clockInTime: editShift.clockInTime || null,
                    clockOutTime: editShift.clockOutTime || null,
                  })
                  setEditShift(null)
                  loadTargets()
                }}
                className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
