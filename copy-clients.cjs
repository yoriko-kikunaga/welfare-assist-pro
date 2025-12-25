const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'public', 'clients.json');
const dest = path.join(__dirname, 'dist', 'assets', 'clients.json');

try {
  // Ensure assets directory exists
  const assetsDir = path.join(__dirname, 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  fs.copyFileSync(source, dest);
  console.log('✓ clients.jsonをdist/assetsにコピーしました');
} catch (error) {
  console.error('✗ コピーに失敗:', error.message);
  process.exit(1);
}
