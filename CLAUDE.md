# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** is a web application for welfare equipment specialists in Japan. It manages client information, meeting minutes, equipment selection, and sales records. The app integrates with Google Spreadsheets, Kintone, and uses Firebase for hosting/persistence and Google Gemini 2.5 Flash (Vertex AI, Tokyo region) for automated suggestions.

**Key Stats:**
- 8,469 total clients loaded from spreadsheets
- 464 welfare equipment users (updated: 2026-01-12 with December performance data)
- Automatic daily sync from Google Sheets + Kintone via GitHub Actions
- Monthly performance data sync (manual, differential update)
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
# Data import (runs daily at 00:00 JST via GitHub Actions)
node importSpreadsheetData.cjs    # Import from Google Sheets + merge Firestore edits
node importFromKintone.cjs        # Import change records from Kintone

# Monthly performance data import (manual, differential update)
node importSpreadsheetData.cjs --monthly-sheet="12月実績"  # Merge monthly sheet data
node importSpreadsheetData.cjs --monthly-sheet="1月実績"   # Example for January

# Equipment master data
node fetchEquipmentMaster.cjs     # Fetch 928 equipment items from spreadsheet

# After data updates, copy to public folder for runtime access
cp clients.json public/assets/clients.json
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

### Testing
```bash
# Run E2E tests with Playwright
npm run test:e2e              # Run all E2E tests
npm run test:e2e:ui           # Run tests in UI mode (interactive)
npm run test:e2e:debug        # Debug mode with Playwright Inspector
npm run test:e2e:report       # Show HTML test report

# Test files location
e2e/app.spec.ts               # Main app flow tests (auth, client list, tabs, equipment)
e2e/production-check.spec.ts  # Production site health check
```

**Test Features:**
- Automated E2E testing with Playwright
- E2E test bypass mode via `?e2e_test_mode=true` URL parameter
- Tests cover: authentication, client list/search/filter, tab navigation, equipment selection
- Performance testing (load time, console errors)
- Production site monitoring with screenshot capture

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
   - Updated daily at 00:00 JST via GitHub Actions
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

**Important:** User edits are NOT in `clients.json`. They live only in Firestore and are merged at runtime. The daily sync script (`importSpreadsheetData.cjs`) also merges Firestore edits before saving to `clients.json` to preserve manual changes during automated updates.

**Critical Fix (2026-01-08):** The sync process now preserves `changeRecords` from Kintone to prevent data loss. Previously, `importSpreadsheetData.cjs` initialized `changeRecords: []` without reading existing data, causing Kintone data to be lost. The fix loads existing `changeRecords` from `clients.json` before creating new client objects, ensuring both Google Sheets and Kintone data coexist properly.

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
    ├── Tab 1: 基本情報 (Basic Info)
    │   ├── office dropdown (鹿児島（ACG） / 福岡（Lichi）) - referenced by other tabs
    │   └── isWelfareEquipmentUser checkbox
    ├── Tab 2: 病歴・状態 (Medical History + AI Equipment Suggestions)
    ├── Tab 3: 議事録一覧 (Meetings with AI Summary Generation)
    ├── Tab 4: 利用者新規・変更情報入力 (Change Records with Grouping)
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

### Tab 4: Change Records Grouping

**Overview:**
Tab 4 displays change records from Kintone with intelligent grouping. Records are paired to show the lifecycle of services (new→cancel) and hospital stays (hospitalization→discharge).

**Data Source:**
- Kintone App 184: 入院・退院情報 (Hospitalization/Discharge)
- Kintone App 197: 新規・変更情報 (New/Change Records)
- Total: 1,017 change records across 724 clients
- Auto-synced daily at 00:00 JST via GitHub Actions

**Record Types (`ChangeInfoType`):**
1. **新規** (New) - New service contract
2. **解約** (Cancel) - Service cancellation
3. **入院（サービス停止）** (Hospitalization - Service Stop)
4. **退院（サービス開始）** (Discharge - Service Restart)

**Grouping Logic:**

