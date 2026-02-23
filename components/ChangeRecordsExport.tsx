import React, { useState, useMemo } from 'react';
import { Client, ClientChangeRecord, ChangeInfoType, OfficeLocation } from '../types';
import { syncChangeRecordsToSheets } from '../services/geminiService';

interface ChangeRecordsExportProps {
  clients: Client[];
}

type OfficeFilter = 'all' | OfficeLocation;
type InfoTypeFilter = 'all' | ChangeInfoType;

const OFFICE_OPTIONS: { value: OfficeFilter; label: string }[] = [
  { value: 'all', label: '全事業所' },
  { value: '鹿児島（ACG）', label: '鹿児島（ACG）' },
  { value: '福岡（Lichi）', label: '福岡（Lichi）' },
];

const INFO_TYPE_OPTIONS: { value: InfoTypeFilter; label: string }[] = [
  { value: 'all', label: '全種別' },
  { value: '新規', label: '新規' },
  { value: '入院（サービス停止）', label: '入院' },
  { value: '退院（サービス開始）', label: '退院' },
  { value: '解約', label: '解約' },
  { value: '変更あり', label: '変更あり' },
  { value: 'その他', label: 'その他' },
  { value: 'デモ', label: 'デモ' },
];

// 情報種別に応じたデータ連携日を取得
const getDataLinkageDate = (record: ClientChangeRecord): string => {
  switch (record.infoType) {
    case '新規':
      return record.billingStartDateNew || '';
    case '入院（サービス停止）':
      return record.billingStopDateHospital || '';
    case '退院（サービス開始）':
      return record.billingStartDateDischarge || '';
    case '解約':
      return record.billingStopDateCancel || '';
    case 'デモ':
      return record.demoStartDate || '';
    default:
      return record.recordDate || '';
  }
};

interface FlattenedRecord {
  client: Client;
  record: ClientChangeRecord;
  dataLinkageDate: string;
}

