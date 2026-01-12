const fs = require('fs');

const content = fs.readFileSync('./components/ClientDetail.tsx', 'utf8');
const lines = content.split('\n');

// Find the selfPayRentals.map line (should be around 1740 now after previous changes)
let startLine = -1;
for (let i = 1700; i < 1800; i++) {
  if (lines[i] && lines[i].includes('selfPayRentals.map((eq) =>')) {
    startLine = i;
    break;
  }
}

if (startLine === -1) {
  console.error('Could not find selfPayRentals.map line');
  process.exit(1);
}

console.log(`Found selfPayRentals.map at line ${startLine + 1}`);

// Find the closing ))} for this map
let endLine = -1;
for (let i = startLine + 1; i < Math.min(startLine + 400, lines.length); i++) {
  if (lines[i] && lines[i].trim() === '))}') {
    endLine = i;
    break;
  }
}

if (endLine === -1) {
  console.error('Could not find closing line');
  process.exit(1);
}

console.log(`Found closing at line ${endLine + 1}`);
console.log(`Replacing lines ${startLine + 1} to ${endLine + 1}`);

// New table content for self-pay rentals
const tableContent = `                    {selfPayRentals.map((eq) => (
                      <tr key={eq.id} className="hover:bg-purple-50 transition-colors">
                        <td className="px-4 py-3">{eq.selfPayProductName || eq.name || '-'}</td>
                        <td className="px-4 py-3">{eq.unitPrice ? \`¥\${eq.unitPrice.toLocaleString()}\` : '-'}</td>
                        <td className="px-4 py-3">{eq.quantity || '-'}</td>
                        <td className="px-4 py-3 font-semibold">{eq.taxIncludedAmount ? \`¥\${eq.taxIncludedAmount.toLocaleString()}\` : '-'}</td>
                        <td className="px-4 py-3 text-xs">{eq.startDate || '-'}</td>
                        <td className="px-4 py-3 text-xs">{eq.endDate || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={\`px-2 py-1 rounded text-xs \${eq.kaipokeStatus === '登録済' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}\`}>
                            {eq.kaipokeStatus || '未登録'}
                          </span>
                        </td>
                        {isEditing && (
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => removeEquipment('selected', eq.id)}
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
                    ))}`;

// We also need to add the table structure before this
// Find the line before selfPayRentals.map (should be the header div closing)
const headerEndLine = startLine - 1;

// Insert table structure
const tableHeader = `
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-purple-50 border-b border-purple-100">
                            <tr>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">商品名</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">単価</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">数量</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">税込金額</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">利用開始日</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">利用終了日</th>
                              <th className="px-4 py-3 text-left font-bold text-purple-900">カイポケ</th>
                              {isEditing && <th className="px-4 py-3 text-center font-bold text-purple-900">操作</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">`;

const tableFooter = `                          </tbody>
                        </table>
                      </div>
                    </div>`;

// Replace the content
const newLines = [
  ...lines.slice(0, headerEndLine + 1),
  tableHeader,
  tableContent,
  tableFooter,
  ...lines.slice(endLine + 1)
];

fs.writeFileSync('./components/ClientDetail.tsx', newLines.join('\n'), 'utf8');
console.log('✓ Self-pay rentals table format applied');
