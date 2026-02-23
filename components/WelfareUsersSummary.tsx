import React, { useState } from 'react';
import { Client, OfficeLocation } from '../types';

interface WelfareUsersSummaryProps {
  clients: Client[];
}

type GroupByType = 'facility' | 'status' | 'office';
type OfficeFilter = '全事業所' | '鹿児島（ACG）' | '福岡（Lichi）';

const OFFICE_FILTERS: { label: string; value: OfficeFilter; color: string; activeColor: string }[] = [
  { label: '全事業所',      value: '全事業所',      color: 'bg-gray-200 text-gray-700 hover:bg-gray-300',                 activeColor: 'bg-gray-700 text-white' },
  { label: '鹿児島（ACG）', value: '鹿児島（ACG）', color: 'bg-sky-100 text-sky-700 hover:bg-sky-200',                   activeColor: 'bg-sky-600 text-white' },
  { label: '福岡（Lichi）', value: '福岡（Lichi）', color: 'bg-violet-100 text-violet-700 hover:bg-violet-200',           activeColor: 'bg-violet-600 text-white' },
];

const OFFICES: OfficeLocation[] = ['鹿児島（ACG）', '福岡（Lichi）'];

const WelfareUsersSummary: React.FC<WelfareUsersSummaryProps> = ({ clients }) => {
  const [groupBy, setGroupBy] = useState<GroupByType>('facility');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>('全事業所');

  const allWelfareUsers = clients.filter(c => c.isWelfareEquipmentUser);

  // 事業所別モード以外では事業所フィルターを適用
  const welfareUsers = groupBy === 'office'
    ? allWelfareUsers
    : allWelfareUsers.filter(c => officeFilter === '全事業所' || c.office === officeFilter as OfficeLocation);

  // 施設別に集計
  const groupByFacility = (): [string, Client[]][] => {
    const groups = new Map<string, Client[]>();
    welfareUsers.forEach(client => {
      const key = client.currentStatus === '施設入居中' && client.facilityName
        ? client.facilityName
        : '在宅';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(client);
    });
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '在宅') return -1;
      if (b[0] === '在宅') return 1;
      return a[0].localeCompare(b[0], 'ja');
    });
  };

  // Status別に集計
  const groupByStatus = (): [string, Client[]][] => {
    const groups = new Map<string, Client[]>();
    welfareUsers.forEach(client => {
      const statuses = new Set(client.selectedEquipment.map(eq => eq.status || '介護保険貸与'));
      let key = '未設定';
      if (statuses.size === 1) {
        const s = Array.from(statuses)[0];
        if (s === '介護保険貸与') key = '介護保険レンタル';
        else if (s === '自費利用') key = '自費利用';
        else key = s;
      } else if (statuses.size > 1) {
        key = '併用';
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(client);
    });
    const order = ['介護保険レンタル', '自費利用', '併用', '未設定'];
    return Array.from(groups.entries()).sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  };

  // 事業所別に集計（全利用者を ACG / Lichi に分類）
  const groupByOffice = (): [string, Client[]][] => {
    return OFFICES.map(office => [
      office,
      allWelfareUsers.filter(c => c.office === office),
    ]);
  };

  const groupedData: [string, Client[]][] =
    groupBy === 'facility' ? groupByFacility()
    : groupBy === 'status'  ? groupByStatus()
    : groupByOffice();

  // 初期選択グループを設定
  React.useEffect(() => {
    if (groupedData.length > 0 && !selectedGroup) {
      setSelectedGroup(groupedData[0][0]);
    }
  }, [groupedData, selectedGroup]);

  // タブ・フィルター切り替え時に先頭グループを選択
  React.useEffect(() => {
    if (groupedData.length > 0) {
      setSelectedGroup(groupedData[0][0]);
    }
  }, [groupBy, officeFilter]);

  const selectedGroupClients = groupedData.find(([name]) => name === selectedGroup)?.[1] || [];

  // 事業所別サブタブのアクセントカラー
  const officeAccentClass = (office: string) =>
    office === '鹿児島（ACG）' ? 'bg-sky-600' : 'bg-violet-600';
  const officeSubTabActive = (office: string) =>
    office === '鹿児島（ACG）'
      ? 'bg-sky-600 text-white'
      : 'bg-violet-600 text-white';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">福祉用具利用者集計</h2>

        {/* 事業所フィルター（事業所別タブでは非表示） */}
        {groupBy !== 'office' && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {OFFICE_FILTERS.map(({ label, value, color, activeColor }) => {
              const count = value === '全事業所'
                ? allWelfareUsers.length
                : allWelfareUsers.filter(c => c.office === value as OfficeLocation).length;
              return (
                <button
                  key={value}
                  onClick={() => setOfficeFilter(value)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                    officeFilter === value ? activeColor : color
                  }`}
                >
                  {label}
                  <span className="ml-1.5 opacity-80">({count}件)</span>
                </button>
              );
            })}
          </div>
        )}

        <p className="text-sm text-gray-600 mb-4">
          {groupBy === 'office' ? (
            <>
              <span className="font-bold text-primary-600">ACG: {allWelfareUsers.filter(c => c.office === '鹿児島（ACG）').length}件</span>
              <span className="mx-2 text-gray-300">|</span>
              <span className="font-bold text-primary-600">Lichi: {allWelfareUsers.filter(c => c.office === '福岡（Lichi）').length}件</span>
              <span className="ml-2 text-gray-400">（合計: {allWelfareUsers.length}件）</span>
            </>
          ) : (
            <>
              表示中: <span className="font-bold text-primary-600">{welfareUsers.length}件</span>
              {officeFilter !== '全事業所' && (
                <span className="ml-2 text-gray-400">（全体: {allWelfareUsers.length}件）</span>
              )}
            </>
          )}
        </p>

        {/* 主タブ切り替え */}
        <div className="flex gap-2 mb-4">
          {(
            [
              { value: 'facility', label: '施設別' },
              { value: 'status',   label: 'Status別' },
              { value: 'office',   label: '事業所別' },
            ] as { value: GroupByType; label: string }[]
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setGroupBy(value)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                groupBy === value
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* サブタブ（グループ選択） */}
        <div className="flex gap-2 flex-wrap">
          {groupedData.map(([groupName, groupClients]) => (
            <button
              key={groupName}
              onClick={() => setSelectedGroup(groupName)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                selectedGroup === groupName
                  ? groupBy === 'office'
                    ? officeSubTabActive(groupName)
                    : 'bg-accent-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {groupName}
              <span className="ml-1.5 opacity-75">({groupClients.length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* 選択されたグループの詳細 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* グループヘッダー */}
          <div className={`border-b px-6 py-4 ${
            groupBy === 'office' ? 'bg-gray-50 border-gray-200' : 'bg-accent-50 border-accent-100'
          }`}>
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-800">{selectedGroup}</h3>
              <span className={`text-white px-4 py-1.5 rounded-full text-sm font-bold ${
                groupBy === 'office' ? officeAccentClass(selectedGroup) : 'bg-accent-600'
              }`}>
                {selectedGroupClients.length}件
              </span>
            </div>
          </div>

          {/* クライアント一覧 */}
          <div className="divide-y divide-gray-100">
            {selectedGroupClients.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-400">
                該当する利用者がいません
              </div>
            ) : (
              selectedGroupClients.map(client => (
                <div key={client.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex-1">
                    {/* 名前行 */}
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-bold text-gray-800 text-lg">{client.name}</h4>
                      <span className="text-sm text-gray-500">{client.nameKana}</span>
                      {client.paymentType === '生保' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700 border border-orange-300">
                          生活保護
                        </span>
                      )}
                    </div>
                    {/* 詳細情報（1行・flex wrap） */}
                    <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm">
                      <div>
                        <span className="text-gray-500">あおぞらID:</span>
                        <span className="ml-1 text-gray-700 font-medium">{client.aozoraId}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">要介護度:</span>
                        <span className="ml-1 text-gray-700 font-medium">{client.careLevel}</span>
                      </div>
                      {/* 施設別: 居室を表示 */}
                      {groupBy === 'facility' && client.currentStatus === '施設入居中' && client.roomNumber && (
                        <div>
                          <span className="text-gray-500">居室:</span>
                          <span className="ml-1 text-gray-700 font-medium">{client.roomNumber}</span>
                        </div>
                      )}
                      {/* Status別・事業所別: 施設/在宅を表示 */}
                      {(groupBy === 'status' || groupBy === 'office') && (
                        <div>
                          <span className="text-gray-500">施設:</span>
                          <span className="ml-1 text-gray-700 font-medium">
                            {client.currentStatus === '施設入居中' ? client.facilityName || '施設' : '在宅'}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500">福祉用具:</span>
                        <span className="ml-1 text-gray-700 font-medium">{client.selectedEquipment.length}件</span>
                      </div>
                      {client.careSupportOffice && (
                        <div className="text-gray-600">
                          <span className="text-gray-400">居宅介護支援:</span>
                          <span className="ml-1">{client.careSupportOffice}</span>
                        </div>
                      )}
                      {client.careManager && (
                        <div className="text-gray-600">
                          <span className="text-gray-400">担当CM:</span>
                          <span className="ml-1">{client.careManager}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelfareUsersSummary;
