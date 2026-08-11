
export type MeetingType = 
  'カンファレンス時' | 
  '担当者会議（新規）' | 
  '担当者会議（更新）' | 
  '担当者会議（退院時）' | 
  'その他';

export type UsageCategory = '介護保険レンタル' | '自費レンタル' | '購入' | '併用';
export type ConfirmationStatus = '' | '確認済' | '未確認';
export type RegistrationStatus = '未登録' | '登録済';
export type OfficeLocation = '鹿児島（ACG）' | '福岡（Lichi）';
export type ReminderStatus = 'あり' | 'なし';

// 新規追加: 情報の種類
export type ChangeInfoType = '新規' | '施設入居新規' | '入院（サービス停止）' | '退院（サービス開始）' | '解約' | '施設入居解約' | '変更あり' | 'その他' | 'デモ';
// 新規追加: 連絡状態
export type ContactStatus = '未対応' | '対応済';

// 福祉用具関連の型定義
export type EquipmentType = '車いす' | '車いす付属品' | '特殊寝台' | '特殊寝台付属品' | '床ずれ防止用具' | '体位変換器' | '歩行器' | '徘徊感知器' | '手すり' | '歩行補助つえ' | '移動用リフト' | 'スロープ' | 'その他';
export type PropertyAttribute = '自社物件' | 'リース物件';
export type EquipmentStatus = '介護保険レンタル' | '自費レンタル' | '販売';
export type RegistrationState = '未登録' | '登録済';

// 売上管理関連の型定義
export type TaxType = '非課税' | '10％' | '軽8％' | '税込';

// 販売用の型定義
export type TransactionType = '社内間取引' | 'ー';
export type UserBurdenType = '自己負担０（日常生活給付）' | '一部負担（日常生活給付）' | '１割負担（受領委任払い）' | '２割負担（受領委任払い）' | '３割負担（受領委任払い）' | '全額負担（償還払い）';
export type PaymentMethod = '口座引き落とし' | '現金集金' | '受領委任払い' | '償還払い' | '日常生活給付' | '請求書払い';

// ===== 書類管理 =====
export type DocumentType = '計画書' | 'モニタリング' | 'その他';

export interface ClientDocument {
  id: string;
  fileName: string;
  documentType: DocumentType;
  uploadedAt: string;
  storagePath: string;
  fileSize?: number;
  note?: string;
  isSigned?: boolean;
  signedAt?: string;
  originalDocumentId?: string;
}
export type ApplicationProgress = '未対応' | '申請中' | '申請済';

// ===== 利用者マスター 変更履歴 =====
// 基本情報の追跡対象フィールドが変わった際の履歴1件（上書きせず追記）
export interface AttributeHistoryEntry {
  id: string;
  field: string;          // 追跡対象フィールド名（careLevel 等）
  value: string;          // 変更後の値（表示用文字列。未設定は 'ー'）
  effectiveFrom: string;  // 実効日 'YYYY-MM-DD'（手動入力）
  recordedAt: string;     // 記録日時 ISO
  note?: string;          // 備考（任意）
}

export interface SalesRecord {
  id: string;
  office: OfficeLocation; // 事業所
  status: EquipmentStatus;
  aozoraId: string;
  clientName: string;
  facilityName: string;
  productName: string; // 商品名（請求費目）
  quantity: number; // 数量
  unitPrice: number; // 単価
  taxType: TaxType; // 税区分
  taxIncludedAmount?: number; // 税込み請求額
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

  // 自費レンタル関連フィールド
  selfPayProductName?: string; // 商品名（自費レンタル）
  unitPrice?: number; // 単価
  quantity?: number; // 数量
  subtotalAmount?: number; // 請求額（小計）
  taxType?: TaxType; // 税区分
  taxIncludedAmount?: number; // 税込み金額

  // 販売用フィールド
  salesPerson?: string; // 営業担当
  transactionType?: TransactionType; // 取引内容
  userBurdenType?: UserBurdenType; // 利用者自己負担割合
  burdenLimitAmount?: number; // 一部負担時の上限額
  userBurdenAmount?: number; // 利用者負担額
  applicationAmount?: number; // 申請額
  paymentMethod?: PaymentMethod; // 支払い方法
  applicationStatus?: boolean; // 申請あり
  applicationProgress?: ApplicationProgress; // 申請の進捗
  applicationMunicipality?: string; // 申請市町村
  shippingCost?: number; // 送料金額
  totalAdjustment?: number; // 総計手動調整額（端数調整用）
  isCompanyOwned?: boolean; // 自社ベッド（仕入不要）※propertyAttribute==='自社物件'で代替予定
  companyBedItemId?: string; // ベッド管理タブの EquipmentItem.id と紐づけ

