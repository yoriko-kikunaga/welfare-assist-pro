
export enum MeetingType {
  CONFERENCE = 'カンファレンス',
  PROVIDER_MEETING = '担当者会議',
}

export interface Equipment {
  id: string;
  name: string;
  category: string;
  monthlyCost?: number;
  note?: string;
}

export interface MeetingRecord {
  id: string;
  date: string;
  type: MeetingType;
  attendees: string;
  content: string; // The raw notes or rough content
  summary?: string; // AI generated structured summary
}

export interface KeyPerson {
  name: string;
  relationship: string;
  contact: string;
}

export type CurrentStatus = '在宅' | '入院中' | '施設入居中';
export type PaymentType = '非生保' | '生保';

export interface Client {
  id: string;
  // 基本情報
  name: string;
  nameKana: string;
  birthDate: string;
  gender: '男性' | '女性' | 'その他';
  careLevel: string; // 要介護度
  
  // 追加項目
  currentStatus: CurrentStatus; // 現在の状況
  paymentType: PaymentType;     // 支払い区分
  copayRate: string;            // 負担割合
  keyPerson: KeyPerson;         // キーパーソン

  // 施設・住所
  facilityName: string; // 入居施設 または 入院先
  address: string;

  // 医療情報
  medicalHistory: string; // 病歴
  
  // 議事録
  meetings: MeetingRecord[];

  // 福祉用具選定
  plannedEquipment: Equipment[]; // 選定予定
  selectedEquipment: Equipment[]; // 選定した福祉用具
  startDate: string; // 使用開始日
}

export const MOCK_CLIENTS: Client[] = [
  {
    id: '1',
    name: '山田 太郎',
    nameKana: 'ヤマダ タロウ',
    birthDate: '1945-05-15',
    gender: '男性',
    careLevel: '要介護2',
    currentStatus: '在宅',
    paymentType: '非生保',
    copayRate: '1割',
    keyPerson: {
      name: '山田 一郎',
      relationship: '長男',
      contact: '090-1234-5678'
    },
    facilityName: '', 
    address: '東京都世田谷区...',
    medicalHistory: '脳梗塞後遺症（右麻痺）、高血圧、糖尿病。歩行時にふらつきあり。',
    meetings: [
      {
        id: 'm1',
        date: '2023-10-01',
        type: MeetingType.CONFERENCE,
        attendees: '山田様、医師、看護師、ケアマネジャー',
        content: '退院後の生活について話し合い。自宅での入浴が困難なため、福祉用具の導入を検討。',
        summary: '【議題】退院後の在宅生活\n【決定事項】浴室手すりとシャワーチェアの導入を検討。\n【次回】担当者会議にて機種選定。'
      }
    ],
    plannedEquipment: [
      { id: 'e1', name: 'シャワーチェア', category: '入浴補助' },
      { id: 'e2', name: '手すり（浴室）', category: '住宅改修・レンタル' }
    ],
    selectedEquipment: [],
    startDate: ''
  },
  {
    id: '2',
    name: '鈴木 花子',
    nameKana: 'スズキ ハナコ',
    birthDate: '1938-11-20',
    gender: '女性',
    careLevel: '要介護4',
    currentStatus: '施設入居中',
    paymentType: '非生保',
    copayRate: '1割',
    keyPerson: {
      name: '鈴木 次郎',
      relationship: '夫',
      contact: '045-123-4567'
    },
    facilityName: '特別養護老人ホーム さくら',
    address: '神奈川県横浜市...',
    medicalHistory: 'アルツハイマー型認知症、大腿骨頸部骨折術後。車椅子移動が主。',
    meetings: [],
    plannedEquipment: [],
    selectedEquipment: [
       { id: 'e3', name: '多機能車椅子', category: '車椅子', monthlyCost: 6000 }
    ],
    startDate: '2023-09-15'
  }
];
