!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\Yankit"
    RMDir /r "$LOCALAPPDATA\Yankit"
  ${endIf}
!macroend