const ChangeRecordsExport: React.FC<ChangeRecordsExportProps> = ({ clients }) => {
  // 期間選択のデフォルト値（過去1ヶ月）
  const today = new Date();
  const oneMonthAgo = new Date(today);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const [startDate, setStartDate] = useState<string>(
    oneMonthAgo.toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState<string>(
    today.toISOString().split('T')[0]
  );
  const [selectedOffice, setSelectedOffice] = useState<OfficeFilter>('all');
  const [selectedInfoType, setSelectedInfoType] = useState<InfoTypeFilter>('all');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  // フィルタリングされた変更情報を取得
  const filteredRecords = useMemo<FlattenedRecord[]>(() => {
    const result: FlattenedRecord[] = [];

    // 福祉用具利用者のみ対象
    const welfareUsers = clients.filter(c => c.isWelfareEquipmentUser);

    welfareUsers.forEach(client => {
      (client.changeRecords || []).forEach(record => {
        const dataLinkageDate = getDataLinkageDate(record);

        // 事業所フィルター（利用者の現在の事業所で判定）
        if (selectedOffice !== 'all' && client.office !== selectedOffice) {
          return;
        }

        // 情報種別フィルター
        if (selectedInfoType !== 'all' && record.infoType !== selectedInfoType) {
          return;
        }

        // 期間フィルター（データ連携日で判定）
        if (dataLinkageDate) {
          if (startDate && dataLinkageDate < startDate) return;
          if (endDate && dataLinkageDate > endDate) return;
        } else {
          // データ連携日がない場合は記録日で判定
          if (record.recordDate) {
            if (startDate && record.recordDate < startDate) return;
            if (endDate && record.recordDate > endDate) return;
          }
        }

        result.push({ client, record, dataLinkageDate });
      });
    });

    // データ連携日順でソート（新しい順）
    return result.sort((a, b) => {
      const dateA = a.dataLinkageDate || a.record.recordDate || '';
      const dateB = b.dataLinkageDate || b.record.recordDate || '';
      return dateB.localeCompare(dateA);
    });
  }, [clients, startDate, endDate, selectedOffice, selectedInfoType]);

  // CSVダウンロード
  const exportCSV = () => {
    const headers = [
      '入力日',
      'あおぞらID',
      '利用者名',
      '施設名',
      '情報種別',
      '利用区分',
      '請求開始日（新規）',
      '請求停止日（入院）',
      '請求開始日（退院）',
      '請求停止日（解約）',
      'デモ開始日',
      'デモ終了日',
      'データ連携日',
      '卸会社停止連絡',
      '卸会社再開連絡',
      '記録者',
      '事業所',
      '特記'
    ];

    const rows = filteredRecords.map(({ client, record, dataLinkageDate }) => [
      record.recordDate || '',
      client.aozoraId,
      client.name,
      client.facilityName || '',
      record.infoType,
      record.usageCategory || '',
      record.billingStartDateNew || '',
      record.billingStopDateHospital || '',
      record.billingStartDateDischarge || '',
      record.billingStopDateCancel || '',
      record.demoStartDate || '',
      record.demoEndDate || '',
      dataLinkageDate,
      record.wholesalerStopContactStatus || '',
      record.wholesalerResumeContactStatus || '',
      record.recorder || '',
      client.office || '',
      record.note || ''
    ]);

    downloadCSV(headers, rows);
  };

  // スプレッドシート同期
  const handleSyncToSheets = async () => {
    setIsSyncing(true);
    setSyncResult(null);

    try {
      const result = await syncChangeRecordsToSheets();
      if (result.success) {
        setSyncResult({
          success: true,
          message: result.message || `${result.count}件を同期しました`
        });
        // スプレッドシートを新しいタブで開く
        if (result.spreadsheetUrl) {
          window.open(result.spreadsheetUrl, '_blank');
        }
      } else {
        setSyncResult({
          success: false,
          message: result.error || '同期に失敗しました'
        });
      }
    } catch (error) {
      console.error('Sync error:', error);
      setSyncResult({
        success: false,
        message: error instanceof Error ? error.message : '同期中にエラーが発生しました'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // CSVダウンロード関数
  const downloadCSV = (headers: string[], rows: string[][]) => {
    const BOM = '\uFEFF';
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const officeLabel = selectedOffice === 'all' ? '全事業所' : selectedOffice;
    const filename = `変更情報_${startDate}_${endDate}_${officeLabel}.csv`;

    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 情報種別ごとの件数を計算
  const countByInfoType = useMemo(() => {
    const counts: Record<string, number> = {
      '新規': 0,
      '入院（サービス停止）': 0,
      '退院（サービス開始）': 0,
      '解約': 0,
      '変更あり': 0,
      'その他': 0,
      'デモ': 0
    };
    filteredRecords.forEach(({ record }) => {
      if (counts[record.infoType] !== undefined) {
        counts[record.infoType]++;
      }
    });
    return counts;
  }, [filteredRecords]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">変更情報一覧</h2>

        {/* フィルター */}
        <div className="flex items-center gap-6 mb-4 flex-wrap">
          {/* 期間選択 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-600">期間:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            />
            <span className="text-gray-500">〜</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>

          {/* 事業所選択 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-600">事業所:</label>
            <select
              value={selectedOffice}
              onChange={(e) => setSelectedOffice(e.target.value as OfficeFilter)}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            >
              {OFFICE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {/* 情報種別選択 */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-600">種別:</label>
            <select
              value={selectedInfoType}
              onChange={(e) => setSelectedInfoType(e.target.value as InfoTypeFilter)}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none bg-white"
            >
              {INFO_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* サマリー */}
        <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
          <span className="font-bold text-gray-800">
            {filteredRecords.length}件
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-green-600">新規: {countByInfoType['新規']}</span>
          <span className="text-orange-600">入院: {countByInfoType['入院（サービス停止）']}</span>
          <span className="text-blue-600">退院: {countByInfoType['退院（サービス開始）']}</span>
          <span className="text-red-600">解約: {countByInfoType['解約']}</span>
          <span className="text-gray-600">変更: {countByInfoType['変更あり']}</span>
          <span className="text-gray-500">他: {countByInfoType['その他']}</span>
          <span className="text-cyan-600">デモ: {countByInfoType['デモ']}</span>
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* テーブルヘッダー */}
          <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-4 flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-indigo-800">変更情報</h3>
              <p className="text-sm text-indigo-600 mt-1">
                {startDate} 〜 {endDate} / {filteredRecords.length}件
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* 同期結果メッセージ */}
              {syncResult && (
                <span className={`text-sm ${syncResult.success ? 'text-green-600' : 'text-red-600'}`}>
                  {syncResult.message}
                </span>
              )}

              {/* スプレッドシート同期ボタン */}
              <button
                onClick={handleSyncToSheets}
                disabled={isSyncing}
                className="bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
              >
                {isSyncing ? (
                  <>
                    <svg className="animate-spin w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    同期中...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    スプレッドシートに同期
                  </>
                )}
              </button>

              {/* CSVダウンロードボタン */}
              <button
                onClick={exportCSV}
                disabled={filteredRecords.length === 0}
                className="bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSVダウンロード
              </button>
            </div>
          </div>

          {/* テーブル */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">データ連携日</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">入力日</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">あおぞらID</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">利用者名</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">施設名</th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-gray-600 uppercase whitespace-nowrap">情報種別</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">利用区分</th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-gray-600 uppercase whitespace-nowrap">卸停止連絡</th>
                  <th className="px-3 py-3 text-center text-xs font-bold text-gray-600 uppercase whitespace-nowrap">卸再開連絡</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">記録者</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">事業所</th>
                  <th className="px-3 py-3 text-left text-xs font-bold text-gray-600 uppercase whitespace-nowrap">特記</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center text-gray-400">
                      該当する変更情報はありません
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map(({ client, record, dataLinkageDate }) => {
                    // 情報種別に応じたバッジカラー
                    const getInfoTypeBadgeColor = (infoType: ChangeInfoType) => {
                      switch (infoType) {
                        case '新規':
                          return 'bg-green-100 text-green-800';
                        case '入院（サービス停止）':
                          return 'bg-orange-100 text-orange-800';
                        case '退院（サービス開始）':
                          return 'bg-blue-100 text-blue-800';
                        case '解約':
                          return 'bg-red-100 text-red-800';
                        case '変更あり':
                          return 'bg-yellow-100 text-yellow-800';
                        case 'デモ':
                          return 'bg-cyan-100 text-cyan-800';
                        default:
                          return 'bg-gray-100 text-gray-800';
                      }
                    };

                    // 連絡状況バッジ
                    const getContactBadge = (status: string | undefined) => {
                      if (!status) return <span className="text-gray-300">-</span>;
                      if (status === '対応済') {
                        return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">済</span>;
                      }
                      return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">未</span>;
                    };

                    return (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap font-medium">
                          {dataLinkageDate || '-'}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {record.recordDate || '-'}
                        </td>
                        <td className="px-3 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                          {client.aozoraId}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {client.name}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap max-w-[150px] truncate" title={client.facilityName}>
                          {client.facilityName || '-'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getInfoTypeBadgeColor(record.infoType)}`}>
                            {record.infoType === '入院（サービス停止）' ? '入院' :
                             record.infoType === '退院（サービス開始）' ? '退院' :
                             record.infoType}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {record.usageCategory || '-'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {record.infoType === '入院（サービス停止）' || record.infoType === '解約'
                            ? getContactBadge(record.wholesalerStopContactStatus)
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {record.infoType === '退院（サービス開始）'
                            ? getContactBadge(record.wholesalerResumeContactStatus)
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {record.recorder || '-'}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {client.office || '-'}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-500 max-w-[200px] truncate" title={record.note}>
                          {record.note || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChangeRecordsExport;
