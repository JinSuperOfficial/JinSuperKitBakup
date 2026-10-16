package xyz.rth1.jinsuper811

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

/**
 * LocalContentHandler.kt —— 离线副本 / 本地内容的伺服
 * ===========================================================
 * 这是整个安卓侧**最要紧的一段代码**。三条命门全在这儿：
 *
 * ① **不走 `file://`，也不用随机端口的本地 HTTP 服务**
 *    页面清单是 `fetch` 出来的，`file://` 会被 CORS 拦；
 *    而随机端口会毁掉 localStorage（见下面 ②）。
 *    做法：页面全部走固定虚拟域 `https://appassets.androidplatform.net/`，
 *    所有子资源在 `shouldInterceptRequest` 里接管。
 *    这个域名是**虚拟 host** —— 外部浏览器访问它会走真实 DNS、找不到，
 *    天然隔离、没有端口暴露风险。
 *
 * ② **origin 必须固定**（Origins.LOCAL_HOST 那条注释也写了）
 *    作业页的勾选状态存在 `localStorage`，键是 `hw:<id>:<条目哈希>`；
 *    `localStorage` 按 origin（scheme://host:port）隔离 —— 端口一随机，
 *    origin 每次冷启动都变，**同学之前勾过的作业全部消失**。
 *    排障表里那句「勾选状态每次都清空 → 检查是否误用了随机端口」说的就是这个。
 *
 * ③ **Range 必须支持**（206 + Content-Range + Accept-Ranges）
 *    英语听力页 `/class/english.html` 的 `<audio>` 靠它拖进度。
 *    `WebViewAssetLoader` **不支持 Range**，所以这里没用它 —— 自己写。
 *    验收方式写死：**断网下拖动进度条，抓包必须看到 206**。
 *
 * 另加一条原样复刻的既有事实：**`.php` 一律回 404**。
 * 阅读器取原文的第一选择是 `p/raw.php`，404 之后它才会按设计回落去直接取 `.md`；
 * 真把 PHP 源码发回去，页面会把源码当正文显示（`SiteAssets.resolve` 负责这条）。
 *
 * 线程：`shouldInterceptRequest` 在**非 UI 线程**被调用，所以这里的 IO 可以直接做。
 */
class LocalContentHandler(private val context: Context) {

    companion object {
        /** 作业编辑器界面的路径前缀（映射到 `assets/hwk-ui/`，不是站点那一套） */
        const val HWK_UI_PREFIX = "hwk-ui"
    }

    private val filesSiteDir = JinSuperApp.siteDir(context)

    /** 外部来源（cn / rth / gh）一律放行给 WebView 自己去联网 */
    private fun isLocalRequest(url: String): Boolean {
        val host = Uri.parse(url).host ?: return false
        return host == Origins.LOCAL_HOST
    }

