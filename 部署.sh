#!/usr/bin/env bash
# ============================================================
#  deploy entry point  (Linux)
#  (the file itself is named in Chinese: "bu shu .sh" =
#   "deploy.sh"; that name lives in the filesystem only,
#   never inside this file)
# ------------------------------------------------------------
#  真正的实现是 build/deploy-cli.mjs。这个文件只做五件事：
#    1. 切到脚本所在目录（双击、软链、从别的目录调用都找得到项目）
#    2. 保证终端按 UTF-8 解码          ← 对应 .cmd 里的 chcp 65001
#    3. 给终端窗口起个标题             ← 对应 .cmd 里的 title
#    4. 把参数原样转给 CLI，退出码原样交回去
#    5. 双击 / 文件管理器启动（没有终端）时，自己开一个终端
#
#  和「部署.cmd」的差别，以及为什么：
#    · cmd.exe 是按当前代码页逐字节读批处理、按偏移重读的，所以那边
#      必须纯 ASCII；bash 整文件解码，中文文案不会让解释器错位执行，
#      所以这里直接写中文，和 deploy-cli.mjs 的输出风格保持一致。
#    · Linux 没有「代码页」要还原，改的只是本进程的 LANG，父 shell
#      不受影响，所以不需要 .cmd 那段 :done 里的还原逻辑。
#    · cmd 双击窗口由 Windows 起；Linux 双击 .sh 默认没有终端，所以
#      多了一段「自己开终端」，否则窗口里什么都看不见。
#
#  跑法（把 .cmd 换成 ./部署.sh，参数一模一样）：
#    ./部署.sh                  进交互界面（真终端里默认 TUI）
#    ./部署.sh full -y          一条龙，不确认（纯文本输出）
#    ./部署.sh full --no-build  只改了几篇 .md，跳过重新构建
#    ./部署.sh build            只构建     ./部署.sh status   看状态
#    ./部署.sh bakup --check    只看会备份什么（源码备份，与部署无关）
#    ./部署.sh --help           全部命令和选项
#
#  环境变量（可选）：
#    JINS_NODE=/path/to/node    指定用哪个 node
#    JINS_NO_TERM=1             禁止「没有终端就自己开一个」
# ============================================================

set -u

TITLE='JinSuper Deploy'
MAIN_REL='build/deploy-cli.mjs'

# ── 0. 自己是谁、项目在哪 ────────────────────────────────────
# 软链也要认：realpath 拿不到就退回原路径，dirname/basename 照常能用。
_self="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  _real="$(readlink -f -- "$_self" 2>/dev/null || true)"
  [ -n "$_real" ] && _self="$_real"
fi
ROOT="$(cd -- "$(dirname -- "$_self")" 2>/dev/null && pwd -P)" || {
  printf '\n  [X] 定位不到脚本所在目录：%s\n\n' "$_self" >&2
  exit 1
}
SELF="$ROOT/$(basename -- "$_self")"
MAIN="$ROOT/$MAIN_REL"
cd -- "$ROOT" || exit 1

# ── 1. 终端按 UTF-8 解码（对应 chcp 65001） ───────────────────
# 取生效的那个 locale（LC_ALL > LC_CTYPE > LANG），已经是 UTF-8 就不动。
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) ;;
  *)
    for _loc in C.UTF-8 C.utf8 en_US.UTF-8 zh_CN.UTF-8; do
      if locale -a 2>/dev/null | grep -qxF -- "$_loc"; then
        unset LC_ALL LC_CTYPE
        LANG="$_loc"
        export LANG
        break
      fi
    done
    ;;
esac

# ── 2. 终端窗口标题（对应 title） ────────────────────────────
if [ -t 1 ]; then printf '\033]0;%s\007' "$TITLE"; fi

# ── 3. 没有终端就自己开一个 ─────────────────────────────────
# 从终端里跑一定命不中这段。设 JINS_NO_TERM=1 可以彻底关掉它。
if [ ! -t 0 ] && [ -z "${JINS_RELAUNCHED:-}" ] && [ -z "${JINS_NO_TERM:-}" ] \
   && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  _term=''
  for _cand in x-terminal-emulator gnome-terminal konsole xfce4-terminal kitty alacritty xterm; do
    if command -v "$_cand" >/dev/null 2>&1; then _term="$_cand"; break; fi
  done
  if [ -z "$_term" ]; then
    printf '\n  [X] 没找到可用的终端程序，开不了窗口。\n\n      请在终端里跑：cd %s && ./部署.sh %s\n\n' \
      "$ROOT" "$*" >&2
    exit 1
  fi
  # Debian 系的 x-terminal-emulator 是 alternatives 软链，参数规则得按真实终端走
  _real_term="$(readlink -f -- "$(command -v "$_term")" 2>/dev/null || true)"
  case "$_real_term" in
    */gnome-terminal) _term=gnome-terminal ;;
    */konsole)        _term=konsole ;;
    */xfce4-terminal) _term=xfce4-terminal ;;
    */kitty)          _term=kitty ;;
  esac
  # 只开一个窗口：开完就把退出码当自己的（开不出来会在这里报 command not found）。
  # 故意不做「这个终端失败了再换下一个」——里面那趟部署失败时退出码非 0，
  # 那样会再弹一个窗口出来。
  export JINS_RELAUNCHED=1
  case "$_term" in
    gnome-terminal) "$_term" -- "$SELF" "$@" ;;
    xfce4-terminal) "$_term" -x "$SELF" "$@" ;;
    kitty)          "$_term"    "$SELF" "$@" ;;
    *)              "$_term" -e "$SELF" "$@" ;;
  esac
  exit $?
fi

# ── 4. 找 Node ──────────────────────────────────────────────
# 优先 PATH 里的 node（Debian 老包叫 nodejs），JINS_NODE 可以手动指定。
NODE_BIN="${JINS_NODE:-}"
if [ -z "$NODE_BIN" ]; then
  for _c in node nodejs; do
    if command -v "$_c" >/dev/null 2>&1; then NODE_BIN="$_c"; break; fi
  done
fi

# ── 5. 干活 ─────────────────────────────────────────────────
if [ -z "$NODE_BIN" ]; then
  cat >&2 <<'EOF'

  [X] 没找到 Node.js（PATH 里没有 node）。

      到 https://nodejs.org/ 装 LTS 版，或者用包管理器：
        Debian/Ubuntu   sudo apt install nodejs
        Fedora          sudo dnf install nodejs
        Arch            sudo pacman -S nodejs
      装完重开一个终端，再跑这个脚本。

EOF
  _code=1
elif [ ! -f "$MAIN" ]; then
  printf '\n  [X] 缺文件：\n      %s\n\n' "$MAIN" >&2
  _code=1
else
  "$NODE_BIN" "$MAIN" "$@"
  _code=$?
fi

# ── 6. 收尾 ─────────────────────────────────────────────────
# .cmd 出错时无条件 pause，双击的窗口不会一闪就没。这里只在真终端里等
# 回车，免得把管道和自动化卡住。
if [ "$_code" -ne 0 ] && [ -t 0 ]; then
  printf '\n  按回车键关闭…'
  read -r _jins_wait || true
  printf '\n'
fi
exit "$_code"
