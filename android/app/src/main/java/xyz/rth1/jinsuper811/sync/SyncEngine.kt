package xyz.rth1.jinsuper811.sync

import xyz.rth1.jinsuper811.HwkStore
import xyz.rth1.jinsuper811.Json
import java.io.File
import java.util.Date

/**
 * SyncEngine.kt —— 把「读方向」和「写方向」串起来的那一层
 * ===========================================================
 * 和桌面版 `desktop/src/sync.js` 的分工一样：
 *
 *   读方向（pull）：Gitee 收件箱里家里推上来的 `hwk` 包 → 并进 `filesDir/hwk/`
 *   写方向（push）：本机改过的那些天 → tar.gz → `inbox/<时间戳>/hwk.tar.gz`
 *                   → 最后写 `_manifest.json`
 *
 * ★ 两条路不要混：
 *   · **读路径**（看作业、翻历史）走站点来源回落链 —— `Origins.buildChain()`
 *     的 cn → rth → gh → local，是另一套东西；
 *   · **写路径**（录了作业往上传）**只走 Gitee 收件箱**，没有第二个出口。
 *   这也是 `project.md` 里那句「家里通证明不了学校通」的由来。
 *
 * H5：**只做前台一次性重试** —— 没有 WorkManager、没有后台任务、没有通知权限。
 * 失败就写进 `SyncQueue`（`filesDir/sync/queue/` 下一天一个 json），下次用户手动点同步时重放。
 * 学校网络环境是这条队列存在的原因，但后台常驻在手机上只会被系统杀掉 + 费电。
 *
 * ★ 写注释时注意：KDoc 里不能出现「斜杠 + 星号」那两个字符 ——
 *   它会**嵌套开一层注释**，整个文件的括号就配不平了（报的是「Unclosed comment」，
 *   行号指在文件末尾，跟真正写错的位置差得远）。上面那句本来写的是
 *   `queue/` 后面跟星号通配，就是为了避开这个坑才改成「一天一个 json」。
 */
