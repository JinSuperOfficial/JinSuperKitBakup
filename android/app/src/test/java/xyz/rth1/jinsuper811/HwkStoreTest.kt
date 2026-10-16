package xyz.rth1.jinsuper811

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * HwkStoreTest —— 作业在本机的存储
 * ===========================================================
 * 三条教训里的后两条都落在这一组：
 *
 *   ② **安装 / 数据位置必须被测试盯住** —— 断言数据落在 `filesDir/hwk/`
 *      （见 `data_lives_under_the_given_dir_not_next_to_it`）；
 *   ③ **回归测试不许钉「最新一天」** —— 基线用的是随包 fixture 里那两天
 *      （`hwk-n261010` / `hwk-n261017`），不是「站点里最新那天」。
 *
 * 另外还盯住「跨端形状一致」：写出来的 JSON 必须是**制表符缩进 + 结尾换行**，
 * 键序必须是 id / date / title / bg / 各科 / 笔记 —— 和
 * `sync/lib/hwk-schema.mjs` 的 `dumpJson` 一字不差，家里 `git diff` 才干净。
 */
class HwkStoreTest {

    private lateinit var tmp: File
    private lateinit var filesDir: File
    private lateinit var baselineDir: File
    private lateinit var outbox: File

    /** 临时目录统一挂到 exit 上删掉（跑一次会建好几个，不删就往 /tmp 里堆） */
    private val tempDirs = mutableListOf<File>()

    private fun mkTmp(prefix: String): File {
        val d = Files.createTempDirectory(prefix).toFile()
        tempDirs.add(d)
        return d
    }

    @Before
    fun setUp() {
        tmp = mkTmp("jins-hwk-")
        filesDir = File(tmp, "files/hwk")
        baselineDir = File(tmp, "baseline")
        outbox = File(tmp, "files/sync/outbox")
        baselineDir.mkdirs()

        /* 基线 = 随包 fixture（**固定**，不是站点里会变的那份） */
        for (n in listOf("hwk-n261010.json", "hwk-n261017.json", "index.json")) {
            val bytes = javaClass.classLoader!!.getResourceAsStream("hwk-baseline/$n")!!.readBytes()
            File(baselineDir, n).writeBytes(bytes)
        }
    }

    @After
    fun tearDown() {
        for (d in tempDirs) {
            runCatching { d.deleteRecursively() }
        }
        tempDirs.clear()
    }

    private fun store() = HwkStore(filesDir, baselineDir, outbox)

    /* ═══════════ ② 数据位置 ═══════════ */

    @Test
    fun data_lives_under_the_given_dir_not_next_to_it() {
        val s = store()
        s.seed()
        s.save("n261101", "2026-11-01", "作业-20261101", "default",
            listOf("语文" to "1. 抄写"), "笔记内容")

        /* 该在的全在 files/hwk/ 底下 */
        assertTrue("record 不在 filesDir 里", File(filesDir, "hwk-n261101.json").isFile)
        assertTrue("index.json 不在 filesDir 里", File(filesDir, "index.json").isFile)
        assertTrue("状态文件不在 filesDir 里", File(filesDir, ".state.json").isFile)

        /* 不该在**外面**长出一份（getExternalFilesDir 那种错法就是这么被发现） */
        assertFalse(File(tmp, "hwk-n261101.json").exists())
        assertFalse(File(tmp, "hwk").exists())
    }

    @Test
    fun record_file_name_is_hwk_dash_id_dot_json() {
        val s = store()
        s.save("n261101", "2026-11-01", "t", "default", listOf("语文" to "x"))
        assertEquals("hwk-n261101.json", s.recordFile("n261101").name)
        assertEquals(listOf("n261101"), s.listIds())
    }

    /* ═══════════ 形状 / 键序 / 缩进 ═══════════ */

    @Test
    fun written_json_matches_site_shape_byte_for_byte() {
        val s = store()
        s.save(
            id = "n261101",
            date = "2026-11-01",
            title = "作业-20261101",
            bg = "default",
            subjects = listOf("语文" to "1. 抄写\n2. 背诵", "数学" to "试卷一张"),
            notes = "周一交",
        )

        val text = File(filesDir, "hwk-n261101.json").readText(Charsets.UTF_8)

        /* 制表符缩进 + 结尾换行（= dumpJson） */
        assertTrue("缩进应该是制表符", text.contains("\n\t\"id\""))
        assertTrue("结尾应该有一个换行", text.endsWith("}\n"))
        assertFalse("不该有尾随空格", text.contains(" \n"))

        /* 键序：id / date / title / bg / 各科 / 笔记 */
        val order = Regex("\"(id|date|title|bg|语文|数学|笔记)\"").findAll(text).map { it.groupValues[1] }.toList()
        assertEquals(listOf("id", "date", "title", "bg", "语文", "数学", "笔记"), order)

        /* bg 是对象（不是裸字符串）—— 页面三种写法都认，但站点里存的是 {"value":…} */
        assertTrue(text.contains("\"bg\": {\n\t\t\"value\": \"default\"\n\t}"))
    }

    @Test
    fun round_trip_through_our_own_json_parser() {
        val s = store()
        s.save("n261101", "2026-11-01", "带\"引号\"的标题", "default",
            listOf("语文" to "行1\n行2\t带制表"), "笔记")
        val back = s.read("n261101")!!
        assertEquals("带\"引号\"的标题", back["title"])
        assertEquals("行1\n行2\t带制表", back["语文"])
        assertEquals("笔记", back["笔记"])
    }

    /* ═══════════ 基线 ═══════════ */

    @Test
    fun seed_copies_baseline_once_and_never_overwrites() {
        val s = store()
        val first = s.seed()
        assertTrue("第一次应该导进来", first.seeded)
        assertEquals(2, first.count)
        assertEquals(listOf("n261010", "n261017"), s.listIds().sorted())

        /* 导完改一天，再 seed 一次 —— 不能被基线盖回去 */
        s.save("n261017", "2026-10-17", "同学改过的", "default", listOf("语文" to "改过了"))
        val second = s.seed()
        assertFalse("第二次不该再导", second.seeded)
        assertEquals("已经导过", second.reason)
        assertEquals("同学改过的", s.read("n261017")!!["title"])
    }

    @Test
    fun reseed_is_explicit_and_reimports() {
        val s = store()
        s.seed()
        File(filesDir, "hwk-n261010.json").delete()
        assertEquals(1, s.listIds().size)
        val r = s.reseed()
        assertTrue("显式重新导入要能补回来", r.seeded)
        assertEquals(2, s.listIds().size)
    }

    @Test
    fun seed_does_not_copy_the_old_homework_backup() {
        /* 站点里那份 class/data/homework.json 是老结构，不该被当基线导进来 */
        File(baselineDir, "homework.json").writeText("{\"语文\":\"老的那份\"}")
        val s = store()
        s.seed()
        assertFalse(File(filesDir, "homework.json").exists())
        assertEquals(2, s.listIds().size)
    }

    /* ═══════════ 目录（index.json） ═══════════ */

    @Test
    fun index_puts_newest_first_and_replaces_same_id() {
        val s = store()
        s.seed()
        s.save("n261101", "2026-11-01", "最新", "default", listOf("语文" to "x"))
        val idx = s.readIndex()
        assertEquals(listOf("n261101", "n261017", "n261010"), idx.map { it.id })

        /* 同一天写第二次：替换，不是插两条 */
        s.save("n261101", "2026-11-01", "改过的最新", "default", listOf("语文" to "y"))
        val idx2 = s.readIndex()
        assertEquals(3, idx2.size)
        assertEquals("改过的最新", idx2.first().title)
    }

    @Test
    fun index_falls_back_to_directory_scan_when_file_is_missing() {
        val s = store()
        s.seed()
        File(filesDir, "index.json").delete()
        val idx = s.readIndex()
        assertEquals(2, idx.size)
        assertEquals("n261017", idx.first().id)
    }

    @Test
    fun latest_is_the_first_index_entry() {
        val s = store()
        s.seed()
        assertEquals("n261017", s.latest()?.id)
        assertEquals("2026-10-17", s.latest()?.date)
    }

    /* ═══════════ 校验 ═══════════ */

    @Test
    fun rejects_bad_id_and_empty_body() {
        val s = store()
        var msg = ""
        try {
            s.save("有中文", "2026-11-01", "t", "default", listOf("语文" to "x"))
        } catch (e: IllegalArgumentException) {
            msg = e.message ?: ""
        }
        assertTrue("id 里的中文必须被拦：$msg", msg.contains("不能当文件名"))

        msg = ""
        try {
            s.save("n261101", "2026-11-01", "t", "default", emptyList(), "")
        } catch (e: IllegalArgumentException) {
            msg = e.message ?: ""
        }
        assertTrue("一科都没填必须被拦：$msg", msg.contains("一个科目都没填"))
    }

