
import React, { useState } from 'react';
import { Client, MeetingType } from './types';
import ClientList from './components/ClientList';
import ClientDetail from './components/ClientDetail';
import WelfareUsersSummary from './components/WelfareUsersSummary';
import clientsData from './clients.json';

const App: React.FC = () => {
  const [clients, setClients] = useState<Client[]>(clientsData as Client[]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [showOnlyWelfareUsers, setShowOnlyWelfareUsers] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // フィルタリングされたクライアントリスト
  const filteredClients = clients.filter(client => {
    // 福祉用具フィルター
    if (showOnlyWelfareUsers && !client.isWelfareEquipmentUser) {
      return false;
    }

    // 検索フィルター（氏名・氏名カナで検索）
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchName = client.name.toLowerCase().includes(query);
      const matchKana = client.nameKana.toLowerCase().includes(query);
      const matchId = client.aozoraId.includes(query);
      return matchName || matchKana || matchId;
    }

    return true;
  });

  const selectedClient = clients.find(c => c.id === selectedClientId);

  const handleUpdateClient = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
  };

  const handleAddClient = () => {
    const newClient: Client = {
      id: Date.now().toString(),
      aozoraId: '',
      name: '新規 利用者',
      nameKana: 'シンキ リヨウシャ',
      birthDate: '1950-01-01',
      gender: '女性',
      facilityName: '',
      roomNumber: '',
      careLevel: '申請中',
      copayRate: '1割',
      insuranceCardStatus: '未確認',
      burdenProportionCertificateStatus: '未確認',
      currentStatus: '在宅',
      paymentType: '非生保',
      kaipokeRegistrationStatus: '未登録',
      keyPerson: {
        name: '',
        relationship: '',
        contact: ''
      },
      careSupportOffice: '',
      careManager: '',
      address: '',
      medicalHistory: '',
      isWelfareEquipmentUser: false,
      meetings: [],
      changeRecords: [],
      plannedEquipment: [],
      selectedEquipment: [],
      startDate: '',
      salesRecords: []
    };
    setClients([newClient, ...clients]);
    setSelectedClientId(newClient.id);
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans text-gray-900">
      {/* Sidebar - Mobile Responsive: Hidden on small screens if client selected or summary shown */}
      <div className={`${(selectedClientId || showSummary) ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full flex-col`}>
         <ClientList
            clients={filteredClients}
            selectedClientId={selectedClientId}
            onSelectClient={(c) => {
              setSelectedClientId(c.id);
              setShowSummary(false);
            }}
            onAddClient={handleAddClient}
            onShowSummary={() => {
              setShowSummary(true);
              setSelectedClientId(null);
            }}
            showOnlyWelfareUsers={showOnlyWelfareUsers}
            onToggleWelfareFilter={() => setShowOnlyWelfareUsers(!showOnlyWelfareUsers)}
            totalCount={clients.length}
            welfareUserCount={clients.filter(c => c.isWelfareEquipmentUser).length}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
         />
      </div>

      {/* Main Content */}
      <div className="flex-1 h-full overflow-hidden flex flex-col relative">
        {showSummary ? (
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