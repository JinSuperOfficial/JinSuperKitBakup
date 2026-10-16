package xyz.rth1.jinsuper811.sync

import xyz.rth1.jinsuper811.Json
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * GiteeTransport.kt —— Gitee OpenAPI 后端（学校 / 手机那条唯一能通的通道）
 * ===========================================================
 * 这是 `sync/lib/gitee.mjs` 的同构移植。**只用到 OpenAPI v5 的两件事**：
 *
 *   · 读：`GET  {API}/repos/{owner}/{repo}/raw/{path}?ref={branch}&access_token=…`
 *   · 写：`contents` 接口（一个文件一次请求；收件箱因此打成 tar.gz 再传）
 *        `GET    /contents/{path}?ref=…`  → 拿 sha（**先 stat 再写**）
 *        新文件  `POST /contents/{path}`  body 里没有 sha
 *        已存在  `PUT  /contents/{path}`  body 里带 sha
 *        删除    `DELETE /contents/{path}`  body 里带 sha
 *
 * 站点镜像**不走这里**（镜像体积大、变化多，家里直接用 git push 第二个 remote）；
 * 这里只管收件箱和清单。
 *
 * ★ 三条与 JS 侧必须一致的行为（错了就是「手机上传失败」这种线上事故）：
 *   1. **put 之前先 stat** —— 这不是「优化」，是协议要求（Gitee 的 contents 接口
 *      靠 sha 判并发）。JS 那边当年把 stat 挂在了那个「只是个箭头函数的 api」上
 *      （点号写法），一调就 TypeError —— 就是学校里上传挂掉的老毛病（project.md §15.2）。
 *      `FakeTransport` 的单测盯这条，`build/test-android.mjs` 也会按源码形状再查一遍。
 *   2. `Content-Type: application/json;charset=UTF-8` 只在有 body 的时候发。
 *   3. 4xx（除了 429）**不重试** —— 重试也还是同样的 4xx，只会把额度耗光。
 *
 * 网络实现只用 `HttpURLConnection`（Android 自带）：
 * 不引 OkHttp / Retrofit ——「轻量」是硬指标，而且这一层只有五六个请求形状，
 * 用第三方库换来的是几百 KB 和一条额外的升级负担。
 */