```typescript
// Hospital-Discharge Pairing
// Match discharge records that occur on or after hospitalization date
const pairs: Array<{ hospital: ClientChangeRecord; discharge?: ClientChangeRecord }> = [];
sortedHospital.forEach(hospital => {
    const matchingDischarge = dischargeRecords
        .filter(d => !usedDischargeIds.has(d.id))
        .filter(d => (d.recordDate || '') >= (hospital.recordDate || ''))
        .sort((a, b) => (a.recordDate || '').localeCompare(b.recordDate || ''))[0];

    if (matchingDischarge) {
        usedDischargeIds.add(matchingDischarge.id);
        pairs.push({ hospital, discharge: matchingDischarge });
    } else {
        pairs.push({ hospital }); // Unpaired hospitalization
    }
});

// New-Cancel Pairing (same logic)
// Match cancel records that occur on or after new contract date
const contractPairs: Array<{ newRecord: ClientChangeRecord; cancelRecord?: ClientChangeRecord }> = [];
// ... similar pairing logic
```

**Display Order:**
1. **入院・退院ペア** (Hospital-Discharge Pairs) - Orange header
   - Side-by-side display: Hospitalization (red) | Discharge (green)
   - Unpaired discharges shown separately

2. **新規・解約ペア** (New-Cancel Pairs) - Purple header
   - Side-by-side display: New (blue) | Cancel (gray)
   - Shows "解約情報なし（継続中）" for active contracts

3. **単独の解約レコード** (Unpaired Cancel Records) - Gray header
   - Cancel records without matching new records

**Key Features:**
- **Date-based pairing**: Automatically matches records chronologically
- **Visual grouping**: Color-coded cards for each record type
- **Editable fields**: All fields can be modified when in edit mode
- **Firestore persistence**: Changes saved to `clientEdits/{aozoraId}` collection
- **Kintone IDs**: String format like `kintone-184-hospitalization-564`

**Important Notes:**
- IDs from Kintone are strings (not numbers) - avoid `parseInt(id)`
- Pairing uses `recordDate` field for chronological matching
- Unpaired records are displayed separately to maintain data visibility
- All change records stored in `client.changeRecords[]` array

**Location:**
- File: `components/ClientDetail.tsx` (lines 1092-1650+)
- State: `editedClient.changeRecords` (array of `ClientChangeRecord`)

## Critical Implementation Details

### Authentication Flow
- Firebase Authentication with Google Sign-In
- Auth state managed via `AuthContext` in `src/contexts/AuthContext.tsx`
- Protected routes: All screens require authentication
- Firestore security rules: Only authenticated users can read/write

### AI Integration (Gemini)
- Service: `services/geminiService.ts`
- Functions:
  - `generateMeetingSummary()`: Convert rough notes → formatted meeting minutes
  - `suggestEquipment()`: Suggest equipment based on medical history
- Uses Google AI API (browser-compatible)
- Model: `gemini-2.0-flash-exp`
- SDK: `@google/generative-ai` (browser-compatible, NOT @google-cloud/vertexai)
- **Important**: Must use browser-compatible SDK; Node.js-only SDKs cause "process is not defined" errors

### Welfare Equipment User Flag
- Field: `isWelfareEquipmentUser` (boolean)
- Locations:
  1. Basic info tab: Manual checkbox
  2. Client list: Checkbox per client (with event.stopPropagation() to prevent navigation)
  3. Filter toggle: "全員" vs "福祉用具" buttons
- Persisted to Firestore immediately on change
- Used to filter 457 welfare equipment users from 8,406 total

### Office Field (事業所)
- Field: `office` (OfficeLocation: '鹿児島（ACG）' | '福岡（Lichi）')
- Central configuration: Set in Tab1 (基本情報) via dropdown
- Referenced by other tabs: Tab3 (議事録), Tab4 (変更情報), Tab5 (福祉用具選定), Tab6 (売上管理)
- Implementation: Other tabs display office field as read-only, automatically populated from `editedClient.office`
- Default value: '鹿児島（ACG）' (set in App.tsx for new clients and importSpreadsheetData.cjs)
- Persisted to Firestore with other client edits

### Important File Locations

**Type Definitions:**
- `types.ts`: 70+ TypeScript interfaces including `Client`, `Equipment`, `Meeting`, etc.

