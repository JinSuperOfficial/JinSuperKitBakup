/**
 * git 的 safe.directory 参数
 * ---------------------------------------------------
 * 只在 Windows 上会撞到，但两个平台一起带上更省心（Linux 上无副作用）：
 *
 *   项目在 WSL 里、工具链跑在 Windows 上时，仓库是走
 *   `\\wsl.localhost\Ubuntu-26.04\home\...` 这个 UNC 路径访问的。
 *   那些文件在 Windows 看来属于**别的用户**（WSL 里的 owner 不是当前 Windows 用户），
 *   于是 git 直接拒绝操作：
 *
 *     fatal: detected dubious ownership in repository at '//wsl.localhost/...'
 *
 *   去改全局配置（`git config --global --add safe.directory <路径>`）当然行，
 *   但那是「每台机器都要再做一遍」的手工步骤，而且会一直留在用户的全局配置里。
 *   用 `-c safe.directory=<本仓库>` 只给**这一次调用**放行：换机器、换目录都不用管。
 *
 * 反斜杠换成正斜杠：git 认 UNC 的正斜杠写法（git 2.46 实测），也和自己报错时
 * 给出的路径形式一致。
 */

/**
 * @param {string} dir 仓库的绝对路径
 * @returns {string[]} 该拼在 `git` 后面的 `-c` 参数
 */
export function safeArgs(dir) {
  const p = process.platform === 'win32' ? String(dir).replace(/\\/g, '/') : String(dir);
  return ['-c', `safe.directory=${p}`];
}