class GiteeTransport(
    private val config: SyncConfig,
    private val log: (String) -> Unit = {},
) : Transport {

    companion object {
        const val API = "https://gitee.com/api/v5"
        private const val CONNECT_TIMEOUT = 15_000
        private const val READ_TIMEOUT = 30_000
        private const val RETRIES = 3
    }

    override val kind: String get() = "gitee"
    override val inboxBranch: String get() = config.giteeInboxBranch

    private val owner get() = config.giteeOwner
    private val repo get() = config.giteeRepo
    private val token get() = config.token

    /* ═══════════════ HTTP 底座 ═══════════════ */

    private class Response(val status: Int, val body: ByteArray) {
        val text: String get() = String(body, Charsets.UTF_8)
    }

    private fun buildQuery(params: Map<String, String?>): String {
        val sb = StringBuilder()
        for ((k, v) in params) {
            if (v.isNullOrEmpty()) continue
            sb.append(if (sb.isEmpty()) '?' else '&')
            sb.append(URLEncoder.encode(k, "UTF-8")).append('=').append(URLEncoder.encode(v, "UTF-8"))
        }
        return sb.toString()
    }

    /** 发一次请求；可重试的错误按 700ms × (n+1) 退避，最多 RETRIES 次 */
    private fun request(url: String, method: String, body: ByteArray?): Response {
        var last: Exception? = null
        for (attempt in 0 until RETRIES) {
            try {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    requestMethod = method
                    connectTimeout = CONNECT_TIMEOUT
                    readTimeout = READ_TIMEOUT
                    instanceFollowRedirects = true
                    /* 只读 `raw` 时用 Bearer 更稳（有些网关不支持 URL 里的 token）；
                       contents 接口仍然按官方要求把 access_token 放 body / query。 */
                    if (token.isNotEmpty()) setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", "JinSuperSync/1.0 (Android)")
                    if (body != null) {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json;charset=UTF-8")
                    }
                }
                try {
                    if (body != null) {
                        conn.outputStream.use { it.write(body) }
                    }
                    val status = conn.responseCode
                    val stream = if (status >= 400) conn.errorStream else conn.inputStream
                    val bytes = stream?.let { readAll(it) } ?: ByteArray(0)
                    val res = Response(status, bytes)
                    if (status in 200..299) return res

                    val msg = extractMessage(res.text)
                    val err = TransportException("Gitee $status：$msg", status)
                    /* 4xx 里除了 429 都是「重试也没用」 */
                    if (status < 500 && status != 429) throw err
                    last = err
                } finally {
                    conn.disconnect()
                }
            } catch (e: TransportException) {
                if (!e.retryable) throw e
                last = e
            } catch (e: Exception) {
                last = e
            }
            if (attempt < RETRIES - 1) {
                val wait = 700L * (attempt + 1)
                log("Gitee 请求失败（${last?.message}），${wait}ms 后重试")
                try {
                    Thread.sleep(wait)
                } catch (ie: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw TransportException("请求被中断", 0)
                }
            }
        }
        throw (last as? TransportException) ?: TransportException("Gitee 请求失败：${last?.message}", 0)
    }

    private fun readAll(s: java.io.InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = s.read(buf)
            if (n <= 0) break
            out.write(buf, 0, n)
        }
        s.close()
        return out.toByteArray()
    }

    private fun extractMessage(text: String): String {
        return try {
            val m = Json.asMap(Json.parse(text))
            Json.asString(m?.get("message")) ?: text.take(300)
        } catch (e: Exception) {
            text.take(300)
        }
    }

    /** API 请求（自动带 access_token） */
    private fun api(path: String, params: Map<String, String?> = emptyMap(), method: String = "GET", body: ByteArray? = null): Response =
        request("$API/repos/$owner/$repo$path" + buildQuery(params + ("access_token" to token)), method, body)

    /** 公开仓库的免令牌 raw 地址 */
    private fun publicRaw(key: String, branch: String): String {
        val encoded = key.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        val b = URLEncoder.encode(branch, "UTF-8")
        return "https://gitee.com/$owner/$repo/raw/$b/$encoded"
    }

    private fun jsonBody(fields: Map<String, Any?>): ByteArray = Json.stringify(fields).toByteArray(Charsets.UTF_8)

    /* ═══════════════ Transport ═══════════════ */

    override fun stat(key: String, branch: String): Transport.Stat? {
        return try {
            val res = api("/contents/$key", mapOf("ref" to branch))
            val v = Json.parse(res.text)
            val arr = Json.asList(v)
            if (arr != null) {
                Transport.Stat("dir", "", 0)
            } else {
                val m = Json.asMap(v)
                Transport.Stat("file", Json.asString(m?.get("sha")) ?: "", Json.asInt(m?.get("size")).toLong())
            }
        } catch (e: TransportException) {
            if (e.status == 404) null else throw e
        }
    }

    override fun get(key: String, branch: String): ByteArray {
        if (config.giteeVisibility == "public" && token.isEmpty()) {
            return request(publicRaw(key, branch), "GET", null).body
        }
        return api("/raw/$key", mapOf("ref" to branch)).body
    }

    /**
     * ★ 先 stat 再写。
     * 新文件 POST（body 不带 sha）；已存在的 PUT（body 带 sha）——
     * 顺序写反、或者把 stat 挂到那个「只是个箭头函数的 api」上，都会在真机上直接失败。
     */
    override fun put(key: String, data: ByteArray, branch: String, message: String): Transport.Stat {
        val existing = stat(key, branch)
        val body = LinkedHashMap<String, Any?>()
        body["access_token"] = token
        /* base64 用自己写的（Base64Codec）：android.util.Base64 在 JVM 单测里是 stub，
           碰它就等于这条写路径永远测不了；而且它是 android.* 依赖，
           会让这一层没法「纯逻辑」地被覆盖。 */
        body["content"] = xyz.rth1.jinsuper811.Base64Codec.encode(data)
        body["message"] = message.take(200).ifBlank { "sync" }
        body["branch"] = branch
        if (existing != null && existing.isFile) {
            body["sha"] = existing.sha
            api("/contents/$key", emptyMap(), "PUT", jsonBody(body))
        } else {
            api("/contents/$key", emptyMap(), "POST", jsonBody(body))
        }
        return Transport.Stat("file", "", data.size.toLong())
    }

    override fun del(key: String, branch: String, message: String): Boolean {
        val at = stat(key, branch)
        if (at == null || !at.isFile) return false
        val body = LinkedHashMap<String, Any?>()
        body["access_token"] = token
        body["sha"] = at.sha
        body["message"] = message
        body["branch"] = branch
        api("/contents/$key", emptyMap(), "DELETE", jsonBody(body))
        return true
    }

    override fun list(prefix: String, branch: String): List<Transport.Item> {
        return try {
            val res = api("/contents/$prefix", mapOf("ref" to branch))
            val v = Json.parse(res.text)
            val raw = Json.asList(v) ?: listOf(v)
            raw.mapNotNull { e ->
                val m = Json.asMap(e) ?: return@mapNotNull null
                val p = Json.asString(m["path"]) ?: return@mapNotNull null
                Transport.Item(
                    name = Json.asString(m["name"]) ?: p.substringAfterLast('/'),
                    path = p,
                    type = if (Json.asString(m["type"]) == "dir") "dir" else "file",
                    size = Json.asInt(m["size"]).toLong(),
                    sha = Json.asString(m["sha"]) ?: "",
                )
            }
        } catch (e: TransportException) {
            if (e.status == 404) emptyList() else throw e
        }
    }
}
