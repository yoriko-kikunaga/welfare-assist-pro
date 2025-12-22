import React, { useState } from 'react';
import { Client } from '../types';

interface WelfareUsersSummaryProps {
  clients: Client[];
}

type GroupByType = 'facility' | 'status';

const WelfareUsersSummary: React.FC<WelfareUsersSummaryProps> = ({ clients }) => {
  const [groupBy, setGroupBy] = useState<GroupByType>('facility');
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  // 福祉用具利用者のみをフィルター
  const welfareUsers = clients.filter(c => c.isWelfareEquipmentUser);

  // 施設別に集計
  const groupByFacility = () => {
    const groups = new Map<string, Client[]>();

    welfareUsers.forEach(client => {
      const facilityKey = client.currentStatus === '施設入居中' && client.facilityName
        ? client.facilityName
        : '在宅';

      if (!groups.has(facilityKey)) {
        groups.set(facilityKey, []);
      }
      groups.get(facilityKey)!.push(client);
    });

    // 在宅を最初に、その後施設名でソート
    const sorted = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '在宅') return -1;
      if (b[0] === '在宅') return 1;
      return a[0].localeCompare(b[0], 'ja');
    });

    return sorted;
  };

  // Status別に集計
  const groupByStatus = () => {
    const groups = new Map<string, Client[]>();

    welfareUsers.forEach(client => {
      // 選定した福祉用具からステータスを判定
      const statuses = new Set(client.selectedEquipment.map(eq => eq.status || '介護保険貸与'));

      let statusKey = '未設定';
      if (statuses.size === 0) {
        statusKey = '未設定';
      } else if (statuses.size === 1) {
        const status = Array.from(statuses)[0];
        if (status === '介護保険貸与') statusKey = '介護保険レンタル';
        else if (status === '自費利用') statusKey = '自費利用';
        else statusKey = status;
      } else {
        statusKey = '併用';
      }

      if (!groups.has(statusKey)) {
        groups.set(statusKey, []);
      }
      groups.get(statusKey)!.push(client);
    });

    // ステータス順でソート
    const order = ['介護保険レンタル', '自費利用', '併用', '未設定'];
    const sorted = Array.from(groups.entries()).sort((a, b) => {
      const indexA = order.indexOf(a[0]);
      const indexB = order.indexOf(b[0]);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    return sorted;
  };

  const groupedData = groupBy === 'facility' ? groupByFacility() : groupByStatus();

  // 初期選択グループを設定
  React.useEffect(() => {
    if (groupedData.length > 0 && !selectedGroup) {
      setSelectedGroup(groupedData[0][0]);
    }
  }, [groupedData, selectedGroup]);

  // グループ切り替え時に最初のグループを選択
  React.useEffect(() => {
    if (groupedData.length > 0) {
      setSelectedGroup(groupedData[0][0]);
    }
  }, [groupBy]);

  // 選択されたグループのクライアントを取得
  const selectedGroupClients = groupedData.find(([name]) => name === selectedGroup)?.[1] || [];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">福祉用具利用者集計</h2>
        <p className="text-sm text-gray-600 mb-4">
          総利用者数: <span className="font-bold text-primary-600">{welfareUsers.length}件</span>
        </p>

        {/* 主タブ切り替え */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setGroupBy('facility')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              groupBy === 'facility'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            施設別
          </button>
          <button
            onClick={() => setGroupBy('status')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              groupBy === 'status'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Status別
          </button>
        </div>

        {/* サブタブ（グループ選択） */}
        <div className="flex gap-2 flex-wrap">
          {groupedData.map(([groupName, groupClients]) => (
            <button
              key={groupName}
              onClick={() => setSelectedGroup(groupName)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                selectedGroup === groupName
                  ? 'bg-accent-600 text-white'
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
          <div className="bg-accent-50 border-b border-accent-100 px-6 py-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-800">{selectedGroup}</h3>
              <span className="bg-accent-600 text-white px-4 py-1.5 rounded-full text-sm font-bold">
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
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-bold text-gray-800 text-lg">{client.name}</h4>
                        <span className="text-sm text-gray-500">{client.nameKana}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">あおぞらID:</span>
                          <span className="ml-1 text-gray-700 font-medium">{client.aozoraId}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">要介護度:</span>
                          <span className="ml-1 text-gray-700 font-medium">{client.careLevel}</span>
                        </div>
                        {groupBy === 'facility' && client.currentStatus === '施設入居中' && client.roomNumber && (
                          <div>
                            <span className="text-gray-500">居室:</span>
                            <span className="ml-1 text-gray-700 font-medium">{client.roomNumber}</span>
                          </div>
                        )}
                        {groupBy === 'status' && (
                          <div>
                            <span className="text-gray-500">施設:</span>
                            <span className="ml-1 text-gray-700 font-medium">
                              {client.currentStatus === '施設入居中' ? client.facilityName : '在宅'}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">福祉用具:</span>
                          <span className="ml-1 text-gray-700 font-medium">{client.selectedEquipment.length}件</span>
                        </div>
                      </div>
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
