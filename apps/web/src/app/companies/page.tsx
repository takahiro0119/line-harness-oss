'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import type { KintoneCompanyItem, KintoneAssignmentItem } from '@/lib/api'

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<KintoneCompanyItem[]>([])
  const [assignments, setAssignments] = useState<KintoneAssignmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.kintone.companies(), api.kintone.assignments()])
      .then(([cRes, aRes]) => {
        setCompanies(cRes.success ? cRes.data : [])
        setAssignments(aRes.success ? aRes.data : [])
      })
      .catch(() => {
        setCompanies([])
        setAssignments([])
      })
      .finally(() => setLoading(false))
  }, [])

  const filteredCompanies = companies.filter(c => {
    if (!query) return true
    const q = query.toLowerCase()
    return (c.companyName || '').toLowerCase().includes(q) ||
           c.cases.some(name => name.toLowerCase().includes(q))
  })

  const workersInSelected = selectedCompany
    ? assignments.filter(a => a.billingCompany === selectedCompany && a.status === '参画中')
    : []

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="参画先企業" description="BPO企業マスタと参画中の稼働者を表示します" />

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 企業一覧 */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <input
                type="search"
                placeholder="企業名・案件名で検索"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-500">読み込み中...</div>
            ) : filteredCompanies.length === 0 ? (
              <div className="p-8 text-center text-gray-500">該当する企業がありません</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">企業名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">案件名</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">参画中</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">CS担当</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompanies.map(co => (
                      <tr
                        key={co.kintoneId}
                        className={`border-b border-gray-100 cursor-pointer hover:bg-green-50 ${selectedCompany === co.companyName ? 'bg-green-50' : ''}`}
                        onClick={() => setSelectedCompany(co.companyName)}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">{co.companyName || '-'}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-xs">
                          {co.cases.length === 0 ? <span className="text-gray-400">-</span> : (
                            <div className="space-y-1">
                              {co.cases.map((name, i) => (
                                <div key={i} className="truncate" title={name}>• {name}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {co.activeWorkerCount > 0 ? (
                            <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">
                              {co.activeWorkerCount}名
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs">{co.csPerson || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
              {filteredCompanies.length} / 全 {companies.length} 社 (毎朝 8:40 に同期)
            </p>
          </div>

          {/* 選択企業の参画稼働者 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-3">
              {selectedCompany || '企業を選択してください'}
            </h3>
            {!selectedCompany ? (
              <p className="text-sm text-gray-500">左の一覧から企業を選択すると、参画中の稼働者が表示されます。</p>
            ) : workersInSelected.length === 0 ? (
              <p className="text-sm text-gray-500">この企業に参画中の稼働者はいません。</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 mb-2">参画中 {workersInSelected.length}名</p>
                {workersInSelected.map(w => (
                  <div key={w.friendId} className="p-2 bg-gray-50 rounded text-sm">
                    <div className="font-medium text-gray-900">{w.displayName || '(名前未設定)'}</div>
                    {w.caseName && <div className="text-xs text-gray-600 mt-0.5">{w.caseName}</div>}
                    {w.agencyName && <div className="text-xs text-gray-500 mt-0.5">代理店: {w.agencyName}</div>}
                    {w.assignmentStartDate && <div className="text-xs text-gray-500">開始: {w.assignmentStartDate}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
