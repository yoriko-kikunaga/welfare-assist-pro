
import React, { useState, useEffect } from 'react';
import { Client, MeetingRecord, MeetingType, Equipment, CurrentStatus, PaymentType } from '../types';
import { generateMeetingSummary, suggestEquipment } from '../services/geminiService';

interface ClientDetailProps {
  client: Client;
  onUpdateClient: (updatedClient: Client) => void;
}

const ClientDetail: React.FC<ClientDetailProps> = ({ client, onUpdateClient }) => {
  const [activeTab, setActiveTab] = useState<'info' | 'medical' | 'equipment' | 'meetings'>('info');
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
  const handleAddMeeting = (type: MeetingType) => {
    const newMeeting: MeetingRecord = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      type: type,
      attendees: '',
      content: '',
      summary: ''
    };
    setEditedClient(prev => ({
      ...prev,
      meetings: [newMeeting, ...prev.meetings]
    }));
    setActiveTab('meetings');
    setIsEditing(true);
  };

  const updateMeeting = (id: string, field: keyof MeetingRecord, value: string) => {
    setEditedClient(prev => ({
      ...prev,
      meetings: prev.meetings.map(m => m.id === id ? { ...m, [field]: value } : m)
    }));
  };

  const handleGenerateSummary = async (meeting: MeetingRecord) => {
    if (!meeting.content.trim()) {
      alert("まずはメモ欄（内容）を入力してください。");
      return;
    }
    setIsGeneratingSummary(meeting.id);
    const summary = await generateMeetingSummary(meeting.content, meeting.type, editedClient.name);
    updateMeeting(meeting.id, 'summary', summary);
    setIsGeneratingSummary(null);
  };

  // --- Equipment Handlers ---
  const handleAddEquipment = (type: 'planned' | 'selected') => {
    const newEq: Equipment = { id: Date.now().toString(), name: '', category: '' };
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
      <div className="bg-white border-b border-gray-200 px-6 flex gap-6">
        {[
          { id: 'info', label: '基本情報・住所' },
          { id: 'medical', label: '病歴・状態' },
          { id: 'equipment', label: '福祉用具選定' },
          { id: 'meetings', label: '議事録一覧' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
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
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in">
              <h3 className="text-lg font-bold text-gray-800 border-l-4 border-primary-500 pl-3 mb-6">基本情報</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* 既存: 氏名など */}
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">性別</label>
                    <select
                      disabled={!isEditing}
                      value={editedClient.gender}
                      onChange={(e) => handleChange('gender', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                      <option value="男性">男性</option>
                      <option value="女性">女性</option>
                      <option value="その他">その他</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">要介護度</label>
                    <input
                      disabled={!isEditing}
                      value={editedClient.careLevel}
                      onChange={(e) => handleChange('careLevel', e.target.value)}
                      className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>
                </div>

                {/* 新規追加: 現在の状況・支払い・負担割合 */}
                <div className="md:col-span-2 border-t border-gray-100 my-2"></div>

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">現在の状況</label>
                    <select
                        disabled={!isEditing}
                        value={editedClient.currentStatus}
                        onChange={(e) => handleChange('currentStatus', e.target.value as CurrentStatus)}
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                        <option value="在宅">在宅</option>
                        <option value="入院中">入院中</option>
                        <option value="施設入居中">施設入居中</option>
                    </select>
                </div>

                {/* 条件付き表示: 病院名 or 施設名 */}
                {editedClient.currentStatus !== '在宅' && (
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">
                             {editedClient.currentStatus === '入院中' ? '入院先病院名' : '施設名'}
                        </label>
                        <input
                            disabled={!isEditing}
                            value={editedClient.facilityName}
                            onChange={(e) => handleChange('facilityName', e.target.value)}
                            placeholder={editedClient.currentStatus === '入院中' ? '〇〇病院' : 'ケアハウス〇〇'}
                            className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                    </div>
                )}
                 {editedClient.currentStatus === '在宅' && <div className="hidden md:block"></div>}

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">支払い区分</label>
                    <select
                        disabled={!isEditing}
                        value={editedClient.paymentType}
                        onChange={(e) => handleChange('paymentType', e.target.value as PaymentType)}
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                        <option value="非生保">非生保</option>
                        <option value="生保">生保</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">負担割合証</label>
                    <input
                        disabled={!isEditing}
                        value={editedClient.copayRate}
                        onChange={(e) => handleChange('copayRate', e.target.value)}
                        placeholder="1割、2割など"
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                </div>

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

              {/* キーパーソン情報 */}
              <h3 className="text-lg font-bold text-gray-800 border-l-4 border-accent-500 pl-3 mb-6">キーパーソン</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            </div>
          )}

          {/* --- Medical History Tab --- */}
          {activeTab === 'medical' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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
            </div>
          )}

          {/* --- Equipment Tab --- */}
          {activeTab === 'equipment' && (
            <div className="space-y-8 animate-fade-in">
              {/* Planned */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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

              {/* Selected */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative">
                 <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-gray-800 border-l-4 border-green-500 pl-3">選定した福祉用具 (導入済み)</h3>
                  {isEditing && (
                    <button onClick={() => handleAddEquipment('selected')} className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded text-gray-700">＋ 追加</button>
                  )}
                </div>
                 <div className="mb-4">
                  <label className="text-sm font-bold text-gray-600 mr-2">使用開始日:</label>
                  <input
                    type="date"
                    disabled={!isEditing}
                    value={editedClient.startDate}
                    onChange={(e) => handleChange('startDate', e.target.value)}
                    className="border p-1 rounded disabled:bg-transparent disabled:border-none"
                  />
                 </div>

                 {editedClient.selectedEquipment.length === 0 ? (
                    <p className="text-gray-400 text-sm">登録なし</p>
                ) : (
                     <div className="space-y-3">
                        {editedClient.selectedEquipment.map(eq => (
                            <div key={eq.id} className="flex gap-2 items-start bg-green-50 p-3 rounded-lg border border-green-100">
                                <div className="flex-1 grid grid-cols-2 gap-2">
                                    <input
                                        disabled={!isEditing}
                                        placeholder="品名"
                                        value={eq.name}
                                        onChange={(e) => updateEquipment('selected', eq.id, 'name', e.target.value)}
                                        className="border p-1 rounded text-sm bg-white"
                                    />
                                    <input
                                        disabled={!isEditing}
                                        placeholder="カテゴリー"
                                        value={eq.category}
                                        onChange={(e) => updateEquipment('selected', eq.id, 'category', e.target.value)}
                                        className="border p-1 rounded text-sm bg-white"
                                    />
                                     <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-gray-500">月額:</span>
                                        <input
                                            type="number"
                                            disabled={!isEditing}
                                            placeholder="円"
                                            value={eq.monthlyCost || ''}
                                            onChange={(e) => updateEquipment('selected', eq.id, 'monthlyCost', parseInt(e.target.value))}
                                            className="border p-1 rounded text-sm w-24 bg-white"
                                        />
                                        <span className="text-xs text-gray-500">円</span>
                                     </div>
                                </div>
                                {isEditing && (
                                    <button onClick={() => removeEquipment('selected', eq.id)} className="text-red-500 hover:text-red-700">
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
            <div className="space-y-6 animate-fade-in">
              <div className="flex gap-4 justify-end">
                <button
                  onClick={() => handleAddMeeting(MeetingType.CONFERENCE)}
                  className="bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg shadow-sm text-sm font-bold flex items-center gap-2 transition-all"
                >
                  ＋ カンファレンス記録を追加
                </button>
                <button
                  onClick={() => handleAddMeeting(MeetingType.PROVIDER_MEETING)}
                  className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
                >
                  ＋ 担当者会議議事録を追加
                </button>
              </div>

              {editedClient.meetings.length === 0 && (
                <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                  議事録はまだありません
                </div>
              )}

              {editedClient.meetings.map((meeting) => (
                <div key={meeting.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className={`p-4 flex justify-between items-center ${meeting.type === MeetingType.PROVIDER_MEETING ? 'bg-primary-50' : 'bg-blue-50'}`}>
                     <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 text-xs font-bold rounded text-white ${meeting.type === MeetingType.PROVIDER_MEETING ? 'bg-primary-500' : 'bg-blue-400'}`}>
                          {meeting.type}
                        </span>
                        <input
                            type="date"
                            disabled={!isEditing}
                            value={meeting.date}
                            onChange={(e) => updateMeeting(meeting.id, 'date', e.target.value)}
                            className="bg-transparent font-bold text-gray-700 outline-none"
                        />
                     </div>
                     <span className="text-xs text-gray-400">ID: {meeting.id}</span>
                  </div>

                  <div className="p-6 space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">出席者</label>
                        <input
                            disabled={!isEditing}
                            value={meeting.attendees}
                            placeholder="参加者を入力..."
                            onChange={(e) => updateMeeting(meeting.id, 'attendees', e.target.value)}
                            className="w-full border-b border-gray-200 focus:border-primary-500 outline-none py-1 bg-transparent"
                        />
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left: Raw Content */}
                        <div className="flex flex-col h-full">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 flex justify-between">
                                <span>メモ・内容 (RAW)</span>
                                {isEditing && (
                                    <span className="text-xs font-normal text-primary-600">※ここに要点を入力</span>
                                )}
                            </label>
                            <textarea
                                disabled={!isEditing}
                                value={meeting.content}
                                onChange={(e) => updateMeeting(meeting.id, 'content', e.target.value)}
                                placeholder="・現状の課題...&#13;&#10;・家族の要望...&#13;&#10;・決定事項..."
                                className="w-full h-64 p-3 border rounded-lg border-gray-300 focus:ring-2 focus:ring-primary-200 outline-none resize-none text-sm leading-relaxed"
                            />
                        </div>

                        {/* Right: AI Summary */}
                        <div className="flex flex-col h-full bg-gray-50 rounded-lg p-4 border border-gray-100">
                             <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-purple-500">
                                      <path fillRule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813a3.75 3.75 0 0 0 2.576-2.576l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5Z" clipRule="evenodd" />
                                    </svg>
                                    AI 生成議事録
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
                                placeholder="左側のメモからAIが正式な議事録を生成します。"
                                className="flex-1 w-full p-2 bg-white border border-gray-200 rounded text-sm leading-relaxed resize-none focus:ring-2 focus:ring-purple-200 outline-none"
                             />
                        </div>
                     </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientDetail;
