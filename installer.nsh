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

!macro customUnInstall
  DetailPrint "WebPrinter 제거를 시작합니다..."
  
  ; 안전한 프로세스 종료
  !insertmacro SafeProcessTermination
  
  ; 시작 프로그램 제거
  DetailPrint "시작 프로그램에서 제거 중..."
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  
  ; 프로토콜 핸들러 제거
  DetailPrint "프로토콜 핸들러 제거 중..."
  DeleteRegKey HKCR "webprinter"
  DeleteRegKey HKCU "Software\Classes\webprinter"
  
  ; 사용자 데이터 정리 옵션
  MessageBox MB_YESNO|MB_ICONQUESTION "저장된 세션 데이터와 설정을 삭제하시겠습니까?" IDYES delete_userdata
  Goto skip_userdata
  
  delete_userdata:
    DetailPrint "사용자 데이터 정리 중..."
    Delete "$PROFILE\.webprinter-sessions.json"
    RMDir /r "$APPDATA\WebPrinter"
    RMDir /r "$LOCALAPPDATA\WebPrinter"
    
    ; PDF 파일 정리 옵션
    MessageBox MB_YESNO|MB_ICONQUESTION "Downloads 폴더의 WebPrinter PDF 파일도 삭제하시겠습니까?" IDYES delete_pdfs
    Goto skip_pdfs
    
    delete_pdfs:
      RMDir /r "$PROFILE\Downloads\WebPrinter"
    
    skip_pdfs:
  
  skip_userdata:
  
  ; 방화벽 규칙 제거
  DetailPrint "방화벽 규칙 제거 중..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="WebPrinter" 2>nul'
  
  DetailPrint "WebPrinter가 제거되었습니다."
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "WebPrinter 설치를 시작합니다.$\n$\n이 프로그램은 웹페이지에서 직접 인쇄를 가능하게 합니다.$\n$\n설치하기 전에 다른 모든 프로그램을 닫는 것을 권장합니다."
!macroend


!macro customFinishPage
  !define MUI_FINISHPAGE_TEXT "WebPrinter 설치가 완료되었습니다.$\n$\n• 시스템 트레이에서 WebPrinter를 찾을 수 있습니다$\n• 웹페이지에서 인쇄 기능을 바로 사용할 수 있습니다$\n• 컴퓨터를 재시작하면 자동으로 실행됩니다"
  !define MUI_FINISHPAGE_RUN "$INSTDIR\WebPrinter.exe"
  !define MUI_FINISHPAGE_RUN_TEXT "지금 WebPrinter 실행하기"
  !define MUI_FINISHPAGE_RUN_CHECKED
  !define MUI_FINISHPAGE_RUN_PARAMETERS "--hidden"
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