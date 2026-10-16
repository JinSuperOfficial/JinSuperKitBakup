; 811 套装安装程序的自定义段（NSIS）
; ---------------------------------------------------------------
; electron-builder 默认只建一份快捷方式（名字来自 nsis.shortcutName），
; 而「811 套装」要的是**两个**：班级百宝箱（浏览站点）和作业编辑器
; （同一个 exe，加 --app=homework）。所以这里自己建、自己删，
; package.json 里把 createDesktopShortcut / createStartMenuShortcut 关掉。
;
; 文件必须是 UTF-8 **带 BOM**（NSIS 3 靠 BOM 认 Unicode，否则中文快捷方式名会乱码）。
; 图标：build/icon.ico（百宝箱）与 build/icon-hwk.ico（作业编辑器）。

; ── 安装位置必须稳定（更新全靠它）────────────────────────────────
; 默认的 electron-builder 安装程序第二页会问「给所有用户装 / 只给我装」，
; 而且它会**读注册表**记住上一次的选择：机器上一旦有一份「给所有用户」装的旧版
; （默认落在 $PROGRAMFILES\${MENU_FILENAME}\JinSuper），这一页就会默认勾中
; 「所有用户」→ 新版装进 Program Files，和之前 %LOCALAPPDATA%\Programs\JinSuper
; 那份并存：两份程序、两个卸载项、快捷方式互相覆盖，更新就乱了。
;
; 所以这里强制「只给当前用户装」：不再出现这一页、不需要管理员权限（学校机器多半
; 不给），路径固定 %LOCALAPPDATA%\Programs\JinSuper；升级时还会复用注册表里记的
; 那个 InstallLocation，永远落回同一处。
;
; 注意：宏名要与 electron-builder 模板里 `!ifmacrodef customInstallmode` 对得上
; （NSIS 的宏名不区分大小写，这里照官方文档的写法）。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

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

; ── 开工前提醒：机器上还有一份「给所有用户」装的旧版 ──────────────
; 那种旧版不会被这一版升级掉（一个在 Program Files、一个在用户目录），
; 不卸掉就是两份并存的局面，所以先把话说清楚。
!macro customInit
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到这台机器上有一份「给所有用户」安装的旧版：$\r$\n$0$\r$\n$\r$\n这一版只装给当前用户（%LOCALAPPDATA%\Programs\${APP_FILENAME}，不需要管理员权限）。$\r$\n建议先到「设置 → 应用」里卸载上面那份旧版再继续，免得两份并存、快捷方式互相覆盖。$\r$\n$\r$\n点「确定」继续安装。"
  ${endif}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\班级百宝箱.lnk"
  Delete "$DESKTOP\作业编辑器.lnk"
  Delete "$SMPROGRAMS\811 套装\班级百宝箱.lnk"
  Delete "$SMPROGRAMS\811 套装\作业编辑器.lnk"
  RMDir "$SMPROGRAMS\811 套装"
!macroend
