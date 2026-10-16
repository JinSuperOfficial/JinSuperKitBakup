package xyz.rth1.jinsuper811.sync

import xyz.rth1.jinsuper811.InboxTarGz
import xyz.rth1.jinsuper811.Json
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Inbox.kt —— 收件箱（手机 → 家）
 * ===========================================================
 * 这是 `sync/lib/inbox.mjs` 的同构移植。手机这边把选中的作业打成 **一个 tar.gz**
 * 写到 Gitee 的收件箱分支：
 *
 *   inbox/<时间戳>/<root>.tar.gz      root ∈ hwk | site | misc
 *   inbox/<时间戳>/_manifest.json     谁传的、什么时候、里面有哪些文件、sha256
 *
 * ★ **描述文件最后写** —— 家里只认有 `_manifest.json` 的时间戳，
 *   所以传到一半断线不会产生「半个收件箱」。这条有单测盯着
 *   （`InboxTest.pushInbox_writes_tar_gz_before_manifest`）。
 *
 * 家里 `部署.cmd sync pull` 把它下到 `sync/inbox/<时间戳>/`（不直接动仓库），
 * `sync apply` 再按 roots 映射落进仓库，默认先 dry-run 打一份 diff。
 * 手机这里只负责「放上去」，不管家里怎么落。
 */
object Inbox {

    const val INBOX_DIR = "inbox"
    const val INBOX_MANIFEST = "_manifest.json"
    val INBOX_ROOTS = listOf("hwk", "site", "misc")

    /** 时间戳目录名：20261015-2218（本地时间，人看得懂）—— 与 inbox.mjs 同形 */
    fun defaultStamp(d: Date = Date()): String =
        SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(d)

    data class Entry(val name: String, val data: ByteArray) {
        // ByteArray 在 data class 里得自己写 equals/hashCode，否则比较的是引用
        override fun equals(other: Any?): Boolean =
            other is Entry && other.name == name && other.data.contentEquals(data)

        override fun hashCode(): Int = 31 * name.hashCode() + data.contentHashCode()
    }

    data class PushResult(
        val stamp: String,
        val root: String,
        val key: String,
        val dir: String,
        val count: Int,
        val size: Int,
    )

    /** 上传一批文件到收件箱 */
    fun pushInbox(
        t: Transport,
        root: String,
        entries: List<Entry>,
        stamp: String = defaultStamp(),
        from: String = "未知设备",
        branch: String = t.inboxBranch,
        log: (String) -> Unit = {},
    ): PushResult {
        val realRoot = if (INBOX_ROOTS.contains(root)) root else "misc"
        val list = entries.filter { it.name.isNotBlank() && it.data.isNotEmpty() }
        require(list.isNotEmpty()) { "没有要上传的文件" }

        val dir = "$INBOX_DIR/$stamp"
        val tarEntries = list.map { InboxTarGz.Entry(InboxTarGz.safeRel(it.name), it.data) }
        val tarball = InboxTarGz.packTarGz(tarEntries)
        val key = "$dir/$realRoot.tar.gz"

        /* ① 先传包 */
        log("上传 $key（${tarball.size} 字节，${list.size} 个文件）")
        t.put(key, tarball, branch, "inbox($realRoot) $stamp：${list.size} 个文件")

        /* ② 再写清单 —— 顺序不许换 */
        val files = list.map { e ->
            val m = LinkedHashMap<String, Any?>()
            m["path"] = InboxTarGz.safeRel(e.name)
            m["size"] = e.data.size
            m["sha256"] = InboxTarGz.sha256(e.data)
            m
        }.sortedBy { it["path"] as String }

        val manifest = LinkedHashMap<String, Any?>()
        manifest["v"] = 1
        manifest["stamp"] = stamp
        manifest["root"] = realRoot
        manifest["from"] = from.ifBlank { "未知设备" }
        manifest["createdAt"] = isoNow()
        manifest["files"] = files
        val pack = LinkedHashMap<String, Any?>()
        pack["key"] = key
        pack["size"] = tarball.size
        pack["sha256"] = InboxTarGz.sha256(tarball)
        pack["parts"] = 1
        manifest["pack"] = pack

        log("最后写清单 $dir/$INBOX_MANIFEST")
        t.put("$dir/$INBOX_MANIFEST", Json.dump(manifest).toByteArray(Charsets.UTF_8), branch, "inbox($realRoot) $stamp：清单")

        return PushResult(stamp, realRoot, key, dir, list.size, tarball.size)
    }

