const fs = require('fs');

const content = fs.readFileSync('./components/ClientDetail.tsx', 'utf8');
const lines = content.split('\n');

// Find line 1699 (0-indexed: 1698) - insuranceRentals.map((eq) =>
const startLine = 1698; // 0-indexed (line 1699 in editor)
const endLine = 2050;   // 0-indexed (line 2051 in editor where ))} is)

console.log(`Replacing lines ${startLine + 1} to ${endLine + 1}`);
console.log(`Line ${startLine + 1}: ${lines[startLine]}`);
console.log(`Line ${endLine + 1}: ${lines[endLine]}`);

// New table row content
const tableRowContent = `                            {insuranceRentals.map((eq) => (
                              <tr key={eq.id} className="hover:bg-blue-50 transition-colors">
                                <td className="px-4 py-3">{eq.name || '-'}</td>
                                <td className="px-4 py-3">{eq.manufacturer || '-'}</td>
                                <td className="px-4 py-3">{eq.category || '-'}</td>
                                <td className="px-4 py-3">{eq.units || '-'}</td>
                                <td className="px-4 py-3 text-xs">{eq.taisCode || '-'}</td>
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
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>`;

// Replace the content
const newLines = [
  ...lines.slice(0, startLine),
  tableRowContent,
  ...lines.slice(endLine + 1)
];

fs.writeFileSync('./components/ClientDetail.tsx', newLines.join('\n'), 'utf8');
console.log('✓ Insurance rentals table format applied');
