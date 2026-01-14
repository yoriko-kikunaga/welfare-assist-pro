
import React, { useState, useEffect } from 'react';
import { Client, MeetingRecord, MeetingType, Equipment, CurrentStatus, PaymentType, Gender, CareLevel, CopayRate, UsageCategory, ConfirmationStatus, RegistrationStatus, OfficeLocation, ReminderStatus, ClientChangeRecord, ChangeInfoType, ContactStatus, PropertyAttribute, EquipmentStatus, RegistrationState, EquipmentType, SalesRecord, TaxType, TransactionType, UserBurdenType, PaymentMethod } from '../types';
import { generateMeetingSummary, suggestEquipment } from '../services/geminiService';

interface ClientDetailProps {
  client: Client;
  onUpdateClient: (updatedClient: Client) => void;
}

const EQUIPMENT_TYPES: EquipmentType[] = [
  '車いす', '車いす付属品', '特殊寝台', '特殊寝台付属品', '床ずれ防止用具', '体位変換器', '歩行器', '徘徊感知器', '手すり', '歩行補助つえ', '移動用リフト', 'スロープ', 'その他'
];

interface EquipmentMasterItem {
  itemType: string;
  productName: string;
  productCode: string;
  manufacturer: string;
  monthlyUnits: string;
}

interface EquipmentMasterData {
  equipmentList: EquipmentMasterItem[];
  itemTypes: string[];
  manufacturers: string[];
}