    /**
     * 接管一次请求。
     * @return null = 不接管（交给 WebView 去联网）
     */
    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url?.toString() ?: return null
        if (!isLocalRequest(url)) return null
        return serve(request.url, request.requestHeaders)
    }

    /** 直接按 URL 伺服（不经过 WebResourceRequest，方便单测与复用） */
    fun serve(uri: Uri, headers: Map<String, String>?): WebResourceResponse {
        val resolved = SiteAssets.resolve(uri.path)

        if (resolved.notFound) {
            return notFound(resolved.reason.ifBlank { "按设计 404" })
        }

        val source = open(resolved.rel)
            ?: return notFound("离线副本里没有 ${resolved.rel}")

        val size = source.size
        val range = parseRange(headers?.get("Range"), size)

        return try {
            if (range == null) {
                val body = readAll(source.open(0), size)
                response(200, "OK", resolved.mime, size, null, body)
            } else {
                if (range.first >= size) {
                    source.close()
                    rangeNotSatisfiable(size)
                } else {
                    val length = (range.second - range.first + 1)
                    val body = readAll(source.open(range.first), length)
                    source.close()
                    response(206, "Partial Content", resolved.mime, body.size.toLong(), range to size, body)
                }
            }
        } catch (e: IOException) {
            runCatching { source.close() }
            notFound("读不出 ${resolved.rel}：${e.message}")
        }
    }

    /* ═══════════════ 资源定位 ═══════════════ */

    /** 一个可读的本地资源（来自 filesDir 或 assets） */
    private interface Source {
        val size: Long

        /** 从 offset 开始读的流 */
        fun open(offset: Long): InputStream

        fun close()
    }

    /**
     * 先查 `filesDir/site/`（云端同步下来的更新），再查 `assets/site/`（随包副本）。
     * 顺序不能反 —— 反了的话内容更新会被随包那份盖回去。
     *
     * 另有一条**并列**的路：`/hwk-ui/…` 直接映射到 `assets/hwk-ui/`（作业编辑器界面）。
     * 它不走 site 那套（编辑器不是站点页面，也不参与云端更新），
     * 内容由 `android/tools/sync-site-assets.mjs` 从 `desktop/src/ui/hwk/` 拷过来。
     */
    private fun open(rel: String): Source? {
        if (rel == HWK_UI_PREFIX || rel.startsWith("$HWK_UI_PREFIX/")) {
            return AssetSource(context.assets, "${JinSuperApp.ASSETS_HWK_UI}/" + rel.removePrefix("$HWK_UI_PREFIX/"))
        }
        val f = File(filesSiteDir, rel)
        if (f.isFile) return FileSource(f)
        return AssetSource(context.assets, "${JinSuperApp.ASSETS_SITE}/$rel")
    }

    private class FileSource(private val file: File) : Source {
        override val size: Long get() = file.length()

        override fun open(offset: Long): InputStream {
            val ins = file.inputStream()
            /* Range 请求要跳到中间：assets 没法 seek，文件可以 */
            var skipped = 0L
            while (skipped < offset) {
                val n = ins.skip(offset - skipped)
                if (n <= 0) break
                skipped += n
            }
            return ins
        }

        override fun close() {}
    }

    private class AssetSource(private val assets: android.content.res.AssetManager, private val path: String) : Source {
        override val size: Long by lazy {
            try {
                assets.open(path, android.content.res.AssetManager.ACCESS_STREAMING).use { it.available().toLong() }
            } catch (e: IOException) {
                -1L
            }
        }

        override fun open(offset: Long): InputStream {
            val ins = assets.open(path, android.content.res.AssetManager.ACCESS_STREAMING)
            /* assets 不支持 seek —— 顺序跳过。离线副本里没有音视频，
               所以这条路上真正的 Range 请求只可能是图片，代价可以接受。
               （万一以后把音频打进包，这里应该换成先把文件解到 filesDir 再伺服。） */
            var skipped = 0L
            while (skipped < offset) {
                val n = ins.skip(offset - skipped)
                if (n <= 0) break
                skipped += n
            }
            return ins
        }

        override fun close() {}
    }

    /* ═══════════════ Range / 响应 ═══════════════ */

    /**
     * 解析 `Range: bytes=start-end`。
     * 具体规则在 `RangeHeader`（纯逻辑，有单测）—— 这里只负责按文件大小夹好。
     */
    private fun parseRange(header: String?, size: Long): Pair<Long, Long>? {
        val span = RangeHeader.parse(header, size) ?: return null
        return span.start to span.end
    }

    private fun response(
        status: Int,
        reason: String,
        mime: String,
        declaredLength: Long,
        range: Pair<Pair<Long, Long>, Long>?,
        body: ByteArray,
    ): WebResourceResponse {
        val headers = LinkedHashMap<String, String>()
        headers["Content-Type"] = mime
        headers["Content-Length"] = body.size.toString()
        /* ★ 一定要广告 Accept-Ranges：不广告的话 WebView 不会发 Range 请求，
           听力页就拖不动进度条（或者干脆不播）。 */
        headers["Accept-Ranges"] = "bytes"
        headers["Cache-Control"] = "no-cache"
        if (range != null) {
            val (r, total) = range
            headers["Content-Range"] = "bytes ${r.first}-${r.second}/$total"
        }
        val stream = ByteArrayInputStream(body)
        return WebResourceResponse(mime, "utf-8", status, reason, headers, stream)
    }

    private fun notFound(reason: String): WebResourceResponse {
        /* 这里**不能**返回 null：null = 交给 WebView 去联网，
           而虚拟 host 在真实 DNS 上不存在，结果是一个难懂的网络错误页。
           回一个说人话的 404 更利于排障（也方便抓包看到状态码）。 */
        val body = ("<!DOCTYPE html><meta charset=\"utf-8\">" +
            "<title>404</title>" +
            "<div style=\"font:16px/1.7 system-ui;color:#8D6959;padding:24px\">" +
            "<h1 style=\"font-size:20px;margin:0 0 8px\">离线副本里没有这个文件</h1>" +
            "<p style=\"margin:0;color:#6B635A\">$reason</p>" +
            "</div>").toByteArray(Charsets.UTF_8)
        val headers = LinkedHashMap<String, String>()
        headers["Content-Type"] = "text/html; charset=utf-8"
        headers["Content-Length"] = body.size.toString()
        headers["Accept-Ranges"] = "bytes"
        /* ★ `.php` 那条路走到这里 —— 回 404 正是阅读器回落逻辑需要的 */
        return WebResourceResponse("text/html", "utf-8", 404, "Not Found", headers, ByteArrayInputStream(body))
    }

    private fun rangeNotSatisfiable(total: Long): WebResourceResponse {
        val headers = LinkedHashMap<String, String>()
        headers["Content-Range"] = "bytes */$total"
        headers["Accept-Ranges"] = "bytes"
        return WebResourceResponse("text/plain", "utf-8", 416, "Range Not Satisfiable", headers, ByteArrayInputStream(ByteArray(0)))
    }

    /** 按长度读满（单次 read 可能读不满，必须循环） */
    private fun readAll(input: InputStream, length: Long): ByteArray {
        input.use { ins ->
            val want = length.coerceAtLeast(0).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
            val out = java.io.ByteArrayOutputStream(want)
            val buf = ByteArray(32 * 1024)
            var left = want
            while (left > 0) {
                val n = ins.read(buf, 0, minOf(buf.size, left))
                if (n <= 0) break
                out.write(buf, 0, n)
                left -= n
            }
            return out.toByteArray()
        }
    }
}
