;; WebPrinter 커스텀 인스톨러/언인스톨러 스크립트
;; electron-builder 호환 버전

!macro customHeader
  RequestExecutionLevel admin
  
  ; 설치 디렉토리 정규화
  InstallDir "$PROGRAMFILES\WebPrinter"
!macroend

!macro CheckDependencies
  ; Visual C++ 2015-2022 재배포 패키지 확인
  DetailPrint "시스템 의존성 확인 중..."
  
  ; x64 시스템 확인
  ${If} ${RunningX64}
    ReadRegDword $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${If} $0 != 1
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "Visual C++ 2015-2022 재배포 패키지(x64)가 설치되지 않았습니다.$\n$\n설치를 계속하시겠습니까?" IDYES +2
      Abort
    ${EndIf}
  ${Else}
    ; x86 시스템
    ReadRegDword $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86" "Installed"
    ${If} $0 != 1
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "Visual C++ 2015-2022 재배포 패키지(x86)가 설치되지 않았습니다.$\n$\n설치를 계속하시겠습니까?" IDYES +2
      Abort
    ${EndIf}
  ${EndIf}
  
  DetailPrint "의존성 확인 완료"
!macroend

!macro SafeProcessTermination
  ; 안전한 프로세스 종료 (정상 종료 → 강제 종료)
  DetailPrint "WebPrinter 프로세스를 안전하게 종료하는 중..."
  
  ; 1단계: 정상 종료 시도
  nsExec::ExecToLog 'taskkill /im "WebPrinter.exe"'
  Pop $0
  ${If} $0 == 0
    DetailPrint "정상 종료 신호 전송됨. 대기 중..."
    Sleep 3000
  ${EndIf}
  
  ; 2단계: 프로세스 확인
  nsExec::ExecToLog 'tasklist /FI "IMAGENAME eq WebPrinter.exe" 2>NUL | find /I "WebPrinter.exe"'
  Pop $0
  ${If} $0 == 0
    DetailPrint "프로세스가 아직 실행 중입니다. 강제 종료 시도..."
    ; 3단계: 강제 종료
    nsExec::ExecToLog 'taskkill /f /im "WebPrinter.exe" /t'
    Sleep 2000
  ${Else}
    DetailPrint "프로세스가 정상적으로 종료되었습니다."
  ${EndIf}
  
  ; 4단계: WMI를 통한 확실한 종료
  nsExec::ExecToLog 'wmic process where "name=''WebPrinter.exe''" delete'
!macroend

!macro CleanupPorts
  ; 포트 점유 프로세스 정리
  DetailPrint "네트워크 포트 정리 중..."
  
  ; 주요 포트만 확인 (18731-18735)
  nsExec::ExecToLog 'cmd /c "for /f "tokens=5" %p in (''netstat -ano ^| findstr :18731'') do taskkill /f /pid %p 2>nul"'
  nsExec::ExecToLog 'cmd /c "for /f "tokens=5" %p in (''netstat -ano ^| findstr :18732'') do taskkill /f /pid %p 2>nul"'
  nsExec::ExecToLog 'cmd /c "for /f "tokens=5" %p in (''netstat -ano ^| findstr :18733'') do taskkill /f /pid %p 2>nul"'
!macroend

!macro customInstall
  DetailPrint "WebPrinter 설치 준비 중..."
  
  ; 의존성 체크
  !insertmacro CheckDependencies
  
  ; 안전한 프로세스 종료
  !insertmacro SafeProcessTermination
  
  ; 포트 정리
  !insertmacro CleanupPorts
  
  ; 이전 설치 흔적 정리
  DetailPrint "이전 설치 정리 중..."
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegKey HKCR "webprinter"
  
  ; 파일 잠금 해제 대기
  Sleep 2000
  
  DetailPrint "WebPrinter 설치를 시작합니다..."
!macroend

