
import React, { useState, useEffect, useRef } from 'react';
import { Client, MeetingRecord, MeetingType, Equipment, PaymentType, BillingCategory, Gender, CareLevel, CopayRate, UsageCategory, ConfirmationStatus, RegistrationStatus, OfficeLocation, ReminderStatus, ClientChangeRecord, ChangeInfoType, ContactStatus, PropertyAttribute, EquipmentStatus, RegistrationState, EquipmentType, TaxType, TransactionType, UserBurdenType, PaymentMethod, ApplicationProgress, EquipmentItem, AttributeHistoryEntry } from '../types';

// 変更履歴の追跡対象フィールドと表示ラベル
const TRACKED_FIELD_LABELS: Record<string, string> = {
  office: '事業所',
  facilityName: '入居施設名', roomNumber: '居室番号', location: '在宅区分',
  isWelfareEquipmentUser: '福祉用具利用者', receiptCheckTarget: 'レセプトチェック対象',
  careSupportOffice: '居宅介護支援事業所', careManager: '担当CM',
  careLevel: '要介護度', copayRate: '負担割合',
  insuranceCardStatus: '介護保険被保険者証', burdenProportionCertificateStatus: '介護保険負担割合証',
  paymentType: '支払い区分', billingCategory: '請求区分',
};

