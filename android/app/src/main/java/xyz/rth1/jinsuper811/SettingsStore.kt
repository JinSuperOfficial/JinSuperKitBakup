package xyz.rth1.jinsuper811

import android.content.Context
import xyz.rth1.jinsuper811.sync.SyncConfig

/**
 * SettingsStore.kt —— 本机设置（SharedPreferences）
 * ===========================================================
 * 只管三件事，而且都有默认值 —— **首次启动零输入**能直接看作业：
 *
 *   originId         打开的是哪个站（默认 `cn` 主站）
 *   offlineFallback  云端全连不上时用不用内置离线副本（默认开）
 *   autoFallback     云端之间互相顶替（默认开）
 *
 * 这里**不存令牌**。令牌的两个来源在 `SyncConfigStore` 里（包内 assets + 这里的手改值），
 * 这一层只提供「用户手改过的那份」的存取。
 */
class SettingsStore(context: Context) {

    companion object {
        private const val FILE = "jinsuper811"

        private const val K_ORIGIN = "originId"
        private const val K_AUTO = "autoFallback"
        private const val K_OFFLINE = "offlineFallback"

        /* 用户在设置页手改过的同步配置（不填就用包内那份） */
        private const val K_GITEE_OWNER = "giteeOwner"
        private const val K_GITEE_REPO = "giteeRepo"
        private const val K_GITEE_BRANCH = "giteeBranch"
        private const val K_GITEE_INBOX = "giteeInboxBranch"
        private const val K_GITEE_VIS = "giteeVisibility"
        private const val K_GITEE_PUBLIC = "giteePublicBase"
        private const val K_TOKEN = "token"
        private const val K_FROM = "from"
    }

    private val sp = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /* ═══════════════ 站点来源 ═══════════════ */

    var originId: String
        get() {
            val v = sp.getString(K_ORIGIN, null)
            return if (v != null && Origins.ALL.any { it.id == v }) v else Origins.DEFAULT_ORIGIN
        }
        set(value) {
            val v = if (Origins.ALL.any { it.id == value }) value else Origins.DEFAULT_ORIGIN
            sp.edit().putString(K_ORIGIN, v).apply()
        }

    var autoFallback: Boolean
        get() = sp.getBoolean(K_AUTO, true)
        set(value) = sp.edit().putBoolean(K_AUTO, value).apply()

    var offlineFallback: Boolean
        get() = sp.getBoolean(K_OFFLINE, true)
        set(value) = sp.edit().putBoolean(K_OFFLINE, value).apply()

    /** 按当前设置算出的回落链（第一个 = 用户选的那个） */
    fun chain(startId: String? = null): List<String> =
        Origins.buildChain(originId, autoFallback, offlineFallback, startId)

    /* ═══════════════ 同步配置的本机覆盖 ═══════════════ */

    /**
     * 拿一份「用户手改过」的覆盖值。
     * 空字符串 = 没改过，交给 `SyncConfigStore` 用包内那份兜底。
     */
    fun overrides(): SyncConfig = SyncConfig(
        giteeOwner = sp.getString(K_GITEE_OWNER, "").orEmpty(),
        giteeRepo = sp.getString(K_GITEE_REPO, "").orEmpty(),
        giteeBranch = sp.getString(K_GITEE_BRANCH, "").orEmpty(),
        giteeInboxBranch = sp.getString(K_GITEE_INBOX, "").orEmpty(),
        giteeVisibility = sp.getString(K_GITEE_VIS, "").orEmpty(),
        giteePublicBase = sp.getString(K_GITEE_PUBLIC, "").orEmpty(),
        token = sp.getString(K_TOKEN, "").orEmpty(),
        from = sp.getString(K_FROM, "").orEmpty(),
    )

    fun saveOverrides(c: SyncConfig) {
        sp.edit()
            .putString(K_GITEE_OWNER, c.giteeOwner)
            .putString(K_GITEE_REPO, c.giteeRepo)
            .putString(K_GITEE_BRANCH, c.giteeBranch)
            .putString(K_GITEE_INBOX, c.giteeInboxBranch)
            .putString(K_GITEE_VIS, c.giteeVisibility)
            .putString(K_GITEE_PUBLIC, c.giteePublicBase)
            .putString(K_TOKEN, c.token)
            .putString(K_FROM, c.from)
            .apply()
    }
}
