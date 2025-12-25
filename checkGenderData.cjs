const fs = require('fs');

const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf-8'));

console.log('=== 性別データ確認 ===\n');

const genderStats = {
  '男性': 0,
  '女性': 0,
  'その他': 0
};

clients.forEach(client => {
  if (client.gender === '男性') {
    genderStats['男性']++;
  } else if (client.gender === '女性') {
    genderStats['女性']++;
  } else {
    genderStats['その他']++;
  }
});

console.log('総利用者数:', clients.length);
console.log('男性:', genderStats['男性']);
console.log('女性:', genderStats['女性']);
console.log('その他/未設定:', genderStats['その他']);

// 福祉用具利用者の性別分布
const welfareUsers = clients.filter(c => c.isWelfareEquipmentUser);
const welfareGenderStats = {
  '男性': 0,
  '女性': 0,
  'その他': 0
};

welfareUsers.forEach(client => {
  if (client.gender === '男性') {
    welfareGenderStats['男性']++;
  } else if (client.gender === '女性') {
    welfareGenderStats['女性']++;
  } else {
    welfareGenderStats['その他']++;
  }
});

console.log('\n=== 福祉用具利用者の性別分布 ===');
console.log('福祉用具利用者数:', welfareUsers.length);
console.log('男性:', welfareGenderStats['男性']);
console.log('女性:', welfareGenderStats['女性']);
console.log('その他/未設定:', welfareGenderStats['その他']);

// 女性名の末尾パターンをチェック
const femaleNamePatterns = ['子', '美', '恵', '代', '枝', '江', '乃', '香', '花', '奈', '菜', '音', '絵'];
const maleWithFemaleNamePattern = [];

clients.forEach(client => {
  if (client.gender === '男性') {
    const lastName = client.name.split(' ')[1] || '';
    const lastChar = lastName.charAt(lastName.length - 1);
    if (femaleNamePatterns.includes(lastChar)) {
      maleWithFemaleNamePattern.push({
        aozoraId: client.aozoraId,
        name: client.name,
        nameKana: client.nameKana,
        lastChar: lastChar,
        isWelfare: client.isWelfareEquipmentUser
      });
    }
  }
});

console.log(`\n=== 男性だが女性名パターンを持つ利用者: ${maleWithFemaleNamePattern.length}件 ===`);
if (maleWithFemaleNamePattern.length > 0) {
  console.log('最初の20件:');
  maleWithFemaleNamePattern.slice(0, 20).forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.aozoraId} ${item.name} (${item.nameKana}) - 末尾: ${item.lastChar}, 福祉用具: ${item.isWelfare ? 'Yes' : 'No'}`);
  });

  const welfareCount = maleWithFemaleNamePattern.filter(item => item.isWelfare).length;
  console.log(`\nうち福祉用具利用者: ${welfareCount}件`);
}
