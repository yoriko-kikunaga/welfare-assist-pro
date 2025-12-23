
export type MeetingType = 
  'カンファレンス時' | 
  '担当者会議（新規）' | 
  '担当者会議（更新）' | 
  '担当者会議（退院時）' | 
  'その他';

export type UsageCategory = '介護保険レンタル' | '自費レンタル' | '購入' | '併用';
export type ConfirmationStatus = '確認済' | '未確認';
export type RegistrationStatus = '未登録' | '登録済';
export type OfficeLocation = '鹿児島（ACG）' | '福岡（Lichi）';
export type ReminderStatus = 'あり' | 'なし';

// 新規追加: 情報の種類
export type ChangeInfoType = '新規' | '入院（サービス停止）' | '退院（サービス開始）' | '解約' | '変更あり' | 'その他';
// 新規追加: 連絡状態
export type ContactStatus = '未対応' | '対応済';

// 福祉用具関連の型定義
export type EquipmentType = '車いす' | '車いす付属品' | '特殊寝台' | '特殊寝台付属品' | '床ずれ防止用具' | '体位変換器' | '歩行器' | '徘徊感知器' | '手すり' | '歩行補助つえ' | '移動用リフト' | 'スロープ' | 'その他';
export type PropertyAttribute = '自社物件' | 'リース物件';
export type EquipmentStatus = '介護保険貸与' | '自費利用' | '販売';
export type RegistrationState = '未登録' | '登録済';

// 売上管理関連の型定義
export type SalesStatus = '自費レンタル' | '販売';
export type TaxType = '非課税' | '10％' | '軽8％' | '税込';

export interface SalesRecord {
  id: string;
  office: OfficeLocation; // 事業所
  status: SalesStatus;
  aozoraId: string;
  clientName: string;
  facilityName: string;
  productName: string; // 商品名（請求費目）
  quantity: number; // 数量
  unitPrice: number; // 単価
  taxType: TaxType; // 税区分
}

export interface Equipment {
  id: string;
  name: string; // 商品名
  category: string; // 福祉用具の種類 (Planned uses string, Selected uses EquipmentType mostly)
  
  // 詳細フィールド (選定済み用)
  office?: OfficeLocation; // 事業所選択
  recorder?: string; // 記録者
  propertyAttribute?: PropertyAttribute; // 属性
  ownProductCategory?: string; // 自社：商品区分
  ownProductId?: string; // 自社：商品ID
  taisCode?: string; // 商品コード（タイスコード）
  manufacturer?: string; // メーカー
  wholesaler?: string; // 卸会社
  units?: string; // 単位数
  kaipokeStatus?: RegistrationState; // カイポケ登録
  status?: EquipmentStatus; // Status
  
  // 日付関連
  orderReceivedDate?: string; // 受注日
  orderPlacedDate?: string; // 発注日
  purchaseDate?: string; // 購入日
  deliveryDate?: string; // 納品日
  startDate?: string; // 利用開始日
  endDate?: string; // 利用終了日

  monthlyCost?: number; // 請求金額
  note?: string; // Legacy
}

export interface MeetingRecord {
  id: string;
  date: string;
  type: MeetingType;
  
  // 新規追加・変更フィールド
  office: OfficeLocation;    // 事業所選択
  recorder: string;          // 記録者
  place: string;             // 施設名
  attendees: string;         // 出席者
  careSupportOffice: string; // 居宅介護支援事業所
  careManager: string;       // 担当CM
  
  hospital: string;          // 病院名
  socialWorker: string;      // 担当SW

  usageCategory: UsageCategory;       // 利用区分
  carePlanStatus: ConfirmationStatus;     // ケアプラン
  serviceTicketStatus: ConfirmationStatus; // 提供票

  content: string; // 議事録内容
  reminder: ReminderStatus; // リマインダー
  summary?: string; // AI generated structured summary
}

// 新規追加: 利用者新規・変更情報レコード
export interface ClientChangeRecord {
  id: string;
  recordDate: string; // 作成日
  office: OfficeLocation; // 事業所選択
  infoType: ChangeInfoType; // 情報の種類
  recorder: string; // 記録者
  usageCategory: UsageCategory; // 利用区分
  
  // 詳細な日付・ステータス項目
  billingStartDateNew: string; // 請求開始日（新規）
  billingStopDateCancel: string; // 請求停止日（解約）
  
  billingStopDateHospital: string; // 請求停止日（入院）
  wholesalerStopContactStatus: ContactStatus; // 卸会社への停止連絡
  
  billingStartDateDischarge: string; // 請求開始日（退院日）
  wholesalerResumeContactStatus: ContactStatus; // 卸会社への再開連絡
  
  note: string; // 特記
}

export interface KeyPerson {
  name: string;
  relationship: string;
  contact: string;
}

export type CurrentStatus = '在宅' | '入院中' | '施設入居中';
export type PaymentType = '非生保' | '生保';
export type Gender = '男性' | '女性';
export type CareLevel = '申請中' | '要支援1' | '要支援2' | '要介護1' | '要介護2' | '要介護3' | '要介護4' | '要介護5';
export type CopayRate = '1割' | '2割' | '3割';

export interface Client {
  id: string;
  aozoraId: string; // あおぞらID

  // 基本情報
  name: string;
  nameKana: string;
  birthDate: string;
  gender: Gender;
  
  facilityName: string; // 入居施設名
  roomNumber: string;   // 居室番号
  
  // 介護保険情報グループ
  careLevel: CareLevel; // 要介護度
  copayRate: CopayRate;         // 負担割合
  insuranceCardStatus: ConfirmationStatus; // 介護保険被保険者証
  burdenProportionCertificateStatus: ConfirmationStatus; // 介護保険負担割合証

