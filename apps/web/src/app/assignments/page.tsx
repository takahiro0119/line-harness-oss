'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { KintoneAssignmentItem } from '@/lib/api'

const STATUS_ORDER = ['参画中', '営業中', '待機', 'リリース', '終了']

function statusBadgeColor(status: string): string {
  switch (status) {
    case '参画中': return 'bg-green-100 text-green-800'
    case '営業中': return 'bg-blue-100 text-blue-800'
    case '待機': return 'bg-yellow-100 text-yellow-800'
    case 'リリース': return 'bg-purple-100 text-purple-800'
    case '終了': return 'bg-gray-100 text-gray-600'
    default: return 'bg-gray-50 text-gray-500'
  }
}

export default function AssignmentsPage() {
  const [items, setItems] = useState<KintoneAssignmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('参画中')
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.kintone.assignments()
      .then(res => {
        if (res.success) setItems(res.data)
        else setError('error' in res ? res.error : '読み込みに失敗しました')
      })
      .catch(() => setError('Kintone への接続に失敗しました'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = items.filter(i => {
    if (filter !== 'すべて' && i.status !== filter) return false
    if (linkFilter === 'linked' && !i.isLinked) return false
    if (linkFilter === 'unlinked' && i.isLinked) return false
    if (query) {
      const q = query.toLowerCase()
      if (!i.name.toLowerCase().includes(q) &&
          !i.billingCompany.toLowerCase().includes(q) &&
          !i.caseName.toLowerCase().includes(q) &&
          !i.agencyName.toLowerCase().includes(q)) return false
    }
    return true
  })

  const statusCounts: Record<string, number> = {}
  let linkedCount = 0
  for (const i of items) {
    const s = i.status || '(空)'
    statusCounts[s] = (statusCounts[s] || 0) + 1
    if (i.isLinked) linkedCount++
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="参画者一覧" description="Kintone 稼働者マスタの参画情報を表示します" />

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {/* サマリー */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">全稼働者</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{items.length}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">参画中</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{statusCounts['参画中'] || 0}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">LINE連携済み</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{linkedCount}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">LINE未連携</p>
            <p className="text-2xl font-bold text-gray-600 mt-1">{items.length - linkedCount}</p>
          </div>
        </div>

        {/* フィルタ */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {['すべて', ...STATUS_ORDER].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filter === s ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {s}
                {s !== 'すべて' && statusCounts[s] !== undefined && (
                  <span className="ml-1 opacity-70">({statusCounts[s]})</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs text-gray-500 mr-1">LINE連携:</span>
            {([
              ['all', 'すべて'],
              ['linked', '連携済み'],
              ['unlinked', '未連携'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setLinkFilter(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  linkFilter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="名前・企業・案件・代理店で検索"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* テーブル */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Kintone から読み込み中...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">該当する稼働者がいません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">氏名</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">状況</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">LINE連携</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">参画先企業</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">案件名</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">代理店</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">担当者</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">参画開始日</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.kintoneId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{item.name || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadgeColor(item.status)}`}>
                          {item.status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.isLinked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
                            連携済み
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                            未連携
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.billingCompany || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={item.caseName}>{item.caseName || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.agencyName || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.salesPerson || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{item.assignmentStartDate || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-gray-500">
          表示中: {filtered.length} / 全 {items.length} 件 (Kintone稼働者マスタからリアルタイム取得)
        </p>
      </div>
    </div>
  )
}