  // 論理削除（自費レンタル・販売の誤削除復元／確定済み保護用）
  deletedAt?: string; // ISO日時。設定されていれば論理削除（集計・表示から除外）
  deletedBy?: string; // 削除実行者メール
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
  usageCategory: string; // 利用区分（自費レンタル/介護保険レンタル/販売・複数可。「・」連結で保持）
  
  // 詳細な日付・ステータス項目
  billingStartDateNew: string; // 請求開始日（新規）
  billingStopDateCancel: string; // 請求停止日（解約）
  
  billingStopDateHospital: string; // 請求停止日（入院）
  wholesalerStopContactStatus: ContactStatus; // 卸会社への停止連絡
  
  billingStartDateDischarge: string; // 請求開始日（退院日）
  wholesalerResumeContactStatus: ContactStatus; // 卸会社への再開連絡

  demoStartDate: string; // デモ開始日
  demoEndDate: string;   // デモ終了日

  note: string; // 特記
  pairedWithNewRecordId?: string; // 解約レコードの手動ペア先（新規レコードID）
}

export interface KeyPerson {
  name: string;
  relationship: string;
  contact: string;
}

export type PaymentType = '' | '非生保' | '生保';
export type BillingCategory = '' | '自費レンタル' | '介護保険レンタル' | '併用';
export type Gender = '男性' | '女性';
export type CareLevel = '' | '申請中' | '要支援1' | '要支援2' | '要介護1' | '要介護2' | '要介護3' | '要介護4' | '要介護5';
export type CopayRate = '' | '1割' | '2割' | '3割';

export interface Client {
  id: string;
  aozoraId: string; // あおぞらID
  insuranceNumber?: string; // 被保険者番号
  office: OfficeLocation; // 事業所

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
  paymentType: PaymentType;     // 支払い区分
  billingCategory: BillingCategory; // 請求区分（自費レンタル/介護保険レンタル/併用）
  keyPerson: KeyPerson;         // キーパーソン

  // ケアマネージャー情報
  careSupportOffice: string;    // 居宅介護支援事業所
  careManager: string;          // 担当CM

  // 在宅区分（自宅 / 外部施設 / その他）
  location: string;

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
  receiptCheckTarget?: boolean;    // レセプトチェック対象（true=強制追加, false=強制除外, undefined=自動判定）

  // 福祉用具選定
  plannedEquipment: Equipment[]; // 選定予定
  selectedEquipment: Equipment[]; // 選定した福祉用具
  startDate: string; // 使用開始日

  // 新規追加: 売上管理（自費・販売）
  salesRecords: SalesRecord[];

  // 介護保険レンタル給付対象金額（CSVインポート時に保存）
  insuranceRentalBillingTotal?: number;

  // 書類管理（計画書・モニタリング等）
  documents?: ClientDocument[];

  // 基本情報の変更履歴（介護度・施設等の実効日付き履歴）
  attributeHistory?: AttributeHistoryEntry[];
}

// ===== 介保レンタル売上・請求突合 関連の型定義 =====

// 卸会社
export type WholesaleCompany = 'Nikken' | 'Nishiken' | 'NihonCaresupply' | 'ParamountCare' | 'Noguchi' | 'Kishiya' | 'Other';

// 卸会社の表示名マッピング
export const WHOLESALE_COMPANY_NAMES: Record<WholesaleCompany, string> = {
  Nikken: '日建リース工業株式会社',
  Nishiken: '株式会社ニシケン',
  NihonCaresupply: '株式会社日本ケアサプライ',
  ParamountCare: 'パラマウントケアサービス株式会社',
  Noguchi: '野口株式会社',
  Kishiya: '株式会社キシヤ',
  Other: 'その他',
};

// 請求書から抽出した明細
export interface InvoiceItem {
  id: string;
  wholesaleCompany: WholesaleCompany;
  customerName: string;
  customerNameNormalized: string;
  itemName: string;
  itemNameNormalized: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  rawText?: string;
  matchedAozoraId?: string;     // OCR名前マッチングで確定したあおぞらID
  targetMonth?: string;         // 本来の対象月度(YYYY-MM)。未設定=アップロードした月と同じ。月をまたぐ遅れ請求の紐づけに使用
}

