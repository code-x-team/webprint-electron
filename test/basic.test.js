// 기본 구조 테스트
const fs = require('fs');
const path = require('path');

console.log('🧪 WebPrinter 기본 테스트 시작...');

// 필수 파일 존재 확인
const requiredFiles = [
  'main.js',
  'preload.js',
  'print-preview.html',
  'package.json',
  'modules/server.js',
  'modules/window.js',
  'modules/printer.js'
];

let failed = false;

requiredFiles.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file} 존재`);
  } else {
    console.error(`❌ ${file} 없음`);
    failed = true;
  }
});

// package.json 유효성 확인
try {
  const pkg = require('../package.json');
  console.log(`✅ package.json 유효 (v${pkg.version})`);
} catch (error) {
  console.error('❌ package.json 파싱 실패');
  failed = true;
}

if (failed) {
  console.error('\n❌ 테스트 실패');
  process.exit(1);
} else {
  console.log('\n✅ 모든 테스트 통과');
  process.exit(0);
}