# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** is a web application for welfare equipment specialists in Japan. It manages client information, meeting minutes, equipment selection, and sales records. The app integrates with Google Spreadsheets, Kintone, and uses Firebase for hosting/persistence and Google Gemini AI for automated suggestions.

**Key Stats:**
- 8,406 total clients loaded from spreadsheets
- 457 welfare equipment users
- Automatic hourly sync from Google Sheets via GitHub Actions
- Deployed to Firebase Hosting: https://welfare-assist-pro.web.app

## Essential Commands

### Development
```bash
npm run dev          # Start development server (Vite)
npm run build        # Build for production (includes copy-clients.cjs)
npm run preview      # Preview production build
```

### Data Import Scripts
```bash
# Primary data import (runs hourly via GitHub Actions)
node importSpreadsheetData.cjs    # Import from Google Sheets + merge Firestore edits

# Secondary data import (runs daily via GitHub Actions)
node importFromKintone.cjs        # Import change records from Kintone

# Equipment master data
node fetchEquipmentMaster.cjs     # Fetch 928 equipment items from spreadsheet

# After data updates, copy to public folder for runtime access
cp clients.json public/clients.json
cp public/equipmentMaster.json dist/equipmentMaster.json
```

### Firebase Deployment
```bash
# Deploy hosting only
firebase deploy --only hosting

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Full deployment
firebase deploy
```

### Authentication Setup
```bash
# GCP authentication for local development
gcloud auth application-default login
```

## Architecture Overview

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Data Sources (External)                                 │
├─────────────────────────────────────────────────────────┤
│  • Google Sheets (8,406 clients)                         │
│  • Kintone (change records)                              │
│  • Equipment Master Sheet (928 items)                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (Automated Sync)                         │
├─────────────────────────────────────────────────────────┤
│  Hourly:  importSpreadsheetData.cjs                      │
│  Daily:   importFromKintone.cjs                          │
│  Output:  clients.json (committed to repo)               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Build Process                                           │
├─────────────────────────────────────────────────────────┤
│  1. vite build                                           │
│  2. copy-clients.cjs (copies to dist/assets)             │
│  3. Firebase Hosting deployment                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Runtime (Browser)                                       │
├─────────────────────────────────────────────────────────┤
│  App.tsx:                                                │
│    1. Load /assets/clients.json via fetch               │
│    2. Load Firestore edits (user changes)                │
│    3. Merge: mergeAllClientEdits()                       │
│    4. User edits → saveClientEdits() → Firestore         │
└─────────────────────────────────────────────────────────┘
```

### Firestore Data Persistence

**Critical Pattern:** The app uses a **hybrid data model**:

1. **Base Data** (read-only): Loaded from `/assets/clients.json`
   - Source: Google Sheets + Kintone
   - Updated hourly via GitHub Actions
   - 8,406 clients with full profile data

2. **User Edits** (read-write): Stored in Firestore
   - Collection: `clientEdits/{aozoraId}`
   - Fields saved: `meetings`, `changeRecords`, `plannedEquipment`, `selectedEquipment`, `keyPerson`, `address`, `medicalHistory`, `isWelfareEquipmentUser`
   - Merged at runtime via `mergeAllClientEdits()`

3. **Merge Strategy** (`src/services/firestoreService.ts`):
   ```typescript
   // On app load:
   const baseClients = await fetch('/assets/clients.json');
   const editsMap = await getAllClientEdits();  // From Firestore
   const mergedClients = mergeAllClientEdits(baseClients, editsMap);

   // On user save:
   await saveClientEdits(updatedClient, userEmail);  // To Firestore
   ```

**Important:** User edits are NOT in `clients.json`. They live only in Firestore and are merged at runtime. The hourly sync script (`importSpreadsheetData.cjs`) also merges Firestore edits before saving to `clients.json` to preserve manual changes during automated updates.

### Component Architecture

```
App.tsx (Main container)
├── AuthProvider (Firebase Authentication context)
├── ClientList (Left sidebar)
│   ├── Search/filter controls
│   ├── Welfare equipment filter toggle
│   └── Client items with checkbox (isWelfareEquipmentUser)
│
└── ClientDetail (Main content, 1800+ lines)
    ├── Tab 1: 基本情報 (Basic Info + Address)
    │   └── isWelfareEquipmentUser checkbox
    ├── Tab 2: 病歴・状態 (Medical History + AI Equipment Suggestions)
    ├── Tab 3: 議事録一覧 (Meetings with AI Summary Generation)
    ├── Tab 4: 利用者新規・変更情報入力 (Change Records)
    ├── Tab 5: 福祉用具選定 (Equipment Selection)
    │   ├── Equipment master data with cascade filtering
    │   ├── Category → Manufacturer → Product Name
    │   └── Datalist search on all dropdowns
    └── Tab 6: 売上管理 (Sales Management)
```

### Equipment Master Data Integration

**Cascade Filtering Pattern:**
- User selects **福祉用具の種類** (equipment type) → filters manufacturers
- User selects **メーカー** (manufacturer) → filters product names
- User selects **商品名** (product name) → auto-fills code, type, manufacturer, units

**Implementation:**
```typescript
// When category changes → reset downstream fields
if (field === 'category') {
  setEditedClient(prev => ({
    ...prev,
    selectedEquipment: equipment.map(e =>
      e.id === id ? { ...e, category: value, manufacturer: '', name: '', taisCode: '', units: '' } : e
    )
  }));
}

// Dropdown with datalist for search
<input
  list={`manufacturer-list-${eq.id}`}
  value={eq.manufacturer}
  onChange={(e) => updateEquipment('selected', eq.id, 'manufacturer', e.target.value)}
