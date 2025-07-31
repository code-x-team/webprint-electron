const fs = require('fs');
const path = require('path');

console.log('📁 빌드 환경 준비 중...');

// 필요한 디렉토리 생성
const directories = [
  'modules',
  'styles', 
  'renderer',
  'example',
  'example/css',
  'example/js',
  'assets',
  'test',
  'scripts'
];

directories.forEach(dir => {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ ${dir} 디렉토리 생성`);
  }
});

// assets 폴더에 기본 아이콘이 없으면 생성
const iconPath = path.join(process.cwd(), 'assets', 'icon.png');
if (!fs.existsSync(iconPath)) {
  console.log('⚠️  아이콘 파일이 없습니다. 빌드 전에 추가해주세요.');
  console.log('   assets/icon.png (512x512)');
  console.log('   assets/icon-32.png (32x32)');
}

console.log('✅ 빌드 환경 준비 완료');