// OCR解析済み請求書
export interface ParsedInvoice {
  id: string;
  wholesaleCompany: WholesaleCompany;
  fileName: string;
  uploadedAt: string;
  billingMonth: string;
  items: InvoiceItem[];
  totalAmount: number;
  ocrConfidence?: number;
  rawOcrText?: string;
}

// 内部売上データ（介護保険レンタル集計）
export interface InsuranceRentalSalesItem {
  clientId: string;
  aozoraId: string;
  clientName: string;
  clientNameKana: string;
  facilityName: string;
  equipment: {
    id: string;
    name: string;
    manufacturer: string;
    wholesaler: string;
    category: string;
    units: string;
    taisCode: string;
    startDate: string;
    endDate?: string;
  }[];
  totalUnits: number;
}

// 突合ステータス
export type MatchStatus = 'matched' | 'unmatched_sales' | 'unmatched_invoice' | 'partial_match';

// 突合結果（1利用者分）
export interface ReconciliationResult {
  id: string;
  matchStatus: MatchStatus;
  salesData?: InsuranceRentalSalesItem;
  invoiceItems: InvoiceItem[];
  customerNameMatch: boolean;
  itemMatches: {
    salesEquipmentId: string;
    invoiceItemId: string;
    matchConfidence: number;
  }[];
  discrepancies: {
    field: string;
    salesValue: string | number;
    invoiceValue: string | number;
  }[];
}

// 突合サマリー
export interface ReconciliationSummary {
  billingMonth: string;
  processedAt: string;
  totalSalesItems: number;
  totalInvoiceItems: number;
  matchedCount: number;
  unmatchedSalesCount: number;
  unmatchedInvoiceCount: number;
  partialMatchCount: number;
  results: ReconciliationResult[];
  byWholesaler: {
    company: WholesaleCompany;
    invoiceTotal: number;
    matchedTotal: number;
    discrepancyAmount: number;
  }[];
}

// CSV出力用行フォーマット
export interface ReconciliationExportRow {
  aozoraId: string;
  clientName: string;
  facilityName: string;
  equipmentName: string;
  equipmentCategory: string;
  wholesaler: string;
  salesUnits: string;
  invoiceAmount: number;
  matchStatus: string;
  discrepancyNotes: string;
}

// ===== 売上・仕入突合 確定機能 関連の型定義 =====

// 売上種別（確定用）
export type SalesType = '介護保険レンタル' | '自費レンタル' | '販売';

// 確定ステータス（売上・仕入突合用）
export interface SalesConfirmationStatus {
  status: 'draft' | 'confirmed';
  confirmedAt?: Date;
  confirmedBy?: string;
  count: number;
  amount: number;
}

// アップロード済みファイル情報
export interface UploadedFileInfo {
  fileName: string;
  itemCount: number;
  totalAmount: number;
  uploadedAt: string;
}

// 卸会社確定データ（請求書データ含む）
export interface InvoiceConfirmationData {
  status: 'draft' | 'confirmed';
  confirmedAt?: Date;
  confirmedBy?: string;
  files: UploadedFileInfo[];
  items: InvoiceItem[];
  totalAmount: number;
}

// 突合ドキュメント（Firestore保存用）
export interface ReconciliationDocument {
  // 識別情報
  billingMonth: string;           // "2025-12"
  office: string;                 // "全事業所" | "鹿児島（ACG）" | "福岡（Lichi）"

  // 売上確定状態
  salesConfirmation: {
    介護保険レンタル: SalesConfirmationStatus;
    自費レンタル: SalesConfirmationStatus;
    販売: SalesConfirmationStatus;
  };

  // 卸会社確定状態（請求書データ含む）
  invoiceConfirmation: {
    [company: string]: InvoiceConfirmationData;
  };

  // 月次確定状態
  monthlyStatus: 'draft' | 'confirmed';
  monthlyConfirmedAt?: Date;
  monthlyConfirmedBy?: string;

  // 介護保険レンタル利用者別突合の確定状態（会社別）
  insuranceRentalConfirmation?: {
    [company: string]: InsuranceRentalConfirmationStatus;
  };

  // 販売利用者別突合の確定状態（会社別）
  salesConfirmation?: {
    [company: string]: InsuranceRentalConfirmationStatus;
  };

