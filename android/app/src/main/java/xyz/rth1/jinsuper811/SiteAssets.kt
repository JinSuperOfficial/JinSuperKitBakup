package xyz.rth1.jinsuper811

/**
 * SiteAssets.kt —— 「离线副本 / 本地内容」的路径解析（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 页面在 WebView 里用的地址长这样（固定虚拟域，见 Origins.LOCAL_HOST）：
 *
 *   https://appassets.androidplatform.net/class/homework.html
 *   https://appassets.androidplatform.net/class/data/hwk/index.json
 *   https://appassets.androidplatform.net/asset/homework/bg_grid.jpg
 *
 * 这个对象的职责只有一件：**把 URL 路径翻译成「先查哪儿、查什么」**，
 * 具体读写由 `LocalContentHandler` 做（它拿 Android 的 AssetManager / File）。
 *
 * 目录优先级（对齐桌面版 `desktop/src/local-server.js` 的语义）：
 *   1. `filesDir/site/`      —— 云端同步下来的更新（不必重打 APK 就能换内容）
 *   2. `assets/site/`        —— 随包离线副本（兜底，永远在）
 *
 * 另有两条**不可省的既有事实**（原样复刻桌面版的坑）：
 *   · `.php` 一律回 404 —— 阅读器取原文的第一选择是 `p/raw.php`，404 之后它
 *     才会按设计回落去直接取 `.md`；真把 PHP 源码发回去，页面会把源码当正文显示。
 *   · 目录请求（以 `/` 结尾）补 `index.html`，和静态托管的行为一致。
 */

object SiteAssets {

    /** 站点根在 assets / filesDir 下的目录名 */
    const val SITE_DIR = "site"

    /** 本地站点内容的根前缀（`file:///android_asset/site/`） */
    const val ASSET_ROOT = "site"

    /** 目录请求补的默认文件名 */
    const val INDEX_FILE = "index.html"

    /**
     * 一条请求解析出来的结果。
     *
     * @param rel       相对站点根的路径（**没有** 前导斜杠），例如 `class/homework.html`
     * @param mime      Content-Type
     * @param notFound  true = 这个路径按设计就该 404（`.php` / 归一后为空 / 想越狱）
     * @param reason    给日志和排障用的一句话
     */
    data class Resolved(
        val rel: String,
        val mime: String,
        val notFound: Boolean = false,
        val reason: String = "",
    )

    /** 把 URL 的 path 部分归一成相对站点根的路径 */
    fun toRelPath(urlPath: String?): String {
        var p = urlPath?.trim().orEmpty()
        if (p.isEmpty()) return ""
        // 去掉 query / fragment（shouldInterceptRequest 给的是 path，但兜一手）
        val cut = p.indexOfFirst { it == '?' || it == '#' }
        if (cut >= 0) p = p.substring(0, cut)
        p = p.replace('\\', '/')
        // ★ 是不是「目录请求」要在归一**之前**判：归一会把结尾那个 `/` 去掉，
        //   之后就分不出 `/class` 和 `/class/` 了（前者是文件、后者要补 index.html）。
        val isDir = p.endsWith("/")
        // 去掉前导斜杠
        p = p.trimStart('/')
        // 逐段归一：丢掉空段和 `.`，`..` 一律拒掉（越界）
        val out = mutableListOf<String>()
        for (seg in p.split('/')) {
            when (seg) {
                "", "." -> continue
                ".." -> return ""
                else -> out.add(seg)
            }
        }
        if (out.isEmpty()) return ""
        var rel = out.joinToString("/")
        if (isDir) rel += "/$INDEX_FILE"
        return rel
    }

    /**
     * 解析一条请求。
     *
     * ★ `.php` 这条**必须**留在这里，而且**必须**是 404 ——
     *   它不是「没实现」的占位，是阅读器回落逻辑依赖的行为。
     */
    fun resolve(urlPath: String?): Resolved {
        val raw = urlPath?.trim().orEmpty()

        // ① 根路径 → 首页
        val rel = toRelPath(raw).ifEmpty {
            /* `toRelPath` 返回空有两种情况，要分开：
                 · 真·根路径（空串 / `/`）→ 给首页
                 · 想越狱（含 `..`）      → 404
               判据用「有没有 `..`」，不要用「是不是以 `/` 开头」——
               空串不以 `/` 开头，那样写会把根路径也当成越狱（这里栽过一次）。 */
            if (raw.contains("..")) {
                return Resolved("", MIME_OCTET, notFound = true, reason = "路径不合法")
            }
            INDEX_FILE
        }

        // ② `.php` 一律 404（不跑 PHP）—— 见文件头的说明
        if (rel.lowercase().endsWith(".php")) {
            return Resolved(rel, MIME_OCTET, notFound = true, reason = "`.php` 不执行，按设计回 404")
        }

        return Resolved(rel, mimeOf(rel))
    }

    /** 扩展名 → MIME。**只认站点里真实出现过的类型**，其余一律 octet-stream。 */
    fun mimeOf(rel: String): String {
        val name = rel.substringAfterLast('/').lowercase()
        val ext = if (name.contains('.')) name.substringAfterLast('.') else ""
        return when (ext) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "otf" -> "font/otf"
            "txt" -> "text/plain"
            "xml" -> "application/xml"
            "webmanifest" -> "application/manifest+json"
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "wav" -> "audio/wav"
            "ogg", "oga" -> "audio/ogg"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "pdf" -> "application/pdf"
            else -> MIME_OCTET
        }
    }

    /** 这个类型要不要按「字节可断」处理（音频 / 视频才需要 Range） */
    fun isMedia(mime: String): Boolean = mime.startsWith("audio/") || mime.startsWith("video/")

    /** 外部资源一律不带 Range（它们由 WebView 直接走网络） */
    const val MIME_OCTET = "application/octet-stream"
}