; 설치 완료 후 자동 실행 설정
!macro customInit
  DetailPrint "자동 실행 설정 중..."
  
  ; 1. 프로토콜 등록
  DetailPrint "URL 프로토콜 등록 중..."
  WriteRegStr HKCR "webprinter" "" "URL:WebPrinter Protocol"
  WriteRegStr HKCR "webprinter" "URL Protocol" ""
  WriteRegStr HKCR "webprinter\DefaultIcon" "" "$INSTDIR\WebPrinter.exe,0"
  WriteRegStr HKCR "webprinter\shell\open\command" "" '"$INSTDIR\WebPrinter.exe" "%1"'
  
  ; 2. 시작 프로그램 등록 (다중 방식)
  DetailPrint "시작 프로그램 등록 중..."
  
  ; 현재 사용자 레지스트리
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter" '"$INSTDIR\WebPrinter.exe" --hidden --startup'
  
  ; 모든 사용자 레지스트리 (관리자 권한 시)
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter" '"$INSTDIR\WebPrinter.exe" --hidden --startup'
  
  ; App Paths 등록
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\WebPrinter.exe" "" "$INSTDIR\WebPrinter.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\WebPrinter.exe" "Path" "$INSTDIR"
  
  ; 3. 시작 폴더 바로가기
  DetailPrint "시작 폴더 바로가기 생성 중..."
  CreateShortCut "$SMSTARTUP\WebPrinter.lnk" "$INSTDIR\WebPrinter.exe" "--hidden --startup" "$INSTDIR\WebPrinter.exe" 0 SW_SHOWMINIMIZED
  
  ; 4. 작업 스케줄러 등록
  DetailPrint "작업 스케줄러 등록 중..."
  nsExec::ExecToLog 'schtasks /create /tn "WebPrinter_AutoStart" /tr "\"$INSTDIR\WebPrinter.exe\" --hidden --startup" /sc onlogon /rl highest /f 2>nul'
  
  ; 5. 방화벽 및 보안 설정
  DetailPrint "방화벽 예외 추가 중..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="WebPrinter" dir=in action=allow program="$INSTDIR\WebPrinter.exe" enable=yes profile=any'
  
  ; Windows Defender 예외 추가 시도
  DetailPrint "Windows Defender 예외 추가 시도 중..."
  nsExec::ExecToLog 'powershell -Command "Add-MpPreference -ExclusionPath \"$INSTDIR\" -ErrorAction SilentlyContinue" 2>nul'
  
  DetailPrint "자동 실행 설정이 완료되었습니다."
!macroend

!macro customUnInstall
  DetailPrint "WebPrinter 제거를 시작합니다..."
  
  ; 안전한 프로세스 종료
  !insertmacro SafeProcessTermination
  
  ; 시작 프로그램 제거 (모든 방식)
  DetailPrint "시작 프로그램에서 제거 중..."
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  
  ; 시작 폴더 바로가기 제거
  Delete "$SMSTARTUP\WebPrinter.lnk"
  
  ; 작업 스케줄러 제거
  DetailPrint "작업 스케줄러에서 제거 중..."
  nsExec::ExecToLog 'schtasks /delete /tn "WebPrinter_AutoStart" /f 2>nul'
  
  ; App Paths 제거
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\WebPrinter.exe"
  
  ; 프로토콜 핸들러 제거
  DetailPrint "프로토콜 핸들러 제거 중..."
  DeleteRegKey HKCR "webprinter"
  DeleteRegKey HKCU "Software\Classes\webprinter"
  
  ; 사용자 데이터는 언인스톨 시에만 정리 (일반 종료에서는 제외)
  DetailPrint "사용자 데이터 정리를 건너뜁니다..."
  
  ; 방화벽 규칙 제거
  DetailPrint "방화벽 규칙 제거 중..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="WebPrinter" 2>nul'
  
  DetailPrint "WebPrinter가 제거되었습니다."
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "WebPrinter 설치를 시작합니다.$\n$\n이 프로그램은 웹페이지에서 직접 인쇄를 가능하게 합니다.$\n$\n설치하기 전에 다른 모든 프로그램을 닫는 것을 권장합니다."
!macroend





!macro customInstallFailed
  DetailPrint "설치 실패 - 변경사항을 되돌립니다..."
  
  ; 실패 시 정리
  DeleteRegKey HKCR "webprinter"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  
  ; 프로세스가 남아있다면 종료
  nsExec::ExecToLog 'taskkill /f /im "WebPrinter.exe" /t 2>nul'
  
  MessageBox MB_OK|MB_ICONERROR "설치에 실패했습니다.$\n$\n다시 시도하기 전에 다음을 확인하세요:$\n• 관리자 권한으로 실행$\n• 바이러스 백신 일시 중지$\n• 다른 프로그램 종료"
!macroend