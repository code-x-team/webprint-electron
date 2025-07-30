; WebPrinter 커스텀 인스톨러/언인스톨러 스크립트
; 이 파일은 electron-builder에서 자동으로 사용됩니다

!macro customInstall
  ; 설치 전 기존 프로세스 종료
  DetailPrint "기존 WebPrinter 프로세스 확인 중..."
  nsExec::ExecToLog 'taskkill /f /im "WebPrinter.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "web-printer.exe" /t'
  
  ; 잠시 대기 (프로세스 종료 완료)
  Sleep 2000
  
  DetailPrint "WebPrinter 설치를 시작합니다..."
!macroend

!macro customUnInstall
  DetailPrint "WebPrinter 완전 제거를 시작합니다..."
  
  ; 1. 실행 중인 모든 WebPrinter 프로세스 강제 종료
  DetailPrint "실행 중인 프로세스 종료 중..."
  nsExec::ExecToLog 'taskkill /f /im "WebPrinter.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "web-printer.exe" /t'
  nsExec::ExecToLog 'taskkill /f /im "electron.exe" /t'
  
  ; 프로세스 종료 대기
  Sleep 3000
  
  ; 2. 시작 프로그램에서 제거
  DetailPrint "시작 프로그램에서 제거 중..."
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "web-printer"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebPrinter"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "web-printer"
  
  ; 3. 프로토콜 핸들러 제거
  DetailPrint "프로토콜 핸들러 제거 중..."
  DeleteRegKey HKCR "webprinter"
  DeleteRegKey HKCU "Software\Classes\webprinter"
  
  ; 4. 사용자 데이터 정리
  DetailPrint "사용자 데이터 정리 중..."
  Delete "$PROFILE\.webprinter-sessions.json"
  RMDir /r "$APPDATA\WebPrinter"
  RMDir /r "$APPDATA\web-printer"
  RMDir /r "$LOCALAPPDATA\WebPrinter"
  RMDir /r "$LOCALAPPDATA\web-printer"
  
  ; 5. 임시 파일 정리
  DetailPrint "임시 파일 정리 중..."
  RMDir /r "$TEMP\WebPrinter"
  RMDir /r "$TEMP\web-printer"
  
  ; 6. 윈도우 방화벽 규칙 제거 (있다면)
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="WebPrinter"'
  
  ; 7. 서비스 관련 정리 (혹시 등록되어 있다면)
  nsExec::ExecToLog 'sc delete "WebPrinter"'
  nsExec::ExecToLog 'sc delete "web-printer"'
  
  ; 8. 최종 프로세스 확인 및 강제 종료
  DetailPrint "최종 프로세스 정리 중..."
  nsExec::ExecToLog 'wmic process where "commandline like ''%WebPrinter%''" delete'
  nsExec::ExecToLog 'wmic process where "commandline like ''%web-printer%''" delete'
  
  DetailPrint "WebPrinter 완전 제거가 완료되었습니다."
  
  ; 제거 완료 메시지
  MessageBox MB_OK "WebPrinter가 성공적으로 제거되었습니다.$\n$\n• 모든 프로세스가 종료되었습니다$\n• 시작 프로그램에서 제거되었습니다$\n• 사용자 데이터가 정리되었습니다"
!macroend

!macro customHeader
  ; 인스톨러 헤더 사용자 정의
  !define MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_RIGHT
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