package xyz.rth1.jinsuper811.sync

/**
 * Transport.kt —— 传输层的接口（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 这是 `sync/lib/gitee.mjs` + `sync/lib/transport.mjs` 在安卓侧的那层抽象。
 * 分成接口 + 实现，原因是：**学校那条写路径只有假 client 覆盖得到**
 * （`project.md` §15.2 的第一条教训）—— 本地目录通道覆盖不到「请求长什么样」，
 * 而「请求长什么样」正是当年 `学校上传失败` 的根因。
 *
 * 所以：
 *   · `GiteeTransport`  —— 真的发 HTTP（HttpURLConnection，不引第三方库）
 *   · `FakeTransport`   —— 在 JVM 单测里记录每一次调用（见 src/test 下的用例）
 *   两者实现同一个接口，写路径的**形状**因此可以在没有网络、没有真机的情况下断言。
 *
 * 「形状」指这些（都必须有单测盯住）：
 *   · put 之前**先 stat**（新文件 POST / 已存在 PUT 带 sha）——
 *     把 stat 挂到那个「只是个箭头函数的 api」上会立刻 TypeError，这就是学校那边上传挂掉的老毛病；
 *   · del 带 sha；
 *   · 收件箱 pushInbox **先传 tar.gz、最后写 _manifest.json**。
 */
interface Transport {

    /** 文件元信息；不存在返回 null */
    data class Stat(val type: String, val sha: String, val size: Long) {
        val isFile: Boolean get() = type == "file"
        val isDir: Boolean get() = type == "dir"
    }

    /** 目录 / 文件的一条列表项 */
    data class Item(val name: String, val path: String, val type: String, val size: Long, val sha: String)

    /** 一次写请求（给假实现记账用，也让日志能说清「发了什么」） */
    data class PutRequest(
        val key: String,
        val bytes: Int,
        val branch: String,
        val message: String,
        /** 新文件 = POST；已存在 = PUT（且 body 里带 sha） */
        val method: String,
        val sha: String?,
        val base64: Boolean,
    )

    val kind: String
    val inboxBranch: String

    /** 文件元信息（不存在返回 null）。404 不算错误。 */
    fun stat(key: String, branch: String): Stat?

    /** 读一个文件 */
    fun get(key: String, branch: String): ByteArray

    /**
     * 写一个文件。
     * 实现**必须**先 stat 再决定 POST / PUT —— 见接口头部的说明。
     */
    fun put(key: String, data: ByteArray, branch: String, message: String): Stat

    /** 删一个文件；本来就不在返回 false */
    fun del(key: String, branch: String, message: String): Boolean

    /** 列一个目录（**只能列目录**，静态托管列不了 —— 所以收件箱必须有清单文件） */
    fun list(prefix: String, branch: String): List<Item>

    /** 这个 key 存不存在 */
    fun exists(key: String, branch: String): Boolean = stat(key, branch)?.isFile == true
}

/** 传输层的错误（带状态码：4xx 除了 429 都别重试 —— 与 gitee.mjs 的判定一致） */
class TransportException(message: String, val status: Int = 0) : RuntimeException(message) {
    /** 这个错误值不值得重试（网络抖动 / 5xx / 限流值得，其它不值得） */
    val retryable: Boolean get() = status == 0 || status >= 500 || status == 429
}