const ClientDetail: React.FC<ClientDetailProps> = ({ client, onUpdateClient }) => {
  const [activeTab, setActiveTab] = useState<'info' | 'medical' | 'meetings' | 'changes' | 'equipment' | 'sales'>('info');
  const [isEditing, setIsEditing] = useState(false);
  const [editedClient, setEditedClient] = useState<Client>(client);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Equipment Master Data
  const [equipmentMaster, setEquipmentMaster] = useState<EquipmentMasterData | null>(null);

  // AI States
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<string | null>(null); // meeting ID
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<string | null>(null);

  // Equipment Type Selection Modal
  const [showEquipmentTypeModal, setShowEquipmentTypeModal] = useState(false);
  const [showSalesFormModal, setShowSalesFormModal] = useState(false);
  const [editingSalesEquipment, setEditingSalesEquipment] = useState<Equipment | null>(null);
  // Insurance Rental Form Modal
  const [showInsuranceRentalFormModal, setShowInsuranceRentalFormModal] = useState(false);
  const [editingInsuranceRentalEquipment, setEditingInsuranceRentalEquipment] = useState<Equipment | null>(null);
  // Self-Pay Rental Form Modal
  const [showSelfPayRentalFormModal, setShowSelfPayRentalFormModal] = useState(false);
  const [editingSelfPayRentalEquipment, setEditingSelfPayRentalEquipment] = useState<Equipment | null>(null);

  useEffect(() => {
    setEditedClient(client);
    setSuggestionResult(null);
    setSaveSuccess(false);
  }, [client]);

  // Load equipment master data
  useEffect(() => {
    const loadEquipmentMaster = async () => {
      try {
        const response = await fetch('/equipmentMaster.json');
        const data = await response.json();
        setEquipmentMaster(data);
        console.log(`✓ Loaded equipment master: ${data.equipmentList.length} items, ${data.itemTypes.length} types, ${data.manufacturers.length} manufacturers`);
      } catch (error) {
        console.error('Failed to load equipment master data:', error);
      }
    };
    loadEquipmentMaster();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onUpdateClient(editedClient);
      setSaveSuccess(true);
      setIsEditing(false);
      // Show success message for 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Save failed:', error);
      alert('保存に失敗しました。もう一度お試しください。');
    } finally {
      setIsSaving(false);
    }
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
      office: '鹿児島（ACG）',
      type: '担当者会議（新規）',
      recorder: '',
      place: '',
      attendees: '',
      careSupportOffice: editedClient.careSupportOffice,
      careManager: editedClient.careManager,
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
    // Auto-enable editing mode when updating meetings
    if (!isEditing) {
      setIsEditing(true);
    }
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
          office: '鹿児島（ACG）',
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
      // Auto-enable editing mode when updating change records
      if (!isEditing) {
        setIsEditing(true);
      }
  };

  // --- Equipment Handlers ---
  const handleAddEquipment = (type: 'planned' | 'selected', equipmentStatus?: EquipmentStatus) => {
    const status = equipmentStatus || '介護保険レンタル';
    const newEq: Equipment = {
        id: Date.now().toString(),
        name: '',
        category: '',
        office: editedClient.office || '鹿児島（ACG）',
        recorder: '',
        propertyAttribute: 'リース物件',
        ownProductCategory: '',
        ownProductId: '',
        taisCode: '',
        manufacturer: '',
        wholesaler: '',
        units: '',
        kaipokeStatus: '未登録',
        status: status,
        orderReceivedDate: '',
        orderPlacedDate: '',
        purchaseDate: '',
        deliveryDate: '',
        startDate: '',
        endDate: '',
        // 販売用フィールドの初期値
        ...(status === '販売' ? {
          quantity: 1,
          taxType: '非課税' as TaxType,
          applicationStatus: false,
        } : {})
    };
    if (type === 'planned') {
      setEditedClient(prev => ({ ...prev, plannedEquipment: [...prev.plannedEquipment, newEq] }));
    } else {
      setEditedClient(prev => ({ ...prev, selectedEquipment: [...prev.selectedEquipment, newEq] }));
    }
    setShowEquipmentTypeModal(false);

    // ステータスに応じた入力モーダルを表示
    if (status === '販売') {
      setEditingSalesEquipment(newEq);
      setShowSalesFormModal(true);
    } else if (status === '介護保険レンタル') {
      setEditingInsuranceRentalEquipment(newEq);
      setShowInsuranceRentalFormModal(true);
    } else if (status === '自費レンタル') {
      setEditingSelfPayRentalEquipment(newEq);
      setShowSelfPayRentalFormModal(true);
    }

    if (!isEditing) {
      setIsEditing(true);
    }
  };

  // 販売フォームを保存
  const handleSaveSalesEquipment = (equipment: Equipment) => {
    setEditedClient(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.map(eq =>
        eq.id === equipment.id ? equipment : eq
      )
    }));
    setShowSalesFormModal(false);
    setEditingSalesEquipment(null);
  };

  // 介護保険レンタルフォームを保存
  const handleSaveInsuranceRentalEquipment = (equipment: Equipment) => {
    setEditedClient(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.map(eq =>
        eq.id === equipment.id ? equipment : eq
      )
    }));
    setShowInsuranceRentalFormModal(false);
    setEditingInsuranceRentalEquipment(null);
  };

  // 自費レンタルフォームを保存
  const handleSaveSelfPayRentalEquipment = (equipment: Equipment) => {
    setEditedClient(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.map(eq =>
        eq.id === equipment.id ? equipment : eq
      )
    }));
    setShowSelfPayRentalFormModal(false);
    setEditingSelfPayRentalEquipment(null);
  };

  const updateEquipment = (type: 'planned' | 'selected', id: string, field: keyof Equipment, value: any) => {
    const listKey = type === 'planned' ? 'plannedEquipment' : 'selectedEquipment';

    // When category is changed, reset manufacturer and name
    if (field === 'category') {
      setEditedClient(prev => ({
        ...prev,
        [listKey]: prev[listKey].map((e: Equipment) =>
          e.id === id ? { ...e, category: value, manufacturer: '', name: '', taisCode: '', units: '' } : e
        )
      }));
    }
    // When manufacturer is changed, reset name
    else if (field === 'manufacturer') {
      setEditedClient(prev => ({
        ...prev,
        [listKey]: prev[listKey].map((e: Equipment) =>
          e.id === id ? { ...e, manufacturer: value, name: '', taisCode: '', units: '' } : e
        )
      }));
    }
    // When product name is selected, auto-fill other fields
    else if (field === 'name' && equipmentMaster) {
      const selectedProduct = equipmentMaster.equipmentList.find(item => item.productName === value);
      if (selectedProduct) {
        setEditedClient(prev => ({
          ...prev,
          [listKey]: prev[listKey].map((e: Equipment) =>
            e.id === id ? {
              ...e,
              name: selectedProduct.productName,
              taisCode: selectedProduct.productCode,
              category: selectedProduct.itemType as EquipmentType,
              manufacturer: selectedProduct.manufacturer,
              units: selectedProduct.monthlyUnits
            } : e
          )
        }));
      } else {
        setEditedClient(prev => ({
          ...prev,
          [listKey]: prev[listKey].map((e: Equipment) => e.id === id ? { ...e, [field]: value } : e)
        }));
      }
    } else {
      setEditedClient(prev => ({
        ...prev,
        [listKey]: prev[listKey].map((e: Equipment) => e.id === id ? { ...e, [field]: value } : e)
      }));
    }

    // Auto-enable editing mode when updating equipment
    if (!isEditing) {
      setIsEditing(true);
    }
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
      office: '鹿児島（ACG）',
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
    // Auto-enable editing mode when updating sales records
    if (!isEditing) {
      setIsEditing(true);
    }
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
        <div className="flex gap-3 items-center">
          {saveSuccess && (
            <div className="flex items-center gap-2 text-green-600 font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              保存しました
            </div>
          )}
          {isEditing ? (
            <>
              <button
                onClick={() => { setIsEditing(false); setEditedClient(client); }}
                className="px-4 py-2 rounded text-gray-600 hover:bg-gray-100"
                disabled={isSaving}
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded bg-primary-600 text-white hover:bg-primary-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    保存中...
                  </>
                ) : (
                  '保存する'
                )}
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
          { id: 'info', label: '基本情報' },
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
                
                {/* あおぞらID・事業所 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">あおぞらID</label>
                    <input
                      disabled={!isEditing}
                      value={editedClient.aozoraId}
                      onChange={(e) => handleChange('aozoraId', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                      placeholder="AZ-xxxx"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">事業所</label>
                    <select
                      disabled={!isEditing}
                      value={editedClient.office}
                      onChange={(e) => handleChange('office', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                      <option value="鹿児島（ACG）">鹿児島（ACG）</option>
                      <option value="福岡（Lichi）">福岡（Lichi）</option>
                    </select>
                  </div>
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

                  {/* 福祉用具利用フラグ */}
                  <div className="flex items-center">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!isEditing}
                        checked={editedClient.isWelfareEquipmentUser}
                        onChange={(e) => handleChange('isWelfareEquipmentUser', e.target.checked)}
                        className="w-5 h-5 text-green-600 border-gray-300 rounded focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-700">福祉用具利用者</span>
                    </label>
                    <span className="ml-2 text-xs text-gray-500">（介護保険・自費レンタル・販売すべて含む）</span>
                  </div>

                  {/* 住所 */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-500 mb-1">住所</label>
                    <input
                      disabled={!isEditing}
                      value={editedClient.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>
                </div>

                {/* ケアマネージャー情報 */}
                <div className="border-t border-gray-200 my-6"></div>
                <h3 className="text-lg font-bold text-gray-800 border-l-4 border-blue-500 pl-3 mb-6">ケアマネージャー情報</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                   <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">居宅介護支援事業所</label>
                      <input
                          disabled={!isEditing}
                          value={editedClient.careSupportOffice}
                          onChange={(e) => handleChange('careSupportOffice', e.target.value)}
                          className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                   </div>
                   <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">担当CM</label>
                      <input
                          disabled={!isEditing}
                          value={editedClient.careManager}
                          onChange={(e) => handleChange('careManager', e.target.value)}
                          className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-blue-500 outline-none"
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
                            <label className="text-xs font-bold text-gray-500 whitespace-nowrap">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                            <input
                                disabled
                                value={editedClient.office}
                                className="text-xs font-bold rounded px-2 py-1 bg-gray-50 border border-gray-300 text-gray-600"
                            />
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
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">居宅介護支援事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                            <input
                                disabled={true}
                                value={editedClient.careSupportOffice}
                                placeholder="基本情報タブで設定してください"
                                className="w-full border p-2 rounded text-sm border-gray-300 bg-blue-50 text-gray-700 cursor-not-allowed"
                            />
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">担当CM <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                            <input
                                disabled={true}
                                value={editedClient.careManager}
                                placeholder="基本情報タブで設定してください"
                                className="w-full border p-2 rounded text-sm border-gray-300 bg-blue-50 text-gray-700 cursor-not-allowed"
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

                  {(() => {
                      // 情報種別の表示用ラベルを取得
                      const getInfoTypeLabel = (infoType: ChangeInfoType): string => {
                          if (infoType === '入院（サービス停止）') return '入院';
                          if (infoType === '退院（サービス開始）') return '退院';
                          return infoType;
                      };

                      // 全てのレコードを分類（最新レコード表示は削除）
                      const otherRecords = editedClient.changeRecords;
                      const hospitalRecords = otherRecords.filter(r => r.infoType === '入院（サービス停止）');
                      const dischargeRecords = otherRecords.filter(r => r.infoType === '退院（サービス開始）');
                      const newRecords = otherRecords.filter(r => r.infoType === '新規');
                      const cancelRecords = otherRecords.filter(r => r.infoType === '解約');

                      // 入院と退院のペアを作成（recordDateベース）
                      const pairs: Array<{ hospital: ClientChangeRecord; discharge?: ClientChangeRecord }> = [];
                      const usedDischargeIds = new Set<string>();

                      const sortedHospital = [...hospitalRecords].sort((a, b) =>
                          (b.recordDate || '').localeCompare(a.recordDate || '')
                      );

                      sortedHospital.forEach(hospital => {
                          const matchingDischarge = dischargeRecords
                              .filter(d => !usedDischargeIds.has(d.id))
                              .filter(d => (d.recordDate || '') >= (hospital.recordDate || ''))
                              .sort((a, b) => (a.recordDate || '').localeCompare(b.recordDate || ''))[0];

                          if (matchingDischarge) {
                              usedDischargeIds.add(matchingDischarge.id);
                              pairs.push({ hospital, discharge: matchingDischarge });
                          } else {
                              pairs.push({ hospital });
                          }
                      });

                      // ペアになっていない退院
                      const unpairedDischarges = dischargeRecords
                          .filter(d => !usedDischargeIds.has(d.id))
                          .sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));

                      // 新規と解約のペアを作成（recordDateベース）
                      const contractPairs: Array<{ newRecord: ClientChangeRecord; cancelRecord?: ClientChangeRecord }> = [];
                      const usedCancelIds = new Set<string>();

                      const sortedNew = [...newRecords].sort((a, b) =>
                          (b.recordDate || '').localeCompare(a.recordDate || '')
                      );

                      sortedNew.forEach(newRec => {
                          const matchingCancel = cancelRecords
                              .filter(c => !usedCancelIds.has(c.id))
                              .filter(c => (c.recordDate || '') >= (newRec.recordDate || ''))
                              .sort((a, b) => (a.recordDate || '').localeCompare(b.recordDate || ''))[0];

                          if (matchingCancel) {
                              usedCancelIds.add(matchingCancel.id);
                              contractPairs.push({ newRecord: newRec, cancelRecord: matchingCancel });
                          } else {
                              contractPairs.push({ newRecord: newRec });
                          }
                      });

                      // ペアになっていない解約
                      const unpairedCancels = cancelRecords
                          .filter(c => !usedCancelIds.has(c.id))
                          .sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));

                      return (
                          <>

                              {/* 入院・退院ペア（上部・横並び表示） */}
                              {pairs.map((pair, idx) => (
                                  <div key={`hosp-pair-${pair.hospital.id}`} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-orange-50 flex justify-between items-center border-b border-orange-100">
                                          <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2">
                                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
                                              入院・退院情報
                                          </h4>
                                          <span className="text-xs text-gray-400">
                                              {pair.hospital.recordDate && `入院: ${pair.hospital.recordDate}`}
                                              {pair.discharge?.recordDate && ` → 退院: ${pair.discharge.recordDate}`}
                                          </span>
                                      </div>

                                      {/* 入院・退院を横並びで表示 */}
                                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                          {/* 左側: 入院情報 */}
                                          <div className="bg-red-50 p-4 rounded-lg border border-red-100">
                                              <div className="flex justify-between items-start mb-3">
                                                  <h5 className="text-sm font-bold text-red-800">入院（サービス停止）</h5>
                                                  <span className="text-xs text-gray-400">ID: {pair.hospital.id}</span>
                                              </div>
                                              <div className="space-y-3">
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                      <select disabled={!isEditing} value={getInfoTypeLabel(pair.hospital.infoType)} onChange={(e) => {
                                                          const label = e.target.value;
                                                          let infoType: ChangeInfoType = '新規';
                                                          if (label === '新規') infoType = '新規';
                                                          else if (label === '入院') infoType = '入院（サービス停止）';
                                                          else if (label === '退院') infoType = '退院（サービス開始）';
                                                          else if (label === '解約') infoType = '解約';
                                                          updateChangeRecord(pair.hospital.id, 'infoType', infoType);
                                                      }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                          <option value="新規">新規</option>
                                                          <option value="入院">入院</option>
                                                          <option value="退院">退院</option>
                                                          <option value="解約">解約</option>
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                      <input type="date" disabled={!isEditing} value={pair.hospital.recordDate} onChange={(e) => updateChangeRecord(pair.hospital.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">請求停止日（入院）</label>
                                                      <input type="date" disabled={!isEditing} value={pair.hospital.billingStopDateHospital} onChange={(e) => updateChangeRecord(pair.hospital.id, 'billingStopDateHospital', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                      <input disabled={!isEditing} value={pair.hospital.recorder} onChange={(e) => updateChangeRecord(pair.hospital.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                      <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                      <textarea disabled={!isEditing} value={pair.hospital.note} onChange={(e) => updateChangeRecord(pair.hospital.id, 'note', e.target.value)} className="w-full h-16 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                                  </div>
                                                  {isEditing && (
                                                      <button onClick={() => {
                                                          if (confirm('この変更情報を削除しますか？')) {
                                                              setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== pair.hospital.id) }));
                                                          }
                                                      }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                                                  )}
                                              </div>
                                          </div>

                                          {/* 右側: 退院情報 */}
                                          {pair.discharge ? (
                                              <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                                                  <div className="flex justify-between items-start mb-3">
                                                      <h5 className="text-sm font-bold text-green-800">退院（サービス再開）</h5>
                                                      <span className="text-xs text-gray-400">ID: {pair.discharge.id}</span>
                                                  </div>
                                                  <div className="space-y-3">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                          <select disabled={!isEditing} value={getInfoTypeLabel(pair.discharge.infoType)} onChange={(e) => {
                                                              const label = e.target.value;
                                                              let infoType: ChangeInfoType = '新規';
                                                              if (label === '新規') infoType = '新規';
                                                              else if (label === '入院') infoType = '入院（サービス停止）';
                                                              else if (label === '退院') infoType = '退院（サービス開始）';
                                                              else if (label === '解約') infoType = '解約';
                                                              updateChangeRecord(pair.discharge.id, 'infoType', infoType);
                                                          }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                              <option value="新規">新規</option>
                                                              <option value="入院">入院</option>
                                                              <option value="退院">退院</option>
                                                              <option value="解約">解約</option>
                                                          </select>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                          <input type="date" disabled={!isEditing} value={pair.discharge.recordDate} onChange={(e) => updateChangeRecord(pair.discharge.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">請求開始日（退院）</label>
                                                          <input type="date" disabled={!isEditing} value={pair.discharge.billingStartDateDischarge} onChange={(e) => updateChangeRecord(pair.discharge.id, 'billingStartDateDischarge', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                          <input disabled={!isEditing} value={pair.discharge.recorder} onChange={(e) => updateChangeRecord(pair.discharge.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                          <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                          <textarea disabled={!isEditing} value={pair.discharge.note} onChange={(e) => updateChangeRecord(pair.discharge.id, 'note', e.target.value)} className="w-full h-16 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                                      </div>
                                                      {isEditing && (
                                                          <button onClick={() => {
                                                              if (confirm('この変更情報を削除しますか？')) {
                                                                  setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== pair.discharge!.id) }));
                                                              }
                                                          }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                                                      )}
                                                  </div>
                                              </div>
                                          ) : (
                                              <div className="bg-gray-50 p-4 rounded-lg border border-dashed border-gray-300 flex items-center justify-center">
                                                  <p className="text-gray-400 text-sm">退院情報なし</p>
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}

                              {/* 新規・解約ペア（横並び表示） */}
                              {contractPairs.map((pair, idx) => (
                                  <div key={`contract-pair-${pair.newRecord.id}`} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-purple-50 flex justify-between items-center border-b border-purple-100">
                                          <h4 className="text-sm font-bold text-purple-800 flex items-center gap-2">
                                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                                              新規・解約情報
                                          </h4>
                                          <span className="text-xs text-gray-400">
                                              {pair.newRecord.recordDate && `新規: ${pair.newRecord.recordDate}`}
                                              {pair.cancelRecord?.recordDate && ` → 解約: ${pair.cancelRecord.recordDate}`}
                                          </span>
                                      </div>

                                      {/* 新規・解約を横並びで表示 */}
                                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                          {/* 左側: 新規情報 */}
                                          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                              <div className="flex justify-between items-start mb-3">
                                                  <h5 className="text-sm font-bold text-blue-800">新規</h5>
                                                  <span className="text-xs text-gray-400">ID: {pair.newRecord.id}</span>
                                              </div>
                                              <div className="space-y-3">
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                      <select disabled={!isEditing} value={getInfoTypeLabel(pair.newRecord.infoType)} onChange={(e) => {
                                                          const label = e.target.value;
                                                          let infoType: ChangeInfoType = '新規';
                                                          if (label === '新規') infoType = '新規';
                                                          else if (label === '入院') infoType = '入院（サービス停止）';
                                                          else if (label === '退院') infoType = '退院（サービス開始）';
                                                          else if (label === '解約') infoType = '解約';
                                                          updateChangeRecord(pair.newRecord.id, 'infoType', infoType);
                                                      }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                          <option value="新規">新規</option>
                                                          <option value="入院">入院</option>
                                                          <option value="退院">退院</option>
                                                          <option value="解約">解約</option>
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                      <input type="date" disabled={!isEditing} value={pair.newRecord.recordDate} onChange={(e) => updateChangeRecord(pair.newRecord.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">請求開始日（新規）</label>
                                                      <input type="date" disabled={!isEditing} value={pair.newRecord.billingStartDateNew} onChange={(e) => updateChangeRecord(pair.newRecord.id, 'billingStartDateNew', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                      <input disabled={!isEditing} value={pair.newRecord.recorder} onChange={(e) => updateChangeRecord(pair.newRecord.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                      <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                      <textarea disabled={!isEditing} value={pair.newRecord.note} onChange={(e) => updateChangeRecord(pair.newRecord.id, 'note', e.target.value)} className="w-full h-16 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                                  </div>
                                                  {isEditing && (
                                                      <button onClick={() => {
                                                          if (confirm('この変更情報を削除しますか？')) {
                                                              setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== pair.newRecord.id) }));
                                                          }
                                                      }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                                                  )}
                                              </div>
                                          </div>

                                          {/* 右側: 解約情報 */}
                                          {pair.cancelRecord ? (
                                              <div className="bg-gray-100 p-4 rounded-lg border border-gray-200">
                                                  <div className="flex justify-between items-start mb-3">
                                                      <h5 className="text-sm font-bold text-gray-800">解約</h5>
                                                      <span className="text-xs text-gray-400">ID: {pair.cancelRecord.id}</span>
                                                  </div>
                                                  <div className="space-y-3">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                          <select disabled={!isEditing} value={getInfoTypeLabel(pair.cancelRecord.infoType)} onChange={(e) => {
                                                              const label = e.target.value;
                                                              let infoType: ChangeInfoType = '新規';
                                                              if (label === '新規') infoType = '新規';
                                                              else if (label === '入院') infoType = '入院（サービス停止）';
                                                              else if (label === '退院') infoType = '退院（サービス開始）';
                                                              else if (label === '解約') infoType = '解約';
                                                              updateChangeRecord(pair.cancelRecord.id, 'infoType', infoType);
                                                          }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                              <option value="新規">新規</option>
                                                              <option value="入院">入院</option>
                                                              <option value="退院">退院</option>
                                                              <option value="解約">解約</option>
                                                          </select>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                          <input type="date" disabled={!isEditing} value={pair.cancelRecord.recordDate} onChange={(e) => updateChangeRecord(pair.cancelRecord.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">請求停止日（解約）</label>
                                                          <input type="date" disabled={!isEditing} value={pair.cancelRecord.billingStopDateCancel} onChange={(e) => updateChangeRecord(pair.cancelRecord.id, 'billingStopDateCancel', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                          <input disabled={!isEditing} value={pair.cancelRecord.recorder} onChange={(e) => updateChangeRecord(pair.cancelRecord.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                          <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                          <textarea disabled={!isEditing} value={pair.cancelRecord.note} onChange={(e) => updateChangeRecord(pair.cancelRecord.id, 'note', e.target.value)} className="w-full h-16 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                                      </div>
                                                      {isEditing && (
                                                          <button onClick={() => {
                                                              if (confirm('この変更情報を削除しますか？')) {
                                                                  setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== pair.cancelRecord!.id) }));
                                                              }
                                                          }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                                                      )}
                                                  </div>
                                              </div>
                                          ) : (
                                              <div className="bg-gray-50 p-4 rounded-lg border border-dashed border-gray-300 flex items-center justify-center">
                                                  <p className="text-gray-400 text-sm">解約情報なし（継続中）</p>
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}

                              {/* ペアになっていない解約レコード（個別表示） */}
                              {unpairedCancels.map((record) => (
                                  <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-gray-100 flex justify-between items-center">
                                          <h4 className="text-sm font-bold text-gray-800">解約（単独）</h4>
                                          <span className="text-xs text-gray-400">{record.recordDate} | ID: {record.id}</span>
                                      </div>

                                      <div className="p-6 space-y-6">
                                          {/* 情報種別選択 */}
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                  <select disabled={!isEditing} value={getInfoTypeLabel(record.infoType)} onChange={(e) => {
                                                      const label = e.target.value;
                                                      let infoType: ChangeInfoType = '新規';
                                                      if (label === '新規') infoType = '新規';
                                                      else if (label === '入院') infoType = '入院（サービス停止）';
                                                      else if (label === '退院') infoType = '退院（サービス開始）';
                                                      else if (label === '解約') infoType = '解約';
                                                      updateChangeRecord(record.id, 'infoType', infoType);
                                                  }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                      <option value="新規">新規</option>
                                                      <option value="入院">入院</option>
                                                      <option value="退院">退院</option>
                                                      <option value="解約">解約</option>
                                                  </select>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                  <input type="date" disabled={!isEditing} value={record.recordDate} onChange={(e) => updateChangeRecord(record.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                              </div>
                                          </div>

                                          {/* 利用者情報（読み取り専用） */}
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">あおぞらID</label>
                                                  <input type="text" disabled value={editedClient.aozoraId} className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-600"/>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">利用者名</label>
                                                  <input type="text" disabled value={editedClient.name} className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-600"/>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">施設名</label>
                                                  <input type="text" disabled value={editedClient.facilityName || '在宅'} className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-600"/>
                                              </div>
                                          </div>

                                          {/* 記録者・事業所 */}
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-gray-100">
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                  <input disabled={!isEditing} value={record.recorder} onChange={(e) => updateChangeRecord(record.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                  <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                              </div>
                                          </div>

                                          {/* 情報種別に応じた項目 */}
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">請求開始日（新規）</label>
                                              <input type="date" disabled={!isEditing} value={record.billingStartDateNew} onChange={(e) => updateChangeRecord(record.id, 'billingStartDateNew', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                          </div>

                                          {/* 特記（常に表示） */}
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                              <textarea disabled={!isEditing} value={record.note} onChange={(e) => updateChangeRecord(record.id, 'note', e.target.value)} className="w-full h-20 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                          </div>

                                          {/* 削除ボタン */}
                                          {isEditing && (
                                              <div className="flex justify-end pt-2 border-t border-gray-100">
                                                  <button onClick={() => {
                                                      if (confirm('この変更情報を削除しますか？')) {
                                                          setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== record.id) }));
                                                      }
                                                  }} className="text-red-500 hover:text-red-700 text-sm font-bold flex items-center gap-1">
                                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                      </svg>
                                                      削除
                                                  </button>
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}

                              {/* ペアになっていない解約レコード（下部） */}
                              {unpairedCancels.map((record) => (
                                  <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-gray-100 flex justify-between items-center">
                                          <h4 className="text-sm font-bold text-gray-800">解約</h4>
                                          <span className="text-xs text-gray-400">{record.recordDate} | ID: {record.id}</span>
                                      </div>

                                      <div className="p-6 space-y-6">
                                          {/* 情報種別選択 */}
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                  <select disabled={!isEditing} value={getInfoTypeLabel(record.infoType)} onChange={(e) => {
                                                      const label = e.target.value;
                                                      let infoType: ChangeInfoType = '新規';
                                                      if (label === '新規') infoType = '新規';
                                                      else if (label === '入院') infoType = '入院（サービス停止）';
                                                      else if (label === '退院') infoType = '退院（サービス開始）';
                                                      else if (label === '解約') infoType = '解約';
                                                      updateChangeRecord(record.id, 'infoType', infoType);
                                                  }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                      <option value="新規">新規</option>
                                                      <option value="入院">入院</option>
                                                      <option value="退院">退院</option>
                                                      <option value="解約">解約</option>
                                                  </select>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                  <input type="date" disabled={!isEditing} value={record.recordDate} onChange={(e) => updateChangeRecord(record.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                              </div>
                                          </div>

                                          {/* 利用者情報（読み取り専用） */}
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">あおぞらID</label>
                                                  <input type="text" disabled value={editedClient.aozoraId} className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-600"/>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">利用者名</label>
                                                  <input type="text" disabled value={editedClient.name} className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-600"/>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">施設名</label>
                                                  <input type="text" disabled value={editedClient.facilityName || '在宅'} className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-600"/>
                                              </div>
                                          </div>

                                          {/* 記録者・事業所 */}
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-gray-100">
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                  <input disabled={!isEditing} value={record.recorder} onChange={(e) => updateChangeRecord(record.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                              </div>
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                  <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                              </div>
                                          </div>

                                          {/* 情報種別に応じた項目 */}
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">請求停止日（解約）</label>
                                              <input type="date" disabled={!isEditing} value={record.billingStopDateCancel} onChange={(e) => updateChangeRecord(record.id, 'billingStopDateCancel', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                          </div>

                                          {/* 特記（常に表示） */}
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                              <textarea disabled={!isEditing} value={record.note} onChange={(e) => updateChangeRecord(record.id, 'note', e.target.value)} className="w-full h-20 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                          </div>

                                          {/* 削除ボタン */}
                                          {isEditing && (
                                              <div className="flex justify-end pt-2 border-t border-gray-100">
                                                  <button onClick={() => {
                                                      if (confirm('この変更情報を削除しますか？')) {
                                                          setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== record.id) }));
                                                      }
                                                  }} className="text-red-500 hover:text-red-700 text-sm font-bold flex items-center gap-1">
                                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                      </svg>
                                                      削除
                                                  </button>
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </>
                      );
                  })()}
              </div>
          )}

          {/* --- Equipment Tab (Detailed) --- */}
          {activeTab === 'equipment' && (
            <div className="space-y-6 animate-fade-in-up">
              <div className="flex gap-4 justify-end">
                <button
                    onClick={() => setShowEquipmentTypeModal(true)}
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

              {/* 介護保険レンタルセクション */}
              {(() => {
                const insuranceRentals = editedClient.selectedEquipment.filter(eq => eq.status === '介護保険レンタル');
                return insuranceRentals.length > 0 && (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white px-6 py-3 rounded-lg shadow-md">
                      <h3 className="font-bold text-lg flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                        </svg>
                        介護保険レンタル
                        <span className="ml-2 bg-white/20 px-3 py-1 rounded-full text-sm">{insuranceRentals.length}件</span>
                      </h3>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-blue-50 border-b border-blue-100">
                            <tr>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">商品名</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">メーカー</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">卸会社</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">種類</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">単位数</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">商品コード</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">利用開始日</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">利用終了日</th>
                              <th className="px-4 py-3 text-left font-bold text-blue-900">カイポケ</th>
                              {isEditing && <th className="px-4 py-3 text-center font-bold text-blue-900">操作</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {insuranceRentals.map((eq) => (
                              <tr
                                key={eq.id}
                                className="hover:bg-blue-50 transition-colors cursor-pointer"
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingInsuranceRentalEquipment(eq);
                                    setShowInsuranceRentalFormModal(true);
                                  }
                                }}
                              >
                                <td className="px-4 py-3">{eq.name || '-'}</td>
                                <td className="px-4 py-3">{eq.manufacturer || '-'}</td>
                                <td className="px-4 py-3">{eq.wholesaler || '-'}</td>
                                <td className="px-4 py-3">{eq.category || '-'}</td>
                                <td className="px-4 py-3">{eq.units || '-'}</td>
                                <td className="px-4 py-3 text-xs">{eq.taisCode || '-'}</td>
                                <td className="px-4 py-3 text-xs">{eq.startDate || '-'}</td>
                                <td className="px-4 py-3 text-xs">{eq.endDate || '-'}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-1 rounded text-xs ${eq.kaipokeStatus === '登録済' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                    {eq.kaipokeStatus || '未登録'}
                                  </span>
                                </td>
                                {isEditing && (
                                  <td className="px-4 py-3 text-center">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeEquipment('selected', eq.id);
                                      }}
                                      className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                                      title="削除"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                      </svg>
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 自費レンタルセクション */}
              {(() => {
                const selfPayRentals = editedClient.selectedEquipment.filter(eq => eq.status === '自費レンタル');
                return selfPayRentals.length > 0 && (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-purple-600 to-purple-500 text-white px-6 py-3 rounded-lg shadow-md">
                      <h3 className="font-bold text-lg flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
                        </svg>
                        自費レンタル
                        <span className="ml-2 bg-white/20 px-3 py-1 rounded-full text-sm">{selfPayRentals.length}件</span>
                      </h3>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-purple-50 border-b border-purple-100">
                            <tr>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">商品名</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">卸会社</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">単価</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">数量</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">税込金額</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">利用開始日</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">利用終了日</th>
                              {isEditing && <th className="px-4 py-3 text-center font-bold text-purple-900">操作</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                    {selfPayRentals.map((eq) => (
                      <tr
                        key={eq.id}
                        className="hover:bg-purple-50 transition-colors cursor-pointer"
                        onClick={() => {
                          if (isEditing) {
                            setEditingSelfPayRentalEquipment(eq);
                            setShowSelfPayRentalFormModal(true);
                          }
                        }}
                      >
                        <td className="px-4 py-3">{eq.selfPayProductName || eq.name || '-'}</td>
                        <td className="px-4 py-3">{eq.wholesaler || '-'}</td>
                        <td className="px-4 py-3">{eq.unitPrice ? `¥${eq.unitPrice.toLocaleString()}` : '-'}</td>
                        <td className="px-4 py-3">{eq.quantity || '-'}</td>
                        <td className="px-4 py-3 font-semibold text-purple-700">
                          {(() => {
                            const qty = eq.quantity || 1;
                            const price = eq.unitPrice || 0;
                            const taxType = eq.taxType || '非課税';
                            if (!price) return eq.taxIncludedAmount ? `¥${eq.taxIncludedAmount.toLocaleString()}` : '-';
                            const subtotal = qty * price;
                            let taxRate = 0;
                            if (taxType === '10％') taxRate = 0.10;
                            else if (taxType === '軽8％') taxRate = 0.08;
                            const taxAmount = Math.floor(subtotal * taxRate);
                            const total = subtotal + taxAmount;
                            return `¥${total.toLocaleString()}`;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-xs">{eq.startDate || '-'}</td>
                        <td className="px-4 py-3 text-xs">{eq.endDate || '-'}</td>
                        {isEditing && (
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeEquipment('selected', eq.id);
                              }}
                              className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                              title="削除"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 販売セクション */}
              {(() => {
                const salesItems = editedClient.selectedEquipment.filter(eq => eq.status === '販売');
                return salesItems.length > 0 && (
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-green-600 to-green-500 text-white px-6 py-3 rounded-lg shadow-md">
                      <h3 className="font-bold text-lg flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                        </svg>
                        販売
                        <span className="ml-2 bg-white/20 px-3 py-1 rounded-full text-sm">{salesItems.length}件</span>
                      </h3>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-green-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">商品名</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">数量</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">単価（税抜）</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">税区分</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">税込金額</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">受注日</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">納品日</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">支払方法</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">申請</th>
                              {isEditing && <th className="px-4 py-3 text-center text-xs font-bold text-green-700 uppercase tracking-wider">操作</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                    {salesItems.map((eq) => (
                      <tr
                        key={eq.id}
                        className="hover:bg-green-50 transition-colors cursor-pointer"
                        onClick={() => {
                          if (isEditing) {
                            setEditingSalesEquipment(eq);
                            setShowSalesFormModal(true);
                          }
                        }}
                      >
                        <td className="px-4 py-3 font-medium">{eq.name || '-'}</td>
                        <td className="px-4 py-3">{eq.quantity || '-'}</td>
                        <td className="px-4 py-3">{eq.unitPrice ? `¥${eq.unitPrice.toLocaleString()}` : '-'}</td>
                        <td className="px-4 py-3">{eq.taxType || '-'}</td>
                        <td className="px-4 py-3 font-bold text-green-700">
                          {(() => {
                            const qty = eq.quantity || 1;
                            const price = eq.unitPrice || 0;
                            const taxType = eq.taxType || '非課税';
                            if (!price) return '-';
                            const subtotal = qty * price;
                            let taxRate = 0;
                            if (taxType === '10％') taxRate = 0.10;
                            else if (taxType === '軽8％') taxRate = 0.08;
                            const taxAmount = Math.floor(subtotal * taxRate);
                            const total = subtotal + taxAmount;
                            return `¥${total.toLocaleString()}`;
                          })()}
                        </td>
                        <td className="px-4 py-3">{eq.orderReceivedDate || '-'}</td>
                        <td className="px-4 py-3">{eq.deliveryDate || '-'}</td>
                        <td className="px-4 py-3">{eq.paymentMethod || '-'}</td>
                        <td className="px-4 py-3">
                          {eq.applicationStatus ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              ✓ {eq.applicationMunicipality || '申請中'}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        {isEditing && (
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeEquipment('selected', eq.id);
                              }}
                              className="text-red-400 hover:text-red-600 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
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
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                  <input
                                      disabled
                                      value={editedClient.office}
                                      className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
                                  <select
                                      disabled={!isEditing}
                                      value={record.status}
                                      onChange={(e) => updateSalesRecord(record.id, 'status', e.target.value as EquipmentStatus)}
                                      className="w-full border p-2 rounded text-sm bg-white focus:border-indigo-500 outline-none"
                                  >
                                      <option value="介護保険レンタル">介護保険レンタル</option>
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
                              <div className="md:col-span-1">
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
                                       <div className="flex items-center gap-1">
                                           <input
                                              type="number"
                                              disabled={!isEditing}
                                              value={record.taxIncludedAmount || 0}
                                              onChange={(e) => updateSalesRecord(record.id, 'taxIncludedAmount', parseInt(e.target.value) || 0)}
                                              className="w-full border border-indigo-200 p-2 rounded text-sm bg-indigo-50 text-indigo-800 focus:border-indigo-500 outline-none text-right font-bold"
                                           />
                                           <span className="text-xs text-indigo-700">円</span>
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

      {/* Equipment Type Selection Modal */}
      {showEquipmentTypeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-4">機器の種類を選択</h3>
            <div className="space-y-3">
              <button
                onClick={() => handleAddEquipment('selected', '介護保険レンタル')}
                className="w-full p-4 border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50 rounded-lg text-left transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 text-lg">🏥</span>
                  </div>
                  <div>
                    <div className="font-bold text-blue-700">介護保険レンタル</div>
                    <div className="text-sm text-gray-500">介護保険適用のレンタル用具</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleAddEquipment('selected', '自費レンタル')}
                className="w-full p-4 border-2 border-purple-200 hover:border-purple-500 hover:bg-purple-50 rounded-lg text-left transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <span className="text-purple-600 text-lg">💰</span>
                  </div>
                  <div>
                    <div className="font-bold text-purple-700">自費レンタル</div>
                    <div className="text-sm text-gray-500">自費でのレンタル用具</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleAddEquipment('selected', '販売')}
                className="w-full p-4 border-2 border-green-200 hover:border-green-500 hover:bg-green-50 rounded-lg text-left transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-green-600 text-lg">🛒</span>
                  </div>
                  <div>
                    <div className="font-bold text-green-700">販売</div>
                    <div className="text-sm text-gray-500">福祉用具の販売</div>
                  </div>
                </div>
              </button>
            </div>
            <button
              onClick={() => setShowEquipmentTypeModal(false)}
              className="w-full mt-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Sales Form Modal */}
      {showSalesFormModal && editingSalesEquipment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4 my-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-green-700 flex items-center gap-2">
                <span className="text-xl">🛒</span> 販売情報の入力
              </h3>
              <button
                onClick={() => {
                  setShowSalesFormModal(false);
                  setEditingSalesEquipment(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* 基本情報 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3">
                  <label className="block text-sm font-bold text-gray-600 mb-1">商品名（請求費目）<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={editingSalesEquipment.name || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, name: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                    placeholder="商品名を入力"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">受注日</label>
                  <input
                    type="date"
                    value={editingSalesEquipment.orderReceivedDate || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, orderReceivedDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">納品日</label>
                  <input
                    type="date"
                    value={editingSalesEquipment.deliveryDate || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, deliveryDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">営業担当</label>
                  <input
                    type="text"
                    value={editingSalesEquipment.salesPerson || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, salesPerson: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                    placeholder="担当者名を入力"
                  />
                </div>
              </div>

              {/* 金額情報 */}
              <div className="bg-green-50 p-4 rounded-lg">
                <h4 className="text-sm font-bold text-green-700 mb-3">金額情報</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">数量</label>
                    <input
                      type="number"
                      min="1"
                      value={editingSalesEquipment.quantity || 1}
                      onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, quantity: parseInt(e.target.value) || 1} : null)}
                      className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">単価（税抜）</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editingSalesEquipment.unitPrice || ''}
                        onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, unitPrice: parseInt(e.target.value) || 0} : null)}
                        className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none text-right"
                        placeholder="0"
                      />
                      <span className="text-sm text-gray-500">円</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">税区分</label>
                    <select
                      value={editingSalesEquipment.taxType || '非課税'}
                      onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, taxType: e.target.value as TaxType} : null)}
                      className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                    >
                      <option value="非課税">非課税</option>
                      <option value="10％">10％</option>
                      <option value="軽8％">軽8％</option>
                      <option value="税込">税込</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-green-700 mb-1">税込金額</label>
                    <div className="w-full border border-green-300 bg-green-100 p-2 rounded-lg text-right font-bold text-green-800">
                      {(() => {
                        const qty = editingSalesEquipment.quantity || 1;
                        const price = editingSalesEquipment.unitPrice || 0;
                        const taxType = editingSalesEquipment.taxType || '非課税';
                        const subtotal = qty * price;
                        let taxRate = 0;
                        if (taxType === '10％') taxRate = 0.10;
                        else if (taxType === '軽8％') taxRate = 0.08;
                        const taxAmount = Math.floor(subtotal * taxRate);
                        const total = subtotal + taxAmount;
                        return `¥${total.toLocaleString()}`;
                      })()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">送料</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editingSalesEquipment.shippingCost || ''}
                        onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, shippingCost: parseInt(e.target.value) || 0} : null)}
                        className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none text-right"
                        placeholder="0"
                      />
                      <span className="text-sm text-gray-500">円</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 取引情報 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">取引内容</label>
                  <select
                    value={editingSalesEquipment.transactionType || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, transactionType: e.target.value as TransactionType} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="社内間取引">社内間取引</option>
                    <option value="社内外取引">社内外取引</option>
                  </select>
                </div>
              </div>

              {/* 支払い情報 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">利用者自己負担割合</label>
                  <select
                    value={editingSalesEquipment.userBurdenType || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, userBurdenType: e.target.value as UserBurdenType} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="自己負担０（日常生活給付）">自己負担０（日常生活給付）</option>
                    <option value="一部負担（日常生活給付）">一部負担（日常生活給付）</option>
                    <option value="１割負担（受領委任払い）">１割負担（受領委任払い）</option>
                    <option value="２割負担（受領委任払い）">２割負担（受領委任払い）</option>
                    <option value="３割負担（受領委任払い）">３割負担（受領委任払い）</option>
                    <option value="全額負担（償還払い）">全額負担（償還払い）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">支払い方法</label>
                  <select
                    value={editingSalesEquipment.paymentMethod || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, paymentMethod: e.target.value as PaymentMethod} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="口座引き落とし">口座引き落とし</option>
                    <option value="現金集金">現金集金</option>
                    <option value="受領委任払い">受領委任払い</option>
                    <option value="償還払い">償還払い</option>
                    <option value="日常生活給付">日常生活給付</option>
                  </select>
                </div>
              </div>

              {/* 申請情報 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingSalesEquipment.applicationStatus || false}
                      onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, applicationStatus: e.target.checked} : null)}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm font-bold text-gray-600">申請あり</span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">申請市町村</label>
                  <input
                    type="text"
                    value={editingSalesEquipment.applicationMunicipality || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, applicationMunicipality: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                    placeholder="市町村名を入力"
                    disabled={!editingSalesEquipment.applicationStatus}
                  />
                </div>
              </div>

              {/* 備考 */}
              <div>
                <label className="block text-sm font-bold text-gray-600 mb-1">備考</label>
                <textarea
                  value={editingSalesEquipment.note || ''}
                  onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, note: e.target.value} : null)}
                  className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none h-20"
                  placeholder="備考を入力"
                />
              </div>
            </div>

            {/* ボタン */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSalesFormModal(false);
                  setEditingSalesEquipment(null);
                }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  if (editingSalesEquipment) {
                    handleSaveSalesEquipment(editingSalesEquipment);
                  }
                }}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insurance Rental Form Modal */}
      {showInsuranceRentalFormModal && editingInsuranceRentalEquipment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-3xl mx-4 my-8">
            <div className="flex items-center gap-3 mb-6 border-b pb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-blue-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800">介護保険レンタル 機器登録</h3>
                <p className="text-sm text-gray-500">福祉用具の情報を入力してください</p>
              </div>
            </div>

            {/* 商品情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-blue-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">1</span>
                商品情報
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-blue-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">福祉用具の種類</label>
                  <select
                    value={editingInsuranceRentalEquipment.category || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, category: e.target.value, manufacturer: '', name: '', taisCode: '', units: ''} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    {[...new Set(equipmentMaster.equipmentList.map(item => item.itemType))].sort().map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">メーカー</label>
                  <input
                    list="insurance-manufacturer-list"
                    value={editingInsuranceRentalEquipment.manufacturer || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, manufacturer: e.target.value, name: '', taisCode: '', units: ''} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                    placeholder="メーカーを選択"
                  />
                  <datalist id="insurance-manufacturer-list">
                    {[...new Set(equipmentMaster.equipmentList
                      .filter(item => !editingInsuranceRentalEquipment.category || item.itemType === editingInsuranceRentalEquipment.category)
                      .map(item => item.manufacturer))].sort().map(m => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">商品名</label>
                  <input
                    list="insurance-product-list"
                    value={editingInsuranceRentalEquipment.name || ''}
                    onChange={(e) => {
                      const selectedProduct = equipmentMaster.equipmentList.find(
                        item => item.productName === e.target.value &&
                        (!editingInsuranceRentalEquipment.category || item.itemType === editingInsuranceRentalEquipment.category) &&
                        (!editingInsuranceRentalEquipment.manufacturer || item.manufacturer === editingInsuranceRentalEquipment.manufacturer)
                      );
                      if (selectedProduct) {
                        setEditingInsuranceRentalEquipment(prev => prev ? {
                          ...prev,
                          name: selectedProduct.productName,
                          taisCode: selectedProduct.taisCode,
                          units: selectedProduct.units,
                          category: selectedProduct.itemType,
                          manufacturer: selectedProduct.manufacturer
                        } : null);
                      } else {
                        setEditingInsuranceRentalEquipment(prev => prev ? {...prev, name: e.target.value} : null);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                    placeholder="商品名を選択"
                  />
                  <datalist id="insurance-product-list">
                    {equipmentMaster.equipmentList
                      .filter(item =>
                        (!editingInsuranceRentalEquipment.category || item.itemType === editingInsuranceRentalEquipment.category) &&
                        (!editingInsuranceRentalEquipment.manufacturer || item.manufacturer === editingInsuranceRentalEquipment.manufacturer)
                      )
                      .map(item => (
                        <option key={item.taisCode} value={item.productName} />
                      ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">商品コード</label>
                  <input
                    type="text"
                    value={editingInsuranceRentalEquipment.taisCode || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, taisCode: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none bg-gray-50"
                    placeholder="自動入力"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">単位数</label>
                  <input
                    type="text"
                    value={editingInsuranceRentalEquipment.units || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, units: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none bg-gray-50"
                    placeholder="自動入力"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">卸会社</label>
                  <select
                    value={editingInsuranceRentalEquipment.wholesaler || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, wholesaler: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="ニッケン">ニッケン</option>
                    <option value="日本ケアサプライ">日本ケアサプライ</option>
                    <option value="ヤマシタ">ヤマシタ</option>
                    <option value="トーカイ">トーカイ</option>
                    <option value="ダスキンヘルスレント">ダスキンヘルスレント</option>
                    <option value="その他">その他</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 管理情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-blue-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">2</span>
                管理情報
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">属性</label>
                  <select
                    value={editingInsuranceRentalEquipment.propertyAttribute || 'リース物件'}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, propertyAttribute: e.target.value as PropertyAttribute} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  >
                    <option value="自社物件">自社物件</option>
                    <option value="リース物件">リース物件</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">カイポケ登録</label>
                  <select
                    value={editingInsuranceRentalEquipment.kaipokeStatus || '未登録'}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, kaipokeStatus: e.target.value as RegistrationState} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  >
                    <option value="未登録">未登録</option>
                    <option value="登録済">登録済</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                  <input
                    type="text"
                    value={editingInsuranceRentalEquipment.recorder || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, recorder: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                    placeholder="記録者名"
                  />
                </div>
              </div>
            </div>

            {/* 日程情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-blue-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">3</span>
                日程情報
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">受注日</label>
                  <input
                    type="date"
                    value={editingInsuranceRentalEquipment.orderReceivedDate || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, orderReceivedDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">発注日</label>
                  <input
                    type="date"
                    value={editingInsuranceRentalEquipment.orderPlacedDate || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, orderPlacedDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">納品日</label>
                  <input
                    type="date"
                    value={editingInsuranceRentalEquipment.deliveryDate || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, deliveryDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">利用開始日</label>
                  <input
                    type="date"
                    value={editingInsuranceRentalEquipment.startDate || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, startDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">利用終了日</label>
                  <input
                    type="date"
                    value={editingInsuranceRentalEquipment.endDate || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, endDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 備考 */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-600 mb-1">備考</label>
              <textarea
                value={editingInsuranceRentalEquipment.note || ''}
                onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, note: e.target.value} : null)}
                className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none h-20"
                placeholder="備考を入力"
              />
            </div>

            {/* ボタン */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowInsuranceRentalFormModal(false);
                  setEditingInsuranceRentalEquipment(null);
                }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  if (editingInsuranceRentalEquipment) {
                    handleSaveInsuranceRentalEquipment(editingInsuranceRentalEquipment);
                  }
                }}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Self-Pay Rental Form Modal */}
      {showSelfPayRentalFormModal && editingSelfPayRentalEquipment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4 my-8">
            <div className="flex items-center gap-3 mb-6 border-b pb-4">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-purple-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800">自費レンタル 機器登録</h3>
                <p className="text-sm text-gray-500">自費レンタル用具の情報を入力してください</p>
              </div>
            </div>

            {/* 商品情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-purple-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs">1</span>
                商品情報
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-purple-50 p-4 rounded-lg">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-600 mb-1">商品名</label>
                  <input
                    type="text"
                    value={editingSelfPayRentalEquipment.name || editingSelfPayRentalEquipment.selfPayProductName || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, name: e.target.value, selfPayProductName: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                    placeholder="商品名を入力"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-600 mb-1">卸会社</label>
                  <select
                    value={editingSelfPayRentalEquipment.wholesaler || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, wholesaler: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="ニッケン">ニッケン</option>
                    <option value="日本ケアサプライ">日本ケアサプライ</option>
                    <option value="ヤマシタ">ヤマシタ</option>
                    <option value="トーカイ">トーカイ</option>
                    <option value="ダスキンヘルスレント">ダスキンヘルスレント</option>
                    <option value="その他">その他</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 料金情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-purple-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs">2</span>
                料金情報
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">数量</label>
                  <input
                    type="number"
                    min="1"
                    value={editingSelfPayRentalEquipment.quantity || 1}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, quantity: parseInt(e.target.value) || 1} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none text-right"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">単価（税抜）</label>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">¥</span>
                    <input
                      type="number"
                      value={editingSelfPayRentalEquipment.unitPrice || ''}
                      onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, unitPrice: parseInt(e.target.value) || 0} : null)}
                      className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none text-right"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">税区分</label>
                  <select
                    value={editingSelfPayRentalEquipment.taxType || '非課税'}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, taxType: e.target.value as TaxType} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                  >
                    <option value="非課税">非課税</option>
                    <option value="10％">10％</option>
                    <option value="軽8％">軽8％</option>
                    <option value="税込">税込</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-purple-700 mb-1">税込金額</label>
                  <div className="w-full border border-purple-300 bg-purple-100 p-2 rounded-lg text-right font-bold text-purple-800">
                    {(() => {
                      const qty = editingSelfPayRentalEquipment.quantity || 1;
                      const price = editingSelfPayRentalEquipment.unitPrice || 0;
                      const taxType = editingSelfPayRentalEquipment.taxType || '非課税';
                      const subtotal = qty * price;
                      let taxRate = 0;
                      if (taxType === '10％') taxRate = 0.10;
                      else if (taxType === '軽8％') taxRate = 0.08;
                      const taxAmount = Math.floor(subtotal * taxRate);
                      const total = subtotal + taxAmount;
                      return `¥${total.toLocaleString()}`;
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* 日程情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-purple-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs">3</span>
                日程情報
              </h4>
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">利用開始日</label>
                  <input
                    type="date"
                    value={editingSelfPayRentalEquipment.startDate || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, startDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">利用終了日</label>
                  <input
                    type="date"
                    value={editingSelfPayRentalEquipment.endDate || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, endDate: e.target.value} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 備考 */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-600 mb-1">備考</label>
              <textarea
                value={editingSelfPayRentalEquipment.note || ''}
                onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, note: e.target.value} : null)}
                className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none h-20"
                placeholder="備考を入力"
              />
            </div>

            {/* ボタン */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSelfPayRentalFormModal(false);
                  setEditingSelfPayRentalEquipment(null);
                }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  if (editingSelfPayRentalEquipment) {
                    handleSaveSelfPayRentalEquipment(editingSelfPayRentalEquipment);
                  }
                }}
                className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-bold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDetail;