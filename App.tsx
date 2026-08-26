
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Client, MeetingType } from './types';
import ClientList from './components/ClientList';
import ClientDetail, { ClientDetailHandle } from './components/ClientDetail';
import WelfareUsersSummary from './components/WelfareUsersSummary';
import ReconciliationPage from './components/ReconciliationPage';
import MonthlySalesExport from './components/MonthlySalesExport';
import ChangeRecordsExport from './components/ChangeRecordsExport';
import EquipmentTrackingPage from './components/EquipmentTrackingPage';
import ReceiptCheckPage from './components/ReceiptCheckPage';
import HelpPage from './components/HelpPage';
import { Login } from './components/Login';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { getAllClientEdits, mergeAllClientEdits, saveClientEdits, isInsuranceRentalOverridden } from './src/services/firestoreService';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

const AppContent: React.FC = () => {
  const { currentUser, loading, signOut } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [baseClients, setBaseClients] = useState<Client[]>([]);
  const [dataLoading, setDataLoading] = useState<boolean>(true);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [showReconciliation, setShowReconciliation] = useState<boolean>(false);
  const [showMonthlySales, setShowMonthlySales] = useState<boolean>(false);
  const [showChangeRecords, setShowChangeRecords] = useState<boolean>(false);
  const [showEquipmentTracking, setShowEquipmentTracking] = useState<boolean>(false);
  const [showReceiptCheck, setShowReceiptCheck] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showOnlyWelfareUsers, setShowOnlyWelfareUsers] = useState<boolean>(false);

  // ===== 利用者詳細（ClientDetail）の未保存編集の離脱ガード（自動保存廃止・2026-08-26）=====
  // 自動保存を廃止し保存ボタン押下が必須になったため、未保存のまま他の利用者へ切り替えたり
  // 別ページへ移動しようとした際に、気づかず変更が失われないよう確認ダイアログを挟む。
  const clientDetailRef = useRef<ClientDetailHandle>(null);
  const [isClientDirty, setIsClientDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [isSavingBeforeNav, setIsSavingBeforeNav] = useState(false);
  const handleClientDirtyChange = useCallback((dirty: boolean) => setIsClientDirty(dirty), []);
  // 離脱を伴う操作はこれで包む。未保存があれば確認ダイアログを出し、なければ即実行
  const guardNavigate = useCallback((run: () => void) => {
    if (isClientDirty) {
      setPendingNav(() => run);
    } else {
      run();
    }
  }, [isClientDirty]);
  const handleNavSaveAndGo = async () => {
    setIsSavingBeforeNav(true);
    try {
      const ok = await clientDetailRef.current?.save();
      if (ok) {
        pendingNav?.();
        setPendingNav(null);
      }
      // 保存に失敗した場合はダイアログを残し、ClientDetail側のエラー表示を見て再試行/破棄を選べるようにする
    } finally {
      setIsSavingBeforeNav(false);
    }
  };
  const handleNavDiscardAndGo = () => {
    pendingNav?.();
    setPendingNav(null);
  };
  const handleNavCancel = () => setPendingNav(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  // 検索フィルタのデバウンス（300ms）: キー入力のたびに9031件を走査しない
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedQuery(q), 300);
  }, []);

  // Reusable function to load/reload clients data
  const loadClientsData = useCallback(async () => {
    try {
      // Load base client data from JSON
      const response = await fetch('/assets/clients.json');
      const baseClients = await response.json() as Client[];
      console.log(`✓ Loaded ${baseClients.length} clients from JSON`);

      // Load client edits from Firestore
      const editsMap = await getAllClientEdits();
      console.log(`✓ Loaded ${editsMap.size} client edits from Firestore`);

      // Check if insurance rental data has been overridden (cleared or imported via CSV)
      const insuranceOverridden = await isInsuranceRentalOverridden();
      console.log(`✓ Insurance rental override: ${insuranceOverridden}`);

      // Merge base data with Firestore edits
      const mergedClients = mergeAllClientEdits(baseClients, editsMap, insuranceOverridden);
      console.log(`✓ Merged clients data`);

      setBaseClients(baseClients);
      setClients(mergedClients);
      return mergedClients;
    } catch (error) {
      console.error('Failed to load clients data:', error);
      throw error;
    }
  }, []);

  // Load clients data from assets folder and merge with Firestore edits
  useEffect(() => {
    if (!loading && currentUser) {
      console.log(`[Auth] Current user email: ${currentUser.email}`);
      console.log(`[Auth] Email domain: ${currentUser.email?.split('@')[1]}`);

      loadClientsData()
        .then(() => setDataLoading(false))
        .catch(() => setDataLoading(false));
    } else if (!loading && !currentUser) {
      // Auth completed with no user - skip data loading
      setDataLoading(false);
    }
  }, [loading, currentUser, loadClientsData]);

  // ── hooks はすべて early return の前に置く（Rules of Hooks） ──────────────

  // フィルタリングされたクライアントリスト（useMemo: 依存値が変わった時だけ再計算）
  const filteredClients = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return clients.filter(client => {
      if (showOnlyWelfareUsers && !client.isWelfareEquipmentUser) return false;
      if (!q) return true;
      return (
        client.name.toLowerCase().includes(q) ||
        client.nameKana.toLowerCase().includes(q) ||
        client.aozoraId.includes(q)
      );
    });
  }, [clients, debouncedQuery, showOnlyWelfareUsers]);

  // 福祉用具利用者数（useMemo: clients が変わった時だけ再計算）
  const welfareUserCount = useMemo(
    () => clients.filter(c => c.isWelfareEquipmentUser).length,
    [clients]
  );

  const selectedClient = useMemo(
    () => clients.find(c => c.id === selectedClientId),
    [clients, selectedClientId]
  );

  const handleUpdateClient = useCallback(async (updatedClient: Client) => {
    setClients(prev => {
      const next = [...prev];
      const idx = prev.findIndex(c => c.id === updatedClient.id);
      if (idx !== -1) next[idx] = updatedClient;
      return next;
    });
    try {
      if (currentUser?.email) {
        const { violations, selectedEquipment } = await saveClientEdits(updatedClient, currentUser.email);
        if (violations.length > 0) {
          // 確定済みレコードへの改変はサーバー側で差し戻されているため、画面表示もサーバーの値に合わせる
          setClients(prev => {
            const next = [...prev];
            const idx = prev.findIndex(c => c.id === updatedClient.id);
            if (idx !== -1) next[idx] = { ...next[idx], selectedEquipment };
            return next;
          });
          alert(
            '以下の項目は売上確定済みのため変更が反映されませんでした（変更するには売上確定の解除が必要です）:\n' +
            violations.map(v => `・${v.name}（${v.kind}）`).join('\n')
          );
        }
      }
    } catch (error) {
      console.error(`❌ [Firestore] Failed to save client ${updatedClient.aozoraId}:`, error);
      alert(`データの保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [currentUser?.email]);

  const handleToggleWelfareUser = useCallback(async (clientId: string, checked: boolean) => {
    const updatedClient = clients.find(c => c.id === clientId);
    if (!updatedClient) return;
    const newClient = { ...updatedClient, isWelfareEquipmentUser: checked };
    setClients(prev => {
      const next = [...prev];
      const idx = prev.findIndex(c => c.id === clientId);
      if (idx !== -1) next[idx] = newClient;
      return next;
    });
    try {
      if (currentUser?.email) {
        await saveClientEdits(newClient, currentUser.email);
      }
    } catch (error) {
      console.error('Failed to save welfare equipment flag:', error);
    }
  }, [clients, currentUser?.email]);

  // ── early returns（hooks の後に置く） ─────────────────────────────────────

  // Show loading state while checking authentication or loading data
  if (loading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600 font-medium">読み込み中...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!currentUser) {
    return <Login />;
  }

  return (
    <div className="flex h-screen bg-gray-100 font-sans text-gray-900">
      {/* Sidebar - Mobile Responsive: Hidden on small screens if client selected or summary/reconciliation/monthlySales/changeRecords shown */}
      <div className={`${(selectedClientId || showSummary || showReconciliation || showMonthlySales || showChangeRecords || showEquipmentTracking || showReceiptCheck || showHelp) ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full flex-col`}>
         <ClientList
            clients={filteredClients}
            selectedClientId={selectedClientId}
            onSelectClient={(c) => guardNavigate(() => {
              setSelectedClientId(c.id);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
            })}
            onShowSummary={() => guardNavigate(() => {
              setShowSummary(true);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            })}
            onShowReconciliation={() => guardNavigate(() => {
              setShowReconciliation(true);
              setShowSummary(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            })}
            onShowMonthlySales={() => guardNavigate(() => {
              setShowMonthlySales(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            })}
            onShowChangeRecords={() => guardNavigate(() => {
              setShowChangeRecords(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            })}
            onShowEquipmentTracking={() => guardNavigate(() => {
              setShowEquipmentTracking(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            })}
            onShowReceiptCheck={() => guardNavigate(() => {
              setShowReceiptCheck(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowHelp(false);
              setSelectedClientId(null);
            })}
            onShowHelp={() => guardNavigate(() => {
              setShowHelp(true);
              setShowReceiptCheck(false);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setSelectedClientId(null);
            })}
            showOnlyWelfareUsers={showOnlyWelfareUsers}
            onToggleWelfareFilter={() => setShowOnlyWelfareUsers(!showOnlyWelfareUsers)}
            totalCount={clients.length}
            welfareUserCount={welfareUserCount}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            onToggleWelfareUser={handleToggleWelfareUser}
            onSignOut={() => guardNavigate(signOut)}
            userEmail={currentUser?.email || ''}
         />
      </div>

      {/* Main Content */}
      <div className="flex-1 h-full overflow-hidden flex flex-col relative">
        {showHelp ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowHelp(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <HelpPage />
          </>
        ) : showReceiptCheck ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowReceiptCheck(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <ReceiptCheckPage clients={clients} baseClients={baseClients} userEmail={currentUser?.email || ''} onUpdateClient={handleUpdateClient} />
          </>
        ) : showEquipmentTracking ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowEquipmentTracking(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <EquipmentTrackingPage clients={clients} userEmail={currentUser?.email || ''} />
          </>
        ) : showChangeRecords ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowChangeRecords(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <ChangeRecordsExport clients={clients} />
          </>
        ) : showMonthlySales ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowMonthlySales(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <MonthlySalesExport clients={clients} userEmail={currentUser?.email || ''} onClientsUpdated={loadClientsData} />
          </>
        ) : showReconciliation ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowReconciliation(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <ReconciliationPage clients={clients} baseClients={baseClients} userEmail={currentUser?.email || ''} />
          </>
        ) : showSummary ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => setShowSummary(false)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <WelfareUsersSummary clients={clients} />
          </>
        ) : selectedClient ? (
          <>
            {/* Mobile Back Button */}
            <div className="md:hidden p-2 bg-white border-b border-gray-200">
               <button onClick={() => guardNavigate(() => setSelectedClientId(null))} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <ClientDetail
              ref={clientDetailRef}
              client={selectedClient}
              onUpdateClient={handleUpdateClient}
              onDirtyChange={handleClientDirtyChange}
            />
          </>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50 flex-col text-gray-400">
             <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-gray-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
             </div>
             <p className="text-lg font-medium">利用者を選択してください</p>
             <p className="text-sm mt-2">左側のリストから選択するか、新規追加してください。</p>
          </div>
        )}
      </div>

      {/* 未保存の変更がある状態で利用者切替・他ページ遷移・ログアウトしようとした時の確認ダイアログ
          （自動保存廃止・2026-08-26。保存ボタン押下が必須になったため、気づかず変更が失われないための安全策） */}
      {pendingNav && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">保存されていない変更があります</h3>
            <p className="text-sm text-gray-600 mb-5">このまま移動すると、入力した内容が失われます。どうしますか？</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleNavSaveAndGo}
                disabled={isSavingBeforeNav}
                className="px-4 py-2 rounded bg-primary-600 text-white hover:bg-primary-700 shadow-sm disabled:opacity-50 font-bold"
              >
                {isSavingBeforeNav ? '保存中...' : '保存して移動'}
              </button>
              <button
                onClick={handleNavDiscardAndGo}
                disabled={isSavingBeforeNav}
                className="px-4 py-2 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                保存せず移動
              </button>
              <button
                onClick={handleNavCancel}
                disabled={isSavingBeforeNav}
                className="px-4 py-2 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                キャンセル（このまま留まる）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;