  // 自費レンタル利用者別突合の確定状態（会社別）
  selfPayRentalConfirmation?: {
    [company: string]: InsuranceRentalConfirmationStatus;
  };

  // 確定時のサマリー
  summary?: ReconciliationSummaryV2;

  // メタデータ
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

// ===== 売上・仕入突合V2 関連の型定義 =====

// 全売上アイテム（介護保険レンタル・自費レンタル・販売統合）
export interface SalesItem {
  id: string;
  aozoraId: string;
  clientName: string;
  clientNameKana: string;
  facilityName: string;
  equipmentId: string;
  equipmentName: string;
  category: string;           // 福祉用具種類
  status: EquipmentStatus;    // 介護保険レンタル/自費レンタル/販売
  wholesaler: string;         // 卸会社
  taisCode: string;           // タイスコード
  quantity: number;           // 数量
  unitPrice: number;          // 単価
  salesAmount: number;        // 売上金額
  startDate: string;
  endDate?: string;
  deliveryDate?: string;      // 納品日（販売用）
  office?: OfficeLocation;    // 事業所
  propertyAttribute?: PropertyAttribute; // 物件属性
}

// 突合ステータスV2
export type MatchStatusV2 = 'matched' | 'sales_only' | 'invoice_only';

// 突合結果V2（粗利計算付き）
export interface ReconciliationResultV2 {
  id: string;
  matchStatus: MatchStatusV2;

  // 売上データ（sales_only, matched）
  salesItem?: SalesItem;

  // 仕入データ（invoice_only, matched）
  invoiceItem?: InvoiceItem;

  // マッチング情報
  matchConfidence?: number;

  // 粗利計算（matchedの場合）
  salesAmount?: number;
  purchaseAmount?: number;
  grossProfit?: number;
  grossProfitRate?: number;
}

// 卸会社別集計
export interface WholesalerSummary {
  company: WholesaleCompany;
  companyName: string;
  salesCount: number;
  invoiceCount: number;
  matchedCount: number;
  salesAmount: number;
  purchaseAmount: number;
  grossProfit: number;
  grossProfitRate: number;
}

// 突合サマリーV2（粗利集計付き）
export interface ReconciliationSummaryV2 {
  billingMonth: string;
  processedAt: string;

  // 件数
  totalSalesCount: number;
  totalInvoiceCount: number;
  matchedCount: number;
  salesOnlyCount: number;
  invoiceOnlyCount: number;

  // 金額サマリー
  totalSalesAmount: number;
  totalPurchaseAmount: number;
  totalGrossProfit: number;
  grossProfitRate: number;

  // 結果
  results: ReconciliationResultV2[];