/>
<datalist id={`manufacturer-list-${eq.id}`}>
  {equipmentMaster.equipmentList
    .filter(item => !eq.category || item.itemType === eq.category)
    .map(item => <option key={item.manufacturer} value={item.manufacturer} />)}
</datalist>
```

## Critical Implementation Details

### Authentication Flow
- Firebase Authentication with Google Sign-In
- Auth state managed via `AuthContext` in `src/contexts/AuthContext.tsx`
- Protected routes: All screens require authentication
- Firestore security rules: Only authenticated users can read/write

### AI Integration (Gemini)
- Service: `src/services/geminiService.ts`
- Functions:
  - `generateMeetingSummary()`: Convert rough notes → formatted meeting minutes
  - `suggestEquipment()`: Suggest equipment based on medical history
- Uses Vertex AI API with Workload Identity authentication
- Model: `gemini-2.0-flash-exp`

### Welfare Equipment User Flag
- Field: `isWelfareEquipmentUser` (boolean)
- Locations:
  1. Basic info tab: Manual checkbox
  2. Client list: Checkbox per client (with event.stopPropagation() to prevent navigation)
  3. Filter toggle: "全員" vs "福祉用具" buttons
- Persisted to Firestore immediately on change
- Used to filter 457 welfare equipment users from 8,406 total

### Important File Locations

**Type Definitions:**
- `types.ts`: 70+ TypeScript interfaces including `Client`, `Equipment`, `Meeting`, etc.

**Firestore Integration:**
- `src/services/firestoreService.ts`: Save/load user edits
- `firestoreAdmin.cjs`: Server-side Firestore operations for import scripts
- `firestore.rules`: Security rules (authenticated users only)

**Data Import Scripts:**
- `importSpreadsheetData.cjs`: Primary import from Google Sheets (runs hourly)
- `importFromKintone.cjs`: Import change records from Kintone (runs daily)
- `fetchEquipmentMaster.cjs`: Fetch equipment catalog
- `copy-clients.cjs`: Copy data files to dist during build

**GitHub Actions:**
- `.github/workflows/hourly-sync.yml`: Hourly data sync + deployment
- `.github/workflows/daily-kintone-sync.yml`: Daily Kintone sync

### Build Process Notes

1. **clients.json handling:**
   - Generated by import scripts (7.7MB)
   - Copied to `public/clients.json` for development
   - Copied to `dist/assets/clients.json` during build by `copy-clients.cjs`
   - Loaded dynamically at runtime via fetch (not bundled)

2. **Equipment master data:**
   - Source: `public/equipmentMaster.json` (928 items)
   - Copied to `dist/equipmentMaster.json` by `copy-clients.cjs`
   - Loaded dynamically in `ClientDetail.tsx`

3. **Bundle size:** ~805KB (after moving clients.json out of bundle)

## Data Model Key Points

### Client Structure
```typescript
interface Client {
  id: string;
  aozoraId: string;  // Primary business identifier
  name: string;
  // ... 30+ fields
  isWelfareEquipmentUser: boolean;  // Manual flag for filtering
  meetings: Meeting[];
  changeRecords: ClientChangeRecord[];
  selectedEquipment: Equipment[];
  salesRecords: SalesRecord[];
}
```

### Equipment Cascade Fields
```typescript
interface Equipment {
  category: string;      // 福祉用具の種類 (13 types)
  manufacturer: string;  // メーカー (75 manufacturers)
  name: string;          // 商品名 (928 products)
  taisCode: string;      // 商品コード (auto-filled)
  units: string;         // 単位数 (auto-filled)
  wholesaler: string;    // 卸会社 (6 companies: ニッケン, 日本ケアサプライ, etc.)
  // ... other fields
}
```

## Common Patterns

### Editing Pattern in ClientDetail
```typescript
const [editedClient, setEditedClient] = useState(client);
const [isEditing, setIsEditing] = useState(false);

// Auto-enable edit mode when field changes
const handleChange = (field, value) => {
  setEditedClient(prev => ({ ...prev, [field]: value }));
  if (!isEditing) setIsEditing(true);
};

// Save to Firestore
const handleSave = async () => {
  await onUpdateClient(editedClient);  // Calls saveClientEdits()
};
```

### Search/Filter Pattern
```typescript
// In App.tsx
const filteredClients = clients.filter(client => {
  // Welfare equipment filter
  if (showOnlyWelfareUsers && !client.isWelfareEquipmentUser) return false;

  // Search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    return client.name.toLowerCase().includes(query) ||
           client.nameKana.toLowerCase().includes(query) ||
           client.aozoraId.includes(query);
  }
  return true;
});
```

## Japanese Business Context

- **あおぞらID**: Primary client identifier (e.g., "AZ-0001")
- **要介護度**: Care level (申請中, 要支援1-2, 要介護1-5)
- **負担割合**: Co-payment rate (1割, 2割, 3割)
- **生保受給者**: Welfare recipients (special handling)
- **居宅介護支援事業所**: Home care support office
- **担当CM**: Care manager in charge
- **福祉用具専門相談員**: Welfare equipment specialist (user persona)

## Document-Driven Development

**Always update README.md first when implementing new features.** The README contains detailed specifications and should be the source of truth. Pattern:

1. Add feature spec to README.md
2. Implement in code following the spec
3. Test and deploy
4. Commit both README and code changes together

See recent commits for examples of this pattern (福祉用具利用フラグ, カスケードフィルタリング機能).
