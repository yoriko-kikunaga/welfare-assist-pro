
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Client, MeetingType } from './types';
import ClientList from './components/ClientList';
import ClientDetail from './components/ClientDetail';
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
        await saveClientEdits(updatedClient, currentUser.email);
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
            onSelectClient={(c) => {
              setSelectedClientId(c.id);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
            }}
            onShowSummary={() => {
              setShowSummary(true);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            }}
            onShowReconciliation={() => {
              setShowReconciliation(true);
              setShowSummary(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            }}
            onShowMonthlySales={() => {
              setShowMonthlySales(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            }}
            onShowChangeRecords={() => {
              setShowChangeRecords(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowEquipmentTracking(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            }}
            onShowEquipmentTracking={() => {
              setShowEquipmentTracking(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowReceiptCheck(false);
              setShowHelp(false);
              setSelectedClientId(null);
            }}
            onShowReceiptCheck={() => {
              setShowReceiptCheck(true);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setShowHelp(false);
              setSelectedClientId(null);
            }}
            onShowHelp={() => {
              setShowHelp(true);
              setShowReceiptCheck(false);
              setShowSummary(false);
              setShowReconciliation(false);
              setShowMonthlySales(false);
              setShowChangeRecords(false);
              setShowEquipmentTracking(false);
              setSelectedClientId(null);
            }}
            showOnlyWelfareUsers={showOnlyWelfareUsers}
            onToggleWelfareFilter={() => setShowOnlyWelfareUsers(!showOnlyWelfareUsers)}
            totalCount={clients.length}
            welfareUserCount={welfareUserCount}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            onToggleWelfareUser={handleToggleWelfareUser}
            onSignOut={signOut}
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
            <ReceiptCheckPage clients={clients} baseClients={baseClients} userEmail={currentUser?.email || ''} />
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
               <button onClick={() => setSelectedClientId(null)} className="flex items-center text-primary-600 font-bold">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                 </svg>
                 一覧に戻る
               </button>
            </div>
            <ClientDetail
              client={selectedClient}
              onUpdateClient={handleUpdateClient}
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
    </div>
  );
};

export default App;