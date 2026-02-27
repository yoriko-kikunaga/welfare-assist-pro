import React from 'react';
import { Client } from '../types';

interface ClientListProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (client: Client) => void;
  onShowSummary: () => void;
  onShowReconciliation: () => void;
  onShowMonthlySales: () => void;
  onShowChangeRecords: () => void;
  onShowEquipmentTracking: () => void;
  onShowReceiptCheck: () => void;
  onShowHelp: () => void;
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
  onShowSummary,
  onShowReconciliation,
  onShowMonthlySales,
  onShowChangeRecords,
  onShowEquipmentTracking,
  onShowReceiptCheck,
  onShowHelp,
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
      <div className="p-4 border-b border-gray-200 flex items-center bg-gray-50">
        <h2 className="text-lg font-bold text-gray-700">利用者一覧</h2>
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
          className="w-full px-4 py-2 bg-sky-100 hover:bg-sky-200 text-sky-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
          福祉用具集計
        </button>
      </div>

      {/* 介保売上突合ボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowReconciliation}
          className="w-full px-4 py-2 bg-teal-100 hover:bg-teal-200 text-teal-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
          売上・仕入突合
        </button>
      </div>

      {/* 月次売上処理ボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowMonthlySales}
          className="w-full px-4 py-2 bg-violet-100 hover:bg-violet-200 text-violet-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
          月次売上処理
        </button>
      </div>

      {/* 変更情報一覧ボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowChangeRecords}
          className="w-full px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          変更情報一覧
        </button>
      </div>

      {/* ベッド管理ボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowEquipmentTracking}
          className="w-full px-4 py-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75Z" />
          </svg>
          ベッド管理
        </button>
      </div>

      {/* レセプトチェックボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowReceiptCheck}
          className="w-full px-4 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
          レセプトチェック
        </button>
      </div>

      {/* ヘルプボタン */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <button
          onClick={onShowHelp}
          className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
          </svg>
          ヘルプ
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