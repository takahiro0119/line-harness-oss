'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { KintoneAssignmentItem } from '@/lib/api'

const STATUS_ORDER = ['参画中', '営業中', '待機', 'リリース', '終了']

function statusBadgeColor(status: string | null): string {
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
  const [filter, setFilter] = useState<string>('参画中')
  const [query, setQuery] = useState('')

  useEffect(() => {
    setLoading(true)
    api.kintone.assignments()
      .then(res => setItems(res.success ? res.data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = items.filter(i => {
    if (filter !== 'すべて' && (i.status || '') !== filter) return false
    if (query) {
      const q = query.toLowerCase()
      if (!(i.displayName || '').toLowerCase().includes(q) &&
          !(i.billingCompany || '').toLowerCase().includes(q) &&
          !(i.caseName || '').toLowerCase().includes(q) &&
          !(i.agencyName || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const statusCounts: Record<string, number> = {}
  for (const i of items) {
    const s = i.status || '(空)'
    statusCounts[s] = (statusCounts[s] || 0) + 1
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="参画者一覧" description="Kintone 稼働者マスタの参画情報を表示します" />

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
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
            <div className="p-8 text-center text-gray-500">読み込み中...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">該当する稼働者がいません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">氏名</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">状況</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">参画先企業</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">案件名</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">代理店</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">紹介者</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">参画開始日</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.friendId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{item.displayName || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeColor(item.status)}`}>
                          {item.status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{item.billingCompany || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={item.caseName || ''}>{item.caseName || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{item.agencyName || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{item.referrer || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{item.assignmentStartDate || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-gray-500">
          表示中: {filtered.length} / 全 {items.length} 件 (Kintone 稼働者マスタと毎朝 8:40 に同期)
        </p>
      </div>
    </div>
  )
}
