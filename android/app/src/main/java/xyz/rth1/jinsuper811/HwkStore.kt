package xyz.rth1.jinsuper811

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * HwkStore.kt —— 作业数据在本机的存储（**先落本地，再谈上云**）
 * ===========================================================
 * 这是 `desktop/src/hwk-store.js` 的同构移植。学校那台机器（现在是同学手机）
 * 上没有仓库、也常常没有网，所以作业先写进本机：
 *
 *   <filesDir>/hwk/index.json        目录（新的在前），形状和站点里那份一致
 *   <filesDir>/hwk/hwk-<id>.json     一天一份，字段 / 键序和站点里那份一模一样
 *   <filesDir>/hwk/.state.json       内部记账：导没导过基线、哪些天还没同步
 *
 * ★ 落盘位置是 `filesDir`，**不是**外部存储（Android 那个 getExternal… 开头的 API）：
 *   外部存储会被系统清理、也会被别的应用看见（同学的作业本不该被别人翻）。
 *   `HwkStoreTest` 有一条专门盯这个（见 android/app/src/test/.../HwkStoreTest.kt）。
 *
 * 三件事保证「安卓写出来的文件和站点里那份是同一份」：
 *   1. 归一/校验的规则与 `sync/lib/hwk-schema.mjs` 对齐（保留字、id 形状、日期归一）；
 *   2. 写文件用同一套 JSON 缩进（制表符 + 结尾换行），`git diff` 才干净；
 *   3. 第一次打开从随包的离线副本（`assets/site/class/data/hwk`）导一份**基线**
 *      进来（只导一次、只读源），所以同学装完就有历史可看。
 *
 * 同步：`snapshot()` 把当前所有改动复制到 `<filesDir>/sync/outbox/<时间戳>/hwk/`，
 * 这就是「先同步到本地」那一步 —— 上云是另一次动作，失败了本地快照还在。
 *
 * 这个类**只用 java.io / java.util**，不碰 android.* —— 所以能在 JVM 单测里
 * 拿临时目录整套跑一遍（`./gradlew test`）。
 */