// 履歴の値を表示用文字列に変換（未設定は「ー」）
const displayHistoryValue = (field: string, raw: any): string => {
  if (field === 'isWelfareEquipmentUser') return raw ? '該当' : '非該当';
  if (field === 'receiptCheckTarget') return raw === true ? '対象' : raw === false ? '対象外' : '自動判定';
  if (raw === undefined || raw === null || raw === '') return 'ー';
  return String(raw);
};
import { getAllEquipmentItems } from '../src/services/equipmentTrackingService';
import { generateMeetingSummary, suggestEquipment, extractMedicalInfoFromDocument, syncChangeRecordsToSheets } from '../services/geminiService';
import MeetImportModal from './MeetImportModal';
import DocumentsTab from './DocumentsTab';

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
  const [activeTab, setActiveTab] = useState<'info' | 'documents' | 'medical' | 'meetings' | 'changes' | 'equipment' | 'sales'>('info');
  const [isEditing, setIsEditing] = useState(false);
  const [editedClient, setEditedClient] = useState<Client>(client);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pendingRecordIds, setPendingRecordIds] = useState<Set<string>>(new Set());

  // ===== 変更履歴（基本情報の実効日付き履歴）=====
  // 変更検知時の日付入力ダイアログ
  const [pendingHistory, setPendingHistory] = useState<{ field: string; label: string; oldValue: string; newValue: string } | null>(null);
  const [historyDate, setHistoryDate] = useState<string>('');
  const [historyNote, setHistoryNote] = useState<string>('');
  // 🕐タイムライン表示対象フィールド
  const [viewHistoryField, setViewHistoryField] = useState<{ field: string; label: string } | null>(null);
  // テキスト項目のフォーカス時の値（onBlur差分検知用）
  const textFocusRef = useRef<Record<string, string>>({});

  // ===== 自動保存（デバウンス）=====
  // editedClient の変更を検知し、1.2秒後に Firestore へ自動保存する。
  // lastSavedJsonRef: 最後に保存済みの状態のJSON。これと一致する間は保存しない（ループ・二重保存防止）。
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSavedJsonRef = useRef<string>(JSON.stringify(client));
  const editedClientRef = useRef<Client>(client);
  editedClientRef.current = editedClient;

  // 変更情報のスプレッドシート自動同期（保存後・デバウンス）用
  const lastSyncedChangeRecordsRef = useRef<string>(JSON.stringify(client.changeRecords || []));
  const changeRecordsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Equipment Master Data
  const [equipmentMaster, setEquipmentMaster] = useState<EquipmentMasterData | null>(null);

  // AI States
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<string | null>(null); // meeting ID
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<string | null>(null);

  // Equipment Type Selection Modal
  const [showEquipmentTypeModal, setShowEquipmentTypeModal] = useState(false);
  const [pendingEquipmentType, setPendingEquipmentType] = useState<EquipmentStatus | null>(null);
  const [showSalesFormModal, setShowSalesFormModal] = useState(false);
  const [editingSalesEquipment, setEditingSalesEquipment] = useState<Equipment | null>(null);
  const [pendingNewSalesEquipmentId, setPendingNewSalesEquipmentId] = useState<string | null>(null);
  // Insurance Rental Form Modal
  const [showInsuranceRentalFormModal, setShowInsuranceRentalFormModal] = useState(false);
  const [editingInsuranceRentalEquipment, setEditingInsuranceRentalEquipment] = useState<Equipment | null>(null);
  const [pendingNewInsuranceRentalEquipmentId, setPendingNewInsuranceRentalEquipmentId] = useState<string | null>(null);
  // Self-Pay Rental Form Modal
  const [showSelfPayRentalFormModal, setShowSelfPayRentalFormModal] = useState(false);
  const [editingSelfPayRentalEquipment, setEditingSelfPayRentalEquipment] = useState<Equipment | null>(null);
  const [pendingNewSelfPayRentalEquipmentId, setPendingNewSelfPayRentalEquipmentId] = useState<string | null>(null);

  // 各機器モーダルを開いた時点の入力内容スナップショット（未保存変更の検知用）
  const salesModalInitialRef = useRef<string>('');
  const insuranceModalInitialRef = useRef<string>('');
  const selfPayModalInitialRef = useRef<string>('');

  // ベッド管理在庫リスト（自社物件選択時に使用）
  const [inventoryBeds, setInventoryBeds] = useState<EquipmentItem[]>([]);

  // OCR Document Processing States
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ success: boolean; text: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Meet Import Modal
  const [showMeetImportModal, setShowMeetImportModal] = useState(false);

  useEffect(() => {
    // 別の利用者に切り替わる前に、未保存の編集があればフラッシュ保存（取りこぼし防止）
    const prevJson = JSON.stringify(editedClientRef.current);
    if (prevJson !== lastSavedJsonRef.current) {
      lastSavedJsonRef.current = prevJson; // 自分の setClients で再フラッシュしないよう先にマーク
      onUpdateClient(editedClientRef.current);
    }
    setEditedClient(client);
    lastSavedJsonRef.current = JSON.stringify(client);
    // 利用者切替では同期しないよう、現在の変更情報を「同期済み」として初期化
    //   （保留中の同期タイマーはあえて残す＝全件一括・冪等のため、切替前の編集も取りこぼさない）
    lastSyncedChangeRecordsRef.current = JSON.stringify(client.changeRecords || []);
    setSuggestionResult(null);
    setSaveSuccess(false);
    setAutoSaveStatus('idle');
  }, [client]);

  // 機器入力モーダルが開いている間は自動保存を一時停止
  //   （開いた瞬間に追加される空のプレースホルダや入力途中の状態を保存しないため。
  //    モーダルを「保存」して閉じた直後に、確定した内容がまとめて自動保存される）
  const anyEquipmentModalOpen =
    showSalesFormModal || showInsuranceRentalFormModal || showSelfPayRentalFormModal || showEquipmentTypeModal;

  // 機器モーダルを開いた時点の入力内容をスナップショット（未保存変更の検知用）
  useEffect(() => {
    if (showSalesFormModal && editingSalesEquipment) salesModalInitialRef.current = JSON.stringify(editingSalesEquipment);
  }, [showSalesFormModal]);
  useEffect(() => {
    if (showInsuranceRentalFormModal && editingInsuranceRentalEquipment) insuranceModalInitialRef.current = JSON.stringify(editingInsuranceRentalEquipment);
  }, [showInsuranceRentalFormModal]);
  useEffect(() => {
    if (showSelfPayRentalFormModal && editingSelfPayRentalEquipment) selfPayModalInitialRef.current = JSON.stringify(editingSelfPayRentalEquipment);
  }, [showSelfPayRentalFormModal]);

  // 変更情報(changeRecords)が保存されたら、スプレッドシートへ自動同期（保存後・デバウンス4秒で連続編集を集約）
  //   ※ Firestore保存が完了してから呼ぶこと（同期Functionは保存済みデータを読む）
  const scheduleChangeRecordsSync = (crJson: string) => {
    if (changeRecordsSyncTimerRef.current) clearTimeout(changeRecordsSyncTimerRef.current);
    changeRecordsSyncTimerRef.current = setTimeout(async () => {
      try {
        await syncChangeRecordsToSheets();
        lastSyncedChangeRecordsRef.current = crJson;
      } catch (e) {
        console.error('[changeRecords auto-sync] スプレッドシート同期に失敗:', e);
      }
    }, 4000);
  };

  // デバウンス自動保存: editedClient が保存済み状態と異なれば1.2秒後に保存
  useEffect(() => {
    if (anyEquipmentModalOpen) return; // モーダル編集中は保存しない
    const currentJson = JSON.stringify(editedClient);
    if (currentJson === lastSavedJsonRef.current) return; // 変更なし

    const timer = setTimeout(async () => {
      lastSavedJsonRef.current = currentJson; // onUpdateClient→setClients による再保存を防ぐため先にマーク
      setAutoSaveStatus('saving');
      try {
        await onUpdateClient(editedClient);
        setAutoSaveStatus('saved');
        window.setTimeout(() => setAutoSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2000);
        // 変更情報が変わっていればスプレッドシートへ自動同期（保存完了後）
        const crJson = JSON.stringify(editedClient.changeRecords || []);
        if (crJson !== lastSyncedChangeRecordsRef.current) scheduleChangeRecordsSync(crJson);
      } catch (e) {
        console.error('[autosave] 自動保存に失敗:', e);
        setAutoSaveStatus('error');
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [editedClient, anyEquipmentModalOpen]);

  // 画面を閉じる（アンマウント）時に未保存の編集をフラッシュ保存
  //   ただし機器モーダルが開いたまま閉じた場合は、空プレースホルダ等を保存しないようスキップ
  const anyEquipmentModalOpenRef = useRef(false);
  anyEquipmentModalOpenRef.current = anyEquipmentModalOpen;
  useEffect(() => {
    return () => {
      if (!anyEquipmentModalOpenRef.current &&
          JSON.stringify(editedClientRef.current) !== lastSavedJsonRef.current) {
        onUpdateClient(editedClientRef.current);
      }
    };
  }, []);

  // ベッド管理在庫を一度だけ読み込み
  useEffect(() => {
    getAllEquipmentItems().then(items => {
      setInventoryBeds(items.filter(i => i.status !== '販売済み' && i.status !== '破棄済み'));
    }).catch(() => {});
  }, []);

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
      lastSavedJsonRef.current = JSON.stringify(editedClient); // 自動保存との二重保存を防止
      await onUpdateClient(editedClient);
      setSaveSuccess(true);
      setIsEditing(false);
      setPendingRecordIds(new Set());
      // 変更情報が変わっていればスプレッドシートへ自動同期（保存完了後）
      const crJson = JSON.stringify(editedClient.changeRecords || []);
      if (crJson !== lastSyncedChangeRecordsRef.current) scheduleChangeRecordsSync(crJson);
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

  // ===== 変更履歴ハンドラ =====
  const todayStr = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  // 追跡対象フィールドの変更を検知し、実効日入力ダイアログを開く（値は既に editedClient に適用済み前提）
  const requestHistoryChange = (field: string, oldRaw: any, newRaw: any) => {
    const oldValue = displayHistoryValue(field, oldRaw);
    const newValue = displayHistoryValue(field, newRaw);
    if (oldValue === newValue) return; // 実質変化なし
    setPendingHistory({ field, label: TRACKED_FIELD_LABELS[field] || field, oldValue, newValue });
    setHistoryDate(todayStr());
    setHistoryNote('');
  };

  // ダイアログで「記録」: 履歴エントリを追記
  const confirmHistory = () => {
    if (!pendingHistory) return;
    const ph = pendingHistory;
    setEditedClient(prev => {
      const existing = prev.attributeHistory || [];
      const additions: AttributeHistoryEntry[] = [];
      // 初回記録: 変更前の値をベースライン(effectiveFrom='')として残す
      //   （過去月の状態を正しく引けるようにするため）
      if (!existing.some(e => e.field === ph.field)) {
        additions.push({
          id: `hist-${Date.now()}-base-${Math.random().toString(36).slice(2, 7)}`,
          field: ph.field,
          value: ph.oldValue,
          effectiveFrom: '',
          recordedAt: new Date().toISOString(),
          note: '記録開始前の値',
        });
      }
      additions.push({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        field: ph.field,
        value: ph.newValue,
        effectiveFrom: historyDate,
        recordedAt: new Date().toISOString(),
        ...(historyNote.trim() ? { note: historyNote.trim() } : {}),
      });
      return { ...prev, attributeHistory: [...existing, ...additions] };
    });
    setPendingHistory(null);
  };

  // 履歴エントリの削除（誤記録の修正用）
  const deleteHistoryEntry = (id: string) => {
    setEditedClient(prev => ({ ...prev, attributeHistory: (prev.attributeHistory || []).filter(e => e.id !== id) }));
  };

  // 🕐 履歴表示ボタン
  const HistoryBtn: React.FC<{ field: string }> = ({ field }) => {
    const count = (editedClient.attributeHistory || []).filter(e => e.field === field).length;
    return (
      <button
        type="button"
        onClick={() => setViewHistoryField({ field, label: TRACKED_FIELD_LABELS[field] || field })}
        title={`変更履歴を表示${count ? `（${count}件）` : ''}`}
        className="ml-1 inline-flex items-center gap-0.5 align-middle text-gray-400 hover:text-primary-600 text-xs"
      >
        🕐{count > 0 && <span className="text-[10px] font-bold text-primary-600">{count}</span>}
      </button>
    );
  };

  // 選択/チェック項目用: 値を適用しつつ変更履歴を検知
  const handleTrackedSelect = (field: keyof Client, newValue: any) => {
    const oldValue = (editedClient as any)[field];
    handleChange(field, newValue);
    requestHistoryChange(field as string, oldValue, newValue);
  };
  // テキスト項目用: フォーカス時の値を記録 / 離脱時に差分検知
  const handleTrackedFocus = (field: string) => {
    textFocusRef.current[field] = (editedClient as any)[field] ?? '';
  };
  const handleTrackedBlur = (field: string) => {
    const before = textFocusRef.current[field];
    if (before === undefined) return;
    requestHistoryChange(field, before, (editedClient as any)[field]);
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

  const handleMeetImport = (importedText: string) => {
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
      content: importedText,
      reminder: 'なし',
      summary: ''
    };
    setEditedClient(prev => ({
      ...prev,
      meetings: [newMeeting, ...prev.meetings]
    }));
    setActiveTab('meetings');
    setIsEditing(true);
    setShowMeetImportModal(false);
    // AI議事録生成を自動実行
    setIsGeneratingSummary(newMeeting.id);
    generateMeetingSummary(importedText, newMeeting.type, editedClient.name).then((summary) => {
      setEditedClient(prev => ({
        ...prev,
        meetings: prev.meetings.map(m => m.id === newMeeting.id ? { ...m, summary } : m)
      }));
      setIsGeneratingSummary(null);
    }).catch(() => {
      setIsGeneratingSummary(null);
    });
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
          demoStartDate: '',
          demoEndDate: '',
          note: ''
      };
      setEditedClient(prev => ({
          ...prev,
          changeRecords: [newRecord, ...prev.changeRecords]
      }));
      setPendingRecordIds(prev => new Set([...prev, newRecord.id]));
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
  const handleAddEquipment = (type: 'planned' | 'selected', equipmentStatus?: EquipmentStatus, attribute?: PropertyAttribute) => {
    const status = equipmentStatus || '介護保険レンタル';
    const newEq: Equipment = {
        id: Date.now().toString(),
        name: '',
        category: '',
        office: editedClient.office || '鹿児島（ACG）',
        recorder: '',
        propertyAttribute: attribute || undefined,
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
      setPendingNewSalesEquipmentId(newEq.id);
    } else if (status === '介護保険レンタル') {
      setEditingInsuranceRentalEquipment(newEq);
      setShowInsuranceRentalFormModal(true);
      setPendingNewInsuranceRentalEquipmentId(newEq.id);
    } else if (status === '自費レンタル') {
      setEditingSelfPayRentalEquipment(newEq);
      setShowSelfPayRentalFormModal(true);
      setPendingNewSelfPayRentalEquipmentId(newEq.id);
    }

    if (!isEditing) {
      setIsEditing(true);
    }
  };

  // 販売フォームを保存
  const handleSaveSalesEquipment = (equipment: Equipment) => {
    // 納品日は必須（未入力だと月次売上ページに表示されないため）
    if (!equipment.deliveryDate || equipment.deliveryDate.trim() === '') {
      alert('納品日を入力してください。\n納品日が未入力の販売データは月次売上ページに表示されません。');
      return;
    }
    setEditedClient(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.map(eq =>
        eq.id === equipment.id ? equipment : eq
      )
    }));
    setShowSalesFormModal(false);
    setEditingSalesEquipment(null);
    setPendingNewSalesEquipmentId(null);
  };

  // 販売フォームをキャンセル（新規追加分は selectedEquipment から削除・未保存変更は確認）
  const handleCancelSalesModal = () => {
    const dirty = editingSalesEquipment &&
      JSON.stringify(editingSalesEquipment) !== salesModalInitialRef.current;
    if (dirty && !window.confirm('入力内容が保存されていません。破棄して閉じますか？')) return;
    if (pendingNewSalesEquipmentId) {
      const idToRemove = pendingNewSalesEquipmentId;
      setEditedClient(prev => ({
        ...prev,
        selectedEquipment: prev.selectedEquipment.filter(eq => eq.id !== idToRemove)
      }));
    }
    setShowSalesFormModal(false);
    setEditingSalesEquipment(null);
    setPendingNewSalesEquipmentId(null);
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
    setPendingNewInsuranceRentalEquipmentId(null);
  };

  // 介護保険レンタルフォームをキャンセル（新規追加分は削除・未保存変更は確認）
  const handleCancelInsuranceRentalModal = () => {
    const dirty = editingInsuranceRentalEquipment &&
      JSON.stringify(editingInsuranceRentalEquipment) !== insuranceModalInitialRef.current;
    if (dirty && !window.confirm('入力内容が保存されていません。破棄して閉じますか？')) return;
    if (pendingNewInsuranceRentalEquipmentId) {
      const idToRemove = pendingNewInsuranceRentalEquipmentId;
      setEditedClient(prev => ({
        ...prev,
        selectedEquipment: prev.selectedEquipment.filter(eq => eq.id !== idToRemove)
      }));
    }
    setShowInsuranceRentalFormModal(false);
    setEditingInsuranceRentalEquipment(null);
    setPendingNewInsuranceRentalEquipmentId(null);
  };

  // 自費レンタルフォームを保存
  const handleSaveSelfPayRentalEquipment = (equipment: Equipment) => {
    const newName = equipment.selfPayProductName || equipment.name || '';
    if (newName) {
      const duplicate = editedClient.selectedEquipment.find(eq =>
        eq.id !== equipment.id &&
        eq.status === '自費レンタル' &&
        (eq.selfPayProductName || eq.name || '') === newName
      );
      if (duplicate) {
        const ok = window.confirm(
          `「${newName}」は既に自費レンタルに登録されています。\n重複して登録しますか？`
        );
        if (!ok) return;
      }
    }
    setEditedClient(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.map(eq =>
        eq.id === equipment.id ? equipment : eq
      )
    }));
    setShowSelfPayRentalFormModal(false);
    setEditingSelfPayRentalEquipment(null);
    setPendingNewSelfPayRentalEquipmentId(null);
  };

  // 自費レンタルフォームをキャンセル（新規追加分は削除・未保存変更は確認）
  const handleCancelSelfPayRentalModal = () => {
    const dirty = editingSelfPayRentalEquipment &&
      JSON.stringify(editingSelfPayRentalEquipment) !== selfPayModalInitialRef.current;
    if (dirty && !window.confirm('入力内容が保存されていません。破棄して閉じますか？')) return;
    if (pendingNewSelfPayRentalEquipmentId) {
      const idToRemove = pendingNewSelfPayRentalEquipmentId;
      setEditedClient(prev => ({
        ...prev,
        selectedEquipment: prev.selectedEquipment.filter(eq => eq.id !== idToRemove)
      }));
    }
    setShowSelfPayRentalFormModal(false);
    setEditingSelfPayRentalEquipment(null);
    setPendingNewSelfPayRentalEquipmentId(null);
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
    // id が重複している場合（過去のインポートでの重複等）でも、最初の1件のみ削除する
    // → 重複の片方だけ消したいケースに対応
    setEditedClient(prev => {
      const list = (prev[listKey] || []) as Equipment[];
      const idx = list.findIndex(e => e.id === id);
      if (idx === -1) return prev;
      const newList = [...list.slice(0, idx), ...list.slice(idx + 1)];
      return { ...prev, [listKey]: newList };
    });
  };

  const handleSuggestEquipment = async () => {
    setIsSuggesting(true);
    const result = await suggestEquipment(editedClient);
    setSuggestionResult(result);
    setIsSuggesting(false);
  };

  // --- OCR Document Processing Handler ---
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessingOcr(true);
    setOcrResult(null);

    const result = await extractMedicalInfoFromDocument(file);
    setOcrResult(result);
    setIsProcessingOcr(false);

    // Clear the file input so the same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleApplyOcrResult = () => {
    if (!ocrResult?.success || !ocrResult.text) return;

    // Append OCR result to medical history with a separator
    const separator = editedClient.medicalHistory ? '\n\n--- PDF読み取り結果 ---\n' : '';
    const newMedicalHistory = editedClient.medicalHistory + separator + ocrResult.text;

    setEditedClient(prev => ({ ...prev, medicalHistory: newMedicalHistory }));
    setOcrResult(null);

    // Auto-enable editing mode
    if (!isEditing) {
      setIsEditing(true);
    }
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
          <p className="text-sm text-gray-500 mt-1">ID: {editedClient.id}{editedClient.facilityName ? ` | ${editedClient.facilityName}` : ' | 在宅'}</p>
        </div>
        <div className="flex gap-3 items-center">
          {/* 自動保存ステータス */}
          {autoSaveStatus === 'saving' && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              自動保存中…
            </div>
          )}
          {autoSaveStatus === 'saved' && (
            <div className="flex items-center gap-1.5 text-green-600 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              自動保存しました
            </div>
          )}
          {autoSaveStatus === 'error' && (
            <div className="flex items-center gap-1.5 text-red-600 text-sm font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              自動保存に失敗（手動保存してください）
            </div>
          )}
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
                onClick={() => { setIsEditing(false); setEditedClient(client); setPendingRecordIds(new Set()); }}
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
          { id: 'documents', label: '書類管理' },
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
                    <label className="block text-sm font-medium text-gray-500 mb-1">事業所<HistoryBtn field="office" /></label>
                    <select
                      disabled={!isEditing}
                      value={editedClient.office}
                      onChange={(e) => handleTrackedSelect('office', e.target.value as OfficeLocation)}
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

                  {/* 入居施設名・居室番号・在宅 */}
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">入居施設名<HistoryBtn field="facilityName" /></label>
                        <input
                            disabled={!isEditing}
                            value={editedClient.facilityName}
                            onChange={(e) => handleChange('facilityName', e.target.value)}
                            onFocus={() => handleTrackedFocus('facilityName')}
                            onBlur={() => handleTrackedBlur('facilityName')}
                            placeholder="施設に入居している場合に入力"
                            className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">居室番号<HistoryBtn field="roomNumber" /></label>
                        <input
                            disabled={!isEditing}
                            value={editedClient.roomNumber}
                            onChange={(e) => handleChange('roomNumber', e.target.value)}
                            onFocus={() => handleTrackedFocus('roomNumber')}
                            onBlur={() => handleTrackedBlur('roomNumber')}
                            placeholder="例: 101"
                            className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">在宅区分<HistoryBtn field="location" /></label>
                        <select
                            disabled={!isEditing}
                            value={editedClient.location}
                            onChange={(e) => handleTrackedSelect('location', e.target.value)}
                            className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        >
                            <option value="">ー</option>
                            <option value="自宅">自宅</option>
                            <option value="外部施設">外部施設</option>
                            <option value="その他">その他</option>
                        </select>
                     </div>
                  </div>

                  {/* 福祉用具利用者・レセプトチェック対象（縦2行）＋ 請求区分（隣） */}
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    {/* 左: 2つのフラグを縦に */}
                    <div className="flex flex-col gap-3">
                      {/* 福祉用具利用フラグ */}
                      <div className="flex items-center">
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!isEditing}
                            checked={editedClient.isWelfareEquipmentUser}
                            onChange={(e) => handleTrackedSelect('isWelfareEquipmentUser', e.target.checked)}
                            className="w-5 h-5 text-green-600 border-gray-300 rounded focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className="ml-3 text-sm font-medium text-gray-700">福祉用具利用者<HistoryBtn field="isWelfareEquipmentUser" /></span>
                        </label>
                        <span className="ml-2 text-xs text-gray-500">（介護保険・自費レンタル・販売すべて含む）</span>
                      </div>

                      {/* レセプトチェック対象フラグ */}
                      <div className="flex items-center">
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!isEditing}
                            checked={editedClient.receiptCheckTarget === true}
                            ref={el => {
                              if (el) el.indeterminate = editedClient.receiptCheckTarget === undefined;
                            }}
                            onChange={(e) => handleTrackedSelect('receiptCheckTarget', e.target.checked ? true : false)}
                            className="w-5 h-5 text-rose-600 border-gray-300 rounded focus:ring-2 focus:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className="ml-3 text-sm font-medium text-gray-700">レセプトチェック対象<HistoryBtn field="receiptCheckTarget" /></span>
                        </label>
                        <span className="ml-2 text-xs text-gray-500">
                          {editedClient.receiptCheckTarget === true && '（強制追加）'}
                          {editedClient.receiptCheckTarget === false && '（強制除外）'}
                          {editedClient.receiptCheckTarget === undefined && '（自動判定）'}
                        </span>
                      </div>
                    </div>

                    {/* 右: 請求区分 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">請求区分<HistoryBtn field="billingCategory" /></label>
                      <select
                        disabled={!isEditing}
                        value={editedClient.billingCategory}
                        onChange={(e) => handleTrackedSelect('billingCategory', e.target.value as BillingCategory)}
                        className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                      >
                        <option value="">ー</option>
                        <option value="自費レンタル">自費レンタル</option>
                        <option value="介護保険レンタル">介護保険レンタル</option>
                        <option value="併用">併用</option>
                      </select>
                    </div>
                  </div>

                </div>

                {/* ケアマネージャー情報 */}
                <div className="border-t border-gray-200 my-6"></div>
                <h3 className="text-lg font-bold text-gray-800 border-l-4 border-blue-500 pl-3 mb-6">ケアマネージャー情報</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                   <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">居宅介護支援事業所<HistoryBtn field="careSupportOffice" /></label>
                      <input
                          disabled={!isEditing}
                          value={editedClient.careSupportOffice}
                          onChange={(e) => handleChange('careSupportOffice', e.target.value)}
                          onFocus={() => handleTrackedFocus('careSupportOffice')}
                          onBlur={() => handleTrackedBlur('careSupportOffice')}
                          className="w-full p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                   </div>
                   <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">担当CM<HistoryBtn field="careManager" /></label>
                      <input
                          disabled={!isEditing}
                          value={editedClient.careManager}
                          onChange={(e) => handleChange('careManager', e.target.value)}
                          onFocus={() => handleTrackedFocus('careManager')}
                          onBlur={() => handleTrackedBlur('careManager')}
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
                        <label className="block text-sm font-bold text-gray-700 mb-1">要介護度<HistoryBtn field="careLevel" /></label>
                        <select
                          disabled={!isEditing}
                          value={editedClient.careLevel}
                          onChange={(e) => handleTrackedSelect('careLevel', e.target.value as CareLevel)}
                          className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                        >
                          <option value="">ー</option>
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
                          <label className="block text-sm font-bold text-gray-700 mb-1">負担割合<HistoryBtn field="copayRate" /></label>
                          <select
                              disabled={!isEditing}
                              value={editedClient.copayRate}
                              onChange={(e) => handleTrackedSelect('copayRate', e.target.value as CopayRate)}
                              className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                          >
                              <option value="">ー</option>
                              <option value="1割">1割</option>
                              <option value="2割">2割</option>
                              <option value="3割">3割</option>
                          </select>
                      </div>

                      {/* 介護保険被保険者証 */}
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">介護保険被保険者証<HistoryBtn field="insuranceCardStatus" /></label>
                          <select
                              disabled={!isEditing}
                              value={editedClient.insuranceCardStatus}
                              onChange={(e) => handleTrackedSelect('insuranceCardStatus', e.target.value as ConfirmationStatus)}
                              className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                          >
                              <option value="">ー</option>
                              <option value="確認済">確認済</option>
                              <option value="未確認">未確認</option>
                          </select>
                      </div>

                      {/* 介護保険負担割合証 */}
                      <div>
                          <label className="block text-sm font-bold text-gray-700 mb-1">介護保険負担割合証<HistoryBtn field="burdenProportionCertificateStatus" /></label>
                          <select
                              disabled={!isEditing}
                              value={editedClient.burdenProportionCertificateStatus}
                              onChange={(e) => handleTrackedSelect('burdenProportionCertificateStatus', e.target.value as ConfirmationStatus)}
                              className="w-full p-2 border rounded border-gray-300 disabled:bg-white disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                          >
                              <option value="">ー</option>
                              <option value="確認済">確認済</option>
                              <option value="未確認">未確認</option>
                          </select>
                      </div>
                  </div>
                </div>

                {/* 支払い区分 */}
                <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">支払い区分<HistoryBtn field="paymentType" /></label>
                    <select
                        disabled={!isEditing}
                        value={editedClient.paymentType}
                        onChange={(e) => handleTrackedSelect('paymentType', e.target.value as PaymentType)}
                        className="w-full md:w-1/2 p-2 border rounded border-gray-300 disabled:bg-gray-50 disabled:text-gray-600 focus:ring-2 focus:ring-primary-500 outline-none"
                    >
                        <option value="">ー</option>
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

          {/* --- Documents Tab --- */}
          {activeTab === 'documents' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <DocumentsTab client={client} onUpdateClient={onUpdateClient} />
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

              {/* --- OCR Document Upload Section --- */}
              <div className="mt-4 p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="ocr-file-upload"
                />
                <label
                  htmlFor="ocr-file-upload"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  {isProcessingOcr ? (
                    <>
                      <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-sm text-blue-600 font-medium">AI解析中...</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <span className="text-sm text-gray-600">
                        <span className="text-blue-600 font-medium">PDF/画像をアップロード</span>して病歴を読み取り
                      </span>
                      <span className="text-xs text-gray-400">診療情報提供書、退院サマリー等（PDF, PNG, JPG, WEBP / 最大20MB）</span>
                    </>
                  )}
                </label>
              </div>

              {/* --- OCR Result Display --- */}
              {ocrResult && (
                <div className={`mt-4 border rounded-lg p-4 ${ocrResult.success ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h4 className={`font-bold flex items-center gap-2 ${ocrResult.success ? 'text-blue-800' : 'text-red-800'}`}>
                      {ocrResult.success ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                          読み取り結果
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                          </svg>
                          エラー
                        </>
                      )}
                    </h4>
                    <button
                      onClick={() => setOcrResult(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className={`text-sm whitespace-pre-wrap leading-relaxed mb-3 ${ocrResult.success ? 'text-blue-800' : 'text-red-800'}`}>
                    {ocrResult.text}
                  </div>
                  {ocrResult.success && (
                    <button
                      onClick={handleApplyOcrResult}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      病歴欄に反映
                    </button>
                  )}
                </div>
              )}

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
                  onClick={() => setShowMeetImportModal(true)}
                  className="bg-green-600 text-white hover:bg-green-700 px-4 py-2 rounded-lg shadow-md text-sm font-bold flex items-center gap-2 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
                  </svg>
                  Meetメモから作成
                </button>
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

                      // ラベルからChangeInfoTypeへの変換
                      const labelToInfoType = (label: string): ChangeInfoType => {
                          if (label === '入院') return '入院（サービス停止）';
                          if (label === '退院') return '退院（サービス開始）';
                          if (label === '新規') return '新規';
                          if (label === '解約') return '解約';
                          if (label === '変更あり') return '変更あり';
                          if (label === 'その他') return 'その他';
                          if (label === 'デモ') return 'デモ';
                          return '新規';
                      };

                      // 保存前の「入力中」レコードを分離（種別変更しても上部に固定）
                      const pendingRecords = editedClient.changeRecords.filter(r => pendingRecordIds.has(r.id));
                      // 全てのレコードを分類（pendingを除外）
                      const otherRecords = editedClient.changeRecords.filter(r => !pendingRecordIds.has(r.id));
                      const hospitalRecords = otherRecords.filter(r => r.infoType === '入院（サービス停止）');
                      const dischargeRecords = otherRecords.filter(r => r.infoType === '退院（サービス開始）');
                      const newRecords = otherRecords.filter(r => r.infoType === '新規');
                      const cancelRecords = otherRecords.filter(r => r.infoType === '解約');
                      const changeAndOtherRecords = otherRecords
                          .filter(r => r.infoType === '変更あり' || r.infoType === 'その他' || r.infoType === 'デモ')
                          .sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));

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

                      // 新規と解約のペアを作成（手動ペア優先、次にrecordDateベース）
                      const contractPairs: Array<{ newRecord: ClientChangeRecord; cancelRecord?: ClientChangeRecord }> = [];
                      const usedCancelIds = new Set<string>();
                      const usedNewIds = new Set<string>();

                      const sortedNew = [...newRecords].sort((a, b) =>
                          (b.recordDate || '').localeCompare(a.recordDate || '')
                      );

                      // Step 1: 手動ペア（pairedWithNewRecordId が設定されている解約）を先に処理
                      cancelRecords
                          .filter(c => c.pairedWithNewRecordId)
                          .forEach(cancelRec => {
                              const targetNew = newRecords.find(n => n.id === cancelRec.pairedWithNewRecordId);
                              if (targetNew && !usedCancelIds.has(cancelRec.id) && !usedNewIds.has(targetNew.id)) {
                                  usedCancelIds.add(cancelRec.id);
                                  usedNewIds.add(targetNew.id);
                                  contractPairs.push({ newRecord: targetNew, cancelRecord: cancelRec });
                              }
                          });

                      // Step 2: 残りを日付ベースで自動ペア
                      sortedNew
                          .filter(n => !usedNewIds.has(n.id))
                          .forEach(newRec => {
                              const matchingCancel = cancelRecords
                                  .filter(c => !usedCancelIds.has(c.id) && !c.pairedWithNewRecordId)
                                  .filter(c => (c.recordDate || '') >= (newRec.recordDate || ''))
                                  .sort((a, b) => (a.recordDate || '').localeCompare(b.recordDate || ''))[0];

                              if (matchingCancel) {
                                  usedCancelIds.add(matchingCancel.id);
                                  contractPairs.push({ newRecord: newRec, cancelRecord: matchingCancel });
                              } else {
                                  contractPairs.push({ newRecord: newRec });
                              }
                          });

                      // 表示順を新規 recordDate 降順に統一
                      contractPairs.sort((a, b) =>
                          (b.newRecord.recordDate || '').localeCompare(a.newRecord.recordDate || '')
                      );

                      // ペアになっていない解約
                      const unpairedCancels = cancelRecords
                          .filter(c => !usedCancelIds.has(c.id))
                          .sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));

                      // 施設入居情報（Kintone由来・独立）
                      const facilityMoveInRecords = otherRecords.filter(r => r.infoType === '施設入居新規');
                      const facilityMoveOutRecords = otherRecords.filter(r => r.infoType === '施設入居解約');

                      const facilityPairs: Array<{ newRecord: ClientChangeRecord; cancelRecord?: ClientChangeRecord }> = [];
                      const usedFacilityMoveOutIds = new Set<string>();
                      const sortedFacilityMoveIn = [...facilityMoveInRecords].sort((a, b) =>
                          (b.recordDate || '').localeCompare(a.recordDate || '')
                      );
                      sortedFacilityMoveIn.forEach(newRec => {
                          const matchingMoveOut = facilityMoveOutRecords
                              .filter(c => !usedFacilityMoveOutIds.has(c.id))
                              .filter(c => (c.recordDate || '') >= (newRec.recordDate || ''))
                              .sort((a, b) => (a.recordDate || '').localeCompare(b.recordDate || ''))[0];
                          if (matchingMoveOut) {
                              usedFacilityMoveOutIds.add(matchingMoveOut.id);
                              facilityPairs.push({ newRecord: newRec, cancelRecord: matchingMoveOut });
                          } else {
                              facilityPairs.push({ newRecord: newRec });
                          }
                      });
                      facilityPairs.sort((a, b) =>
                          (b.newRecord.recordDate || '').localeCompare(a.newRecord.recordDate || '')
                      );
                      const unpairedFacilityMoveOuts = facilityMoveOutRecords
                          .filter(c => !usedFacilityMoveOutIds.has(c.id))
                          .sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));

                      return (
                          <>

                              {/* 入力中レコード（保存前は種別に関わらず最上部に固定） */}
                              {pendingRecords.map((record) => {
                                  const label = getInfoTypeLabel(record.infoType);
                                  // 種別に応じた日付フィールド
                                  const dateField = (() => {
                                      if (record.infoType === '新規') return { label: '請求開始日（新規）', key: 'billingStartDateNew' as keyof ClientChangeRecord };
                                      if (record.infoType === '入院（サービス停止）') return { label: '請求停止日（入院）', key: 'billingStopDateHospital' as keyof ClientChangeRecord };
                                      if (record.infoType === '退院（サービス開始）') return { label: '請求開始日（退院）', key: 'billingStartDateDischarge' as keyof ClientChangeRecord };
                                      if (record.infoType === '解約') return { label: '請求停止日（解約）', key: 'billingStopDateCancel' as keyof ClientChangeRecord };
                                      return null; // デモは別途2フィールドで表示
                                  })();
                                  return (
                                      <div key={record.id} className="bg-white rounded-xl shadow-sm border-2 border-amber-300 overflow-hidden">
                                          <div className="p-4 bg-amber-50 flex justify-between items-center border-b border-amber-200">
                                              <h4 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                                                  </svg>
                                                  入力中
                                                  <span className="ml-1 px-2 py-0.5 bg-amber-200 text-amber-900 rounded-full text-xs font-semibold">{label}</span>
                                              </h4>
                                              <span className="text-xs text-gray-400">ID: {record.id}</span>
                                          </div>
                                          <div className="p-5 bg-amber-50/30 space-y-3">
                                              {/* 情報種別 + 入力日 */}
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                      <select value={label} onChange={(e) => {
                                                          updateChangeRecord(record.id, 'infoType', labelToInfoType(e.target.value));
                                                      }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                          <option value="新規">新規</option>
                                                          <option value="入院">入院</option>
                                                          <option value="退院">退院</option>
                                                          <option value="解約">解約</option>
                                                          <option value="変更あり">変更あり</option>
                                                          <option value="その他">その他</option>
                                                          <option value="デモ">デモ</option>
                                                      </select>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                      <input type="date" value={record.recordDate} onChange={(e) => updateChangeRecord(record.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                              </div>
                                              {/* 種別固有の日付フィールド */}
                                              {dateField && (
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">{dateField.label}</label>
                                                      <input type="date" value={String(record[dateField.key] || '')} onChange={(e) => updateChangeRecord(record.id, dateField.key, e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                              )}
                                              {/* デモ開始日・デモ終了日 */}
                                              {record.infoType === 'デモ' && (
                                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">デモ開始日</label>
                                                          <input type="date" value={record.demoStartDate || ''} onChange={(e) => updateChangeRecord(record.id, 'demoStartDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">デモ終了日</label>
                                                          <input type="date" value={record.demoEndDate || ''} onChange={(e) => updateChangeRecord(record.id, 'demoEndDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                  </div>
                                              )}
                                              {/* 記録者 + 事業所 */}
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                      <input value={record.recorder} onChange={(e) => updateChangeRecord(record.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                      <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                  </div>
                                              </div>
                                              {/* 特記 */}
                                              <div>
                                                  <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                  <textarea value={record.note} onChange={(e) => updateChangeRecord(record.id, 'note', e.target.value)} className="w-full h-20 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                              </div>
                                              {/* 削除ボタン */}
                                              <div className="flex justify-end pt-2 border-t border-amber-200">
                                                  <button onClick={() => {
                                                      if (confirm('この変更情報を削除しますか？')) {
                                                          setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== record.id) }));
                                                          setPendingRecordIds(prev => { const s = new Set(prev); s.delete(record.id); return s; });
                                                      }
                                                  }} className="text-red-500 hover:text-red-700 text-sm font-bold flex items-center gap-1">
                                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                      </svg>
                                                      削除
                                                  </button>
                                              </div>
                                          </div>
                                      </div>
                                  );
                              })}

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
                                                          const infoType = labelToInfoType(e.target.value);
                                                          updateChangeRecord(pair.hospital.id, 'infoType', infoType);
                                                      }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                          <option value="新規">新規</option>
                                                          <option value="入院">入院</option>
                                                          <option value="退院">退院</option>
                                                          <option value="解約">解約</option>
                                                          <option value="変更あり">変更あり</option>
                                                          <option value="その他">その他</option>
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
                                                              const infoType = labelToInfoType(e.target.value);
                                                              updateChangeRecord(pair.discharge.id, 'infoType', infoType);
                                                          }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                              <option value="新規">新規</option>
                                                              <option value="入院">入院</option>
                                                              <option value="退院">退院</option>
                                                              <option value="解約">解約</option>
                                                              <option value="変更あり">変更あり</option>
                                                              <option value="その他">その他</option>
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

                              {/* 変更あり・その他・デモレコード */}
                              {changeAndOtherRecords.map((record) => {
                                  const isChange = record.infoType === '変更あり';
                                  const isDemo = record.infoType === 'デモ';
                                  const headerBg = isChange ? 'bg-emerald-50 border-b border-emerald-100' : isDemo ? 'bg-cyan-50 border-b border-cyan-100' : 'bg-slate-50 border-b border-slate-100';
                                  const headerText = isChange ? 'text-emerald-800' : isDemo ? 'text-cyan-800' : 'text-slate-700';
                                  const cardBg = isChange ? 'bg-emerald-50 border-emerald-100' : isDemo ? 'bg-cyan-50 border-cyan-100' : 'bg-slate-50 border-slate-100';
                                  return (
                                      <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                          <div className={`p-4 flex justify-between items-center ${headerBg}`}>
                                              <h4 className={`text-sm font-bold flex items-center gap-2 ${headerText}`}>
                                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                                                  </svg>
                                                  {record.infoType}
                                              </h4>
                                              <span className="text-xs text-gray-400">{record.recordDate} | ID: {record.id}</span>
                                          </div>
                                          <div className="p-6">
                                              <div className={`p-4 rounded-lg border ${cardBg} space-y-3`}>
                                                  {/* 情報種別 + 入力日 */}
                                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                          <select disabled={!isEditing} value={getInfoTypeLabel(record.infoType)} onChange={(e) => {
                                                              const infoType = labelToInfoType(e.target.value);
                                                              updateChangeRecord(record.id, 'infoType', infoType);
                                                          }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                              <option value="新規">新規</option>
                                                              <option value="入院">入院</option>
                                                              <option value="退院">退院</option>
                                                              <option value="解約">解約</option>
                                                              <option value="変更あり">変更あり</option>
                                                              <option value="その他">その他</option>
                                                              <option value="デモ">デモ</option>
                                                          </select>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                          <input type="date" disabled={!isEditing} value={record.recordDate} onChange={(e) => updateChangeRecord(record.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                  </div>
                                                  {/* デモ開始日・デモ終了日 */}
                                                  {record.infoType === 'デモ' && (
                                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                          <div>
                                                              <label className="block text-xs font-bold text-gray-600 mb-1">デモ開始日</label>
                                                              <input type="date" disabled={!isEditing} value={record.demoStartDate || ''} onChange={(e) => updateChangeRecord(record.id, 'demoStartDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                          </div>
                                                          <div>
                                                              <label className="block text-xs font-bold text-gray-600 mb-1">デモ終了日</label>
                                                              <input type="date" disabled={!isEditing} value={record.demoEndDate || ''} onChange={(e) => updateChangeRecord(record.id, 'demoEndDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                          </div>
                                                      </div>
                                                  )}
                                                  {/* 記録者 + 事業所 */}
                                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                          <input disabled={!isEditing} value={record.recorder} onChange={(e) => updateChangeRecord(record.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                          <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                      </div>
                                                  </div>
                                                  {/* 特記 */}
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                      <textarea disabled={!isEditing} value={record.note} onChange={(e) => updateChangeRecord(record.id, 'note', e.target.value)} className="w-full h-20 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                                  </div>
                                                  {/* 削除ボタン */}
                                                  {isEditing && (
                                                      <div className="flex justify-end pt-2 border-t border-gray-200">
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
                                      </div>
                                  );
                              })}

                              {/* 新規・解約ペア（横並び表示） */}
                              {contractPairs.map((pair, idx) => (
                                  <div key={`contract-pair-${pair.newRecord.id}`} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-purple-50 flex justify-between items-center border-b border-purple-100">
                                          <h4 className="text-sm font-bold text-purple-800 flex items-center gap-2">
                                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>
                                              契約情報
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
                                                          const infoType = labelToInfoType(e.target.value);
                                                          updateChangeRecord(pair.newRecord.id, 'infoType', infoType);
                                                      }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                          <option value="新規">新規</option>
                                                          <option value="入院">入院</option>
                                                          <option value="退院">退院</option>
                                                          <option value="解約">解約</option>
                                                          <option value="変更あり">変更あり</option>
                                                          <option value="その他">その他</option>
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
                                              <div className={`p-4 rounded-lg border ${pair.cancelRecord.pairedWithNewRecordId ? 'bg-amber-50 border-amber-300' : 'bg-gray-100 border-gray-200'}`}>
                                                  <div className="flex justify-between items-start mb-3">
                                                      <div className="flex items-center gap-2">
                                                          <h5 className="text-sm font-bold text-gray-800">解約</h5>
                                                          {pair.cancelRecord.pairedWithNewRecordId && (
                                                              <span className="text-xs px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded font-medium">手動ペア</span>
                                                          )}
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                          {isEditing && (
                                                              <select
                                                                  value={pair.cancelRecord.pairedWithNewRecordId || ''}
                                                                  onChange={e => {
                                                                      const val = e.target.value;
                                                                      updateChangeRecord(pair.cancelRecord!.id, 'pairedWithNewRecordId', val || undefined);
                                                                  }}
                                                                  className="text-xs border border-amber-300 rounded px-1.5 py-0.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                                                  title="ペア先の新規レコードを変更"
                                                              >
                                                                  <option value="">ペアを自動設定</option>
                                                                  {newRecords.map(n => (
                                                                      <option key={n.id} value={n.id}>
                                                                          {`新規 ${n.billingStartDateNew || n.recordDate || n.id.slice(-6)}`}
                                                                      </option>
                                                                  ))}
                                                              </select>
                                                          )}
                                                          <span className="text-xs text-gray-400">ID: {pair.cancelRecord.id}</span>
                                                      </div>
                                                  </div>
                                                  <div className="space-y-3">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                          <select disabled={!isEditing} value={getInfoTypeLabel(pair.cancelRecord.infoType)} onChange={(e) => {
                                                              const infoType = labelToInfoType(e.target.value);
                                                              updateChangeRecord(pair.cancelRecord.id, 'infoType', infoType);
                                                          }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                              <option value="新規">新規</option>
                                                              <option value="入院">入院</option>
                                                              <option value="退院">退院</option>
                                                              <option value="解約">解約</option>
                                                              <option value="変更あり">変更あり</option>
                                                              <option value="その他">その他</option>
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
                                                      const infoType = labelToInfoType(e.target.value);
                                                      updateChangeRecord(record.id, 'infoType', infoType);
                                                  }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                      <option value="新規">新規</option>
                                                      <option value="入院">入院</option>
                                                      <option value="退院">退院</option>
                                                      <option value="解約">解約</option>
                                                      <option value="変更あり">変更あり</option>
                                                      <option value="その他">その他</option>
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
                                                      const infoType = labelToInfoType(e.target.value);
                                                      updateChangeRecord(record.id, 'infoType', infoType);
                                                  }} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white">
                                                      <option value="新規">新規</option>
                                                      <option value="入院">入院</option>
                                                      <option value="退院">退院</option>
                                                      <option value="解約">解約</option>
                                                      <option value="変更あり">変更あり</option>
                                                      <option value="その他">その他</option>
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

                              {/* 施設入居情報セクション（Kintone由来・独立、'新規'/'解約' とは別系統） */}
                              {facilityPairs.map((pair) => (
                                  <div key={`facility-pair-${pair.newRecord.id}`} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-teal-50 flex justify-between items-center border-b border-teal-100">
                                          <h4 className="text-sm font-bold text-teal-800 flex items-center gap-2">
                                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" /></svg>
                                              施設入居情報
                                          </h4>
                                          <span className="text-xs text-gray-400">
                                              {pair.newRecord.recordDate && `入居: ${pair.newRecord.recordDate}`}
                                              {pair.cancelRecord?.recordDate && ` → 退去: ${pair.cancelRecord.recordDate}`}
                                          </span>
                                      </div>

                                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                          {/* 左側: 施設入居新規 */}
                                          <div className="bg-teal-50/60 p-4 rounded-lg border border-teal-100">
                                              <div className="flex justify-between items-start mb-3">
                                                  <h5 className="text-sm font-bold text-teal-800">施設入居新規</h5>
                                                  <span className="text-xs text-gray-400">ID: {pair.newRecord.id}</span>
                                              </div>
                                              <div className="space-y-3">
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                      <div className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-700">施設入居新規</div>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                      <input type="date" disabled={!isEditing} value={pair.newRecord.recordDate} onChange={(e) => updateChangeRecord(pair.newRecord.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                  </div>
                                                  <div>
                                                      <label className="block text-xs font-bold text-gray-600 mb-1">入居日</label>
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
                                                          if (confirm('この変更情報を削除しますか？（次回のKintone同期で再生成される可能性があります）')) {
                                                              setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== pair.newRecord.id) }));
                                                          }
                                                      }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                                                  )}
                                              </div>
                                          </div>

                                          {/* 右側: 施設入居解約 */}
                                          {pair.cancelRecord ? (
                                              <div className="bg-gray-100 p-4 rounded-lg border border-gray-200">
                                                  <div className="flex justify-between items-start mb-3">
                                                      <h5 className="text-sm font-bold text-gray-800">施設入居解約</h5>
                                                      <span className="text-xs text-gray-400">ID: {pair.cancelRecord.id}</span>
                                                  </div>
                                                  <div className="space-y-3">
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                                          <div className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-700">施設入居解約</div>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                                          <input type="date" disabled={!isEditing} value={pair.cancelRecord.recordDate} onChange={(e) => updateChangeRecord(pair.cancelRecord!.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">退去日</label>
                                                          <input type="date" disabled={!isEditing} value={pair.cancelRecord.billingStopDateCancel} onChange={(e) => updateChangeRecord(pair.cancelRecord!.id, 'billingStopDateCancel', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                                          <input disabled={!isEditing} value={pair.cancelRecord.recorder} onChange={(e) => updateChangeRecord(pair.cancelRecord!.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">事業所 <span className="text-xs font-normal text-blue-600">（基本情報から参照）</span></label>
                                                          <input disabled value={editedClient.office} className="w-full border p-2 rounded text-sm bg-gray-50 border-gray-300 text-gray-600"/>
                                                      </div>
                                                      <div>
                                                          <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                                          <textarea disabled={!isEditing} value={pair.cancelRecord.note} onChange={(e) => updateChangeRecord(pair.cancelRecord!.id, 'note', e.target.value)} className="w-full h-16 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                                      </div>
                                                      {isEditing && (
                                                          <button onClick={() => {
                                                              if (confirm('この変更情報を削除しますか？（次回のKintone同期で再生成される可能性があります）')) {
                                                                  setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== pair.cancelRecord!.id) }));
                                                              }
                                                          }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                                                      )}
                                                  </div>
                                              </div>
                                          ) : (
                                              <div className="bg-gray-50 p-4 rounded-lg border border-dashed border-gray-300 flex items-center justify-center">
                                                  <p className="text-gray-400 text-sm">退去情報なし（入居中）</p>
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}

                              {/* ペアになっていない施設入居解約 */}
                              {unpairedFacilityMoveOuts.map((record) => (
                                  <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                      <div className="p-4 bg-gray-100 flex justify-between items-center">
                                          <h4 className="text-sm font-bold text-gray-800">施設入居解約（単独）</h4>
                                          <span className="text-xs text-gray-400">{record.recordDate} | ID: {record.id}</span>
                                      </div>
                                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">情報種別</label>
                                              <div className="w-full border p-2 rounded text-sm border-gray-200 bg-gray-50 text-gray-700">施設入居解約</div>
                                          </div>
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">入力日</label>
                                              <input type="date" disabled={!isEditing} value={record.recordDate} onChange={(e) => updateChangeRecord(record.id, 'recordDate', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                          </div>
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">退去日</label>
                                              <input type="date" disabled={!isEditing} value={record.billingStopDateCancel} onChange={(e) => updateChangeRecord(record.id, 'billingStopDateCancel', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                          </div>
                                          <div>
                                              <label className="block text-xs font-bold text-gray-600 mb-1">記録者</label>
                                              <input disabled={!isEditing} value={record.recorder} onChange={(e) => updateChangeRecord(record.id, 'recorder', e.target.value)} className="w-full border p-2 rounded text-sm border-gray-300 focus:border-accent-500 outline-none bg-white"/>
                                          </div>
                                          <div className="md:col-span-2">
                                              <label className="block text-xs font-bold text-gray-600 mb-1">特記</label>
                                              <textarea disabled={!isEditing} value={record.note} onChange={(e) => updateChangeRecord(record.id, 'note', e.target.value)} className="w-full h-16 p-2 border rounded text-sm border-gray-300 focus:border-accent-500 outline-none resize-none bg-white"/>
                                          </div>
                                          {isEditing && (
                                              <div className="md:col-span-2 flex justify-end">
                                                  <button onClick={() => {
                                                      if (confirm('この変更情報を削除しますか？（次回のKintone同期で再生成される可能性があります）')) {
                                                          setEditedClient(prev => ({ ...prev, changeRecords: prev.changeRecords.filter(r => r.id !== record.id) }));
                                                      }
                                                  }} className="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
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
              {(() => {
                const selfPayRentalItems = editedClient.selectedEquipment.filter(eq => eq.status === '自費レンタル');
                const salesItems = editedClient.selectedEquipment.filter(eq => eq.status === '販売');

                if (selfPayRentalItems.length === 0 && salesItems.length === 0) {
                  return (
                    <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                      自費レンタル・販売データはありません
                    </div>
                  );
                }

                return (
                  <div className="space-y-8">
                    {/* 自費レンタルセクション */}
                    {selfPayRentalItems.length > 0 && (
                      <div className="space-y-4">
                        <div className="bg-gradient-to-r from-purple-600 to-purple-500 text-white px-6 py-3 rounded-lg shadow-md">
                          <h3 className="font-bold text-lg flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                            自費レンタル
                            <span className="ml-2 bg-white/20 px-3 py-1 rounded-full text-sm">{selfPayRentalItems.length}件</span>
                          </h3>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-purple-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">商品名</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">数量</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">月額（税抜）</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">税区分</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">税込金額</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">利用開始日</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-purple-700 uppercase tracking-wider">利用終了日</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {selfPayRentalItems.map((eq) => (
                                  <tr key={eq.id} className="hover:bg-purple-50 transition-colors">
                                    <td className="px-4 py-3 font-medium">{eq.name || '-'}</td>
                                    <td className="px-4 py-3">{eq.quantity || 1}</td>
                                    <td className="px-4 py-3">{eq.unitPrice ? `¥${eq.unitPrice.toLocaleString()}` : '-'}</td>
                                    <td className="px-4 py-3">{eq.taxType || '-'}</td>
                                    <td className="px-4 py-3 font-bold text-purple-700">
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
                                    <td className="px-4 py-3">{eq.startDate || '-'}</td>
                                    <td className="px-4 py-3">{eq.endDate || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 販売セクション */}
                    {salesItems.length > 0 && (
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
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">送料（税抜）</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">送料消費税</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">総計</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">受注日</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">納品日</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">支払方法</th>
                                  <th className="px-4 py-3 text-left text-xs font-bold text-green-700 uppercase tracking-wider">申請</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {salesItems.map((eq) => (
                                  <tr key={eq.id} className="hover:bg-green-50 transition-colors">
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
                                    <td className="px-4 py-3">{eq.shippingCost ? `¥${eq.shippingCost.toLocaleString()}` : '-'}</td>
                                    <td className="px-4 py-3">
                                      {(() => {
                                        const shipping = eq.shippingCost || 0;
                                        return shipping > 0 ? `¥${Math.round(shipping * 0.1).toLocaleString()}` : '-';
                                      })()}
                                    </td>
                                    <td className="px-4 py-3 font-bold text-green-800">
                                      {(() => {
                                        const qty = eq.quantity || 1;
                                        const price = eq.unitPrice || 0;
                                        const taxType = eq.taxType || '非課税';
                                        if (!price) return '-';
                                        const subtotal = qty * price;
                                        let taxRate = 0;
                                        if (taxType === '10％') taxRate = 0.10;
                                        else if (taxType === '軽8％') taxRate = 0.08;
                                        const taxAmount = taxType === '税込' ? 0 : Math.floor(subtotal * taxRate);
                                        const taxIncluded = subtotal + taxAmount;
                                        const shipping = eq.shippingCost || 0;
                                        const shippingTax = shipping > 0 ? Math.round(shipping * 0.1) : 0;
                                        const adjustment = eq.totalAdjustment || 0;
                                        return `¥${(taxIncluded + shipping + shippingTax + adjustment).toLocaleString()}`;
                                      })()}
                                    </td>
                                    <td className="px-4 py-3">{eq.orderReceivedDate || '-'}</td>
                                    <td className="px-4 py-3">{eq.deliveryDate || '-'}</td>
                                    <td className="px-4 py-3">{eq.paymentMethod || '-'}</td>
                                    <td className="px-4 py-3">
                                      {eq.applicationStatus ? (
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                          {eq.applicationMunicipality || '申請中'}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Equipment Type Selection Modal */}
      {showEquipmentTypeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            {/* Step 1: 種類選択 */}
            {!pendingEquipmentType && (
              <>
                <h3 className="text-lg font-bold text-gray-800 mb-4">機器の種類を選択</h3>
                <div className="space-y-3">
                  <button
                    onClick={() => setPendingEquipmentType('介護保険レンタル')}
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
                    onClick={() => setPendingEquipmentType('自費レンタル')}
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
                    onClick={() => setPendingEquipmentType('販売')}
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
              </>
            )}

            {/* Step 2: 属性選択 */}
            {pendingEquipmentType && (
              <>
                <h3 className="text-lg font-bold text-gray-800 mb-2">属性を選択</h3>
                <p className="text-sm text-gray-500 mb-4">
                  種類: <span className={`font-bold ${
                    pendingEquipmentType === '介護保険レンタル' ? 'text-blue-600' :
                    pendingEquipmentType === '自費レンタル' ? 'text-purple-600' : 'text-green-600'
                  }`}>{pendingEquipmentType}</span>
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      handleAddEquipment('selected', pendingEquipmentType, '自社物件');
                      setPendingEquipmentType(null);
                    }}
                    className="w-full p-4 border-2 border-orange-200 hover:border-orange-500 hover:bg-orange-50 rounded-lg text-left transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                        <span className="text-orange-600 text-lg">🏠</span>
                      </div>
                      <div>
                        <div className="font-bold text-orange-700">自社物件</div>
                        <div className="text-sm text-gray-500">自社所有の福祉用具</div>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      handleAddEquipment('selected', pendingEquipmentType, 'リース物件');
                      setPendingEquipmentType(null);
                    }}
                    className="w-full p-4 border-2 border-teal-200 hover:border-teal-500 hover:bg-teal-50 rounded-lg text-left transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                        <span className="text-teal-600 text-lg">📋</span>
                      </div>
                      <div>
                        <div className="font-bold text-teal-700">リース物件</div>
                        <div className="text-sm text-gray-500">リース契約の福祉用具</div>
                      </div>
                    </div>
                  </button>
                </div>
                <button
                  onClick={() => setPendingEquipmentType(null)}
                  className="w-full mt-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
                >
                  ← 種類選択に戻る
                </button>
              </>
            )}
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
                onClick={handleCancelSalesModal}
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
                  <label className="block text-sm font-bold text-gray-600 mb-1">納品日<span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    value={editingSalesEquipment.deliveryDate || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, deliveryDate: e.target.value} : null)}
                    className={`w-full border rounded-lg p-2 focus:border-green-500 outline-none ${
                      !editingSalesEquipment.deliveryDate ? 'border-red-300 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                  {!editingSalesEquipment.deliveryDate && (
                    <p className="text-xs text-red-600 mt-1">月次売上に反映するために必須</p>
                  )}
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
                    <label className="block text-xs font-bold text-gray-600 mb-1">小計</label>
                    <div className="w-full border border-gray-200 bg-gray-50 p-2 rounded-lg text-right text-gray-700">
                      {(() => {
                        const qty = editingSalesEquipment.quantity || 1;
                        const price = editingSalesEquipment.unitPrice || 0;
                        return `¥${(qty * price).toLocaleString()}`;
                      })()}
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
                    <label className="block text-xs font-bold text-gray-600 mb-1">消費税</label>
                    <div className="w-full border border-gray-200 bg-gray-50 p-2 rounded-lg text-right text-gray-700">
                      {(() => {
                        const qty = editingSalesEquipment.quantity || 1;
                        const price = editingSalesEquipment.unitPrice || 0;
                        const taxType = editingSalesEquipment.taxType || '非課税';
                        const subtotal = qty * price;
                        let taxRate = 0;
                        if (taxType === '10％') taxRate = 0.10;
                        else if (taxType === '軽8％') taxRate = 0.08;
                        const taxAmount = taxType === '税込' ? 0 : Math.floor(subtotal * taxRate);
                        return `¥${taxAmount.toLocaleString()}`;
                      })()}
                    </div>
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
                        const taxAmount = taxType === '税込' ? 0 : Math.floor(subtotal * taxRate);
                        return `¥${(subtotal + taxAmount).toLocaleString()}`;
                      })()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">送料（税抜）</label>
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
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">送料消費税</label>
                    <div className="w-full border border-gray-200 bg-gray-50 p-2 rounded-lg text-right text-gray-700">
                      {(() => {
                        const shipping = editingSalesEquipment.shippingCost || 0;
                        return `¥${Math.round(shipping * 0.1).toLocaleString()}`;
                      })()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-orange-600 mb-1">調整額</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editingSalesEquipment.totalAdjustment ?? ''}
                        onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, totalAdjustment: e.target.value === '' ? 0 : parseInt(e.target.value)} : null)}
                        className="w-full border border-orange-300 rounded-lg p-2 focus:border-orange-500 outline-none text-right"
                        placeholder="0"
                      />
                      <span className="text-sm text-gray-500">円</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-purple-700 mb-1">総計</label>
                    <div className="w-full border border-purple-300 bg-purple-100 p-2 rounded-lg text-right font-bold text-purple-800">
                      {(() => {
                        const qty = editingSalesEquipment.quantity || 1;
                        const price = editingSalesEquipment.unitPrice || 0;
                        const taxType = editingSalesEquipment.taxType || '非課税';
                        const subtotal = qty * price;
                        let taxRate = 0;
                        if (taxType === '10％') taxRate = 0.10;
                        else if (taxType === '軽8％') taxRate = 0.08;
                        const taxAmount = taxType === '税込' ? 0 : Math.floor(subtotal * taxRate);
                        const taxIncluded = subtotal + taxAmount;
                        const shipping = editingSalesEquipment.shippingCost || 0;
                        const shippingTax = shipping > 0 ? Math.round(shipping * 0.1) : 0;
                        const adjustment = editingSalesEquipment.totalAdjustment || 0;
                        return `¥${(taxIncluded + shipping + shippingTax + adjustment).toLocaleString()}`;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* 取引情報 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">取引方法</label>
                  <select
                    value={editingSalesEquipment.transactionType || ''}
                    onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, transactionType: e.target.value as TransactionType} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="社内間取引">社内間取引</option>
                    <option value="ー">ー</option>
                  </select>
                </div>
              </div>

              {/* 支払い情報 */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="text-sm font-bold text-blue-700 mb-3">支払い・負担情報</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
                    <label className="block text-sm font-bold text-gray-600 mb-1">一部負担時の上限額</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editingSalesEquipment.burdenLimitAmount || ''}
                        onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, burdenLimitAmount: parseInt(e.target.value) || 0} : null)}
                        className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none text-right"
                        placeholder="0"
                        disabled={editingSalesEquipment.userBurdenType !== '一部負担（日常生活給付）'}
                      />
                      <span className="text-sm text-gray-500">円</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-blue-700 mb-1">利用者負担額</label>
                    <div className="w-full border border-blue-300 bg-blue-100 p-2 rounded-lg text-right font-bold text-blue-800">
                      {(() => {
                        const qty = editingSalesEquipment.quantity || 1;
                        const price = editingSalesEquipment.unitPrice || 0;
                        const taxType = editingSalesEquipment.taxType || '非課税';
                        const subtotal = qty * price;
                        let taxRate = 0;
                        if (taxType === '10％') taxRate = 0.10;
                        else if (taxType === '軽8％') taxRate = 0.08;
                        const taxAmount = taxType === '税込' ? 0 : Math.floor(subtotal * taxRate);
                        const taxIncluded = subtotal + taxAmount;
                        const shipping = editingSalesEquipment.shippingCost || 0;
                        const shippingTax = shipping > 0 ? Math.round(shipping * 0.1) : 0;
                        const adjustment = editingSalesEquipment.totalAdjustment || 0;
                        const grandTotal = taxIncluded + shipping + shippingTax + adjustment;

                        const burdenType = editingSalesEquipment.userBurdenType;
                        const limitAmount = editingSalesEquipment.burdenLimitAmount || 0;
                        let burdenAmount = 0;

                        if (burdenType === '自己負担０（日常生活給付）') {
                          burdenAmount = 0;
                        } else if (burdenType === '一部負担（日常生活給付）') {
                          burdenAmount = limitAmount > 0 ? Math.min(grandTotal, limitAmount) : grandTotal;
                        } else if (burdenType === '１割負担（受領委任払い）') {
                          burdenAmount = Math.floor(grandTotal * 0.1);
                        } else if (burdenType === '２割負担（受領委任払い）') {
                          burdenAmount = Math.floor(grandTotal * 0.2);
                        } else if (burdenType === '３割負担（受領委任払い）') {
                          burdenAmount = Math.floor(grandTotal * 0.3);
                        } else if (burdenType === '全額負担（償還払い）') {
                          burdenAmount = grandTotal;
                        } else {
                          burdenAmount = grandTotal;
                        }

                        return `¥${burdenAmount.toLocaleString()}`;
                      })()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-green-700 mb-1">申請額</label>
                    <div className="w-full border border-green-300 bg-green-100 p-2 rounded-lg text-right font-bold text-green-800">
                      {(() => {
                        const qty = editingSalesEquipment.quantity || 1;
                        const price = editingSalesEquipment.unitPrice || 0;
                        const taxType = editingSalesEquipment.taxType || '非課税';
                        const subtotal = qty * price;
                        let taxRate = 0;
                        if (taxType === '10％') taxRate = 0.10;
                        else if (taxType === '軽8％') taxRate = 0.08;
                        const taxAmount = taxType === '税込' ? 0 : Math.floor(subtotal * taxRate);
                        const taxIncluded = subtotal + taxAmount;
                        const shipping = editingSalesEquipment.shippingCost || 0;
                        const shippingTax = shipping > 0 ? Math.round(shipping * 0.1) : 0;
                        const adjustment = editingSalesEquipment.totalAdjustment || 0;
                        const grandTotal = taxIncluded + shipping + shippingTax + adjustment;

                        const burdenType = editingSalesEquipment.userBurdenType;
                        const limitAmount = editingSalesEquipment.burdenLimitAmount || 0;
                        let burdenAmount = 0;

                        if (burdenType === '自己負担０（日常生活給付）') {
                          burdenAmount = 0;
                        } else if (burdenType === '一部負担（日常生活給付）') {
                          burdenAmount = limitAmount > 0 ? Math.min(grandTotal, limitAmount) : grandTotal;
                        } else if (burdenType === '１割負担（受領委任払い）') {
                          burdenAmount = Math.floor(grandTotal * 0.1);
                        } else if (burdenType === '２割負担（受領委任払い）') {
                          burdenAmount = Math.floor(grandTotal * 0.2);
                        } else if (burdenType === '３割負担（受領委任払い）') {
                          burdenAmount = Math.floor(grandTotal * 0.3);
                        } else if (burdenType === '全額負担（償還払い）') {
                          burdenAmount = grandTotal;
                        } else {
                          burdenAmount = grandTotal;
                        }

                        const applicationAmount = grandTotal - burdenAmount;
                        return `¥${applicationAmount.toLocaleString()}`;
                      })()}
                    </div>
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
                      <option value="請求書払い">請求書払い</option>
                      <option value="受領委任払い">受領委任払い</option>
                      <option value="償還払い">償還払い</option>
                      <option value="日常生活給付">日常生活給付</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 申請情報 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingSalesEquipment.applicationStatus || false}
                      onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, applicationStatus: e.target.checked} : null)}
                      className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm font-bold text-gray-600">申請あり</span>
                  </label>
                  <div className="flex-1">
                    <select
                      value={editingSalesEquipment.applicationProgress || ''}
                      onChange={(e) => setEditingSalesEquipment(prev => prev ? {...prev, applicationProgress: e.target.value as ApplicationProgress} : null)}
                      className="w-full border border-gray-300 rounded-lg p-2 focus:border-green-500 outline-none text-sm"
                      disabled={!editingSalesEquipment.applicationStatus}
                    >
                      <option value="">進捗を選択</option>
                      <option value="未対応">未対応</option>
                      <option value="申請中">申請中</option>
                      <option value="申請済">申請済</option>
                    </select>
                  </div>
                </div>
                <div className="md:col-span-2">
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
                onClick={handleCancelSalesModal}
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
                    value={editingInsuranceRentalEquipment.propertyAttribute || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, propertyAttribute: (e.target.value as PropertyAttribute) || undefined} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-blue-500 outline-none"
                  >
                    <option value="">ー</option>
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
              {/* 自社物件の場合：ベッド管理との紐づけ */}
              {editingInsuranceRentalEquipment.propertyAttribute === '自社物件' && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <label className="block text-xs font-bold text-orange-700 mb-1">ベッド管理 紐づけ（任意）</label>
                  <select
                    value={editingInsuranceRentalEquipment.companyBedItemId || ''}
                    onChange={(e) => setEditingInsuranceRentalEquipment(prev => prev ? {...prev, companyBedItemId: e.target.value || undefined} : null)}
                    className="w-full border border-orange-300 rounded-lg p-2 focus:border-orange-500 outline-none text-sm"
                  >
                    <option value="">ー（紐づけなし）</option>
                    {inventoryBeds.map(bed => (
                      <option key={bed.id} value={bed.id}>
                        {bed.code} - {bed.name}（{bed.status}{bed.currentClientName ? ` / ${bed.currentClientName}使用中` : ''}）
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
                onClick={handleCancelInsuranceRentalModal}
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

            {/* 管理情報セクション */}
            <div className="mb-6">
              <h4 className="text-sm font-bold text-purple-700 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs">2</span>
                管理情報
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">属性</label>
                  <select
                    value={editingSelfPayRentalEquipment.propertyAttribute || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, propertyAttribute: (e.target.value as PropertyAttribute) || undefined} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                  >
                    <option value="">ー</option>
                    <option value="自社物件">自社物件</option>
                    <option value="リース物件">リース物件</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">取引方法</label>
                  <select
                    value={editingSelfPayRentalEquipment.transactionType || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, transactionType: e.target.value as TransactionType} : null)}
                    className="w-full border border-gray-300 rounded-lg p-2 focus:border-purple-500 outline-none"
                  >
                    <option value="">選択してください</option>
                    <option value="社内間取引">社内間取引</option>
                    <option value="ー">ー</option>
                  </select>
                </div>
              </div>
              {/* 自社物件の場合：ベッド管理との紐づけ */}
              {editingSelfPayRentalEquipment.propertyAttribute === '自社物件' && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <label className="block text-xs font-bold text-orange-700 mb-1">ベッド管理 紐づけ（任意）</label>
                  <select
                    value={editingSelfPayRentalEquipment.companyBedItemId || ''}
                    onChange={(e) => setEditingSelfPayRentalEquipment(prev => prev ? {...prev, companyBedItemId: e.target.value || undefined} : null)}
                    className="w-full border border-orange-300 rounded-lg p-2 focus:border-orange-500 outline-none text-sm"
                  >
                    <option value="">ー（紐づけなし）</option>
                    {inventoryBeds.map(bed => (
                      <option key={bed.id} value={bed.id}>
                        {bed.code} - {bed.name}（{bed.status}{bed.currentClientName ? ` / ${bed.currentClientName}使用中` : ''}）
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
                onClick={handleCancelSelfPayRentalModal}
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

      {/* Meet Import Modal */}
      <MeetImportModal
        isOpen={showMeetImportModal}
        onClose={() => setShowMeetImportModal(false)}
        onImport={handleMeetImport}
      />

      {/* 変更履歴: 実効日入力ダイアログ */}
      {pendingHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setPendingHistory(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">変更履歴の記録</h3>
            <p className="text-sm text-gray-500 mb-4">「{pendingHistory.label}」が変更されました。いつから有効かを入力してください。</p>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm flex items-center justify-center gap-3">
              <span className="px-2 py-1 bg-white border border-gray-300 rounded text-gray-500">{pendingHistory.oldValue}</span>
              <span className="text-primary-600 font-bold">→</span>
              <span className="px-2 py-1 bg-primary-50 border border-primary-300 rounded text-primary-700 font-bold">{pendingHistory.newValue}</span>
            </div>
            <label className="block text-sm font-bold text-gray-700 mb-1">実効日（いつから）</label>
            <input
              type="date"
              value={historyDate}
              onChange={e => setHistoryDate(e.target.value)}
              className="w-full p-2 border rounded border-gray-300 focus:ring-2 focus:ring-primary-500 outline-none mb-3"
            />
            <label className="block text-sm font-bold text-gray-700 mb-1">備考（任意）</label>
            <input
              type="text"
              value={historyNote}
              onChange={e => setHistoryNote(e.target.value)}
              placeholder="例: 区分変更申請の認定結果"
              className="w-full p-2 border rounded border-gray-300 focus:ring-2 focus:ring-primary-500 outline-none mb-5"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPendingHistory(null)}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 font-bold"
              >
                記録しない
              </button>
              <button
                type="button"
                disabled={!historyDate}
                onClick={confirmHistory}
                className="flex-1 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                記録する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 変更履歴: タイムライン表示 */}
      {viewHistoryField && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setViewHistoryField(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">🕐 {viewHistoryField.label} の変更履歴</h3>
              <button type="button" onClick={() => setViewHistoryField(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            {(() => {
              const entries = (editedClient.attributeHistory || [])
                .filter(e => e.field === viewHistoryField.field)
                .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
              if (entries.length === 0) {
                return <p className="text-sm text-gray-500 py-6 text-center">まだ変更履歴はありません。<br />編集して値を変更すると、ここに記録されます。</p>;
              }
              return (
                <ol className="relative border-l-2 border-primary-100 ml-2">
                  {entries.map((e, i) => (
                    <li key={e.id} className="ml-4 pb-5">
                      <span className={`absolute -left-[7px] w-3 h-3 rounded-full ${i === 0 ? 'bg-primary-600' : 'bg-primary-200'}`}></span>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-800">{e.effectiveFrom ? `${e.effectiveFrom}〜` : '（記録開始前）'}{i === 0 && <span className="ml-1 text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">現在</span>}</span>
                        {isEditing && (
                          <button type="button" onClick={() => deleteHistoryEntry(e.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
                        )}
                      </div>
                      <div className="text-base font-bold text-primary-700 mt-0.5">{e.value}</div>
                      {e.note && <div className="text-xs text-gray-500 mt-0.5">📝 {e.note}</div>}
                      <div className="text-[10px] text-gray-400 mt-0.5">記録: {e.recordedAt?.slice(0, 10)}</div>
                    </li>
                  ))}
                </ol>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDetail;