package xyz.rth1.jinsuper811.sync

import xyz.rth1.jinsuper811.Json
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * SyncQueue.kt —— 断网时的上传队列（**只做前台一次性重试**）
 * ===========================================================
 * 学校 / 地铁上的网络是这条队列存在的原因：同学点了「同步」但没网，
 * 不该看到一个红叉，而该看到「已保存，等有网再传」。
 *
 * 落盘：`<filesDir>/sync/queue/<时间戳>-<n>.json`，一次失败一个文件 ——
 * 与桌面版 `%APPDATA%\JinSuper\sync\queue\` 是同一个思路，
 * 但**队列项用 JSON 而不是目录**（手机上少建一层目录、也别塞 tar.gz）。
 *
 * 与桌面版的差别（有意为之，记在这里免得以后有人以为漏了）：
 *   · 桌面版队列项里放的是「已打好的包」；这里只记 **id 列表**，
 *     真正打包留到重试那一刻 —— 这样重试时带上的是**最新版本**的作业，
 *     而不是当年失败时那份旧的。
 *   · 没有 WorkManager / 没有后台任务 / 没有通知权限（H5）：
 *     系统会在后台把进程杀掉，后台常驻在手机上只会费电 + 让同学以为传上去了。
 *     所以重放只发生在用户下一次点「同步」的时候。
 */
class SyncQueue(private val dir: File) {

    companion object {
        /** 队列最多留这么多次，超了丢最旧的（别让手机被失败记录撑爆） */
        const val MAX_ITEMS = 50
    }

    class Item(
        val file: File,
        val stamp: String,
        val ids: List<String>,
        val error: String,
        val at: String,
    )

    private fun itemFiles(): List<File> {
        val all = dir.listFiles() ?: return emptyList()
        return all.filter { it.isFile && it.name.endsWith(".json") }.sortedBy { it.name }
    }

    fun list(): List<Item> = itemFiles().mapNotNull { f ->
        val m = try {
            Json.asMap(Json.parse(f.readText(Charsets.UTF_8)))
        } catch (e: Exception) {
            null
        } ?: return@mapNotNull null
        Item(
            file = f,
            stamp = Json.asString(m["stamp"]) ?: f.nameWithoutExtension,
            ids = Json.asList(m["ids"])?.mapNotNull { Json.asString(it) } ?: emptyList(),
            error = Json.asString(m["error"]) ?: "",
            at = Json.asString(m["at"]) ?: "",
        )
    }

    /** 队列里所有还欠着的 id（去重、保序） */
    fun pendingIds(): List<String> {
        val seen = LinkedHashSet<String>()
        for (item in list()) seen.addAll(item.ids)
        return seen.toList()
    }

    /** 记一次失败 */
    fun enqueue(ids: List<String>, stamp: String, error: String): File {
        dir.mkdirs()
        prune()
        val at = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val m = LinkedHashMap<String, Any?>()
        m["v"] = 1
        m["stamp"] = stamp
        m["at"] = at
        m["ids"] = ids
        m["error"] = error
        val f = File(dir, "$at-${ids.size}.json")
        f.writeText(Json.dump(m), Charsets.UTF_8)
        return f
    }

    /**
     * 这几天的队列项清掉。
     * 只要某条记录里的 id **全部**已经同步成功，这条就整个删掉；
     * 还剩一部分就只把成功的那些去掉（留着那些没成的）。
     */
    fun clear(ids: List<String>) {
        if (ids.isEmpty()) return
        for (item in list()) {
            val rest = item.ids.filterNot { ids.contains(it) }
            if (rest.isEmpty()) {
                item.file.delete()
            } else if (rest.size != item.ids.size) {
                val m = LinkedHashMap<String, Any?>()
                m["v"] = 1
                m["stamp"] = item.stamp
                m["at"] = item.at
                m["ids"] = rest
                m["error"] = item.error
                item.file.writeText(Json.dump(m), Charsets.UTF_8)
            }
        }
    }

    /** 超上限就丢最旧的（按文件名的时间戳前缀排序，天然就是时间序） */
    private fun prune() {
        val files = itemFiles()
        if (files.size < MAX_ITEMS) return
        files.take(files.size - MAX_ITEMS + 1).forEach { it.delete() }
    }

    /** 同步面板上那一行 */
    fun summary(): String {
        val items = list()
        if (items.isEmpty()) return "没有待重试的"
        val ids = pendingIds()
        val last = items.last()
        return "待重试 ${items.size} 次 / ${ids.size} 天（最近一次：${last.at} ${last.error}）"
    }
}
