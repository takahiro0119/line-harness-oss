'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'

import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

interface RefRoute {
  refCode: string
  name: string
  onboardingFlow: string | null
  friendCount: number
  clickCount: number
  latestAt: string | null
}

function onboardingFlowLabel(flow: string | null): string {
  if (flow === 'bpo_worker') return 'BPO稼働者（既存）'
  if (flow === 'bpo_new_worker') return 'BPO稼働者（新規）'
  return '—'
}

interface RefSummaryData {
  routes: RefRoute[]
  totalFriends: number
  friendsWithRef: number
  friendsWithoutRef: number
}

interface RefFriend {
  id: string
  displayName: string
  trackedAt: string | null
}

interface RefDetailData {
  refCode: string
  name: string
  friends: RefFriend[]
}

export default function AttributionPage() {
  const { selectedAccountId } = useAccount()
  const [summary, setSummary] = useState<RefSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [detail, setDetail] = useState<RefDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createFlow, setCreateFlow] = useState<'' | 'bpo_worker' | 'bpo_new_worker'>('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const query = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: RefSummaryData }>(`/api/analytics/ref-summary${query}`)
      setSummary(res.data)
    } catch {
      // silent
    }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => {
    loadSummary()
    // Refresh when tab becomes visible
    const handleVisibility = () => { if (document.visibilityState === 'visible') loadSummary() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loadSummary])

  const handleRowClick = async (refCode: string) => {
    if (selectedRef === refCode) {
      setSelectedRef(null)
      setDetail(null)
      return
    }
    setSelectedRef(refCode)
    setDetailLoading(true)
    try {
      const query = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: RefDetailData }>(`/api/analytics/ref/${encodeURIComponent(refCode)}${query}`)
      setDetail(res.data)
    } catch {
      setDetail(null)
    }
    setDetailLoading(false)
  }

  const handleCreate = async () => {
    setCreateError(null)
    if (!createName.trim()) {
      setCreateError('経路名は必須です')
      return
    }
    setCreateSubmitting(true)
    try {
      const apiKey = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : ''
      const res = await fetch(`${WORKER_BASE}/api/entry-routes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: createName.trim(),
          onboardingFlow: createFlow || null,
          isActive: true,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        setCreateError(json.error || `作成に失敗しました (${res.status})`)
        return
      }
      setShowCreate(false)
      setCreateName('')
      setCreateFlow('')
      await loadSummary()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '作成に失敗しました')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const handleCopy = async (refCode: string) => {
    const url = `${WORKER_BASE}/auth/line?ref=${encodeURIComponent(refCode)}`
    await navigator.clipboard.writeText(url)
    setCopiedCode(refCode)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div>
      <Header
        title="流入経路分析"
        description="ref コード別の友だち獲得・クリック実績"
      />

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreate(true)}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + 経路を作成
        </button>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => !createSubmitting && setShowCreate(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-4">流入経路を作成</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  経路名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="既存稼働者 登録用"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  オンボーディングフロー
                </label>
                <select
                  value={createFlow}
                  onChange={(e) => setCreateFlow(e.target.value as '' | 'bpo_worker' | 'bpo_new_worker')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                >
                  <option value="">なし（通常登録）</option>
                  <option value="bpo_worker">BPO稼働者・既存（名前/生年月日でKintone名寄せ）</option>
                  <option value="bpo_new_worker">BPO稼働者・新規（スキルシート記入）</option>
                </select>
              </div>

              <p className="text-xs text-gray-400">ref コードは自動生成されます（作成後にURLをコピー可能）</p>

              {createError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{createError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                disabled={createSubmitting}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleCreate}
                disabled={createSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {createSubmitting ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">総友だち数</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{summary.totalFriends}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">ref 経由</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{summary.friendsWithRef}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">ref 不明</p>
            <p className="text-3xl font-bold text-gray-400 mt-1">{summary.friendsWithoutRef}</p>
          </div>
          <div className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-sm text-gray-500">経路数</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{summary.routes.length}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : !summary || summary.routes.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          流入経路がまだ登録されていません
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ref コード</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">経路名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">フロー</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">友だち数</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">クリック数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最新追加日</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {summary.routes.map((route) => {
                const authUrl = `${WORKER_BASE}/auth/line?ref=${encodeURIComponent(route.refCode)}`
                const isExpanded = selectedRef === route.refCode
                return (
                  <>
                    <tr
                      key={route.refCode}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRowClick(route.refCode)}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-blue-600">{route.refCode}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{route.name}</td>
                      <td className="px-4 py-3 text-sm">
                        {route.onboardingFlow ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            route.onboardingFlow === 'bpo_new_worker'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {onboardingFlowLabel(route.onboardingFlow)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{route.friendCount}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{route.clickCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(route.latestAt)}</td>
                      <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 truncate max-w-[180px]">{authUrl}</span>
                          <button
                            onClick={() => handleCopy(route.refCode)}
                            className="text-xs text-blue-500 hover:text-blue-700 shrink-0"
                          >
                            {copiedCode === route.refCode ? 'コピー済' : 'コピー'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${route.refCode}-detail`}>
                        <td colSpan={7} className="px-6 py-4 bg-gray-50">
                          {detailLoading ? (
                            <p className="text-sm text-gray-400">読み込み中...</p>
                          ) : detail && detail.friends.length > 0 ? (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">
                                このルートから追加した友だち ({detail.friends.length}人)
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {detail.friends.map((f) => (
                                  <div key={f.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100">
                                    <span className="text-sm text-gray-800 font-medium truncate">{f.displayName}</span>
                                    <span className="text-xs text-gray-400 ml-2 shrink-0">{formatDate(f.trackedAt)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">このルートから追加した友だちはまだいません</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
