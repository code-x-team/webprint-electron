; WebPrinter 커스텀 인스톨러/언인스톨러 스크립트
; 이 파일은 electron-builder에서 자동으로 사용됩니다

!macro customInstall
  ; 설치 전 기존 프로세스 종료
  DetailPrint "기존 WebPrinter 프로세스 확인 중..."
  
  ; 모든 가능한 프로세스명으로 종료 시도
  nsExec::ExecToLog 'taskkill /f /im "WebPrinter.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "web-printer.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "webprint*.exe" /t'
  
  ; 포트 점유 프로세스 확인 및 종료 (18731-18740)
  DetailPrint "포트 점유 확인 중..."
  nsExec::ExecToLog 'cmd /c "for /l %i in (18731,1,18740) do netstat -ano | findstr :%i | findstr LISTENING"'
  
  ; 잠시 대기 (프로세스 종료 완료)
  Sleep 3000
  
  ; 레지스트리 정리 (이전 설치 흔적)
  DetailPrint "이전 설치 흔적 정리 중..."
  DeleteRegKey HKCU "Software\WebPrinter"
  DeleteRegKey HKLM "Software\WebPrinter"
  
  DetailPrint "WebPrinter 설치를 시작합니다..."
!macroend

!macro customUnInstall
  DetailPrint "WebPrinter 완전 제거를 시작합니다..."
  
  ; 1. 실행 중인 모든 WebPrinter 프로세스 강제 종료
  DetailPrint "실행 중인 프로세스 종료 중..."
  nsExec::ExecToLog 'taskkill /f /im "WebPrinter.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "web-printer.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "webprint*.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "electron.exe" /t'
  
  ; WMI를 사용한 프로세스 종료 (더 강력함)
  nsExec::ExecToLog 'wmic process where "name like ''%webprint%''" delete'
  
  ; 프로세스 종료 대기
  Sleep 3000
  
  ; 2. 시작 프로그램에서 제거
  DetailPrint "시작 프로그램에서 제거 중..."
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "web-printer"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "web-printer"
  
  ; Task Scheduler에서도 제거
  nsExec::ExecToLog 'schtasks /delete /tn "WebPrinter" /f'
  nsExec::ExecToLog 'schtasks /delete /tn "WebPrinterAutoStart" /f'
  
  ; 3. 프로토콜 핸들러 제거
  DetailPrint "프로토콜 핸들러 제거 중..."
  DeleteRegKey HKCR "webprinter"
  DeleteRegKey HKCU "Software\Classes\webprinter"
  DeleteRegKey HKLM "Software\Classes\webprinter"
  
  ; 4. 앱 레지스트리 정리
  DetailPrint "레지스트리 정리 중..."
  DeleteRegKey HKCU "Software\WebPrinter"
  DeleteRegKey HKLM "Software\WebPrinter"
  DeleteRegKey HKCU "Software\code-x-team\WebPrinter"
  DeleteRegKey HKLM "Software\code-x-team\WebPrinter"
  
  ; 5. 사용자 데이터 정리
  DetailPrint "사용자 데이터 정리 중..."
  Delete "$PROFILE\.webprinter-sessions.json"
  Delete "$PROFILE\.webprinter-config.json"
  RMDir /r "$APPDATA\WebPrinter"
  RMDir /r "$APPDATA\web-printer"
  RMDir /r "$LOCALAPPDATA\WebPrinter"
  RMDir /r "$LOCALAPPDATA\web-printer"
  RMDir /r "$PROGRAMDATA\WebPrinter"
  
  ; 6. 임시 파일 정리
  DetailPrint "임시 파일 정리 중..."
  RMDir /r "$TEMP\WebPrinter"
  RMDir /r "$TEMP\web-printer"
  RMDir /r "$TEMP\electron-*"
  
  ; 7. 윈도우 방화벽 규칙 제거
  DetailPrint "방화벽 규칙 제거 중..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="WebPrinter"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="WebPrinter HTTP Server"'
  
  ; 8. 캐시 정리
  DetailPrint "캐시 정리 중..."
  RMDir /r "$LOCALAPPDATA\electron"
  RMDir /r "$APPDATA\electron"
  
  DetailPrint "WebPrinter가 완전히 제거되었습니다."
!macroend

!macro customHeader
  RequestExecutionLevel admin
!macroend

!macro customWelcomePage
  ; 환영 페이지 사용자 정의
  !define MUI_WELCOMEPAGE_TEXT "WebPrinter 설치 마법사에 오신 것을 환영합니다.$\n$\n이 마법사는 WebPrinter를 컴퓨터에 설치합니다.$\n$\n설치를 시작하기 전에 다른 프로그램을 모두 종료하는 것이 좋습니다."
!macroend

!macro customFinishPage
  ; 완료 페이지 사용자 정의
  !define MUI_FINISHPAGE_TEXT "WebPrinter 설치가 완료되었습니다.$\n$\n• 백그라운드에서 자동으로 실행됩니다$\n• 웹페이지에서 webprinter:// 링크로 호출할 수 있습니다$\n• 시스템 트레이에서 관리할 수 있습니다"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "WebPrinter 실행"
  !define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApplication"
!macroend

Function LaunchApplication
  ; 설치 완료 후 앱 실행
  ExecShell "" "$INSTDIR\WebPrinter.exe" "--hidden"
FunctionEnd 