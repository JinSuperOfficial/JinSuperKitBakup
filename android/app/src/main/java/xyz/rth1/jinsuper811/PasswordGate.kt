package xyz.rth1.jinsuper811

/**
 * PasswordGate.kt —— 「录作业」的密码门
 * ===========================================================
 * 进入编辑模式前必须过这一关。约定（见 project.md 的「移动端」一节）：
 *
 *   · 密码常量就在这个文件里（下面 EDIT_PASSWORD）—— **不写在网页 JS 里**：
 *     网页代码在 WebView 里是可见的，F12 / 抓包都能看到；
 *     虚拟 host 外部访问不到，但页面自己的脚本一样能被读出来。
 *   · 验证位置 = 壳层（Compose 弹框），验证逻辑 = 这个对象。
 *   · **有效期 = 本进程内**。退出编辑模式或进程被杀掉就失效，不写盘、不记住。
 *   · 失败只说「密码不对」，不透露任何别的信息；**不限次数**（给同学用，不做防爆破）。
 *   · 不做「记住密码」、不做「忘记密码」—— 忘了就联系管理员重打 APK。
 *
 * 为什么不做防爆破：这是同班同学的作业本，攻击者模型就是「同学想改作业」，
 * 加限流只会让手滑的同学被锁在外面。真正的边界是 Gitee 令牌（在 APK 里，
 * 见 SyncConfig.kt 的说明）。
 */
object PasswordGate {

    /**
     * ★ 编辑模式的密码。
     *
     * 改这里 = 改密码（README 的排障表里有一条「密码输对了也进不去 →
     * 检查 PasswordGate.kt 的常量是否被误改」，说的就是这个常量）。
     */
    const val EDIT_PASSWORD = "114514"

    /** 进程内有效：过了之后置 true，退出编辑模式 / 进程结束即失效 */
    @Volatile
    var unlocked: Boolean = false
        private set

    /** 校验一次密码并（成功时）解锁本次进程 */
    fun tryUnlock(input: String?): Boolean {
        val ok = input != null && input == EDIT_PASSWORD
        if (ok) unlocked = true
        return ok
    }

    /** 退出编辑模式 / 回到「看作业」时调一次，把这次会话的解锁状态清掉 */
    fun lock() {
        unlocked = false
    }
}