    data class InboxItem(
        val stamp: String,
        val dir: String,
        val complete: Boolean,
        val root: String,
        val from: String,
        val createdAt: String,
        val fileCount: Int,
        val packSha256: String,
        val reason: String = "",
    )

    /** 列出收件箱里**完整**的几份（按时间戳倒序） */
    fun listInbox(t: Transport, branch: String = t.inboxBranch): List<InboxItem> {
        val dirs = t.list(INBOX_DIR, branch).filter { it.type == "dir" }
        val out = mutableListOf<InboxItem>()
        for (d in dirs.sortedByDescending { it.name }) {
            val manifest = try {
                Json.asMap(Json.parse(t.get("${d.path}/$INBOX_MANIFEST", branch).toString(Charsets.UTF_8)))
            } catch (e: Exception) {
                null
            }
            if (manifest == null) {
                out.add(InboxItem(d.name, d.path, false, "", "", "", 0, "", "还没有 $INBOX_MANIFEST（在传或传挂了）"))
                continue
            }
            val pack = Json.asMap(manifest["pack"])
            out.add(InboxItem(
                stamp = Json.asString(manifest["stamp"]) ?: d.name,
                dir = d.path,
                complete = true,
                root = Json.asString(manifest["root"]) ?: "misc",
                from = Json.asString(manifest["from"]) ?: "",
                createdAt = Json.asString(manifest["createdAt"]) ?: "",
                fileCount = Json.asList(manifest["files"])?.size ?: 0,
                packSha256 = Json.asString(pack?.get("sha256")) ?: "",
            ))
        }
        return out
    }

    /**
     * 把收件箱里的一份**拉下来并解开**到本地目录。
     *
     * 手机这边用在「同步（读方向）」：拉到家推上来的 `hwk` 包，
     * 解开后逐份并进 `filesDir/hwk/`。
     */
    fun pullInbox(
        t: Transport,
        into: File,
        stamp: String? = null,
        branch: String = t.inboxBranch,
        log: (String) -> Unit = {},
    ): List<Pair<String, List<InboxTarGz.Entry>>> {
        val list = listInbox(t, branch)
        val want = if (stamp.isNullOrBlank()) list else list.filter { it.stamp == stamp }
        val done = mutableListOf<Pair<String, List<InboxTarGz.Entry>>>()
        for (item in want) {
            if (!item.complete) {
                log("跳过 ${item.stamp}：${item.reason}")
                continue
            }
            val key = "${item.dir}/${item.root}.tar.gz"
            val buf = t.get(key, branch)
            if (item.packSha256.isNotBlank() && InboxTarGz.sha256(buf) != item.packSha256) {
                throw TransportException("${item.stamp} 的包校验不过（下载可能断了）：$key")
            }
            val files = InboxTarGz.unpackTarGz(buf)
            val dir = File(into, item.stamp)
            dir.mkdirs()
            for (f in files) {
                /* ★ 落盘路径就用**包里的名字**（`hwk/hwk-<id>.json` 这样，已经带根了），
                   别再拼一次 item.root —— 拼两次会变成 `hwk/hwk/hwk-…`，
                   而且家里 `sync apply` 是按包的形状找的（它期望 `<stamp>/<root>/…`）。
                   只有包里那份**没带根**时才补上（旧包 / 手工造的场景）。 */
                val name = InboxTarGz.safeRel(f.name)
                val safeName = if (name == item.root || name.startsWith("${item.root}/")) {
                    name
                } else {
                    InboxTarGz.safeRel("${item.root}/$name")
                }
                val abs = File(dir, safeName)
                /* 解包越界再兜一道（safeRel 已经拦了 `..`，这里是第二道闸） */
                if (!abs.canonicalPath.startsWith(dir.canonicalPath + File.separator)) {
                    throw TransportException("解包越界：$safeName")
                }
                abs.parentFile?.mkdirs()
                abs.writeBytes(f.data)
            }
            done.add(item.stamp to files)
            log("拉下 ${item.stamp}：${files.size} 个文件")
        }
        return done
    }

    private fun isoNow(): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        f.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return f.format(Date())
    }
}