class SyncEngine(
    private val store: HwkStore,
    private val transport: Transport,
    private val queue: SyncQueue,
    private val log: (String) -> Unit = {},
) {

    data class PullResult(
        val stamps: List<String>,
        val written: Int,
        val dirty: List<String>,
        val skipped: List<String>,
    )

    data class PushResult(
        val stamp: String?,
        val count: Int,
        val bytes: Int,
        val queued: Boolean,
        val error: String,
    )

    /* ═══════════════ 读方向 ═══════════════ */

    /**
     * 把家里推上来的 `hwk` 收件箱拉下来并进本机。
     *
     * 冲突口径（**不是「谁新谁赢」，而是「本机改过的不会被覆盖」**）：
     *   · 本机没有这份 → 直接写
     *   · 本机有、且**没改过**（不在 dirty 里）→ 用云端的覆盖
     *   · 本机有、且改过（在 dirty 里）→ **跳过**，留给写方向去解决
     *     （本机那份更可能是同学刚录的，覆盖等于把作业弄丢）
     */
    fun pull(onlyStamp: String? = null): PullResult {
        val tmp = File(store.dir.parentFile, "sync/incoming")
        tmp.mkdirs()
        val found = Inbox.pullInbox(transport, tmp, onlyStamp, log = log)
        val dirty = store.dirtyIds().toSet()
        var written = 0
        val skipped = mutableListOf<String>()
        val touched = mutableListOf<String>()

        for ((stamp, files) in found) {
            for (f in files) {
                val rel = f.name
                if (!rel.startsWith("hwk/")) continue
                val base = rel.removePrefix("hwk/")
                if (!base.matches(Regex("^hwk-.+\\.json$"))) continue
                val id = base.removePrefix("hwk-").removeSuffix(".json")
                if (dirty.contains(id)) {
                    skipped.add(id)
                    log("跳过 $id：本机改过，别覆盖")
                    continue
                }
                val dst = store.recordFile(id)
                dst.parentFile?.mkdirs()
                dst.writeBytes(f.data)
                written++
                touched.add(id)
            }
            /* 拉完一份就把临时目录清掉，别在手机上堆 */
            File(tmp, stamp).deleteRecursively()
        }

        if (touched.isNotEmpty()) {
            /* 索引按目录实际内容重建（页面认 index.json 顶上一条当「今天」） */
            rebuildIndex()
        }
        return PullResult(found.map { it.first }, written, touched, skipped)
    }

    /** 按目录实际内容重建 index.json（与 gen-hwk-index.mjs 同一个口径） */
    private fun rebuildIndex() {
        val ids = store.listIds()
        val entries = ids.mapNotNull { id ->
            val r = store.read(id) ?: return@mapNotNull null
            HwkStore.IndexEntry(
                id = id,
                name = HwkStore.nameFor(id),
                date = HwkStore.normalizeDate(Json.asString(r["date"])) ?: HwkStore.dateFromId(id) ?: "",
                title = Json.asString(r["title"]) ?: "",
            )
        }.sortedWith(compareByDescending<HwkStore.IndexEntry> { it.date.ifBlank { it.id } }.thenByDescending { it.id })

        val arr = entries.map { e ->
            val m = LinkedHashMap<String, Any?>()
            m["id"] = e.id
            m["name"] = e.name
            m["date"] = e.date
            m["title"] = e.title
            m
        }
        File(store.dir, "index.json").writeText(Json.dump(arr), Charsets.UTF_8)
    }

    /* ═══════════════ 写方向 ═══════════════ */

    /**
     * 把本机改过的作业传上去。
     *
     * 失败**不抛**：写进队列，返回 `queued = true` ——
     * 同学那边看到的应该是「已保存，等有网再传」，而不是一个红叉。
     */
    fun pushDirty(from: String, stamp: String = Inbox.defaultStamp()): PushResult {
        val ids = store.dirtyIds()
        if (ids.isEmpty()) return PushResult(null, 0, 0, queued = false, error = "")
        return push(ids, from, stamp)
    }

    /** 传指定的几天（「只传今天」这个按钮用） */
    fun push(ids: List<String>, from: String, stamp: String = Inbox.defaultStamp()): PushResult {
        val entries = mutableListOf<Inbox.Entry>()
        for (id in ids) {
            val f = store.recordFile(id)
            if (!f.isFile) continue
            entries.add(Inbox.Entry("hwk/${HwkStore.nameFor(id)}", f.readBytes()))
        }
        if (entries.isEmpty()) return PushResult(null, 0, 0, queued = false, error = "")

        /* 目录也带上：家里 apply 完直接就有正确的 index.json，不用再重建 */
        val idx = File(store.dir, "index.json")
        if (idx.isFile) entries.add(Inbox.Entry("hwk/index.json", idx.readBytes()))

        return try {
            val r = Inbox.pushInbox(transport, "hwk", entries, stamp, from, log = log)
            store.markSyncedAt(ids, r.stamp)
            queue.clear(ids)
            PushResult(r.stamp, r.count, r.size, queued = false, error = "")
        } catch (e: Exception) {
            log("上传失败：${e.message} —— 已排队，下次同步重试")
            queue.enqueue(ids, stamp, e.message ?: "未知错误")
            PushResult(stamp, entries.size, 0, queued = true, error = e.message ?: "未知错误")
        }
    }

    /* ═══════════════ 队列重放 ═══════════════ */

    /**
     * 前台一次性重放：把队列里攒着的几天合起来传一次。
     * 传成功就清队列；还是失败就留着（**不无限重试** —— 每次都是用户点出来的）。
     */
    fun retryQueue(from: String): PushResult {
        val ids = queue.pendingIds()
        if (ids.isEmpty()) return PushResult(null, 0, 0, queued = false, error = "")
        log("重试队列里的 ${ids.size} 天")
        return push(ids, from)
    }

    /** 同步面板要显示的一行：队列里攒了几次、最早一次是什么时候 */
    fun queueSummary(): String = queue.summary()
}
