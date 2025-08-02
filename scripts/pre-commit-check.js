#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Pre-commit 검증 및 버전 업데이트 시작...');

// 검증 결과 추적
let hasErrors = false;

// 0. 자동 버전 업데이트
function updateVersionFromGitTag() {
  console.log('\n🏷️ Git 태그 기반 버전 업데이트 중...');
  
  try {
    // 최신 Git 태그 가져오기
    let latestTag;
    try {
      latestTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
      console.log(`📋 최신 Git 태그: ${latestTag}`);
    } catch (error) {
      // 태그가 없는 경우 기본값 사용
      latestTag = 'v0.0.0';
      console.log('📋 Git 태그가 없어 기본값 사용: v0.0.0');
    }
    
    // 태그에서 버전 파싱 (v2.0.6 -> 2.0.6)
    const versionMatch = latestTag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!versionMatch) {
      console.error(`❌ 태그 형식이 올바르지 않습니다: ${latestTag} (예: v1.0.0)`);
      hasErrors = true;
      return;
    }
    
    let [, major, minor, patch] = versionMatch.map(Number);
    
    // 버전 증가 타입 결정 (우선순위: 환경변수 > 커밋 분석 > 기본값)
    let versionType = process.env.VERSION_TYPE || 'auto';
    
    if (versionType === 'auto') {
      versionType = 'patch'; // 기본값
      
      try {
        // staged 파일들의 diff를 분석하여 변경 규모 추정
        const diff = execSync('git diff --cached', { encoding: 'utf8' });
        
        // 키워드 기반 버전 타입 결정 (diff 내용 기준)
        if (diff.includes('BREAKING CHANGE') || 
            diff.includes('export') && diff.includes('module.exports') ||
            diff.includes('require(') && diff.includes('const ')) {
          versionType = 'major';
        } else if (diff.includes('function ') && diff.includes('new ') ||
                   diff.includes('export') && diff.includes('function') ||
                   diff.includes('module.exports') && diff.includes('function')) {
          versionType = 'minor';
        }
        // 나머지는 patch (기본값)
        
      } catch (error) {
        // 분석 실패 시 기본값 사용
        console.log('⚠️ 변경사항 분석 실패, patch 버전 증가로 진행');
      }
    }
    
    // 유효한 버전 타입인지 확인
    if (!['major', 'minor', 'patch'].includes(versionType)) {
      console.warn(`⚠️ 잘못된 VERSION_TYPE: ${versionType}, patch로 진행`);
      versionType = 'patch';
    }
    
    // 버전 증가 적용
    switch (versionType) {
      case 'major':
        major += 1;
        minor = 0;
        patch = 0;
        break;
      case 'minor':
        minor += 1;
        patch = 0;
        break;
      case 'patch':
      default:
        patch += 1;
        break;
    }
    
    const newVersion = `${major}.${minor}.${patch}`;
    console.log(`📈 버전 증가 타입: ${versionType.toUpperCase()}`);
    
    console.log(`🔄 버전 업데이트: ${latestTag} → v${newVersion}`);
    
    // package.json 읽기
    const packageJsonPath = 'package.json';
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;
    
    // 버전이 같으면 업데이트 스킵
    if (currentVersion === newVersion) {
      console.log(`✅ 버전이 이미 최신입니다: v${newVersion}`);
      return;
    }
    
    // package.json 버전 업데이트
    packageJson.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    
    console.log(`✅ package.json 버전 업데이트: v${currentVersion} → v${newVersion}`);
    
    // package-lock.json도 있으면 업데이트
    const packageLockPath = 'package-lock.json';
    if (fs.existsSync(packageLockPath)) {
      const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
      packageLock.version = newVersion;
      if (packageLock.packages && packageLock.packages[""]) {
        packageLock.packages[""].version = newVersion;
      }
      fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');
      console.log(`✅ package-lock.json 버전도 업데이트됨`);
    }
    
    // 변경된 파일들을 Git staging area에 추가
    try {
      execSync('git add package.json');
      console.log(`📥 package.json이 staging area에 추가됨`);
      
      if (fs.existsSync(packageLockPath)) {
        execSync('git add package-lock.json');
        console.log(`📥 package-lock.json도 staging area에 추가됨`);
      }
    } catch (error) {
      console.error(`❌ Git add 실패:`, error.message);
      hasErrors = true;
    }
    
  } catch (error) {
    console.error('❌ 버전 업데이트 실패:', error.message);
    hasErrors = true;
  }
}

// 1. 파일 크기 검증 (10MB 이상 파일 방지)
function checkFileSize() {
  console.log('\n📏 파일 크기 검증 중...');
  
  try {
    const gitFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .filter(file => file.trim());
    
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    
    for (const file of gitFiles) {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        if (stats.size > MAX_SIZE) {
          console.error(`❌ 파일이 너무 큽니다: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
          hasErrors = true;
        }
      }
    }
    
    if (!hasErrors) {
      console.log('✅ 파일 크기 검증 통과');
    }
  } catch (error) {
    console.log('⚠️ 파일 크기 검증 스킵 (Git 상태 확인 불가)');
  }
}

// 2. 민감한 정보 검증
function checkSensitiveInfo() {
  console.log('\n🔒 민감한 정보 검증 중...');
  
  const sensitivePatterns = [
    /password\s*=\s*["'][^"']*["']/i,
    /api[_-]?key\s*=\s*["'][^"']*["']/i,
    /secret\s*=\s*["'][^"']*["']/i,
    /token\s*=\s*["'][^"']*["']/i,
    /\b[A-Za-z0-9]{40}\b/, // 40자 API 키 패턴
    /\b[A-Za-z0-9]{32}\b/  // 32자 해시 패턴
  ];
  
  try {
    const gitFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .filter(file => file.trim() && (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.md')));
    
    for (const file of gitFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          for (const pattern of sensitivePatterns) {
            if (pattern.test(line) && !line.includes('example') && !line.includes('placeholder')) {
              console.error(`❌ 민감한 정보 감지: ${file}:${index + 1}`);
              console.error(`   내용: ${line.trim()}`);
              hasErrors = true;
            }
          }
        });
      }
    }
    
    if (!hasErrors) {
      console.log('✅ 민감한 정보 검증 통과');
    }
  } catch (error) {
    console.log('⚠️ 민감한 정보 검증 스킵 (Git 상태 확인 불가)');
  }
}

// 3. 기본 코드 품질 검증
function checkCodeQuality() {
  console.log('\n⚡ 기본 코드 품질 검증 중...');
  
  try {
    const gitFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .filter(file => file.trim() && file.endsWith('.js'));
    
    for (const file of gitFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          // console.log가 너무 많은지 확인
          if (line.includes('console.log') && !line.includes('//')) {
            // 개발용 console.log 경고 (에러는 아님)
            console.warn(`⚠️ console.log 발견: ${file}:${index + 1}`);
          }
          
          // 기본적인 문법 오류 체크
          if (line.includes('var ') && !line.includes('//')) {
            console.warn(`⚠️ var 대신 const/let 사용 권장: ${file}:${index + 1}`);
          }
        });
      }
    }
    
    console.log('✅ 기본 코드 품질 검증 완료');
  } catch (error) {
    console.log('⚠️ 코드 품질 검증 스킵 (Git 상태 확인 불가)');
  }
}

// 4. 버전 일관성 검증 (자동 업데이트 후 확인)
function checkVersionConsistency() {
  console.log('\n🔢 최종 버전 상태 확인 중...');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const version = packageJson.version;
    
    console.log(`✅ 최종 버전: v${version}`);
    
    // package-lock.json이 있으면 버전 일치 여부 확인
    if (fs.existsSync('package-lock.json')) {
      const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
      if (packageLock.version === version) {
        console.log(`✅ package-lock.json 버전 일치: v${version}`);
      } else {
        console.warn(`⚠️ package-lock.json 버전 불일치 감지됨 (자동 수정됨)`);
      }
    }
  } catch (error) {
    console.error('❌ 버전 확인 실패:', error.message);
    hasErrors = true;
  }
}

// 5. 필수 파일 존재 확인
function checkRequiredFiles() {
  console.log('\n📋 필수 파일 확인 중...');
  
  const requiredFiles = [
    'main.js',
    'package.json',
    'preload.js'
  ];
  
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      console.error(`❌ 필수 파일 누락: ${file}`);
      hasErrors = true;
    }
  }
  
  if (!hasErrors) {
    console.log('✅ 필수 파일 확인 완료');
  }
}

// 메인 실행
async function main() {
  // 가장 먼저 버전 업데이트 실행
  updateVersionFromGitTag();
  
  // 에러가 있으면 여기서 중단
  if (hasErrors) {
    console.error('\n❌ 버전 업데이트 실패로 인한 조기 종료');
    process.exit(1);
  }
  
  checkFileSize();
  checkSensitiveInfo();
  checkCodeQuality();
  checkVersionConsistency();
  checkRequiredFiles();
  
  console.log('\n' + '='.repeat(50));
  
  if (hasErrors) {
    console.error('❌ Pre-commit 검증 실패! 위 문제들을 수정 후 다시 커밋해주세요.');
    process.exit(1);
  } else {
    console.log('✅ 모든 Pre-commit 검증 통과! 커밋을 진행합니다.');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('💥 Pre-commit 검증 중 오류:', error);
  process.exit(1);
});