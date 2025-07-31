const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('📁 빌드 환경 준비 중...');

// Express 모듈 존재 확인 및 재설치
function checkAndInstallDependencies() {
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
  const expressPath = path.join(nodeModulesPath, 'express');
  const corsPath = path.join(nodeModulesPath, 'cors');
  
  console.log('🔍 의존성 확인 중...');
  
  if (!fs.existsSync(expressPath)) {
    console.log('❌ Express 모듈이 없습니다. 재설치 중...');
    try {
      execSync('npm install express --save', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
      console.log('✅ Express 설치 완료');
    } catch (error) {
      console.error('❌ Express 설치 실패:', error.message);
    }
  } else {
    console.log('✅ Express 모듈 확인됨');
  }
  
  if (!fs.existsSync(corsPath)) {
    console.log('❌ CORS 모듈이 없습니다. 재설치 중...');
    try {
      execSync('npm install cors --save', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
      console.log('✅ CORS 설치 완료');
    } catch (error) {
      console.error('❌ CORS 설치 실패:', error.message);
    }
  } else {
    console.log('✅ CORS 모듈 확인됨');
  }
}

// 의존성 확인 실행
checkAndInstallDependencies();

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