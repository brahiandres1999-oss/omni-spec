; Omni Studio NSIS hooks (plan §13 PK-02): "Abrir con Omni Studio" on folders and on the folder
; background in Explorer, per user (HKCU, no administrator rights). The uninstaller removes both keys.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OmniStudio" "" "Abrir con Omni Studio"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OmniStudio" "Icon" '"$INSTDIR\omni-studio.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OmniStudio\command" "" '"$INSTDIR\omni-studio.exe" "%V"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OmniStudio" "" "Abrir con Omni Studio"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OmniStudio" "Icon" '"$INSTDIR\omni-studio.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OmniStudio\command" "" '"$INSTDIR\omni-studio.exe" "%V"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OmniStudio"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OmniStudio"
!macroend
