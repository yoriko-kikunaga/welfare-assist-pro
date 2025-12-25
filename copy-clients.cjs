const fs = require('fs');
const path = require('path');

try {
  // Ensure dist directory exists
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Copy clients.json to dist/assets
  const clientsSource = path.join(__dirname, 'public', 'clients.json');
  const assetsDir = path.join(__dirname, 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  const clientsDest = path.join(assetsDir, 'clients.json');
  fs.copyFileSync(clientsSource, clientsDest);
  console.log('✓ clients.jsonをdist/assetsにコピーしました');

  // Copy equipmentMaster.json to dist root
  const equipmentSource = path.join(__dirname, 'public', 'equipmentMaster.json');
  const equipmentDest = path.join(distDir, 'equipmentMaster.json');
  fs.copyFileSync(equipmentSource, equipmentDest);
  console.log('✓ equipmentMaster.jsonをdistにコピーしました');
} catch (error) {
  console.error('✗ コピーに失敗:', error.message);
  process.exit(1);
}