**Firestore Integration:**
- `src/services/firestoreService.ts`: Save/load user edits
- `firestoreAdmin.cjs`: Server-side Firestore operations for import scripts
- `firestore.rules`: Security rules (authenticated users only)

**Data Import Scripts:**
- `importSpreadsheetData.cjs`: Primary import from Google Sheets (runs daily)
- `importFromKintone.cjs`: Import change records from Kintone (runs daily)
- `fetchEquipmentMaster.cjs`: Fetch equipment catalog
- `copy-clients.cjs`: Copy data files to dist during build

**GitHub Actions:**
- `.github/workflows/daily-sync.yml`: Daily data sync (Google Sheets + Kintone) + deployment

### Build Process Notes

1. **clients.json handling:**
   - Generated by import scripts (7.7MB)
   - Copied to `public/assets/clients.json` for development
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
  office: OfficeLocation;  // '鹿児島（ACG）' | '福岡（Lichi）' - set in Tab1, referenced by other tabs
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

**Always update documentation when implementing features.** Documentation is the source of truth for understanding the system.

### Implementation Pattern

1. **Update README.md first** with feature specification
2. Implement in code following the spec
3. **Update CLAUDE.md** with implementation details
4. Test and deploy
5. **Commit documentation and code together**

### Critical Documentation Rules

Based on lessons learned from documentation inconsistencies (2026-01-09):

#### 1. Field Additions Require Full Documentation
When adding a new field (e.g., `office` field):
- **README.md**: Document in ALL affected tabs, not just where it's defined
  - Tab1 (definition): Show as editable dropdown
  - Tab3-6 (references): Show as read-only with note "基本情報タブから参照"
  - Data Model section: Add to interface definition
- **CLAUDE.md**: Add to Critical Implementation Details section
- **types.ts**: Update TypeScript interfaces

**Example (office field):**
```typescript
// Tab1: Editable
<select value={editedClient.office} onChange={...}>
  <option>鹿児島（ACG）</option>
  <option>福岡（Lichi）</option>
</select>

// Tab3-6: Read-only reference
<input disabled value={editedClient.office} />
<span className="text-xs">（基本情報から参照）</span>
```

#### 2. Label Changes Must Update All Locations
When changing UI labels (e.g., "基本情報・住所" → "基本情報"):
- **README.md**: Update in screen structure diagram AND section headers
- **CLAUDE.md**: Update in component architecture
- Search for the old label across ALL documentation files

#### 3. Path Changes Require Global Updates
When changing file paths (e.g., `public/clients.json` → `public/assets/clients.json`):
- **README.md**: Update in all command examples
- **CLAUDE.md**: Update in Essential Commands and Build Process Notes
- **SYNC_SETUP.md**: Update in manual execution steps
- **GitHub Actions**: Update workflow files

Use grep to find all occurrences:
```bash
grep -r "public/clients.json" *.md .github/
```

#### 4. Multi-Document Consistency
Maintain consistency across:
- **README.md**: User-facing documentation (detailed specs, all features)
- **CLAUDE.md**: Developer documentation (architecture, patterns, critical details)
- **SYNC_SETUP.md**: Operational documentation (deployment, troubleshooting)
- **GITHUB_ACTIONS_SETUP.md**: CI/CD documentation

**Avoid duplication:** Link between documents instead of copying content.

#### 5. Document Maintenance
- **Regular reviews**: Check for outdated information quarterly
- **Delete obsolete content**: Remove unused implementations (e.g., Cloud Build setup when using GitHub Actions)
- **Simplify**: Keep documents under 150 lines when possible
- **Version critical changes**: Note date and commit for major fixes

### Documentation Quality Checklist

Before committing, verify:
- [ ] All affected tabs/components documented
- [ ] All file paths current and correct
- [ ] No duplicate information across documents
- [ ] Links to other documents instead of copying content
- [ ] TypeScript interfaces match documentation
- [ ] Examples show actual implementation patterns

### Recent Examples

See these commits for documentation best practices:
- `237bdfe`: Fix P1 documentation inconsistencies (office field, Tab1 label, paths)
- `61fc372`: Streamline SYNC_SETUP.md (263→135 lines, remove obsolete content)
- Document-driven pattern: 福祉用具利用フラグ, カスケードフィルタリング機能
