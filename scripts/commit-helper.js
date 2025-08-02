#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🚀 WebPrinter 커밋 헬퍼');
console.log('='.repeat(50));

const args = process.argv.slice(2);
const command = args[0];

function showUsage() {
  console.log(`
📋 사용법:
  node scripts/commit-helper.js <command> [options]

🎯 사용 가능한 명령어:

  commit <message>           - 자동 버전 업데이트와 함께 커밋
  commit-patch <message>     - Patch 버전(+0.0.1) 커밋
  commit-minor <message>     - Minor 버전(+0.1.0) 커밋  
  commit-major <message>     - Major 버전(+1.0.0) 커밋
  
  version-status             - 현재 Git 태그와 package.json 버전 상태 확인
  last-tag                   - 최신 Git 태그 확인

💡 예시:
  node scripts/commit-helper.js commit "fix: 버그 수정"
  node scripts/commit-helper.js commit-minor "feat: 새 기능 추가"
  node scripts/commit-helper.js commit-major "breaking: API 변경"
  
🔧 환경변수:
  VERSION_TYPE=patch|minor|major - 버전 타입 강제 지정

📌 참고:
  - 모든 커밋은 자동으로 Git 태그 기반 버전 업데이트를 실행합니다
  - pre-commit hook이 자동으로 package.json 버전을 업데이트합니다
  - 커밋 후 자동으로 새 태그를 생성할 수 있습니다
`);
}

function getCurrentVersionStatus() {
  console.log('\n📊 현재 버전 상태:');
  
  try {
    // 최신 Git 태그
    let latestTag = 'v0.0.0';
    try {
      latestTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    } catch (error) {
      console.log('📋 Git 태그가 없습니다');
    }
    
    // package.json 버전
    const packageJson = require('../package.json');
    const packageVersion = packageJson.version;
    
    console.log(`🏷️  최신 Git 태그: ${latestTag}`);
    console.log(`📦 package.json 버전: v${packageVersion}`);
    
    if (latestTag === `v${packageVersion}`) {
      console.log('✅ 버전이 동기화되어 있습니다');
    } else {
      console.log('⚠️  버전이 다릅니다 - 다음 커밋에서 자동 업데이트됩니다');
    }
    
  } catch (error) {
    console.error('❌ 버전 상태 확인 실패:', error.message);
  }
}

function performCommit(message, versionType = 'auto') {
  if (!message) {
    console.error('❌ 커밋 메시지가 필요합니다');
    process.exit(1);
  }
  
  console.log(`\n🔄 커밋 준비 중... (버전 타입: ${versionType.toUpperCase()})`);
  
  try {
    // 환경변수 설정
    const env = { ...process.env };
    if (versionType !== 'auto') {
      env.VERSION_TYPE = versionType;
    }
    
    // 스테이징된 파일이 있는지 확인
    const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
    if (!stagedFiles) {
      console.error('❌ 스테이징된 파일이 없습니다. 먼저 git add를 실행하세요');
      process.exit(1);
    }
    
    console.log('📁 스테이징된 파일들:');
    stagedFiles.split('\n').forEach(file => {
      console.log(`  - ${file}`);
    });
    
    // 커밋 실행 (pre-commit hook이 자동 실행됨)
    console.log('\n📝 커밋 실행 중...');
    execSync(`git commit -m "${message}"`, { 
      stdio: 'inherit',
      env 
    });
    
    console.log('✅ 커밋 완료!');
    
    // 새 버전 확인
    const packageJson = require('../package.json');
    const newVersion = packageJson.version;
    console.log(`🎉 새 버전: v${newVersion}`);
    
    // 태그 생성 제안
    console.log('\n💡 태그 생성을 원하시면 다음 명령어를 실행하세요:');
    console.log(`   git tag v${newVersion}`);
    console.log(`   git push origin v${newVersion}`);
    
  } catch (error) {
    console.error('❌ 커밋 실패:', error.message);
    process.exit(1);
  }
}

// 명령어 처리
switch (command) {
  case 'commit':
    performCommit(args[1]);
    break;
    
  case 'commit-patch':
    performCommit(args[1], 'patch');
    break;
    
  case 'commit-minor':
    performCommit(args[1], 'minor');
    break;
    
  case 'commit-major':
    performCommit(args[1], 'major');
    break;
    
  case 'version-status':
  case 'status':
    getCurrentVersionStatus();
    break;
    
  case 'last-tag':
    try {
      const latestTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
      console.log(`🏷️ 최신 태그: ${latestTag}`);
    } catch (error) {
      console.log('📋 Git 태그가 없습니다');
    }
    break;
    
  case 'help':
  case '--help':
  case '-h':
  default:
    showUsage();
    break;
}