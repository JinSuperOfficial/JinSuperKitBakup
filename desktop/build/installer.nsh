; 811 套装安装程序的自定义段（NSIS）
; ---------------------------------------------------------------
; electron-builder 默认只建一份快捷方式（名字来自 nsis.shortcutName），
; 而「811 套装」要的是**两个**：班级百宝箱（浏览站点）和作业编辑器
; （同一个 exe，加 --app=homework）。所以这里自己建、自己删，
; package.json 里把 createDesktopShortcut / createStartMenuShortcut 关掉。
;
; 文件必须是 UTF-8 **带 BOM**（NSIS 3 靠 BOM 认 Unicode，否则中文快捷方式名会乱码）。
; 图标：build/icon.ico（百宝箱）与 build/icon-hwk.ico（作业编辑器）。

!macro customInstall
  ; 开始菜单里给套装一个自己的目录
  CreateDirectory "$SMPROGRAMS\811 套装"

  ; 桌面
  CreateShortCut "$DESKTOP\班级百宝箱.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0
  CreateShortCut "$DESKTOP\作业编辑器.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--app=homework" "$INSTDIR\resources\icon-hwk.ico" 0

  ; 开始菜单
  CreateShortCut "$SMPROGRAMS\811 套装\班级百宝箱.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\811 套装\作业编辑器.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--app=homework" "$INSTDIR\resources\icon-hwk.ico" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\班级百宝箱.lnk"
  Delete "$DESKTOP\作业编辑器.lnk"
  Delete "$SMPROGRAMS\811 套装\班级百宝箱.lnk"
  Delete "$SMPROGRAMS\811 套装\作业编辑器.lnk"
  RMDir "$SMPROGRAMS\811 套装"
!macroend