  // 追加項目
  currentStatus: CurrentStatus; // 現在の状況
  paymentType: PaymentType;     // 支払い区分
  keyPerson: KeyPerson;         // キーパーソン

  // ケアマネージャー情報
  careSupportOffice: string;    // 居宅介護支援事業所
  careManager: string;          // 担当CM

  // 住所
  address: string;

  // カイポケ登録
  kaipokeRegistrationStatus: RegistrationStatus;

  // 医療情報
  medicalHistory: string; // 病歴
  
  // 議事録
  meetings: MeetingRecord[];

  // 新規追加: 新規・変更情報
  changeRecords: ClientChangeRecord[];

  // 福祉用具利用フラグ
  isWelfareEquipmentUser: boolean; // 福祉用具利用者かどうか

  // 福祉用具選定
  plannedEquipment: Equipment[]; // 選定予定
  selectedEquipment: Equipment[]; // 選定した福祉用具
  startDate: string; // 使用開始日

  // 新規追加: 売上管理（自費・販売）
  salesRecords: SalesRecord[];
}

export const MOCK_CLIENTS: Client[] = [
  {
    id: '1',
    aozoraId: 'AZ-0001',
    name: '山田 太郎',
    nameKana: 'ヤマダ タロウ',
    birthDate: '1945-05-15',
    gender: '男性',
    facilityName: '',
    roomNumber: '',
    careLevel: '要介護2',
    copayRate: '1割',
    insuranceCardStatus: '確認済',
    burdenProportionCertificateStatus: '確認済',
    currentStatus: '在宅',
    paymentType: '非生保',
    kaipokeRegistrationStatus: '登録済',
    keyPerson: {
      name: '山田 一郎',
      relationship: '長男',
      contact: '090-1234-5678'
    },
    careSupportOffice: '世田谷ケアセンター',
    careManager: '佐藤 花子',
    address: '東京都世田谷区...',
    medicalHistory: '脳梗塞後遺症（右麻痺）、高血圧、糖尿病。歩行時にふらつきあり。',
    isWelfareEquipmentUser: true,
    meetings: [
      {
        id: 'm1',
        date: '2023-10-01',
        office: '鹿児島（ACG）',
        type: 'カンファレンス時',
        recorder: '自社 担当者',
        place: '山田様 自宅',
        attendees: '山田様、医師、看護師、ケアマネジャー',
        careSupportOffice: '世田谷ケアセンター',
        careManager: '佐藤 花子',
        hospital: '世田谷総合病院',
        socialWorker: '鈴木 健一',
        usageCategory: '介護保険レンタル',
        carePlanStatus: '確認済',
        serviceTicketStatus: '確認済',
        content: '退院後の生活について話し合い。自宅での入浴が困難なため、福祉用具の導入を検討。',
        reminder: 'あり',
        summary: '【議題】退院後の在宅生活\n【決定事項】浴室手すりとシャワーチェアの導入を検討。\n【次回】担当者会議にて機種選定。'
      }
    ],
    changeRecords: [
      {
        id: 'c1',
        recordDate: '2023-10-01',
        office: '鹿児島（ACG）',
        infoType: '新規',
        recorder: '自社 担当者',
        usageCategory: '介護保険レンタル',
        billingStartDateNew: '2023-10-05',
        billingStopDateCancel: '',
        billingStopDateHospital: '',
        wholesalerStopContactStatus: '未対応',
        billingStartDateDischarge: '',
        wholesalerResumeContactStatus: '未対応',
        note: '初回納品予定日。'
      }
    ],
    plannedEquipment: [
      { id: 'e1', name: 'シャワーチェア', category: '入浴補助' },
      { id: 'e2', name: '手すり（浴室）', category: '住宅改修・レンタル' }
    ],
    selectedEquipment: [],
    startDate: '',
    salesRecords: []
  },
  {
    id: '2',
    aozoraId: 'AZ-0056',
    name: '鈴木 花子',
    nameKana: 'スズキ ハナコ',
    birthDate: '1938-11-20',
    gender: '女性',
    facilityName: '特別養護老人ホーム さくら',
    roomNumber: '205',
    careLevel: '要介護4',
    copayRate: '1割',
    insuranceCardStatus: '未確認',
    burdenProportionCertificateStatus: '未確認',
    currentStatus: '施設入居中',
    paymentType: '非生保',
    kaipokeRegistrationStatus: '未登録',
    keyPerson: {
      name: '鈴木 次郎',
      relationship: '夫',
      contact: '045-123-4567'
    },
    careSupportOffice: '',
    careManager: '',
    address: '神奈川県横浜市...',
    medicalHistory: 'アルツハイマー型認知症、大腿骨頸部骨折術後。車椅子移動が主。',
    isWelfareEquipmentUser: true,
    meetings: [],
    changeRecords: [],
    plannedEquipment: [],
    selectedEquipment: [
       { 
         id: 'e3', 
         name: '多機能車椅子', 
         category: '車椅子',
         monthlyCost: 6000,
         office: '鹿児島（ACG）',
         recorder: '担当者A',
         propertyAttribute: 'リース物件',
         ownProductCategory: '',
         ownProductId: '',
         taisCode: '00000-000000',
         manufacturer: 'メーカーA',
         wholesaler: '卸A',
         units: '600',
         kaipokeStatus: '登録済',
         status: '介護保険貸与',
         orderReceivedDate: '2023-09-01',
         orderPlacedDate: '2023-09-02',
         purchaseDate: '',
         deliveryDate: '2023-09-15',
         startDate: '2023-09-15',
         endDate: ''
       }
    ],
    startDate: '2023-09-15',
    salesRecords: []
  }
];