  // 卸会社別集計
  byWholesaler: WholesalerSummary[];
}

// ===== 介護保険レンタル 利用者別突合 =====

// 品目マッピング（弊社品目名 ↔ 卸品目名 複数）
export interface InsuranceRentalItemMapping {
  ourItemName: string;            // 弊社商品名（Kaipoke）
  wholesalerItemNames: string[];  // 卸商品名（複数可）
}

// Firestoreに保存する品目マッチングデータ（卸会社×利用者単位）
export interface InsuranceRentalItemMatchData {
  aozoraId: string;
  wholesaleCompany: WholesaleCompany;
  mappings: InsuranceRentalItemMapping[];
  updatedAt: string;
}

// モーダル内での品目ペア表示用（1弊社品目 : N卸品目）
export interface InsuranceRentalItemPair {
  ourItem: { id: string; name: string; salesAmount?: number; isCompanyOwned?: boolean } | null;
  wholesalerItems: { id: string; name: string; amount: number; targetMonth?: string }[]; // 複数可
}

// 利用者別突合の表示データ（セクション一覧用）
export interface InsuranceRentalClientReconciliation {
  aozoraId: string;
  clientName: string;
  wholesaleCompany: WholesaleCompany;
  ourAmount: number;           // insuranceRentalBillingTotal（カイポケ）
  wholesalerAmount: number;    // 卸請求品目の合計
  ourItems: { id: string; name: string; salesAmount?: number; isCompanyOwned?: boolean }[];  // Kaipokeの品目
  wholesalerItems: InvoiceItem[];             // 卸の請求品目
  difference: number;          // ourAmount - wholesalerAmount
}

// 介護保険レンタル確定状態（会社別）
export interface InsuranceRentalConfirmationStatus {
  status: 'draft' | 'confirmed';
  confirmedAt?: string;
  confirmedBy?: string;
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
    paymentType: '非生保',
    billingCategory: '介護保険レンタル',
    kaipokeRegistrationStatus: '登録済',
    keyPerson: {
      name: '山田 一郎',
      relationship: '長男',
      contact: '090-1234-5678'
    },
    careSupportOffice: '世田谷ケアセンター',
    careManager: '佐藤 花子',
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
    paymentType: '非生保',
    billingCategory: '',
    kaipokeRegistrationStatus: '未登録',
    keyPerson: {
      name: '鈴木 次郎',
      relationship: '夫',
      contact: '045-123-4567'
    },
    careSupportOffice: '',
    careManager: '',
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

// ===== 自社ベッド在庫管理 関連の型定義 =====

// ベッド種別
export type BedItemType = 'ベッド' | 'サイドレール' | 'マットレス';

// ベッドライフサイクルステータス
export type BedLifecycleStatus = '在庫' | '貸出中' | '消毒中';

// 消毒記録
export interface DisinfectionRecord {
  id: string;
  vendor: string;        // 消毒業者
  cost: number;          // 費用
  startDate: string;     // 開始日
  endDate: string;       // 終了日（予定/実績）
  note?: string;         // 備考
}

// 貸出履歴
export interface BedRentalHistory {
  id: string;
  clientAozoraId: string;  // 貸出先の利用者ID
  clientName: string;      // 利用者名（表示用）
  startDate: string;       // 貸出開始日
  endDate?: string;        // 返却日（貸出中はundefined）
  office: OfficeLocation;  // 事業所
}

// ベッド在庫アイテム（1物理アイテム = 1ドキュメント）
export interface BedInventoryItem {
  id: string;                          // ドキュメントID
  code: string;                        // 管理コード（例: BED-001, SR-001, MT-001）
  name: string;                        // 商品名
  itemType: BedItemType;               // ベッド/サイドレール/マットレス
  manufacturer?: string;               // メーカー
  office: OfficeLocation;              // 所属事業所

  // ライフサイクル
  lifecycleStatus: BedLifecycleStatus; // 現在のステータス
  currentClientAozoraId?: string;      // 貸出中の利用者ID
  currentClientName?: string;          // 貸出中の利用者名

  // セット管理
  setId?: string;                      // セットID（セットに属する場合）
  setName?: string;                    // セット名（表示用）

  // 償却
  purchaseDate?: string;               // 購入日
  purchasePrice?: number;              // 購入金額
  depreciationMonths: number;          // 償却月数（デフォルト12）

  // 消毒履歴
  disinfectionHistory: DisinfectionRecord[];
  currentDisinfection?: DisinfectionRecord; // 消毒中の場合

  // 貸出履歴
  rentalHistory: BedRentalHistory[];