class HwkStore(
    val dir: File,
    /** 随包离线副本里的 `class/data/hwk`（可以是空的 / 不存在） */
    private val baselineDir: File?,
    /** 本地快照目录（一般是 <filesDir>/sync/outbox） */
    private val outboxDir: File,
) {

    companion object {
        /**
         * 记录里的保留字。**必须和 `sync/lib/hwk-schema.mjs` 的 RESERVED
         * 以及页面 homework.html 的 INLINE_RESERVED 对齐**：
         * 页面把「不在这个表里的顶层键」一律当科目画成一行 ——
         * 多一个保留字就多一行假科目，少一个科目就被吞掉。
         * `build/test-android.mjs` 会拿三处比对。
         */
        val RESERVED = setOf(
            "id", "date", "title", "bg", "name", "file",
            "subjects", "notesId", "eggId", "homework", "notes", "egg", "彩蛋",
        )

        const val NOTES_KEY = "笔记"
        const val EGG_KEY = "彩蛋"

        val ID_RE = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$")

        /** 日期 → 默认 id：2026-10-11 → n261011（沿用现有那份 n261010 的命名） */
        fun idFromDate(date: String): String {
            val d = normalizeDate(date) ?: return ""
            return "n" + d.substring(2).replace("-", "")
        }

        /** id → 日期：n261011 → 2026-10-11 */
        fun dateFromId(id: String?): String? {
            val m = Regex("^n(\\d{2})(\\d{2})(\\d{2})$").find(id ?: "") ?: return null
            return normalizeDate("20${m.groupValues[1]}-${m.groupValues[2]}-${m.groupValues[3]}")
        }

        /** `2026-10-10` / `2026/10/10` / `2026.10.10` → `2026-10-10`；不认识返回 null */
        fun normalizeDate(raw: String?): String? {
            val s = raw?.trim().orEmpty()
            if (s.isEmpty()) return null
            val m = Regex("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$").find(s) ?: return null
            val (y, mo, d) = m.destructured
            val mm = mo.padStart(2, '0')
            val dd = d.padStart(2, '0')
            // 滚动日期（2-31 → 3-3）当写错了
            val yi = y.toInt(); val mi = mm.toInt(); val di = dd.toInt()
            if (mi !in 1..12 || di !in 1..31) return null
            val cal = java.util.Calendar.getInstance()
            cal.clear()
            cal.set(yi, mi - 1, di)
            if (cal.get(java.util.Calendar.YEAR) != yi ||
                cal.get(java.util.Calendar.MONTH) + 1 != mi ||
                cal.get(java.util.Calendar.DAY_OF_MONTH) != di
            ) return null
            return "$y-$mm-$dd"
        }

        fun today(): String {
            return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        }

        /** 时间戳目录名：20261015-2218（本地时间，人看得懂）—— 与 inbox.mjs 的 defaultStamp 同形 */
        fun stamp(d: Date = Date()): String =
            SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(d)

        fun nameFor(id: String) = "hwk-$id.json"
    }

    /* ═══════════════ 目录条目 ═══════════════ */

    data class IndexEntry(val id: String, val name: String, val date: String, val title: String)

    /* ═══════════════ 内部读写 ═══════════════ */

    private fun writeAtomic(file: File, text: String) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".part")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            // 个别文件系统 rename 会失败（跨设备 / 已存在），退回直写
            file.writeText(text, Charsets.UTF_8)
            tmp.delete()
        }
    }

    private fun readJson(file: File): Any? = try {
        Json.parse(file.readText(Charsets.UTF_8))
    } catch (e: Exception) {
        null
    }

    private val stateFile: File get() = File(dir, ".state.json")

    data class State(
        val seeded: Boolean = false,
        val dirty: List<String> = emptyList(),
        val lastSyncAt: String = "",
        val lastSyncStamp: String = "",
    )

    fun readState(): State {
        val m = Json.asMap(readJson(stateFile)) ?: return State()
        return State(
            seeded = m["seeded"] == true,
            dirty = Json.asList(m["dirty"])?.mapNotNull { Json.asString(it) } ?: emptyList(),
            lastSyncAt = Json.asString(m["lastSyncAt"]) ?: "",
            lastSyncStamp = Json.asString(m["lastSyncStamp"]) ?: "",
        )
    }

    private fun writeState(next: State): State {
        val m = LinkedHashMap<String, Any?>()
        m["seeded"] = next.seeded
        m["dirty"] = next.dirty
        m["lastSyncAt"] = next.lastSyncAt
        m["lastSyncStamp"] = next.lastSyncStamp
        writeAtomic(stateFile, Json.dump(m))
        return next
    }

    fun recordFile(id: String) = File(dir, nameFor(id))

    /* ═══════════════ 读 ═══════════════ */

    fun listIds(): List<String> {
        val names = dir.list() ?: return emptyList()
        return names.filter { it.matches(Regex("^hwk-.+\\.json$")) }
            .map { it.removePrefix("hwk-").removeSuffix(".json") }
            .sorted()
    }

    fun read(id: String): LinkedHashMap<String, Any?>? = Json.asMap(readJson(recordFile(id)))

    /** 读 index.json；没有 / 坏了就按目录实际内容现算一份（页面也是这个兜底口径） */
    fun readIndex(): List<IndexEntry> {
        val raw = Json.asList(readJson(File(dir, "index.json")))
        if (raw != null) {
            val list = raw.mapNotNull { normalizeEntry(it) }
            if (list.isNotEmpty()) return sortIndex(list)
        }
        return sortIndex(listIds().mapNotNull { id ->
            val r = read(id) ?: return@mapNotNull null
            normalizeEntry(mapOf(
                "id" to id,
                "name" to nameFor(id),
                "date" to (Json.asString(r["date"]) ?: dateFromId(id) ?: ""),
                "title" to (Json.asString(r["title"]) ?: ""),
            ))
        })
    }

    private fun normalizeEntry(v: Any?): IndexEntry? {
        val m = Json.asMap(v) ?: return null
        val name = (Json.asString(m["name"]) ?: "").trim()
        val id = ((Json.asString(m["id"]) ?: "").ifBlank {
            name.removePrefix("hwk-").removeSuffix(".json")
        }).trim()
        if (id.isEmpty()) return null
        val date = normalizeDate(Json.asString(m["date"])) ?: dateFromId(id) ?: ""
        return IndexEntry(id, name.ifBlank { nameFor(id) }, date, Json.asString(m["title"]) ?: "")
    }

    /** 日期倒序，同一天按 id 倒序（与 hwk-schema.mjs 的 mergeIndex 同一条规则） */
    private fun sortIndex(list: List<IndexEntry>): List<IndexEntry> =
        list.sortedWith(compareByDescending<IndexEntry> { it.date.ifBlank { it.id } }
            .thenByDescending { it.id })

    /** 目录里顶上一条 = 页面认的「今天这份」 */
    fun latest(): IndexEntry? = readIndex().firstOrNull()

    /* ═══════════════ 写 ═══════════════ */

    /**
     * 保存一天。**键序固定**：id / date / title / bg / 各科 / 笔记 / 彩蛋。
     *
     * @throws IllegalArgumentException 校验不过（id 不合法 / 一科都没填），
     *         消息里把所有问题一次说完，别让人改一条报一条。
     */
    fun save(
        id: String?,
        date: String?,
        title: String? = null,
        bg: String? = null,
        subjects: List<Pair<String, String>> = emptyList(),
        notes: String? = null,
        egg: String? = null,
    ): LinkedHashMap<String, Any?> {
        val problems = mutableListOf<String>()

        var d = normalizeDate(date)
        val idGiven = (id ?: "").trim()
        if (d == null && idGiven.isNotEmpty()) d = dateFromId(idGiven)
        if (d == null) {
            if ((date ?: "").isBlank() && idGiven.isEmpty()) d = today()
            else problems.add("日期要写成 2026-10-11 这样（也可以用 / 或 . 分隔）")
        }

        val realId = idGiven.ifBlank { if (d != null) idFromDate(d) else "" }
        if (realId.isEmpty()) problems.add("缺 id（留空的话按日期自动生成，形如 n261011）")
        else if (!ID_RE.matches(realId)) {
            problems.add("id「$realId」不能当文件名：只用字母数字和 . _ -，别用中文/空格/斜杠")
        }

        val realTitle = (title ?: "").trim().ifBlank {
            if (d != null) "作业-" + d.replace("-", "") else ""
        }
        if (realTitle.isEmpty()) problems.add("标题不能空")
        if (realTitle.length > 120) problems.add("标题太长了（>120 字）")

        val clean = mutableListOf<Pair<String, String>>()
        for ((rawName, rawText) in subjects) {
            val n = rawName.trim()
            if (n.isEmpty() || rawText.isBlank()) continue
            if (RESERVED.contains(n) || n == NOTES_KEY) {
                problems.add("「$n」是保留字，不能当科目名")
                continue
            }
            if (n.length > 20) problems.add("科目名太长了：「$n」")
            if (rawText.length > 20000) problems.add("「$n」的正文太长了（>20000 字）")
            val at = clean.indexOfFirst { it.first == n }
            if (at >= 0) clean[at] = n to rawText else clean.add(n to rawText)
        }
        val realNotes = (notes ?: "").trim()
        if (realNotes.length > 20000) problems.add("笔记太长了（>20000 字）")
        if (clean.isEmpty() && realNotes.isEmpty()) problems.add("一个科目都没填（至少写一科，或者写笔记）")

        if (problems.isNotEmpty()) throw IllegalArgumentException(problems.joinToString("；"))

        val realBg = (bg ?: "").trim().ifBlank { "default" }

        val record = LinkedHashMap<String, Any?>()
        record["id"] = realId
        record["date"] = d
        record["title"] = realTitle
        record["bg"] = linkedMapOf<String, Any?>("value" to realBg)
        for ((n, t) in clean) record[n] = t
        if (realNotes.isNotEmpty()) record[NOTES_KEY] = realNotes
        val realEgg = (egg ?: "").trim()
        if (realEgg.isNotEmpty()) record[EGG_KEY] = realEgg

        dir.mkdirs()
        writeAtomic(recordFile(realId), Json.dump(record))

        /* 把这条顶到索引最前（同一天重复写就替换掉旧的那条） */
        val entry = IndexEntry(realId, nameFor(realId), d ?: "", realTitle)
        val nextIndex = sortIndex(listOf(entry) + readIndex().filterNot { it.id == realId })
        writeIndex(nextIndex)

        /* 记账：这天还没同步 */
        val st = readState()
        if (!st.dirty.contains(realId)) writeState(st.copy(dirty = st.dirty + realId))

        return record
    }

    private fun writeIndex(list: List<IndexEntry>) {
        val arr = list.map { e ->
            val m = LinkedHashMap<String, Any?>()
            m["id"] = e.id
            m["name"] = e.name
            m["date"] = e.date
            m["title"] = e.title
            m
        }
        writeAtomic(File(dir, "index.json"), Json.dump(arr))
    }

    fun delete(id: String): Boolean {
        val f = recordFile(id)
        if (!f.exists()) return false
        val ok = f.delete()
        if (ok) {
            writeIndex(readIndex().filterNot { it.id == id })
            val st = readState()
            writeState(st.copy(dirty = st.dirty.filterNot { it == id }))
        }
        return ok
    }

    /* ═══════════════ 基线 ═══════════════ */

    data class SeedResult(val seeded: Boolean, val count: Int, val reason: String = "")

    /**
     * 第一次打开时从随包离线副本导一份基线（**只导一次、只读源**）。
     * 本机已经有作业了就不导 —— 别把同学录的盖掉。
     */
    fun seed(): SeedResult {
        val st = readState()
        if (st.seeded) return SeedResult(false, 0, "已经导过")
        val base = baselineDir
        if (base == null || !base.isDirectory) {
            writeState(st.copy(seeded = true))
            return SeedResult(false, 0, "随包副本里没有基线")
        }
        dir.mkdirs()
        var count = 0
        val names = base.list() ?: emptyArray()
        for (n in names) {
            if (!n.matches(Regex("^hwk-.+\\.json$"))) continue
            val src = File(base, n)
            val dst = File(dir, n)
            if (dst.exists()) continue                       // 不覆盖本机已有的
            src.copyTo(dst, overwrite = false)
            count++
        }
        /* 索引也照抄一份过来（源里那份就是权威目录） */
        val srcIndex = File(base, "index.json")
        if (count > 0 && srcIndex.isFile) {
            srcIndex.copyTo(File(dir, "index.json"), overwrite = true)
        }
        writeState(readState().copy(seeded = true))
        return SeedResult(count > 0, count)
    }

    /** 显式「重新导入基线」：把已经导过的标记清掉，再走一遍 seed() */
    fun reseed(): SeedResult {
        writeState(readState().copy(seeded = false))
        return seed()
    }

    /* ═══════════════ 快照 / 记账 ═══════════════ */

    /**
     * 「先同步到本地」：把当前所有作业快照到 `outbox/<时间戳>/hwk/`。
     * 上云失败了这份快照还在，不用重新录一遍。
     */
    fun snapshot(d: Date = Date()): File {
        val target = File(File(outboxDir, stamp(d)), "hwk")
        target.mkdirs()
        for (id in listIds()) {
            recordFile(id).copyTo(File(target, nameFor(id)), overwrite = true)
        }
        val idx = File(dir, "index.json")
        if (idx.isFile) idx.copyTo(File(target, "index.json"), overwrite = true)
        /* ★ `.state.json` 这类**点开头的内部记账文件不拷**：
           快照是「给家里看的作业数据」，谁导过基线、哪些天没同步是**本机**的事，
           带过去只会让家里的 diff 里多一份没人认识的 dotfile。
           （对齐 inbox.mjs 的 collectDir：它也是 `if (e.name.startsWith('.')) continue`。） */
        return target
    }

    /**
     * 把一批 id 标记成「已经同步过了」。
     * @param stampValue 收件箱时间戳；传 null / 空白就用当前时间的 `yyyyMMdd-HHmm`
     */
    fun markSyncedAt(ids: List<String>, stampValue: String?): State {
        val st = readState()
        return writeState(st.copy(
            dirty = st.dirty.filterNot { ids.contains(it) },
            lastSyncAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date()),
            lastSyncStamp = stampValue?.takeIf { it.isNotBlank() } ?: stamp(),
        ))
    }

    /** 只传 id，时间戳取现在 */
    fun markSynced(ids: List<String>): State = markSyncedAt(ids, null)

    fun dirtyIds(): List<String> = readState().dirty

    /** 给同步面板 / 设置页看的一行摘要 */
    fun stats(): String {
        val n = listIds().size
        val dirty = dirtyIds().size
        val latest = latest()
        return "本机 $n 天作业 · 待同步 $dirty 天 · 最近 " + (latest?.date ?: "—")
    }
}
