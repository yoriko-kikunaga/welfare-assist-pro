
import React, { useState, useEffect } from 'react';
import { Client, MeetingRecord, MeetingType, Equipment, CurrentStatus, PaymentType, Gender, CareLevel, CopayRate, UsageCategory, ConfirmationStatus, RegistrationStatus, OfficeLocation, ReminderStatus, ClientChangeRecord, ChangeInfoType, ContactStatus, PropertyAttribute, EquipmentStatus, RegistrationState, EquipmentType, SalesRecord, SalesStatus, TaxType } from '../types';
import { generateMeetingSummary, suggestEquipment } from '../services/geminiService';

interface ClientDetailProps {
  client: Client;
  onUpdateClient: (updatedClient: Client) => void;
}

const EQUIPMENT_TYPES: EquipmentType[] = [
  '車いす', '車いす付属品', '特殊寝台', '特殊寝台付属品', '床ずれ防止用具', '体位変換器', '歩行器', '徘徊感知器', '手すり', '歩行補助つえ', '移動用リフト', 'スロープ', 'その他'
];

const ClientDetail: React.FC<ClientDetailProps> = ({ client, onUpdateClient }) => {
  const [activeTab, setActiveTab] = useState<'info' | 'medical' | 'meetings' | 'changes' | 'equipment' | 'sales'>('info');
  const [isEditing, setIsEditing] = useState(false);
  const [editedClient, setEditedClient] = useState<Client>(client);
  
  // AI States
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<string | null>(null); // meeting ID
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<string | null>(null);

  useEffect(() => {
    setEditedClient(client);
    setSuggestionResult(null);
  }, [client]);

  const handleSave = () => {
    onUpdateClient(editedClient);
    setIsEditing(false);
  };

  const handleChange = (field: keyof Client, value: any) => {
    setEditedClient(prev => ({ ...prev, [field]: value }));
  };
  
  const handleKeyPersonChange = (field: keyof Client['keyPerson'], value: string) => {
    setEditedClient(prev => ({
      ...prev,
      keyPerson: {
        ...prev.keyPerson,
        [field]: value
      }
    }));
  };

  // --- Meeting Handlers ---
  const handleAddMeeting = () => {
    const newMeeting: MeetingRecord = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      office: '鹿児島',
      type: '担当者会議（新規）',
      recorder: '',
      place: '',
      attendees: '',
      careSupportOffice: '',
      careManager: '',
      hospital: '',
      socialWorker: '',
      usageCategory: '介護保険レンタル',
      carePlanStatus: '未確認',
      serviceTicketStatus: '未確認',
      content: '',
      reminder: 'なし',
      summary: ''
    };
    setEditedClient(prev => ({
      ...prev,
      meetings: [newMeeting, ...prev.meetings]
    }));
    setActiveTab('meetings');
    setIsEditing(true);
  };

  const updateMeeting = (id: string, field: keyof MeetingRecord, value: any) => {
    setEditedClient(prev => ({
      ...prev,
      meetings: prev.meetings.map(m => m.id === id ? { ...m, [field]: value } : m)
    }));
  };

  const handleGenerateSummary = async (meeting: MeetingRecord) => {
    if (!meeting.content.trim()) {
      alert("まずは議事録内容を入力してください。");
      return;
    }
    setIsGeneratingSummary(meeting.id);
    const summary = await generateMeetingSummary(meeting.content, meeting.type, editedClient.name);
    updateMeeting(meeting.id, 'summary', summary);
    setIsGeneratingSummary(null);
  };

  // --- Change Record Handlers ---
  const handleAddChangeRecord = () => {
      const newRecord: ClientChangeRecord = {
          id: Date.now().toString(),
          recordDate: new Date().toISOString().split('T')[0],
          office: '鹿児島',
          infoType: '新規',
          recorder: '',
          usageCategory: '介護保険レンタル',
          billingStartDateNew: '',
          billingStopDateCancel: '',
          billingStopDateHospital: '',
          wholesalerStopContactStatus: '未対応',
          billingStartDateDischarge: '',
          wholesalerResumeContactStatus: '未対応',
          note: ''
      };
      setEditedClient(prev => ({
          ...prev,
          changeRecords: [newRecord, ...prev.changeRecords]
      }));
      setActiveTab('changes');
      setIsEditing(true);
  };

  const updateChangeRecord = (id: string, field: keyof ClientChangeRecord, value: any) => {
      setEditedClient(prev => ({
          ...prev,
          changeRecords: prev.changeRecords.map(r => r.id === id ? { ...r, [field]: value } : r)
      }));
  };

  // --- Equipment Handlers ---
  const handleAddEquipment = (type: 'planned' | 'selected') => {
    const newEq: Equipment = { 
        id: Date.now().toString(), 
        name: '', 
        category: '車いす',
        office: '鹿児島',
        recorder: '',
        propertyAttribute: 'リース物件',
        ownProductCategory: '',
        ownProductId: '',
        taisCode: '',
        manufacturer: '',
        wholesaler: '',
        units: '',
        kaipokeStatus: '未登録',
        status: '介護保険貸与',
        orderReceivedDate: '',
        orderPlacedDate: '',
        purchaseDate: '',
        deliveryDate: '',
        startDate: '',
        endDate: ''
    };
    if (type === 'planned') {
      setEditedClient(prev => ({ ...prev, plannedEquipment: [...prev.plannedEquipment, newEq] }));
    } else {
      setEditedClient(prev => ({ ...prev, selectedEquipment: [...prev.selectedEquipment, newEq] }));
    }
  };

  const updateEquipment = (type: 'planned' | 'selected', id: string, field: keyof Equipment, value: any) => {
    const listKey = type === 'planned' ? 'plannedEquipment' : 'selectedEquipment';
    setEditedClient(prev => ({
      ...prev,
      [listKey]: prev[listKey].map((e: Equipment) => e.id === id ? { ...e, [field]: value } : e)
    }));
  };

  const removeEquipment = (type: 'planned' | 'selected', id: string) => {
    const listKey = type === 'planned' ? 'plannedEquipment' : 'selectedEquipment';
    setEditedClient(prev => ({
      ...prev,
      [listKey]: prev[listKey].filter((e: Equipment) => e.id !== id)
    }));
  };

  const handleSuggestEquipment = async () => {
    setIsSuggesting(true);
    const result = await suggestEquipment(editedClient);
    setSuggestionResult(result);
    setIsSuggesting(false);
  };

  // --- Sales Record Handlers ---
  const handleAddSalesRecord = () => {
    const newRecord: SalesRecord = {
      id: Date.now().toString(),
      status: '販売',
      aozoraId: editedClient.aozoraId,
      clientName: editedClient.name,
      facilityName: editedClient.facilityName,
      productName: '',
      quantity: 1,
      unitPrice: 0,
      taxType: '10％'
    };
    setEditedClient(prev => ({
      ...prev,
      salesRecords: [...(prev.salesRecords || []), newRecord]
    }));
    setActiveTab('sales');
    setIsEditing(true);
  };

  const updateSalesRecord = (id: string, field: keyof SalesRecord, value: any) => {
    setEditedClient(prev => ({
      ...prev,
      salesRecords: prev.salesRecords.map(r => r.id === id ? { ...r, [field]: value } : r)
    }));
  };

  const removeSalesRecord = (id: string) => {
    setEditedClient(prev => ({
      ...prev,
      salesRecords: prev.salesRecords.filter(r => r.id !== id)
    }));
  };

  const calculateAmounts = (quantity: number, unitPrice: number, taxType: TaxType) => {
    const subtotal = quantity * unitPrice;
    let total = subtotal;
    if (taxType === '10％') {
      total = Math.floor(subtotal * 1.1);
    } else if (taxType === '軽8％') {
      total = Math.floor(subtotal * 1.08);
    }
    // 非課税 and 税込 use subtotal as is (for '税込', unitPrice is assumed inclusive, or handled as gross)
    // Here we assume '税込' input means the unitPrice IS already tax included, so total matches subtotal calculationwise for display,
    // or if the user wants to input base price and select '税込' to mean "Show me the gross", it depends.
    // Usually '税込' selector implies the calculated result is just the sum.
    // However, common logic:
    // TaxType affects how "Tax Included Total" is derived from "Amount (Quantity * Unit Price)".
    return { subtotal, total };
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden relative">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm z-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            {editedClient.name}
            <span className="text-sm font-normal text-gray-500 ml-2">({editedClient.nameKana})</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">ID: {editedClient.id} | {editedClient.currentStatus} {editedClient.facilityName ? `(${editedClient.facilityName})` : ''}</p>
        </div>
        <div className="flex gap-3">
          {isEditing ? (
            <>
              <button onClick={() => { setIsEditing(false); setEditedClient(client); }} className="px-4 py-2 rounded text-gray-600 hover:bg-gray-100">
                キャンセル
              </button>
              <button onClick={handleSave} className="px-4 py-2 rounded bg-primary-600 text-white hover:bg-primary-700 shadow-md">
                保存する
              </button>
            </>
          ) : (
             <button onClick={() => setIsEditing(true)} className="px-4 py-2 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                編集モード
             </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-6 overflow-x-auto">
        {[
          { id: 'info', label: '基本情報・住所' },
          { id: 'medical', label: '病歴・状態' },
          { id: 'meetings', label: '議事録一覧' },
          { id: 'changes', label: '利用者新規・変更情報入力' },
          { id: 'equipment', label: '福祉用具選定' },
          { id: 'sales', label: '売上管理（自費・販売）' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8 pb-10">
          
          {/* --- Basic Info Tab --- */}
          {activeTab === 'info' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in-up">
              <h3 className="text-lg font-bold text-gray-800 border-l-4 border-primary-500 pl-3 mb-6">基本情報</h3>
              
              <div className="space-y-6">
                
                {/* あおぞらID */}
                <div>
                   <label className="block text-sm font-medium text-gray-500 mb-1">あおぞらID</label>
                   <input
                     disabled={!isEditing}
                     value={editedClient.aozoraId}
                     onChange={(e) => handleChange('aozoraId', e.target.value)}
                     className="w-full md:w-1/3 p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                     placeholder="AZ-xxxx"
                   />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 氏名・フリガナ */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">氏名</label>
                    <input
                      disabled={!isEditing}
                      value={editedClient.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">フリガナ</label>
                    <input
                      disabled={!isEditing}
                      value={editedClient.nameKana}
                      onChange={(e) => handleChange('nameKana', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>

                  {/* 生年月日・性別 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">生年月日</label>
                    <input
                      type="date"
                      disabled={!isEditing}
                      value={editedClient.birthDate}
                      onChange={(e) => handleChange('birthDate', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">性別</label>
                    <select
                      disabled={!isEditing}
                      value={editedClient.gender}
                      onChange={(e) => handleChange('gender', e.target.value as Gender)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                      <option value="男性">男性</option>
                      <option value="女性">女性</option>
                    </select>
                  </div>

                  {/* 入居施設名・居室番号 */}
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">入居施設名</label>
                        <input
                            disabled={!isEditing}
                            value={editedClient.facilityName}
                            onChange={(e) => handleChange('facilityName', e.target.value)}
                            placeholder="施設に入居している場合に入力"
                            className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">居室番号</label>
                        <input
                            disabled={!isEditing}
                            value={editedClient.roomNumber}
                            onChange={(e) => handleChange('roomNumber', e.target.value)}
                            placeholder="例: 101"
                            className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                     </div>
                  </div>

                  {/* 現在の状況 */}
                  <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">現在の状況</label>
                      <select
                          disabled={!isEditing}
                          value={editedClient.currentStatus}
                          onChange={(e) => handleChange('currentStatus', e.target.value as CurrentStatus)}
                          className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                      >
                          <option value="入院中">入院中</option>
                          <option value="在宅">在宅</option>
                          <option value="施設入居中">施設入居中</option>
                      </select>
                  </div>
                  
                  {/* 住所 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">住所</label>
                    <input
                      disabled={!isEditing}
                      value={editedClient.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>
                </div>

                {/* 介護保険情報グループ */}
                <div className="border-t-2 border-primary-100 pt-6 mt-4">
                  <h4 className="font-bold text-primary-700 mb-4 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                    </svg>
                    介護保険情報
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-primary-50 p-4 rounded-xl">
                      {/* 要介護度 */}
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">要介護度</label>
                        <select
                          disabled={!isEditing}
                          value={editedClient.careLevel}
                          onChange={(e) => handleChange('careLevel', e.target.value as CareLevel)}
                          className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        >
                          <option value="申請中">申請中</option>
                          <option value="要支援1">要支援1</option>
                          <option value="要支援2">要支援2</option>
                          <option value="要介護1">要介護1</option>
                          <option value="要介護2">要介護2</option>
                          <option value="要介護3">要介護3</option>
                          <option value="要介護4">要介護4</option>
                          <option value="要介護5">要介護5</option>
                        </select>
                      </div>

                      {/* 負担割合 */}
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">負担割合</label>
                          <select
                              disabled={!isEditing}
                              value={editedClient.copayRate}
                              onChange={(e) => handleChange('copayRate', e.target.value as CopayRate)}
                              className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                          >
                              <option value="1割">1割</option>
                              <option value="2割">2割</option>
                              <option value="3割">3割</option>
                          </select>
                      </div>

                      {/* 介護保険被保険者証 */}
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">介護保険被保険者証</label>
                          <select
                              disabled={!isEditing}
                              value={editedClient.insuranceCardStatus}
                              onChange={(e) => handleChange('insuranceCardStatus', e.target.value as ConfirmationStatus)}
                              className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                          >
                              <option value="確認済">確認済</option>
                              <option value="未確認">未確認</option>
                          </select>
                      </div>

                      {/* 介護保険負担割合証 */}
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">介護保険負担割合証</label>
                          <select
                              disabled={!isEditing}
                              value={editedClient.burdenProportionCertificateStatus}
                              onChange={(e) => handleChange('burdenProportionCertificateStatus', e.target.value as ConfirmationStatus)}
                              className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                          >
                              <option value="確認済">確認済</option>
                              <option value="未確認">未確認</option>
                          </select>
                      </div>
                  </div>
                </div>

                {/* 支払い区分 */}
                <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">支払い区分</label>
                    <select
                        disabled={!isEditing}
                        value={editedClient.paymentType}
                        onChange={(e) => handleChange('paymentType', e.target.value as PaymentType)}
                        className="w-full md:w-1/2 p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                        <option value="非生保">非生保</option>
                        <option value="生保">生保</option>
                    </select>
                </div>

              </div>

              {/* キーパーソン情報 */}
              <h3 className="text-lg font-bold text-gray-800 border-l-4 border-accent-500 pl-3 mt-8 mb-6">キーパーソン</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                 <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">氏名</label>
                    <input
                        disabled={!isEditing}
                        value={editedClient.keyPerson.name}
                        onChange={(e) => handleKeyPersonChange('name', e.target.value)}
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-accent-500 outline-none"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">続柄</label>
                    <input
                        disabled={!isEditing}
                        value={editedClient.keyPerson.relationship}
                        onChange={(e) => handleKeyPersonChange('relationship', e.target.value)}
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-accent-500 outline-none"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">連絡先</label>
                    <input
                        disabled={!isEditing}
                        value={editedClient.keyPerson.contact}
                        onChange={(e) => handleKeyPersonChange('contact', e.target.value)}
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-accent-500 outline-none"
                    />
                 </div>
              </div>

              <div className="border-t border-gray-200 my-6"></div>

              {/* カイポケ登録（基本情報） */}
              <div className="flex items-center gap-4 bg-gray-100 p-4 rounded-lg">
                   <label className="block text-sm font-bold text-gray-700 whitespace-nowrap">カイポケ登録（基本情報）</label>
                   <select
                        disabled={!isEditing}
                        value={editedClient.kaipokeRegistrationStatus}
                        onChange={(e) => handleChange('kaipokeRegistrationStatus', e.target.value as RegistrationStatus)}
                        className={`p-2 border rounded font-bold outline-none ${
                            editedClient.kaipokeRegistrationStatus === '登録済' 
                            ? 'bg-green-100 text-green-700 border-green-300' 
                            : 'bg-white text-gray-600 border-gray-300'
                        }`}
                   >
                        <option value="未登録">未登録</option>
                        <option value="登録済">登録済</option>
                   </select>
              </div>

            </div>
          )}

          {/* --- Medical History Tab --- */}
          {activeTab === 'medical' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in-up">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-gray-800 border-l-4 border-red-500 pl-3">病歴・身体状況</h3>
                <button
                    onClick={handleSuggestEquipment}
                    disabled={isSuggesting}
                    className="text-sm bg-purple-50 text-purple-700 px-3 py-1 rounded-full border border-purple-200 hover:bg-purple-100 flex items-center gap-1"
                >
                    {isSuggesting ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-purple-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          AI分析中...
                        </>
                    ) : (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                             <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813a3.75 3.75 0 0 0 2.576-2.576l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5Z" clipRule="evenodd" />
                           </svg>
                           病歴から用具を提案
                        </>
                    )}
                </button>
              </div>
              
              <textarea
                disabled={!isEditing}
                value={editedClient.medicalHistory}
                onChange={(e) => handleChange('medicalHistory', e.target.value)}
                rows={8}
                placeholder="病名、麻痺の有無、現在の身体状況、ADL（日常生活動作）の状態などを詳しく記載してください。"
                className="w-full p-4 border rounded-lg border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-red-200 outline-none leading-relaxed"
              />

              {suggestionResult && (
                  <div className="mt-6 bg-purple-50 border border-purple-100 rounded-lg p-4">
                      <h4 className="font-bold text-purple-800 mb-2 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                        </svg>
                        AIによる提案
                      </h4>
                      <div className="text-sm text-purple-800 whitespace-pre-wrap leading-relaxed">
                          {suggestionResult}
                      </div>
                  </div>
              )}

              {/* --- Planned Equipment (Moved here) --- */}
              <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-gray-800 border-l-4 border-yellow-400 pl-3">選定予定の福祉用具</h3>
                  {isEditing && (
                    <button onClick={() => handleAddEquipment('planned')} className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-gray-700">＋ 追加</button>
                  )}
                </div>
                {editedClient.plannedEquipment.length === 0 ? (
                    <p className="text-gray-400 text-sm">登録なし</p>
                ) : (
                    <div className="space-y-3">
                        {editedClient.plannedEquipment.map(eq => (
                            <div key={eq.id} className="flex gap-2 items-start border-b border-gray-100 pb-2">
                                <input
                                    disabled={!isEditing}
                                    placeholder="品名"
                                    value={eq.name}
                                    onChange={(e) => updateEquipment('planned', eq.id, 'name', e.target.value)}
                                    className="flex-1 border p-1 rounded text-sm disabled:bg-transparent disabled:border-none"
                                />
                                <input
                                    disabled={!isEditing}
                                    placeholder="種目/カテゴリー"
                                    value={eq.category}
                                    onChange={(e) => updateEquipment('planned', eq.id, 'category', e.target.value)}
                                    className="w-1/3 border p-1 rounded text-sm disabled:bg-transparent disabled:border-none"
                                />
                                {isEditing && (
                                    <button onClick={() => removeEquipment('planned', eq.id)} className="text-red-500 hover:text-red-700">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
              </div>
            </div>
          )}

          {/* --- Meetings Tab --- */}
          {activeTab === 'meetings' && (
            <div className="space-y-6 animate-fade-in-up">
              <div className="flex gap-4 justify-end">
                <button
                  onClick={handleAddMeeting}
                  className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
                >
                  ＋ 記録を追加
                </button>
              </div>

              {editedClient.meetings.length === 0 && (
                <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                  議事録はまだありません
                </div>
              )}

              {editedClient.meetings.map((meeting) => (
                <div key={meeting.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  {/* Meeting Header */}
                  <div className={`p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${meeting.type === 'その他' ? 'bg-orange-50' : 'bg-primary-50'}`}>
                     <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto flex-1">
                        {/* 事業所選択 */}
                         <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-gray-500 whitespace-nowrap">事業所</label>
                            <select
                                disabled={!isEditing}
                                value={meeting.office}
                                onChange={(e) => updateMeeting(meeting.id, 'office', e.target.value as OfficeLocation)}
                                className="text-xs font-bold rounded px-2 py-1 bg-white border border-gray-300 text-gray-700 focus:ring-2 focus:ring-primary-500 outline-none"
                            >
                                <option value="鹿児島">鹿児島</option>
                                <option value="福岡">福岡</option>
                            </select>
                         </div>

                         {/* 議事録入力 (タイプ) */}
                         <div className="flex items-center gap-2 flex-1">
                             <select
                                disabled={!isEditing}
                                value={meeting.type}
                                onChange={(e) => updateMeeting(meeting.id, 'type', e.target.value as MeetingType)}
                                className="text-xs font-bold rounded px-2 py-1 bg-white border border-gray-300 text-gray-700 focus:ring-2 focus:ring-primary-500 outline-none flex-1 md:flex-none"
                            >
                                <option value="カンファレンス時">カンファレンス時</option>
                                <option value="担当者会議（新規）">担当者会議（新規）</option>
                                <option value="担当者会議（更新）">担当者会議（更新）</option>
                                <option value="担当者会議（退院時）">担当者会議（退院時）</option>
                                <option value="その他">その他</option>
                            </select>
                            <input
                                type="date"
                                disabled={!isEditing}
                                value={meeting.date}
                                onChange={(e) => updateMeeting(meeting.id, 'date', e.target.value)}
                                className="bg-transparent font-bold text-gray-700 outline-none text-sm"
                            />
                         </div>
                     </div>
                     <span className="text-xs text-gray-400 self-end md:self-center">ID: {meeting.id}</span>
                  </div>

                  <div className="p-6 space-y-4">
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">記録者</label>
                            <input
                                disabled={!isEditing}
                                value={meeting.recorder}
                                placeholder="記録者名"
                                onChange={(e) => updateMeeting(meeting.id, 'recorder', e.target.value)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">施設名</label>
                            <input
                                disabled={!isEditing}
                                value={meeting.place}
                                placeholder="実施場所など"
                                onChange={(e) => updateMeeting(meeting.id, 'place', e.target.value)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            />
                         </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">居宅介護支援事業所</label>
                            <input
                                disabled={!isEditing}
                                value={meeting.careSupportOffice}
                                placeholder="事業所名"
                                onChange={(e) => updateMeeting(meeting.id, 'careSupportOffice', e.target.value)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">担当CM</label>
                            <input
                                disabled={!isEditing}
                                value={meeting.careManager}
                                placeholder="ケアマネジャー名"
                                onChange={(e) => updateMeeting(meeting.id, 'careManager', e.target.value)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            />
                         </div>
                     </div>

                    {/* 病院名・担当SW (新規追加) */}
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">病院名</label>
                            <input
                                disabled={!isEditing}
                                value={meeting.hospital}
                                placeholder="病院名"
                                onChange={(e) => updateMeeting(meeting.id, 'hospital', e.target.value)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">担当SW</label>
                            <input
                                disabled={!isEditing}
                                value={meeting.socialWorker}
                                placeholder="ソーシャルワーカー名"
                                onChange={(e) => updateMeeting(meeting.id, 'socialWorker', e.target.value)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            />
                         </div>
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">出席者</label>
                        <input
                            disabled={!isEditing}
                            value={meeting.attendees}
                            placeholder="参加者を入力..."
                            onChange={(e) => updateMeeting(meeting.id, 'attendees', e.target.value)}
                            className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                        />
                     </div>

                     {/* Radio Buttons for Usage Category */}
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">利用区分</label>
                        <div className="flex gap-4">
                            {(['介護保険レンタル', '自費レンタル', '購入'] as UsageCategory[]).map((cat) => (
                                <label key={cat} className="flex items-center gap-1 text-sm cursor-pointer">
                                    <input
                                        type="radio"
                                        name={`usageCategory-${meeting.id}`}
                                        value={cat}
                                        checked={meeting.usageCategory === cat}
                                        onChange={(e) => updateMeeting(meeting.id, 'usageCategory', e.target.value)}
                                        disabled={!isEditing}
                                        className="text-primary-600 focus:ring-primary-500"
                                    />
                                    {cat}
                                </label>
                            ))}
                        </div>
                     </div>

                     {/* Dropdowns for Care Plan and Service Ticket */}
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">ケアプラン</label>
                            <select
                                disabled={!isEditing}
                                value={meeting.carePlanStatus}
                                onChange={(e) => updateMeeting(meeting.id, 'carePlanStatus', e.target.value as ConfirmationStatus)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            >
                                <option value="確認済">確認済</option>
                                <option value="未確認">未確認</option>
                            </select>
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">提供票</label>
                            <select
                                disabled={!isEditing}
                                value={meeting.serviceTicketStatus}
                                onChange={(e) => updateMeeting(meeting.id, 'serviceTicketStatus', e.target.value as ConfirmationStatus)}
                                className="w-full border p-2 rounded text-sm border-gray-300 focus:border-primary-500 outline-none"
                            >
                                <option value="確認済">確認済</option>
                                <option value="未確認">未確認</option>
                            </select>
                         </div>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pt-4 border-t border-gray-100">
                        {/* Left: Raw Content */}
                        <div className="flex flex-col h-full">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 flex justify-between">
                                <span>議事録内容</span>
                                {isEditing && (
                                    <span className="text-xs font-normal text-primary-600">※ここに要点を入力</span>
                                )}
                            </label>
                            <textarea
                                disabled={!isEditing}
                                value={meeting.content}
                                onChange={(e) => updateMeeting(meeting.id, 'content', e.target.value)}
                                placeholder="・現状の課題...&#13;&#10;・家族の要望...&#13;&#10;・決定事項..."
                                className="w-full h-64 p-3 border rounded-lg border-gray-300 focus:ring-2 focus:ring-primary-200 outline-none resize-none text-sm leading-relaxed mb-2"
                            />
                            
                            {/* リマインダー (新規追加) */}
                            <div className="flex items-center gap-4 bg-yellow-50 p-2 rounded border border-yellow-100">
                                <label className="text-xs font-bold text-gray-600">リマインダー</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            name={`reminder-${meeting.id}`}
                                            value="あり"
                                            checked={meeting.reminder === 'あり'}
                                            onChange={(e) => updateMeeting(meeting.id, 'reminder', e.target.value)}
                                            disabled={!isEditing}
                                            className="text-primary-600 focus:ring-primary-500"
                                        />
                                        あり
                                    </label>
                                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            name={`reminder-${meeting.id}`}
                                            value="なし"
                                            checked={meeting.reminder === 'なし'}
                                            onChange={(e) => updateMeeting(meeting.id, 'reminder', e.target.value)}
                                            disabled={!isEditing}
                                            className="text-primary-600 focus:ring-primary-500"
                                        />
                                        なし
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Right: AI Summary */}
                        <div className="flex flex-col h-full bg-gray-50 rounded-lg p-4 border border-gray-100">
                             <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-purple-500">
                                      <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813a3.75 3.75 0 0 0 2.576-2.576l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5Z" clipRule="evenodd" />
                                    </svg>
                                    AI 生成サマリー
                                </label>
                                <button
                                    onClick={() => handleGenerateSummary(meeting)}
                                    disabled={isGeneratingSummary === meeting.id}
                                    className="text-xs bg-white border border-gray-300 px-2 py-1 rounded shadow-sm hover:bg-gray-50 text-gray-700 disabled:opacity-50"
                                >
                                    {isGeneratingSummary === meeting.id ? '生成中...' : 'AI作成/更新'}
                                </button>
                             </div>
                             <textarea
                                disabled={!isEditing}
                                value={meeting.summary}
                                onChange={(e) => updateMeeting(meeting.id, 'summary', e.target.value)}
                                placeholder="左側の内容からAIが正式な議事録を生成します。"
                                className="flex-1 w-full p-2 bg-white border border-gray-200 rounded text-sm leading-relaxed resize-none focus:ring-2 focus:ring-purple-200 outline-none"
                             />
                        </div>
                     </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* --- Changes Tab (New) --- */}
          {activeTab === 'changes' && (
              <div className="space-y-6 animate-fade-in-up">
                  <div className="flex gap-4 justify-end">
                      <button
                          onClick={handleAddChangeRecord}
                          className="bg-accent-500 text-white hover:bg-accent-600 px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
                      >
                          ＋ 情報を追加
                      </button>
                  </div>

                  {editedClient.changeRecords.length === 0 && (
                      <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                          変更情報はまだありません
                      </div>
                  )}

                  {editedClient.changeRecords.map((record) => (
                      <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                          <div className="p-4 bg-gray-50 flex justify-between items-center">
                               <div className="flex items-center gap-4">
                                   <div className="flex items-center gap-2">
                                       <label className="text-xs font-bold text-gray-500 whitespace-nowrap">事業所</label>
                                       <select
                                           disabled={!isEditing}
                                           value={record.office}
                                           onChange={(e) => updateChangeRecord(record.id, 'office', e.target.value as OfficeLocation)}
                                           className="text-xs font-bold rounded px-2 py-1 bg-white border border-gray-300 text-gray-700 focus:ring-2 focus:ring-accent-500 outline-none"
                                       >
                                           <option value="鹿児島">鹿児島</option>
                                           <option value="福岡">福岡</option>
                                       </select>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <label className="text-xs font-bold text-gray-500 whitespace-nowrap">情報の種類</label>
                                       <select
                                            disabled={!isEditing}
                                            value={record.infoType}
                                            onChange={(e) => updateChangeRecord(record.id, 'infoType', e.target.value as ChangeInfoType)}
                                            className="text-xs font-bold rounded px-2 py-1 bg-white border border-gray-300 text-gray-700 focus:ring-2 focus:ring-accent-500 outline-none"
                                       >
                                           <option value="新規">新規</option>
                                           <option value="入院（サービス停止）">入院（サービス停止）</option>
                                           <option value="退院（サービス開始）">退院（サービス開始）</option>
                                           <option value="解約">解約</option>
                                           <option value="変更あり">変更あり</option>
                                           <option value="その他">その他</option>
                                       </select>
                                   </div>
                               </div>
                               <span className="text-xs text-gray-400">ID: {record.id}</span>
                          </div>

                          <div className="p-6 space-y-4">
                               <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">記録者</label>
                                  <input
                                      disabled={!isEditing}
                                      value={record.recorder}
                                      placeholder="記録者名"
                                      onChange={(e) => updateChangeRecord(record.id, 'recorder', e.target.value)}
                                      className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none"
                                  />
                               </div>

                               <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">利用区分</label>
                                  <div className="flex gap-4">
                                      {(['介護保険レンタル', '自費レンタル', '購入'] as UsageCategory[]).map((cat) => (
                                          <label key={cat} className="flex items-center gap-1 text-sm cursor-pointer">
                                              <input
                                                  type="radio"
                                                  name={`change-usageCategory-${record.id}`}
                                                  value={cat}
                                                  checked={record.usageCategory === cat}
                                                  onChange={(e) => updateChangeRecord(record.id, 'usageCategory', e.target.value)}
                                                  disabled={!isEditing}
                                                  className="text-accent-500 focus:ring-accent-500"
                                              />
                                              {cat}
                                          </label>
                                      ))}
                                  </div>
                               </div>

                               {/* Dates */}
                               <div className="space-y-4">
                                   {/* Group 1 */}
                                   <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                       <h4 className="text-sm font-bold text-blue-800 mb-3 flex items-center gap-2">
                                           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                           新規・解約
                                       </h4>
                                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                           <div>
                                               <label className="block text-xs font-bold text-gray-600 mb-1">新規（請求開始日）</label>
                                               <input type="date" disabled={!isEditing} value={record.billingStartDateNew} onChange={(e) => updateChangeRecord(record.id, 'billingStartDateNew', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                           </div>
                                           <div>
                                               <label className="block text-xs font-bold text-gray-600 mb-1">解約（請求停止日）</label>
                                               <input type="date" disabled={!isEditing} value={record.billingStopDateCancel} onChange={(e) => updateChangeRecord(record.id, 'billingStopDateCancel', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                           </div>
                                       </div>
                                   </div>
                                   {/* Group 2 */}
                                   <div className="bg-red-50 p-4 rounded-lg border border-red-100">
                                       <h4 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">
                                           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z" /></svg>
                                           入院・サービス停止
                                       </h4>
                                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                           <div>
                                               <label className="block text-xs font-bold text-gray-600 mb-1">入院（請求停止日）</label>
                                               <input type="date" disabled={!isEditing} value={record.billingStopDateHospital} onChange={(e) => updateChangeRecord(record.id, 'billingStopDateHospital', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                           </div>
                                           <div>
                                               <label className="block text-xs font-bold text-gray-600 mb-1">卸会社への停止連絡</label>
                                               <select disabled={!isEditing} value={record.wholesalerStopContactStatus} onChange={(e) => updateChangeRecord(record.id, 'wholesalerStopContactStatus', e.target.value as ContactStatus)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                  <option value="未対応">未対応</option>
                                                  <option value="対応済">対応済</option>
                                              </select>
                                           </div>
                                       </div>
                                   </div>
                                   {/* Group 3 */}
                                   <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                                       <h4 className="text-sm font-bold text-green-800 mb-3 flex items-center gap-2">
                                           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
                                           退院・サービス再開
                                       </h4>
                                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                           <div>
                                               <label className="block text-xs font-bold text-gray-600 mb-1">退院（請求開始日）</label>
                                               <input type="date" disabled={!isEditing} value={record.billingStartDateDischarge} onChange={(e) => updateChangeRecord(record.id, 'billingStartDateDischarge', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                           </div>
                                           <div>
                                               <label className="block text-xs font-bold text-gray-600 mb-1">卸会社への再開連絡</label>
                                               <select disabled={!isEditing} value={record.wholesalerResumeContactStatus} onChange={(e) => updateChangeRecord(record.id, 'wholesalerResumeContactStatus', e.target.value as ContactStatus)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                  <option value="未対応">未対応</option>
                                                  <option value="対応済">対応済</option>
                                              </select>
                                           </div>
                                       </div>
                                   </div>
                               </div>

                               <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">特記</label>
                                  <textarea
                                      disabled={!isEditing}
                                      value={record.note}
                                      onChange={(e) => updateChangeRecord(record.id, 'note', e.target.value)}
                                      placeholder="備考など..."
                                      className="w-full h-24 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none"
                                  />
                               </div>
                          </div>
                      </div>
                  ))}
              </div>
          )}

          {/* --- Equipment Tab (Detailed) --- */}
          {activeTab === 'equipment' && (
            <div className="space-y-6 animate-fade-in-up">
              <div className="flex gap-4 justify-end">
                <button
                    onClick={() => handleAddEquipment('selected')}
                    className="bg-green-600 text-white hover:bg-green-700 px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
                >
                    ＋ 機器を追加
                </button>
              </div>

              {editedClient.selectedEquipment.length === 0 && (
                <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                  福祉用具は登録されていません
                </div>
              )}

              {editedClient.selectedEquipment.map((eq) => (
                  <div key={eq.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                      <div className="p-4 bg-green-50 border-b border-green-100 flex justify-between items-center">
                          <h4 className="font-bold text-green-800 flex items-center gap-2">
                             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
                             {eq.name || '新規福祉用具'}
                          </h4>
                          {isEditing && (
                              <button onClick={() => removeEquipment('selected', eq.id)} className="text-red-500 hover:text-red-700 p-1">
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                              </button>
                          )}
                      </div>
                      
                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                           {/* Group 1: Office, Recorder, Attribute */}
                           <div className="col-span-1 md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">事業所選択</label>
                                   <select
                                       disabled={!isEditing}
                                       value={eq.office}
                                       onChange={(e) => updateEquipment('selected', eq.id, 'office', e.target.value)}
                                       className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   >
                                       <option value="鹿児島">鹿児島</option>
                                       <option value="福岡">福岡</option>
                                   </select>
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">記録者</label>
                                   <input
                                      disabled={!isEditing}
                                      value={eq.recorder}
                                      onChange={(e) => updateEquipment('selected', eq.id, 'recorder', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">属性</label>
                                   <select
                                       disabled={!isEditing}
                                       value={eq.propertyAttribute}
                                       onChange={(e) => updateEquipment('selected', eq.id, 'propertyAttribute', e.target.value)}
                                       className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   >
                                       <option value="リース物件">リース物件</option>
                                       <option value="自社物件">自社物件</option>
                                   </select>
                               </div>
                           </div>

                           {/* Group 2: Internal & Cost */}
                           <div className="col-span-1 md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">自社：商品区分</label>
                                   <input
                                      disabled={!isEditing}
                                      value={eq.ownProductCategory}
                                      onChange={(e) => updateEquipment('selected', eq.id, 'ownProductCategory', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">自社：商品ID</label>
                                   <input
                                      disabled={!isEditing}
                                      value={eq.ownProductId}
                                      onChange={(e) => updateEquipment('selected', eq.id, 'ownProductId', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">請求金額</label>
                                   <div className="flex items-center gap-2">
                                       <input
                                          type="number"
                                          disabled={!isEditing}
                                          value={eq.monthlyCost || ''}
                                          onChange={(e) => updateEquipment('selected', eq.id, 'monthlyCost', parseInt(e.target.value))}
                                          className="flex-1 border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                       />
                                       <span className="text-xs text-gray-500">円</span>
                                   </div>
                               </div>
                           </div>

                           {/* Group 3: Product Specs */}
                           <div className="col-span-1 md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">商品コード（タイスコード）</label>
                                   <input
                                      disabled={!isEditing}
                                      value={eq.taisCode}
                                      onChange={(e) => updateEquipment('selected', eq.id, 'taisCode', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">福祉用具の種類</label>
                                   <select
                                       disabled={!isEditing}
                                       value={eq.category}
                                       onChange={(e) => updateEquipment('selected', eq.id, 'category', e.target.value)}
                                       className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   >
                                       {EQUIPMENT_TYPES.map(type => (
                                           <option key={type} value={type}>{type}</option>
                                       ))}
                                   </select>
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">メーカー</label>
                                   <select
                                       disabled={!isEditing}
                                       value={eq.manufacturer}
                                       onChange={(e) => updateEquipment('selected', eq.id, 'manufacturer', e.target.value)}
                                       className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   >
                                       <option value="">選択してください</option>
                                       <option value="パラマウントベッド">パラマウントベッド</option>
                                       <option value="パナソニック">パナソニック</option>
                                       <option value="シーホネンス">シーホネンス</option>
                                       <option value="モルテン">モルテン</option>
                                       <option value="その他">その他</option>
                                   </select>
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">卸会社</label>
                                   <select
                                       disabled={!isEditing}
                                       value={eq.wholesaler}
                                       onChange={(e) => updateEquipment('selected', eq.id, 'wholesaler', e.target.value)}
                                       className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   >
                                       <option value="">選択してください</option>
                                       <option value="卸会社A">卸会社A</option>
                                       <option value="卸会社B">卸会社B</option>
                                       <option value="その他">その他</option>
                                   </select>
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">商品名</label>
                                   <input
                                      disabled={!isEditing}
                                      value={eq.name}
                                      placeholder="商品名を入力"
                                      onChange={(e) => updateEquipment('selected', eq.id, 'name', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   />
                               </div>
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">単位数</label>
                                   <input
                                      type="number"
                                      disabled={!isEditing}
                                      value={eq.units}
                                      onChange={(e) => updateEquipment('selected', eq.id, 'units', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                   />
                               </div>
                           </div>

                           {/* Group 4: Status & Dates */}
                           <div className="col-span-1 md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100">
                               <div className="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
                                       <select
                                           disabled={!isEditing}
                                           value={eq.status}
                                           onChange={(e) => updateEquipment('selected', eq.id, 'status', e.target.value)}
                                           className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                       >
                                           <option value="介護保険貸与">介護保険貸与</option>
                                           <option value="自費利用">自費利用</option>
                                           <option value="販売">販売</option>
                                       </select>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">カイポケ登録</label>
                                       <select
                                           disabled={!isEditing}
                                           value={eq.kaipokeStatus}
                                           onChange={(e) => updateEquipment('selected', eq.id, 'kaipokeStatus', e.target.value)}
                                           className="w-full border p-2 rounded text-sm bg-white focus:border-green-500 outline-none"
                                       >
                                           <option value="未登録">未登録</option>
                                           <option value="登録済">登録済</option>
                                       </select>
                                   </div>
                               </div>

                               <div className="lg:col-span-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-2">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">受注日</label>
                                       <input type="date" disabled={!isEditing} value={eq.orderReceivedDate} onChange={(e) => updateEquipment('selected', eq.id, 'orderReceivedDate', e.target.value)} className="w-full border p-1 rounded text-xs bg-white focus:border-green-500 outline-none"/>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">発注日</label>
                                       <input type="date" disabled={!isEditing} value={eq.orderPlacedDate} onChange={(e) => updateEquipment('selected', eq.id, 'orderPlacedDate', e.target.value)} className="w-full border p-1 rounded text-xs bg-white focus:border-green-500 outline-none"/>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">購入日</label>
                                       <input type="date" disabled={!isEditing} value={eq.purchaseDate} onChange={(e) => updateEquipment('selected', eq.id, 'purchaseDate', e.target.value)} className="w-full border p-1 rounded text-xs bg-white focus:border-green-500 outline-none"/>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">納品日</label>
                                       <input type="date" disabled={!isEditing} value={eq.deliveryDate} onChange={(e) => updateEquipment('selected', eq.id, 'deliveryDate', e.target.value)} className="w-full border p-1 rounded text-xs bg-white focus:border-green-500 outline-none"/>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">利用開始日</label>
                                       <input type="date" disabled={!isEditing} value={eq.startDate} onChange={(e) => updateEquipment('selected', eq.id, 'startDate', e.target.value)} className="w-full border p-1 rounded text-xs bg-white focus:border-green-500 outline-none"/>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">利用終了日</label>
                                       <input type="date" disabled={!isEditing} value={eq.endDate} onChange={(e) => updateEquipment('selected', eq.id, 'endDate', e.target.value)} className="w-full border p-1 rounded text-xs bg-white focus:border-green-500 outline-none"/>
                                   </div>
                               </div>
                           </div>
                      </div>
                  </div>
              ))}
            </div>
          )}
          
          {/* --- Sales Management Tab --- */}
          {activeTab === 'sales' && (
            <div className="space-y-6 animate-fade-in-up">
              <div className="flex gap-4 justify-end">
                <button
                    onClick={handleAddSalesRecord}
                    className="bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
                >
                    ＋ 売上を追加
                </button>
              </div>

              {editedClient.salesRecords.length === 0 && (
                <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                  売上データはありません
                </div>
              )}

              {editedClient.salesRecords.map((record) => {
                  const { subtotal, total } = calculateAmounts(record.quantity, record.unitPrice, record.taxType);
                  
                  return (
                      <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                          <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                              <h4 className="font-bold text-indigo-800 flex items-center gap-2">
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>
                                 売上No: {record.id.slice(-4)}
                              </h4>
                              {isEditing && (
                                  <button onClick={() => removeSalesRecord(record.id)} className="text-red-500 hover:text-red-700 p-1">
                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                  </button>
                              )}
                          </div>

                          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                              {/* Basic Sales Info */}
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
                                  <select
                                      disabled={!isEditing}
                                      value={record.status}
                                      onChange={(e) => updateSalesRecord(record.id, 'status', e.target.value as SalesStatus)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                  >
                                      <option value="自費レンタル">自費レンタル</option>
                                      <option value="販売">販売</option>
                                  </select>
                              </div>
                              <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">あおぞらID</label>
                                   <input
                                      disabled={!isEditing}
                                      value={record.aozoraId}
                                      onChange={(e) => updateSalesRecord(record.id, 'aozoraId', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                   />
                              </div>
                              <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">氏名</label>
                                   <input
                                      disabled={!isEditing}
                                      value={record.clientName}
                                      onChange={(e) => updateSalesRecord(record.id, 'clientName', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                   />
                              </div>
                              <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">入居施設名</label>
                                   <input
                                      disabled={!isEditing}
                                      value={record.facilityName}
                                      onChange={(e) => updateSalesRecord(record.id, 'facilityName', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                   />
                              </div>

                              {/* Product Info */}
                              <div className="md:col-span-2">
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">商品名（請求費目）</label>
                                  <input
                                      disabled={!isEditing}
                                      value={record.productName}
                                      onChange={(e) => updateSalesRecord(record.id, 'productName', e.target.value)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                      placeholder="商品名を入力"
                                  />
                              </div>

                              {/* Calculation Area */}
                              <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">数量</label>
                                       <input
                                          type="number"
                                          disabled={!isEditing}
                                          value={record.quantity}
                                          onChange={(e) => updateSalesRecord(record.id, 'quantity', parseInt(e.target.value) || 0)}
                                          className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none text-right"
                                       />
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">単価</label>
                                       <div className="flex items-center gap-1">
                                           <input
                                              type="number"
                                              disabled={!isEditing}
                                              value={record.unitPrice}
                                              onChange={(e) => updateSalesRecord(record.id, 'unitPrice', parseInt(e.target.value) || 0)}
                                              className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none text-right"
                                           />
                                           <span className="text-xs text-gray-500">円</span>
                                       </div>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">請求額（小計）</label>
                                       <div className="w-full border p-2 rounded text-sm bg-gray-100 text-gray-700 text-right font-medium">
                                           {subtotal.toLocaleString()} 円
                                       </div>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 mb-1">税区分</label>
                                       <select
                                            disabled={!isEditing}
                                            value={record.taxType}
                                            onChange={(e) => updateSalesRecord(record.id, 'taxType', e.target.value as TaxType)}
                                            className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                       >
                                           <option value="非課税">非課税</option>
                                           <option value="10％">10％</option>
                                           <option value="軽8％">軽8％</option>
                                           <option value="税込">税込</option>
                                       </select>
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-indigo-700 mb-1">税込み請求額</label>
                                       <div className="w-full border border-indigo-200 p-2 rounded text-sm bg-indigo-50 text-indigo-800 text-right font-bold">
                                           {total.toLocaleString()} 円
                                       </div>
                                   </div>
                              </div>
                          </div>
                      </div>
                  );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientDetail;