'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { KintoneCompanyItem } from '@/lib/api'

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<KintoneCompanyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedKintoneId, setSelectedKintoneId] = useState<string | null>(null)
  const [activeWorkersOnly, setActiveWorkersOnly] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.kintone.companies()
      .then(res => {
        if (res.success) setCompanies(res.data)
        else setError('error' in res ? res.error : '読み込みに失敗しました')
      })
      .catch(() => setError('Kintone への接続に失敗しました'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = companies.filter(c => {
    if (activeWorkersOnly && c.activeWorkerCount === 0) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (c.companyName || '').toLowerCase().includes(q) ||
           c.cases.some(name => name.toLowerCase().includes(q))
  })

  const selected = selectedKintoneId ? companies.find(c => c.kintoneId === selectedKintoneId) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="参画先企業" description="BPO企業マスタと参画中の稼働者を表示します" />

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 企業一覧 */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 space-y-3">
              <input
                type="search"
                placeholder="企業名・案件名で検索"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeWorkersOnly}
                  onChange={e => setActiveWorkersOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                参画中の稼働者がいる企業のみ表示
              </label>
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-500">Kintone から読み込み中...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-500">該当する企業がありません</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">企業名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">案件名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">参画中</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">CS担当</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(co => (
                      <tr
                        key={co.kintoneId}
                        className={`border-b border-gray-100 cursor-pointer hover:bg-green-50 ${selectedKintoneId === co.kintoneId ? 'bg-green-50' : ''}`}
                        onClick={() => setSelectedKintoneId(co.kintoneId)}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{co.companyName || '-'}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-xs">
                          {co.cases.length === 0 ? <span className="text-gray-400">-</span> : (
                            <div className="space-y-1">
                              {co.cases.map((name, i) => (
                                <div key={i} className="truncate" title={name}>• {name}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {co.activeWorkerCount > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium whitespace-nowrap">
                              {co.activeWorkerCount}名
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs whitespace-nowrap">{co.csPerson || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
              {filtered.length} / 全 {companies.length} 社 (Kintone BPO企業マスタからリアルタイム取得)
            </p>
          </div>

          {/* 選択企業の詳細 + 参画稼働者 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {!selected ? (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">企業を選択してください</h3>
                <p className="text-sm text-gray-500">左の一覧から企業を選択すると、案件詳細と参画中の稼働者が表示されます。</p>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-gray-900 mb-3">{selected.companyName}</h3>

                {/* 企業情報 */}
                <div className="space-y-2 mb-4 text-sm">
                  {selected.contactPerson && (
                    <div className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-500">担当者</span>
                      <span className="text-gray-900 font-medium">{selected.contactPerson}</span>
                    </div>
                  )}
                  {selected.contactPhone && (
                    <div className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-500">電話</span>
                      <span className="text-gray-900 text-xs">{selected.contactPhone}</span>
                    </div>
                  )}
                  {selected.contactEmail && (
                    <div className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-500">Email</span>
                      <span className="text-gray-900 text-xs truncate ml-2">{selected.contactEmail}</span>
                    </div>
                  )}
                  {selected.csPerson && (
                    <div className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-500">CS担当</span>
                      <span className="text-gray-900">{selected.csPerson}</span>
                    </div>
                  )}
                  {selected.workLocation && (
                    <div className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-500">稼働場所</span>
                      <span className="text-gray-900 text-xs">{selected.workLocation}</span>
                    </div>
                  )}
                  {selected.workHours && (
                    <div className="flex justify-between border-b border-gray-100 pb-1">
                      <span className="text-gray-500">稼働時間</span>
                      <span className="text-gray-900 text-xs">{selected.workHours}</span>
                    </div>
                  )}
                </div>

                {/* 案件概要 */}
                {selected.caseSummaries.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">案件概要</h4>
                    <div className="space-y-2">
                      {selected.cases.map((name, i) => (
                        <div key={i} className="p-2 bg-gray-50 rounded text-xs">
                          <div className="font-medium text-gray-900 mb-1">{name}</div>
                          {selected.caseSummaries[i] && (
                            <div className="text-gray-600 whitespace-pre-line">{selected.caseSummaries[i]}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 参画中稼働者 */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                    参画中 {selected.activeWorkers.length}名
                  </h4>
                  {selected.activeWorkers.length === 0 ? (
                    <p className="text-sm text-gray-500">この企業に参画中の稼働者はいません。</p>
                  ) : (
                    <div className="space-y-2">
                      {selected.activeWorkers.map(w => (
                        <div key={w.kintoneId} className="p-2 bg-gray-50 rounded text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-gray-900">{w.name}</span>
                            {w.isLinked ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">
                                <span className="w-1 h-1 bg-blue-600 rounded-full"></span>
                                LINE連携済み
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                                未連携
                              </span>
                            )}
                          </div>
                          {w.caseName && <div className="text-xs text-gray-600 mt-0.5">{w.caseName}</div>}
                          {w.agencyName && <div className="text-xs text-gray-500 mt-0.5">代理店: {w.agencyName}</div>}
                          {w.startDate && <div className="text-xs text-gray-500">開始: {w.startDate}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