  // メタデータ
  note?: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

// セット定義
export interface BedSet {
  id: string;                          // セットID
  name: string;                        // セット名（例: "セットA-001"）
  itemIds: string[];                   // 含まれるアイテムのID
  office: OfficeLocation;
  createdAt: Date;
  updatedAt: Date;
}

// ===== OCR利用者名マッチング学習 関連の型定義 =====

// OCR名前マッピング（学習データ）
export interface OcrNameMapping {
  id: string;
  ocrName: string;              // OCRで読み取った名前（正規化後）
  ocrNameOriginal: string;      // OCRで読み取った名前（元の形）
  aozoraId: string;             // マッチ先の利用者ID
  masterName: string;           // マスターの正式名
  wholesaleCompany: string;     // 卸会社名（パラマウント等）
  confidence: number;           // 確信度（手動=1.0, 自動=類似度）
  usageCount: number;           // 使用回数（多いほど信頼性高）
  createdAt: Date;
  updatedAt: Date;
}

// マッチング候補
export interface MatchCandidate {
  aozoraId: string;
  masterName: string;
  similarity: number;           // 類似度（0-1）
  isExactMatch: boolean;        // 完全一致かどうか
  matchSource: 'learned' | 'fuzzy'; // 学習データからか、あいまいマッチングか
}

// マッチング結果
export interface MatchResult {
  ocrName: string;              // OCRで読み取った名前
  ocrNameNormalized: string;    // 正規化後の名前
  status: 'matched' | 'candidates' | 'unmatched';
  matchedCandidate?: MatchCandidate;  // statusが'matched'の場合
  candidates?: MatchCandidate[];       // statusが'candidates'の場合（上位N件）
}

// 未照合アイテム（UI表示用）
export interface UnmatchedItem {
  invoiceItem: InvoiceItem;     // 請求書アイテム
  matchResult: MatchResult;      // マッチング結果
  userSelection?: {              // ユーザーの選択結果
    selectedAozoraId: string | null;  // 選択したID（nullは「該当なし」）
    selectedMasterName: string | null;
  };
}

// ===== レセプトチェック 関連の型定義 =====

export interface ReceiptCheckItem {
  aozoraId: string;
  clientName: string;
  nameKana?: string;
  office: string;
  units: number;                        // 単位数（介護保険レンタル合計）
  provisionTicketReceived: boolean;     // E: 提供票受領
  unitsDifference: boolean;             // F: 単位数の差異
  changedFromLastMonth: boolean;        // G: 先月からの変更
  kaipokePlanCreated: boolean;          // H: カイポケ計画書の作成
  welfareRecipient: boolean;            // I: 生保受給
  welfareCareTicket: boolean;           // J: 生保介護券
  firstUseDate: string;                 // K: 利用初回日
  hospitalizationDate: string;          // L: 入院日
  dischargeDate: string;                // M: 退院日
  cancellationDate: string;             // N: 解約日
  cancellationDateLocked?: boolean;     // 解約日を手動ロック（自動上書きをスキップ）
  reflectedFromManagement: boolean;     // O: 管理表から反映
  performanceReport: boolean;           // P: 実績報告書
  delayed: boolean;                     // Q: 月遅れ
  location: string;                     // R: 拠点
  careOffice: string;                   // S: 介護事業所
}

export interface ReceiptCheckDocument {
  billingMonth: string;       // "2026-01"
  office: string;             // "鹿児島（ACG）" | "福岡（Lichi）" | "全事業所"
  items: ReceiptCheckItem[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

// ===== 個体管理システム =====

export type EquipmentItemType = 'ベッド' | 'サイドレール' | 'マットレス';

export type UsageType = '介護保険' | '自費' | '販売' | '施設物品' | '使用不可';

export type EquipmentItemStatus =
  | '倉庫保管' | '事務所保管'
  | 'クリーニング前' | 'クリーニング中'
  | '介護保険貸与にて使用' | '自費にて使用'
  | '施設物品' | '販売済み' | '破棄済み';

export interface CleaningRecord {
  id: string;
  vendor: string;
  cost: number;
  startDate: string;
  endDate: string;
  note?: string;
}

export interface EquipmentUsageHistory {
  id: string;
  fromStatus: EquipmentItemStatus | null;
  toStatus: EquipmentItemStatus;
  usageType: UsageType;
  clientAozoraId?: string;
  clientName?: string;
  startDate: string;
  endDate?: string;
  office: OfficeLocation;
  note?: string;
  changedBy: string;
  changedAt: string;
}

export interface EquipmentItem {
  id: string;
  code: string;
  name: string;
  itemType: EquipmentItemType;
  manufacturer?: string;
  office: OfficeLocation;
  usageType: UsageType;
  status: EquipmentItemStatus;
  currentClientAozoraId?: string;
  currentClientName?: string;
  qrCodeUrl?: string;
  setId?: string;
  setName?: string;
  purchaseDate?: string;
  purchasePrice?: number;
  depreciationMonths: number;
  cleaningHistory: CleaningRecord[];
  currentCleaning?: CleaningRecord;
  usageHistory: EquipmentUsageHistory[];
  note?: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface EquipmentLog {
  id: string;
  equipmentId: string;
  equipmentCode: string;
  action: 'created' | 'status_changed' | 'qr_generated' | 'migrated';
  fromStatus?: EquipmentItemStatus | null;
  toStatus?: EquipmentItemStatus;
  usageType?: UsageType;
  clientAozoraId?: string;
  clientName?: string;
  note?: string;
  performedBy: string;
  performedAt: Date;
}

export interface EquipmentSet {
  id: string;
  name: string;
  itemIds: string[];
  office: OfficeLocation;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationOptions {
  defaultUsageType: UsageType;
  statusMapping: {
    '在庫': EquipmentItemStatus;
    '貸出中': EquipmentItemStatus;
    '消毒中': EquipmentItemStatus;
  };
}