    @Test
    fun reserves_the_same_keys_as_the_site() {
        val s = store()
        val msg = runCatching {
            s.save("n261101", "2026-11-01", "t", "default", listOf("bg" to "x"))
        }.exceptionOrNull()?.message ?: ""
        assertTrue("保留字当科目名必须被拦：$msg", msg.contains("保留字"))

        /* 页面的 INLINE_RESERVED 和 hwk-schema.mjs 的 RESERVED 是同一套 */
        assertTrue(HwkStore.RESERVED.contains("bg"))
        assertTrue(HwkStore.RESERVED.contains("笔记").not())   // 笔记是特殊键，不在保留字表里
        assertTrue(HwkStore.RESERVED.contains("彩蛋"))
    }

    @Test
    fun rejects_rolled_over_dates() {
        assertNull(HwkStore.normalizeDate("2026-02-30"))
        assertNull(HwkStore.normalizeDate("2026-13-01"))
        assertEquals("2026-02-28", HwkStore.normalizeDate("2026/2/28"))
        assertEquals("2026-10-11", HwkStore.normalizeDate("2026.10.11"))
    }

    @Test
    fun id_and_date_convert_both_ways() {
        assertEquals("n261011", HwkStore.idFromDate("2026-10-11"))
        assertEquals("2026-10-11", HwkStore.dateFromId("n261011"))
        assertNull(HwkStore.dateFromId("nope"))
        assertNull(HwkStore.dateFromId("2026-10-11"))
    }

    /* ═══════════ 同步记账 ═══════════ */

    @Test
    fun saving_marks_the_day_dirty_and_sync_clears_it() {
        val s = store()
        s.seed()
        assertTrue("刚导完基线不该有脏数据", s.dirtyIds().isEmpty())

        s.save("n261101", "2026-11-01", "新的一天", "default", listOf("语文" to "x"))
        assertEquals(listOf("n261101"), s.dirtyIds())

        s.markSynced(listOf("n261101"))
        assertTrue(s.dirtyIds().isEmpty())
        assertTrue(s.readState().lastSyncStamp.length >= 8)
    }

    @Test
    fun snapshot_copies_into_outbox_with_a_stamp() {
        val s = store()
        s.seed()
        s.save("n261101", "2026-11-01", "新的一天", "default", listOf("语文" to "x"))
        val dir = s.snapshot(java.util.Date(1700000000000L))
        assertTrue(dir.isDirectory)
        assertTrue(dir.absolutePath.contains("outbox"))
        /* 点名验，别只数「几个 .json」—— `.state.json` 也是 .json 结尾，
           数个数会把内部记账文件一起算进去（这里栽过一次，红得莫名其妙）。 */
        val names = dir.listFiles()!!.map { it.name }.sorted()
        assertEquals(
            listOf("hwk-n261010.json", "hwk-n261017.json", "hwk-n261101.json", "index.json"),
            names,
        )
        assertFalse("内部记账文件不该进快照", names.contains(".state.json"))
    }

    @Test
    fun delete_removes_record_index_entry_and_dirty_flag() {
        val s = store()
        s.seed()
        s.save("n261101", "2026-11-01", "新的一天", "default", listOf("语文" to "x"))
        assertTrue(s.delete("n261101"))
        assertFalse(File(filesDir, "hwk-n261101.json").exists())
        assertFalse(s.readIndex().any { it.id == "n261101" })
        assertTrue(s.dirtyIds().isEmpty())
    }

    @Test
    fun stats_is_human_readable_and_never_null() {
        val s = store()
        s.seed()
        val text = s.stats()
        assertNotNull(text)
        assertTrue(text.contains("本机 2 天作业"))
        assertTrue(text.contains("2026-10-17"))
    }

    /* ═══════════ 读一份真实 fixture，确认字段口径 ═══════════ */

    @Test
    fun baseline_fixture_has_the_site_shape() {
        val s = store()
        s.seed()
        val r = s.read("n261017")!!
        assertEquals("n261017", r["id"])
        assertEquals("2026-10-17", r["date"])
        assertEquals("作业-n20261017", r["title"])
        assertNotNull("bg 得是对象（{\"value\":…}）", Json.asMap(r["bg"]))
        assertEquals("default", Json.asString(Json.asMap(r["bg"])!!["value"]))
        assertTrue("科目就是顶层键", r.containsKey("语文"))
        assertTrue(r.containsKey("笔记"))
    }
}
