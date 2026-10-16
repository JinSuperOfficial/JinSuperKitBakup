package xyz.rth1.jinsuper811.sync

/**
 * FakeTransport.kt —— 假的传输层（**学校那条写路径唯一覆盖得到的地方**）
 * ===========================================================
 * 为什么必须有它：`project.md` §15.2 的第一条教训 ——
 *
 *   > 写路径必须用假 HTTP client 测请求形状（等价 build/test-sync.mjs 的假 fetch 用例）
 *   > —— 本地目录通道覆盖不到「请求长什么样」。
 *
 * 家里那条 `sync push` 走 git，手机这条走 Gitee OpenAPI，两条路不是同一份代码；
 * 「家里通」证明不了「手机通」。所以这里把每一次调用都记下来，让单测去断言
 * **形状**：put 之前有没有先 stat、新文件是 POST 还是 PUT、PUT 带没带 sha、
 * 收件箱是不是先传 tar.gz 再写 `_manifest.json`。
 *
 * 它不是 mock 框架：就是一个手写的、把请求记在 list 里的内存实现。
 * 没有反射、没有字节码生成 —— 老内核上也跑得动（虽然它只在单测里跑）。
 */
class FakeTransport(
    private val branch: String = "main",
    override val inboxBranch: String = "inbox",
) : Transport {

    /** 内存里的「仓库」：key → 字节 */
    val files = LinkedHashMap<String, ByteArray>()

    /** 每一次调用的流水（顺序有意义 —— 收件箱那两条就靠它判断先后） */
    val calls = mutableListOf<String>()

    /** 每一次写请求的形状 */
    val puts = mutableListOf<Transport.PutRequest>()

    /** 下一次请求要抛什么错（用来测重试 / 排队那条路） */
    var failNext: TransportException? = null

    /** 让 stat 返回「这个 key 已存在」 */
    fun seed(key: String, data: ByteArray) {
        files[key] = data
    }

    /**
     * 下一次请求要抛的错 —— ★ **在记账之后抛**。
     *
     * 顺序很重要：如果在记账之前抛，`put` 内部那次 `stat` 就把这一次的失败
     * 「吃掉」了，`put` 自己再 stat 一次就成功了 —— 于是「失败进队列」这条路径
     * 永远测不到（测试会以一个看起来很莫名其妙的断言失败收场）。
     * 记账在前，流水里就能看到「失败的这一次确实发生过」。
     */
    private fun maybeFail() {
        val f = failNext
        if (f != null) {
            failNext = null
            throw f
        }
    }

    override val kind: String get() = "fake"

    override fun stat(key: String, branch: String): Transport.Stat? {
        calls.add("stat:$key@$branch")
        maybeFail()
        val d = files[key] ?: return null
        /* sha 用内容的 sha256 冒充 —— 形状对就够了，Gitee 那边也是内容哈希 */
        return Transport.Stat("file", xyz.rth1.jinsuper811.InboxTarGz.sha256(d).take(40), d.size.toLong())
    }

    override fun get(key: String, branch: String): ByteArray {
        calls.add("get:$key@$branch")
        maybeFail()
        return files[key] ?: throw TransportException("404 Not Found: $key", 404)
    }

    override fun put(key: String, data: ByteArray, branch: String, message: String): Transport.Stat {
        /* ★ 顺序要照着**真实实现的可观测顺序**记：
           `GiteeTransport.put` 是「先发 stat 请求拿 sha，再发 contents 请求写」，
           所以流水里 stat 在 put 前面。这里先调 stat（它会自己记一条），
           再记 put —— 反过来的话「put 之前先 stat」这条断言就永远是假的，
           而真实设备上它明明是对的。 */
        val at = stat(key, branch)
        calls.add("put:$key@$branch")
        maybeFail()
        val method = if (at != null && at.isFile) "PUT" else "POST"
        puts.add(
            Transport.PutRequest(
                key = key,
                bytes = data.size,
                branch = branch,
                message = message,
                method = method,
                sha = if (method == "PUT") at!!.sha else null,
                base64 = true,
            ),
        )
        files[key] = data
        return Transport.Stat("file", xyz.rth1.jinsuper811.InboxTarGz.sha256(data).take(40), data.size.toLong())
    }

    override fun del(key: String, branch: String, message: String): Boolean {
        calls.add("del:$key@$branch")
        maybeFail()
        val at = stat(key, branch) ?: return false
        files.remove(key)
        return at.isFile
    }

    override fun list(prefix: String, branch: String): List<Transport.Item> {
        calls.add("list:$prefix@$branch")
        maybeFail()
        val p = prefix.trimEnd('/')
        val out = LinkedHashMap<String, Transport.Item>()
        for ((k, v) in files) {
            if (!k.startsWith("$p/")) continue
            val rest = k.removePrefix("$p/")
            val head = rest.substringBefore('/')
            val isDir = rest.contains('/')
            out[head] = Transport.Item(
                name = head,
                path = "$p/$head",
                type = if (isDir) "dir" else "file",
                size = if (isDir) 0 else v.size.toLong(),
                sha = if (isDir) "" else xyz.rth1.jinsuper811.InboxTarGz.sha256(v).take(40),
            )
        }
        return out.values.toList()
    }

    /** 某个 key 的正文（测试里解 base64 / 解 tar 用） */
    fun body(key: String): ByteArray = files[key] ?: throw AssertionError("没有这个 key：$key")

    /** 某次写请求的形状 */
    fun putOf(key: String): Transport.PutRequest = puts.last { it.key == key }

    /** 调用流水里某个条目的下标（判断先后顺序用） */
    fun indexOfCall(prefix: String): Int = calls.indexOfFirst { it.startsWith(prefix) }
}
