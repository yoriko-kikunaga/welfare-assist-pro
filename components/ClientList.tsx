import React from 'react';
import { Client } from '../types';

interface ClientListProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (client: Client) => void;
  onAddClient: () => void;
  onShowSummary: () => void;
  showOnlyWelfareUsers: boolean;
  onToggleWelfareFilter: () => void;
  totalCount: number;
  welfareUserCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToggleWelfareUser: (clientId: string, checked: boolean) => void;
  onSignOut: () => void;
  userEmail?: string;
}

const ClientList: React.FC<ClientListProps> = ({
  clients,
  selectedClientId,
  onSelectClient,
  onAddClient,
  onShowSummary,
  showOnlyWelfareUsers,
  onToggleWelfareFilter,
  totalCount,
  welfareUserCount,
  searchQuery,
  onSearchChange,
  onToggleWelfareUser,
  onSignOut,
  userEmail
}) => {
  return (
    <div className="w-full md:w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-bold text-gray-700">利用者一覧</h2>
        <button
          onClick={onAddClient}
          className="bg-primary-600 hover:bg-primary-700 text-white p-2 rounded-full shadow-sm transition-colors"
          title="新規追加"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {/* フィルターボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <button
            onClick={onToggleWelfareFilter}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded transition-colors ${
              !showOnlyWelfareUsers
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            全員 ({totalCount})
          </button>
          <button
            onClick={onToggleWelfareFilter}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded transition-colors ${
              showOnlyWelfareUsers
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            福祉用具 ({welfareUserCount})
          </button>
        </div>
      </div>

      {/* 検索ボックス */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="氏名・カナ・IDで検索"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5 text-gray-400 absolute left-3 top-2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 福祉用具集計ボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowSummary}
          className="w-full px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          福祉用具集計
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {clients.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            利用者が登録されていません
          </div>
        ) : (
          <ul>
            {clients.map((client) => (
              <li key={client.id}>
                <button
                  onClick={() => onSelectClient(client)}
                  className={`w-full text-left p-4 border-b border-gray-100 hover:bg-primary-50 transition-all ${
                    selectedClientId === client.id ? 'bg-primary-50 border-l-4 border-l-primary-500' : 'border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* 福祉用具チェックボックス */}
                    <input
                      type="checkbox"
                      checked={client.isWelfareEquipmentUser}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleWelfareUser(client.id, e.target.checked);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 text-primary-600 rounded cursor-pointer flex-shrink-0"
                      title="福祉用具利用者"
                    />

                    {/* 利用者情報 */}
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <span className="font-semibold text-gray-800 text-lg">{client.name}</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-600">
                          {client.careLevel}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{client.nameKana}</div>
                      <div className="text-xs text-gray-400 mt-1 truncate">{client.facilityName}</div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ユーザー情報とログアウト */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-600 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span className="text-sm text-gray-600 truncate">{userEmail}</span>
          </div>
          <button
            onClick={onSignOut}
            className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex-shrink-0"
            title="ログアウト"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClientList;