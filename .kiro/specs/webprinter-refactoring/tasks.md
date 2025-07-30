# WebPrinter 리팩토링 구현 계획

## 현재 상태 분석
- **main.js**: 1287+ 라인의 단일 파일에 모든 로직 집중
- **구조**: 아직 모듈화되지 않은 원본 상태
- **중복 파일**: index.html, web-example.html 등 중복 웹 인터페이스 존재
- **테스트**: 테스트 코드 없음
- **설정**: 하드코딩된 설정값들이 main.js에 분산

## 1. 프로젝트 구조 및 기본 유틸리티 구축

- [ ] 1.1 새로운 디렉토리 구조 생성
  - src/, config/, tests/, docs/, scripts/ 디렉토리 생성
  - 기존 파일들을 새 구조에 맞게 이동 준비
  - 디렉토리 구조 검증 및 README 업데이트
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 1.2 설정 관리 시스템 구현
  - Config 클래스 구현 (src/main/utils/Config.js)
  - 환경별 설정 파일 생성 (config/default.json, development.json, production.json)
  - main.js의 하드코딩된 포트 범위(18731-18740), 세션 경로 등을 설정 파일로 이동
  - 설정 스키마 검증 로직 추가
  - _요구사항: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 1.3 로깅 시스템 구현
  - Logger 클래스 구현 (src/main/utils/Logger.js)
  - main.js의 50+ console.log 호출들을 구조화된 로깅으로 교체
  - 로그 레벨별 필터링 및 파일 출력 기능 구현
  - 로그 회전 및 크기 제한 기능 추가
  - _요구사항: 4.1, 4.2, 4.3, 4.5_

- [ ] 1.4 에러 처리 시스템 구현
  - ErrorHandler 클래스 구현 (src/main/utils/ErrorHandler.js)
  - main.js의 20+ try-catch 블록들을 통합 에러 처리로 개선
  - 에러 코드 체계 정의 (시스템, 네트워크, 프로토콜, 세션, 인쇄 에러)
  - 복구 메커니즘 및 사용자 알림 시스템 구현
  - _요구사항: 4.1, 4.4, 4.5_

## 2. 메인 프로세스 모듈화

- [ ] 2.1 AppManager 모듈 구현
  - AppManager 클래스 생성 (src/main/app/AppManager.js)
  - main.js의 앱 생명주기 관리 로직 (app.whenReady, app.on 이벤트들) 분리
  - 의존성 주입 컨테이너 기능 추가
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 2.2 WindowManager 모듈 구현
  - WindowManager 클래스 생성 (src/main/app/WindowManager.js)
  - main.js의 createPrintWindow 함수 및 BrowserWindow 관리 로직 분리
  - 창 상태 관리 기능 구현 (현재 printWindow 전역 변수 대체)
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 2.3 ProtocolHandler 모듈 구현
  - ProtocolHandler 클래스 생성 (src/main/protocol/ProtocolHandler.js)
  - main.js의 registerProtocol, handleProtocolCall, parseProtocolUrl 함수들 분리
  - UrlParser 유틸리티 생성 (src/main/protocol/UrlParser.js)
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 2.4 HttpServer 모듈 구현
  - HttpServer 클래스 생성 (src/main/server/HttpServer.js)
  - main.js의 startHttpServer, stopHttpServer 함수 및 Express 라우트들 분리
  - 라우트 모듈화 (src/main/server/routes/urls.js, status.js, version.js)
  - 미들웨어 시스템 구현 (src/main/server/middleware/)
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 2.5 SessionManager 모듈 구현
  - SessionManager 클래스 생성 (src/main/session/SessionManager.js)
  - main.js의 세션 관리 로직 (receivedUrls, saveSessionData, loadSessionData, cleanOldSessions) 분리
  - SessionStorage 클래스 생성 (src/main/session/SessionStorage.js)
  - Session 데이터 모델 정의
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 2.6 PrinterManager 모듈 구현
  - PrinterManager 클래스 생성 (src/main/printer/PrinterManager.js)
  - main.js의 IPC 핸들러들 (get-printers, print-url) 분리
  - PrintJobHandler 클래스 생성 (src/main/printer/PrintJobHandler.js)
  - 인쇄 작업 관리 로직 분리
  - _요구사항: 1.1, 1.2, 1.3_

## 3. 웹 인터페이스 정리 및 분리

- [ ] 3.1 웹 인터페이스 구조 재정리
  - 운영용 인터페이스 생성 (src/web/production/index.html)
  - 개발용 인터페이스 생성 (src/web/development/index.html)
  - 기존 중복 파일들 제거 (index.html, web-example.html)
  - _요구사항: 2.1, 2.2, 2.3_

- [ ] 3.2 공통 웹 모듈 추출
  - 공통 JavaScript 유틸리티 생성 (src/web/shared/utils.js)
  - 공통 API 클라이언트 생성 (src/web/shared/api.js)
  - 중복 코드 제거 및 모듈화
  - _요구사항: 2.4_

- [ ] 3.3 렌더러 프로세스 모듈화
  - print-preview 렌더러 리팩토링 (src/renderer/print-preview/)
  - 공통 렌더러 유틸리티 생성 (src/renderer/shared/)
  - IPC 통신 로직 정리
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 3.4 Preload 스크립트 정리
  - 기능별 preload 스크립트 분리 (src/preload/)
  - 공통 preload 유틸리티 생성
  - 보안 컨텍스트 브리지 최적화
  - _요구사항: 1.1, 8.1, 8.2_

## 4. 테스트 코드 구현

- [ ] 4.1 테스트 환경 설정
  - Jest 설정 및 테스트 스크립트 생성
  - 테스트 디렉토리 구조 생성 (tests/unit/, tests/integration/, tests/e2e/)
  - 모킹 유틸리티 및 테스트 헬퍼 구현
  - _요구사항: 5.1, 5.2, 5.3_

- [ ] 4.2 단위 테스트 구현
  - Config 클래스 테스트 작성
  - Logger 클래스 테스트 작성
  - SessionManager 테스트 작성
  - HttpServer 테스트 작성
  - _요구사항: 5.1, 5.2, 5.4_

- [ ] 4.3 통합 테스트 구현
  - 프로토콜 처리 워크플로우 테스트
  - 세션 관리 통합 테스트
  - 인쇄 워크플로우 테스트
  - _요구사항: 5.1, 5.3, 5.4_

- [ ] 4.4 E2E 테스트 구현
  - 기본 인쇄 시나리오 테스트
  - 에러 시나리오 테스트
  - 성능 테스트 케이스 추가
  - _요구사항: 5.1, 5.3, 5.4_

## 5. 보안 및 성능 최적화

- [ ] 5.1 입력 검증 시스템 구현
  - 요청 데이터 검증 미들웨어 구현
  - 스키마 기반 검증 로직 추가
  - 악의적 입력 차단 메커니즘 구현
  - _요구사항: 8.1, 8.3, 8.4_

- [ ] 5.2 보안 강화 구현
  - CORS 설정 강화
  - Rate Limiting 미들웨어 추가
  - 보안 헤더 설정
  - Path Traversal 방지 로직 구현
  - _요구사항: 8.1, 8.2, 8.3, 8.4_

- [ ] 5.3 성능 최적화 구현
  - 지연 로딩 메커니즘 구현
  - 메모리 사용량 최적화
  - 세션 정리 자동화
  - 캐싱 시스템 구현
  - _요구사항: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 5.4 업데이트 시스템 개선
  - UpdateManager 모듈 분리
  - 서명 검증 로직 추가
  - 점진적 업데이트 메커니즘 구현
  - _요구사항: 8.5_

## 6. 빌드 및 배포 시스템 개선

- [ ] 6.1 빌드 스크립트 개선
  - 환경별 빌드 설정 구현 (scripts/build.js)
  - 개발용 파일 제외 로직 추가
  - 코드 압축 및 최적화 설정
  - _요구사항: 6.1, 6.3_

- [ ] 6.2 개발 도구 개선
  - 개발 서버 스크립트 생성 (scripts/dev.js)
  - 핫 리로드 기능 추가
  - 개발용 디버깅 도구 통합
  - _요구사항: 6.1, 6.4_

- [ ] 6.3 배포 자동화 구현
  - 버전 관리 자동화 스크립트
  - 플랫폼별 빌드 최적화
  - 배포 전 검증 프로세스 구현
  - _요구사항: 6.2, 6.4, 6.5_

- [ ] 6.4 CI/CD 파이프라인 설정
  - GitHub Actions 워크플로우 생성
  - 자동 테스트 실행 설정
  - 배포 승인 프로세스 구현
  - _요구사항: 5.5, 6.4_

## 7. 모니터링 및 진단 도구 구현

- [ ] 7.1 헬스체크 시스템 구현
  - 헬스체크 엔드포인트 구현 (/health)
  - 시스템 상태 모니터링 로직 추가
  - 성능 메트릭 수집 기능 구현
  - _요구사항: 10.1, 10.2, 10.3_

- [ ] 7.2 진단 도구 구현
  - 진단 정보 수집 엔드포인트 구현
  - 로그 분석 도구 추가
  - 성능 프로파일링 기능 구현
  - _요구사항: 10.3, 10.5_

- [ ] 7.3 알림 시스템 구현
  - 임계치 모니터링 로직 구현
  - 알림 발송 메커니즘 추가
  - 에러 리포팅 시스템 구현
  - _요구사항: 10.4_

## 8. 문서화 및 개발자 도구

- [ ] 8.1 코드 문서화
  - JSDoc 주석 추가 (모든 public 메서드)
  - API 문서 자동 생성 설정
  - 아키텍처 다이어그램 생성
  - _요구사항: 9.1, 9.3_

- [ ] 8.2 사용자 문서 작성
  - API 사용 가이드 작성 (docs/api/)
  - 개발 환경 설정 가이드 작성
  - 배포 가이드 작성 (docs/deployment/)
  - _요구사항: 9.2, 9.5_

- [ ] 8.3 개발자 도구 개선
  - 린팅 설정 추가 (ESLint, Prettier)
  - 커밋 훅 설정 (Husky)
  - 코드 품질 검사 도구 통합
  - _요구사항: 9.4_

## 9. 기존 코드 마이그레이션

- [ ] 9.1 main.js 리팩토링
  - 기존 main.js의 로직을 새 모듈들로 분산
  - 새로운 진입점 파일 생성 (src/main/index.js)
  - 의존성 주입 및 초기화 로직 구현
  - _요구사항: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 9.2 print-preview.js 리팩토링
  - 렌더러 프로세스 코드 모듈화
  - IPC 통신 로직 정리
  - UI 컴포넌트 분리
  - _요구사항: 1.1, 1.2, 1.3_

- [ ] 9.3 설정 파일 마이그레이션
  - package.json 정리 및 최적화
  - 빌드 설정 분리
  - 환경 변수 관리 개선
  - _요구사항: 3.1, 3.2, 6.1_

- [ ] 9.4 호환성 검증
  - 기존 API 엔드포인트 호환성 확인
  - 프로토콜 URL 형식 호환성 검증
  - 설정 파일 자동 마이그레이션 구현
  - _요구사항: 모든 요구사항의 호환성 유지_

## 10. 최종 검증 및 배포 준비

- [ ] 10.1 통합 테스트 실행
  - 모든 테스트 케이스 실행 및 검증
  - 성능 벤치마크 테스트
  - 보안 취약점 스캔
  - _요구사항: 5.1, 5.5, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 10.2 문서 최종 검토
  - 모든 문서의 정확성 검증
  - 코드와 문서의 일치성 확인
  - 사용자 가이드 검토
  - _요구사항: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 10.3 배포 준비
  - 프로덕션 빌드 테스트
  - 배포 스크립트 검증
  - 롤백 계획 수립
  - _요구사항: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 10.4 성능 및 안정성 검증
  - 메모리 사용량 검증 (100MB 이하)
  - 시작 시간 검증 (3초 이내)
  - 장시간 실행 안정성 테스트
  - _요구사항: 7.1, 7.2, 7.3, 7.4, 7.5_