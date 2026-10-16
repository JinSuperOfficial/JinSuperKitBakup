package xyz.rth1.jinsuper811

import android.app.Application
import android.os.Build
import xyz.rth1.jinsuper811.sync.GiteeTransport
import xyz.rth1.jinsuper811.sync.SyncConfig
import xyz.rth1.jinsuper811.sync.SyncEngine
import xyz.rth1.jinsuper811.sync.SyncQueue
import xyz.rth1.jinsuper811.sync.Transport
import java.io.File

/**
 * AppServices.kt —— 依赖装配的**唯一**一处
 * ===========================================================
 * 全应用只有这里 new 这些东西。好处是：谁依赖谁一眼看完，
 * 而且单测里可以拿同一批类配上临时目录整套跑（不需要真机）。
 *
 * 令牌来源优先级（对齐桌面版：包内 → 本机设置 → 编译期默认）：
 *   1. 包内 `assets/sync-config.json`（打包时注入，**不入库**）
 *   2. 本机设置里用户手改过的字段（`SettingsStore.overrides()`）
 *   3. `BuildConfig` 的默认值（空 —— 没注入就只是一个「能看不能传」的 APK）
 */
class AppServices(private val app: Application) {

    val settings = SettingsStore(app)

    /* ═══════════════ 作业数据 ═══════════════ */

    /**
     * 随包离线副本里的基线目录：`assets/site/class/data/hwk`。
     *
     * assets 不是一个真的目录（没法 `listFiles`），所以第一次启动时
     * 由 `HwkSeed` 把它**解到 filesDir 下的一个只读缓存目录**再当基线用 ——
     * 见 `baselineDir()`。解一次就够，之后不再动。
     */
    private val baselineCacheDir = File(app.cacheDir, "baseline-hwk")

    val hwkStore: HwkStore by lazy {
        HwkStore(
            dir = JinSuperApp.hwkDir(app),
            baselineDir = baselineCacheDir,
            outboxDir = File(JinSuperApp.syncDir(app), "outbox"),
        )
    }

    val syncQueue: SyncQueue by lazy { SyncQueue(File(JinSuperApp.syncDir(app), "queue")) }

    val syncConfig: SyncConfig by lazy { loadSyncConfig() }

    /** 传输层：配置齐了才给真的，否则给一个「一用就报配置不全」的假实现 */
    val transport: Transport by lazy {
        val problems = syncConfig.problems()
        if (problems.isEmpty()) {
            GiteeTransport(syncConfig) { /* log 先不接：需要时再挂到面板上 */ }
        } else {
            UnconfiguredTransport(problems.joinToString("；"))
        }
    }

    val syncEngine: SyncEngine by lazy { SyncEngine(hwkStore, transport, syncQueue) }

    /* ═══════════════ 启动准备 ═══════════════ */

    /**
     * 第一次打开要做的两件事（幂等，随便调几次）：
     *   1. 把 assets 里的基线解到缓存目录；
     *   2. 调 `store.seed()` 把基线导进 `filesDir/hwk/`。
     *
     * 为什么不直接把 assets 当基线目录：`HwkStore` 要 `listFiles()`，
     * 而 assets 只能按名字 open，列不出目录（这也是站点那边「目录必须落成文件」的同一个道理）。
     */
    fun prepare(force: Boolean = false): HwkStore.SeedResult {
        unpackBaselineIfNeeded()
        return if (force) hwkStore.reseed() else hwkStore.seed()
    }

    private fun unpackBaselineIfNeeded() {
        baselineCacheDir.mkdirs()
        val names = try {
            app.assets.list("${JinSuperApp.ASSETS_SITE}/class/data/hwk") ?: emptyArray()
        } catch (e: Exception) {
            emptyArray()
        }
        for (n in names) {
            if (!n.matches(Regex("^hwk-.+\\.json$")) && n != "index.json") continue
            val dst = File(baselineCacheDir, n)
            /* 已经解过且非空就跳过（省一次 IO；内容随包固定，不会变） */
            if (dst.isFile && dst.length() > 0) continue
            try {
                app.assets.open("${JinSuperApp.ASSETS_SITE}/class/data/hwk/$n").use { ins ->
                    dst.writeBytes(ins.readBytes())
                }
            } catch (e: Exception) {
                /* 单个文件解不出来不该拦住启动 */
            }
        }
    }

    /* ═══════════════ 配置 ═══════════════ */

    private fun loadSyncConfig(): SyncConfig {
        val fromBundle = try {
            app.assets.open(SYNC_CONFIG_ASSET).use { ins ->
                SyncConfig.fromMap(Json.asMap(Json.parse(ins.readBytes().toString(Charsets.UTF_8))))
            }
        } catch (e: Exception) {
            null
        } ?: SyncConfig()
        /* 这里**不**读 BuildConfig 里的令牌字样：令牌只有两个来源
           （包内 assets/sync-config.json + 本机设置），编译期不带任何凭据 ——
           免得有人以为「CI 上配个变量就能把令牌编进去」，那等于把令牌写进构建日志。 */

        /* 本机手改过的字段优先（空 = 没改） */
        val o = settings.overrides()
        val merged = fromBundle.copy(
            giteeOwner = o.giteeOwner.ifBlank { fromBundle.giteeOwner },
            giteeRepo = o.giteeRepo.ifBlank { fromBundle.giteeRepo },
            giteeBranch = o.giteeBranch.ifBlank { fromBundle.giteeBranch },
            giteeInboxBranch = o.giteeInboxBranch.ifBlank { fromBundle.giteeInboxBranch },
            giteeVisibility = o.giteeVisibility.ifBlank { fromBundle.giteeVisibility },
            giteePublicBase = o.giteePublicBase.ifBlank { fromBundle.giteePublicBase },
            token = o.token.ifBlank { fromBundle.token },
            from = o.from.ifBlank { fromBundle.from.ifBlank { deviceName() } },
        )
        return merged
    }

    /** 清单里写的「谁传的」——默认取手机型号，同学一看就知道是谁传的 */
    private fun deviceName(): String {
        val brand = Build.BRAND?.trim().orEmpty()
        val model = Build.MODEL?.trim().orEmpty()
        return when {
            brand.isEmpty() && model.isEmpty() -> "安卓手机"
            model.startsWith(brand, ignoreCase = true) -> model
            else -> "$brand $model".trim()
        }
    }

    companion object {
        /** 包内那份注入的配置（`android/tools/inject-sync-config.mjs` 生成，不入库） */
        const val SYNC_CONFIG_ASSET = "sync-config.json"
    }
}

/**
 * 配置不全时的占位传输层：**不抛异常、不静默**，把原因说清楚。
 * 这样「没注入令牌的包」在同步面板上会明说「只能看不能传」，
 * 而不是给同学一个看不懂的 NullPointerException。
 */
class UnconfiguredTransport(private val reason: String) : Transport {
    override val kind: String get() = "unconfigured"
    override val inboxBranch: String get() = "inbox"

    private fun fail(): Nothing =
        throw xyz.rth1.jinsuper811.sync.TransportException("同步没有配置好：$reason", 0)

    override fun stat(key: String, branch: String): Transport.Stat? = fail()
    override fun get(key: String, branch: String): ByteArray = fail()
    override fun put(key: String, data: ByteArray, branch: String, message: String): Transport.Stat = fail()
    override fun del(key: String, branch: String, message: String): Boolean = fail()
    override fun list(prefix: String, branch: String): List<Transport.Item> = fail()
}
