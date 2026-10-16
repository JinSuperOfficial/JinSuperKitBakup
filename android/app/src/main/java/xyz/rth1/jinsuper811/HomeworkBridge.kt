package xyz.rth1.jinsuper811

import android.webkit.JavascriptInterface
import java.io.File

/**
 * HomeworkBridge.kt —— 作业编辑器页面与壳层之间的桥
 * ===========================================================
 * 桌面版的作业编辑器界面（`desktop/src/ui/hwk/`）只依赖**两个**入口：
 *
 *     window.hwk.getState()          → 等价于 action('list')
 *     window.hwk.action(name, payload) → 'list' | 'read' | 'save' | 'sync' | 'flush'
 *                                        | 'snapshot' | 'openDataDir' | 'close'
 *
 * 所以这一层只要把这几个动作按同样的**输入输出形状**实现出来，
 * 那套 HTML/CSS/JS 就能**一个字节不改**地跑在安卓的 WebView 里
 * （资源由 `LocalContentHandler` 从 `assets/hwk-ui/` 伺服）。
 *
 * 与桌面版的差别（有意为之）：
 *   · 'close' 在安卓上是「回到看作业」，不是关窗口；
 *   · 'openDataDir' 弹不了文件管理器（那是 `filesDir`），改成把路径回给页面显示；
 *   · 令牌在包内（`sync-config.json`），所以没有「登录」这一步。
 *
 * 注意：`@JavascriptInterface` 的方法都在 **WebView 的 JavaBridge 线程**上跑，
 * 不是 UI 线程 —— 里面的 IO 可以直接做（HwkStore / SyncEngine 都是阻塞式的）。
 * 返回值一律是 JSON 字符串：页面那边的 `act()` 期望拿到一个能点属性的对象，
 * 所以这里不能直接回一个字符串（那会变成字符串而不是对象）。
 */
class HomeworkBridge(private val services: AppServices) {

    private val jsonArraySubject = HwkStore.RESERVED

    /** 面板/终端预填的科目清单（与 `sync/lib/hwk-schema.mjs` 的 DEFAULT_SUBJECTS 一致） */
    private val defaultSubjects = listOf("语文", "数学", "英语", "科学", "社会", "班务")

    /* ═══════════════ 页面入口 ═══════════════ */

    @JavascriptInterface
    fun getState(): String = action("list", null)

    @JavascriptInterface
    fun action(name: String?, payload: String?): String {
        return try {
            when (name) {
                "list", null -> listState()
                "read" -> readDay(payload)
                "save" -> save(payload)
                "sync" -> sync()
                "flush" -> flush()
                "snapshot" -> snapshot()
                "openDataDir" -> ok(mapOf("path" to services.hwkStore.dir.absolutePath))
                "close" -> ok(emptyMap<String, Any?>())
                else -> err("认不出这个动作：$name")
            }
        } catch (e: Exception) {
            err(e.message ?: e.javaClass.simpleName)
        }
    }

    /* ═══════════════ list ═══════════════ */

    private fun listState(): String {
        val store = services.hwkStore
        val records = store.readIndex().map { e ->
            linkedMapOf<String, Any?>(
                "id" to e.id,
                "date" to e.date,
                "title" to e.title,
                "name" to e.name,
            )
        }
        val m = linkedMapOf<String, Any?>(
            "today" to HwkStore.today(),
            "records" to records,
            "dirty" to store.dirtyIds(),
            "defaultSubjects" to defaultSubjects,
            "dir" to store.dir.absolutePath,
        )
        return Json.stringify(m)
    }

    /* ═══════════════ read ═══════════════ */

    private fun readDay(payload: String?): String {
        val p = Json.asMap(Json.parse(payload ?: "{}"))
        val id = Json.asString(p?.get("id")) ?: return err("读哪一天？")
        val record = services.hwkStore.read(id) ?: return err("读不到这一天：$id")

        val subjects = record.keys
            .filter { !jsonArraySubject.contains(it) && it != HwkStore.NOTES_KEY && !it.startsWith("__") }
            .map { k ->
                linkedMapOf<String, Any?>(
                    "name" to k,
                    "text" to (Json.asString(record[k]) ?: ""),
                )
            }

        val form = linkedMapOf<String, Any?>(
            "id" to id,
            "date" to (HwkStore.normalizeDate(Json.asString(record["date"])) ?: HwkStore.dateFromId(id) ?: HwkStore.today()),
            "title" to (Json.asString(record["title"]) ?: ""),
            "bg" to (Json.asString(Json.asMap(record["bg"])?.get("value")) ?: "default"),
            "subjects" to subjects,
            "notes" to (Json.asString(record[HwkStore.NOTES_KEY]) ?: ""),
        )
        return Json.stringify(linkedMapOf<String, Any?>("id" to id, "form" to form))
    }

    /* ═══════════════ save ═══════════════ */

    private fun save(payload: String?): String {
        val p = Json.asMap(Json.parse(payload ?: "{}")) ?: return err("没有 payload")
        val input = Json.asMap(p["input"]) ?: return err("没有 input")

        val date = Json.asString(input["date"])
        val title = Json.asString(input["title"])
        val notes = Json.asString(input["notes"])
        val subjects = mutableListOf<Pair<String, String>>()
        Json.asList(input["subjects"])?.forEach { raw ->
            val row = Json.asMap(raw) ?: return@forEach
            val n = Json.asString(row["name"]) ?: ""
            val t = Json.asString(row["text"]) ?: ""
            if (n.isNotBlank() && t.isNotBlank()) subjects.add(n to t)
        }

        return try {
            val record = services.hwkStore.save(
                id = null,                  // 按日期生成 id（与桌面版一致的 n261011 形状）
                date = date,
                title = title,
                bg = Json.asString(input["bg"]),
                subjects = subjects,
                notes = notes,
            )
            val state = Json.asMap(Json.parse(listState()))
            Json.stringify(
                linkedMapOf<String, Any?>(
                    "record" to record,
                    "state" to state,
                    "notes" to emptyList<String>(),
                ),
            )
        } catch (e: IllegalArgumentException) {
            err(e.message ?: "保存失败")
        }
    }

    /* ═══════════════ sync / flush / snapshot ═══════════════ */

    private fun sync(): String {
        val config = services.syncConfig
        val problems = config.problems()
        if (problems.isNotEmpty()) {
            return Json.stringify(
                linkedMapOf<String, Any?>(
                    "ok" to false,
                    "reason" to problems.joinToString("；"),
                    "state" to Json.asMap(Json.parse(listState())),
                ),
            )
        }
        val result = services.syncEngine.pushDirty(from = config.from)
        val state = Json.asMap(Json.parse(listState()))
        /* 页面只关心「排了几个」，具体名字它不用 —— 所以这里放几个占位字符串就行，
           别写成 List(n) { it }（那个 `it` 是下标，Kotlin 的推断会绕进死胡同）。 */
        val queuedFiles = mutableListOf<Any?>()
        var i = 0
        while (i < result.count) {
            queuedFiles.add("queued")
            i++
        }
        return if (result.queued) {
            Json.stringify(
                linkedMapOf<String, Any?>(
                    "ok" to false,
                    "queued" to linkedMapOf<String, Any?>(
                        "files" to queuedFiles,
                        "error" to result.error,
                    ),
                    "state" to state,
                ),
            )
        } else {
            Json.stringify(
                linkedMapOf<String, Any?>(
                    "ok" to true,
                    "uploaded" to linkedMapOf<String, Any?>("count" to result.count, "stamp" to result.stamp),
                    "state" to state,
                ),
            )
        }
    }

    private fun flush(): String {
        val result = services.syncEngine.retryQueue(from = services.syncConfig.from)
        val state = Json.asMap(Json.parse(listState()))
        /* ★ 布尔表达式必须自己加括号再 `to`：
           `"ok" to !a && b` 会被解析成 `("ok" to !a) && b` ——
           `&&` 比 `to` 松，于是拿一个 Pair 去做逻辑与，报的是
           「Type mismatch: inferred type is Pair<String, Boolean> but Boolean was expected」，
           看起来完全不像优先级问题。这里栽过一次。 */
        val allDone = !result.queued && result.count > 0
        val doneFiles = mutableListOf<Any?>()
        if (!result.queued) {
            var i = 0
            while (i < result.count) {
                doneFiles.add("sent")
                i++
            }
        }
        return Json.stringify(
            linkedMapOf<String, Any?>(
                "ok" to allDone,
                "done" to doneFiles,
                "state" to state,
            ),
        )
    }

    private fun snapshot(): String {
        val dir: File = services.hwkStore.snapshot()
        val fields = LinkedHashMap<String, Any?>()
        fields["path"] = dir.absolutePath
        return ok(fields)
    }

    /* ═══════════════ 小工具 ═══════════════ */

    private fun ok(fields: Map<String, Any?>): String {
        val m = LinkedHashMap<String, Any?>()
        m["ok"] = true
        m.putAll(fields)
        return Json.stringify(m)
    }

    private fun err(message: String): String =
        Json.stringify(linkedMapOf<String, Any?>("error" to message))
}
