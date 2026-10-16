package xyz.rth1.jinsuper811

/**
 * Origins.kt —— 「网页来源」表 + 回落链（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 这是 `desktop/src/origins.js` 的同构移植：同一个来源表、同一条回落链、
 * 同一套设置归一规则。两边**故意各留一份**（一个是 JS、一个是 Kotlin，
 * 没法共用代码），所以改了一边必须改另一边 —— 契约由这两点钉住：
 *
 *   · `build/test-android.mjs` 会读这个文件，逐条比对来源 id / host / 顺序，
 *     和 `desktop/src/origins.js` 对不上就红；
 *   · `android/app/src/test/java/.../OriginsTest.kt` 把行为断言一遍。
 *
 * 为什么这个文件不 import 任何 android.*：
 * 它要能在 JVM 单测里直接跑（`./gradlew test`），不需要真机、不需要模拟器。
 * 凡是「能不能连上」这种事，交给调用方（SiteAssets / MainActivity）去做。
 */

/** 一个来源 = 一个站点根地址 */
data class Origin(
    val id: String,
    val label: String,
    val host: String,
    val url: String,
    val desc: String,
)

object Origins {

    const val DEFAULT_ORIGIN = "cn"

    /**
     * ★ 离线副本用的固定 origin。
     *
     * 这个域名是 **虚拟 host**：外部浏览器访问它会走真实 DNS、找不到 —— 天然隔离，
     * 没有端口暴露风险。所有页面与子资源都由 `LocalContentHandler` 在
     * `shouldInterceptRequest` 里接管。
     *
     * 为什么必须固定（不能用 127.0.0.1 + 随机端口）：
     * 作业页的勾选状态存在 localStorage，键是 `hw:<id>:<条目哈希>`；
     * localStorage 按 origin（scheme://host:port）隔离 —— **端口一随机，
     * origin 每次冷启动都变，同学之前勾过的作业全部消失**。
     * 这条在 README 的排障表里也写了一遍（现象：勾选状态每次都清空）。
     */
    const val LOCAL_HOST = "appassets.androidplatform.net"
    const val LOCAL_BASE = "https://$LOCAL_HOST"

    /**
     * 来源表。**顺序就是回落顺序**（对齐 desktop/src/origins.js 的 ORIGINS）。
     * 末尾的 `local` 的 url 是空的：它由本机伺服，地址是上面那个固定虚拟域。
     */
    val ALL: List<Origin> = listOf(
        Origin(
            id = "cn",
            label = "主站",
            host = "www.jinsuper.cn",
            url = "https://www.jinsuper.cn",
            desc = "默认入口，一级域名，走 CDN。",
        ),
        Origin(
            id = "rth",
            label = "热铁盒",
            host = "jinsuper.rth1.xyz",
            url = "https://jinsuper.rth1.xyz",
            desc = "热铁盒托管，内容和主站一致。",
        ),
        Origin(
            id = "gh",
            label = "GitHub Pages",
            host = "jinsuperofficial.github.io",
            url = "https://jinsuperofficial.github.io",
            desc = "GitHub Pages 托管，国内访问偶尔慢。",
        ),
        Origin(
            id = "local",
            label = "内置离线副本",
            host = LOCAL_HOST,
            url = "", // 运行时用 LOCAL_BASE
            desc = "随 APK 打包的最小离线集，断网也能看作业。",
        ),
    )

    /** 顶栏 / 落地页的固定入口（站点根绝对路径） */
    data class NavItem(val id: String, val label: String, val path: String, val hint: String)

    val NAV: List<NavItem> = listOf(
        NavItem("home", "主页", "/index.html", "百宝箱首页"),
        NavItem("class", "班级工具箱", "/class/index.html", "811 专区"),
        NavItem("homework", "作业", "/class/homework.html", "今天的作业"),
    )

    fun get(id: String?): Origin = ALL.firstOrNull { it.id == id }
        ?: ALL.first { it.id == DEFAULT_ORIGIN }

    fun isCloud(id: String?): Boolean = id != "local"

    /** 云端来源的根地址；local 没有云端地址，调用方要用 localBase() */
    fun urlOf(id: String?): String {
        val o = get(id)
        return if (o.id == "local") LOCAL_BASE else o.url
    }

    /**
     * 打开某个来源时要依次尝试的清单。对齐 origins.js 的 buildChain()：
     *   · 第一个永远是用户选中的那个
     *   · 选中「内置离线副本」就只走本地 —— 明确选了离线，就别再跳回云端
     *   · autoFallback：云端之间互相顶替（cn → rth → gh）
     *   · offlineFallback：云端全挂 → local
     */
    fun buildChain(
        originId: String = DEFAULT_ORIGIN,
        autoFallback: Boolean = true,
        offlineFallback: Boolean = true,
        startId: String? = null,
    ): List<String> {
        val first = if (startId != null && ALL.any { it.id == startId }) startId else originId
        if (first == "local") return listOf("local")

        val chain = mutableListOf(first)
        if (autoFallback) {
            for (o in ALL) {
                if (o.id == "local" || chain.contains(o.id)) continue
                chain.add(o.id)
            }
        }
        if (offlineFallback && !chain.contains("local")) chain.add("local")
        return chain
    }

    /** 当前地址属于哪个来源（给来源徽章用）；认不出就返回 null */
    fun matchOrigin(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val host = hostOf(u) ?: return null
        if (host == LOCAL_HOST || host == "127.0.0.1" || host == "localhost") return "local"
        return ALL.firstOrNull { it.host == host }?.id
    }

    /** 从 URL 里抠 host（不引 java.net.URI：老 Android 上 URI 的 host 解析有坑） */
    private fun hostOf(url: String): String? {
        val schemeEnd = url.indexOf("://")
        val rest = if (schemeEnd >= 0) url.substring(schemeEnd + 3) else return null
        val stop = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
        var host = if (stop >= 0) rest.substring(0, stop) else rest
        val at = host.indexOf('@')
        if (at >= 0) host = host.substring(at + 1)
        val colon = host.indexOf(':')
        if (colon >= 0) host = host.substring(0, colon)
        return host.ifBlank { null }
    }
}
