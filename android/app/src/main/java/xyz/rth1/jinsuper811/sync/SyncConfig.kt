package xyz.rth1.jinsuper811.sync

/**
 * SyncConfig.kt —— 跨网同步的配置（**令牌是打包时注进包内的**）
 * ===========================================================
 * 对齐桌面版的 `desktop/build/make-sync-config.mjs` → `resources/sync-config.json`：
 * 同学**不用登录、不用配任何东西**，装完就能看、就能传。
 *
 * 来源优先级（和桌面版一致：包内 → 本机设置 → 仓库里的默认值）：
 *   1. 本机设置（SharedPreferences，用户手动改过才有）
 *   2. 包内 `assets/sync-config.json`（打包时注入，**这个文件不入库**，
 *      见 `.gitignore` 的 `android/app/src/main/assets/sync-config.json`）
 *   3. `BuildConfig` 里的默认值（空 —— 没注入就只是一个能看不能传的 APK）
 *
 * 字段与 `sync/lib/config.mjs` 的 DEFAULT_CONFIG 对齐，只是**扁平成一层**
 * （Kotlin 侧不用嵌套也能表达，扁平更好读、也更好在设置页里改）：
 *
 *   provider         'gitee'（默认）| 'local'
 *   giteeOwner       账号
 *   giteeRepo        仓库名（默认 jinsuper-sync）
 *   giteeBranch      站点镜像分支（家里 git push；学校只读）
 *   giteeInboxBranch 收件箱分支（学校用接口写）
 *   giteeVisibility  'private'（默认，走带令牌的 raw）| 'public'（走免令牌 CDN raw）
 *   giteePublicBase  自建 / 自定义域名（可选）
 *   token            Gitee 个人令牌
 *   from             上传时写进清单的「谁传的」（默认取手机型号）
 *
 * ★ 关于令牌明文（已拍板，别再改）：
 *   就照桌面版的做法**打包时明文注入**，不做额外加密 —— APK 比 exe 更容易解包，
 *   但加密只让「解包难度」上升一档，不改变「能被解包」这件事，却会把复杂度拉满。
 *   真正的防线是：令牌可以随时在 Gitee 侧撤销 + 重打一个 APK（流程见 README）。
 */
data class SyncConfig(
    val provider: String = "gitee",
    val giteeOwner: String = "",
    val giteeRepo: String = "jinsuper-sync",
    val giteeBranch: String = "main",
    val giteeInboxBranch: String = "inbox",
    val giteeVisibility: String = "private",
    val giteePublicBase: String = "",
    val token: String = "",
    val from: String = "",
) {
    val isGitee: Boolean get() = provider != "local"

    /** 配置齐不齐；不齐就把原因说出来（设置页 / 同步面板直接显示这个） */
    fun problems(): List<String> {
        if (!isGitee) return listOf("provider=local 需要配本地目录（安卓版暂不支持，请用 gitee）")
        val out = mutableListOf<String>()
        if (giteeOwner.isBlank()) out.add("还没配 giteeOwner（包内 sync-config.json）")
        if (giteeRepo.isBlank()) out.add("还没配 giteeRepo")
        if (token.isBlank()) out.add("还没有令牌（包内 sync-config.json 里的 token）")
        return out
    }

    val ready: Boolean get() = problems().isEmpty()

    /** 给界面看的一行说明（**不含令牌本身**） */
    fun describe(): String {
        if (!isGitee) return "本地目录 ·（安卓版暂不支持）"
        val vis = if (giteeVisibility == "public") "公开" else "私有"
        val host = giteePublicBase.ifBlank { "gitee.com/$giteeOwner/$giteeRepo" }
        return "Gitee · $host · $vis · 镜像分支 $giteeBranch / 收件箱分支 $giteeInboxBranch"
    }

    companion object {
        /** 把任意一个 map（来自 JSON）读成配置；缺字段用默认值 */
        @Suppress("UNCHECKED_CAST")
        fun fromMap(m: Map<String, Any?>?, fallback: SyncConfig = SyncConfig()): SyncConfig {
            if (m == null) return fallback
            val g = (m["gitee"] as? Map<String, Any?>) ?: emptyMap()
            fun s(key: String, dflt: String): String {
                val v = m[key] ?: g[key]
                val str = when (v) {
                    null -> ""
                    is String -> v
                    is xyz.rth1.jinsuper811.Json.Num -> v.raw
                    else -> v.toString()
                }
                return str.trim().ifBlank { dflt }
            }
            return SyncConfig(
                provider = s("provider", fallback.provider).let { if (it == "local") "local" else "gitee" },
                giteeOwner = s("giteeOwner", s("owner", fallback.giteeOwner)),
                giteeRepo = s("giteeRepo", s("repo", fallback.giteeRepo)),
                giteeBranch = s("giteeBranch", s("branch", fallback.giteeBranch)),
                giteeInboxBranch = s("giteeInboxBranch", s("inboxBranch", fallback.giteeInboxBranch)),
                giteeVisibility = if (s("giteeVisibility", s("visibility", fallback.giteeVisibility)) == "public") "public" else "private",
                giteePublicBase = s("giteePublicBase", s("publicBase", fallback.giteePublicBase)).trimEnd('/'),
                token = s("token", fallback.token),
                from = s("from", fallback.from),
            )
        }

        /** 配置 → 可写回的 JSON map（设置页保存用） */
        fun toMap(c: SyncConfig): LinkedHashMap<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            m["provider"] = c.provider
            m["giteeOwner"] = c.giteeOwner
            m["giteeRepo"] = c.giteeRepo
            m["giteeBranch"] = c.giteeBranch
            m["giteeInboxBranch"] = c.giteeInboxBranch
            m["giteeVisibility"] = c.giteeVisibility
            m["giteePublicBase"] = c.giteePublicBase
            m["token"] = c.token
            m["from"] = c.from
            return m
        }
    }
}
