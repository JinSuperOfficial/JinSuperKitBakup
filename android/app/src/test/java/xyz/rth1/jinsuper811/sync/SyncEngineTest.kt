package xyz.rth1.jinsuper811.sync

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import xyz.rth1.jinsuper811.HwkStore
import java.io.File
import java.nio.file.Files

/**
 * SyncEngineTest —— 读方向 / 写方向的分工
 * ===========================================================
 * 三件事在这里被钉住：
 *
 *   ① **读方向不覆盖本机改过的东西**。冲突口径不是「谁新谁赢」，而是
 *      「本机改过的（dirty）就不动它」—— 否则同学刚录的作业会被云端那份盖掉。
 *   ② **写方向的形状**：tar.gz（里面是 `hwk/…`）+ `_manifest.json` 最后写，
 *      而且 put 之前先 stat。
 *   ③ **失败进队列、不抛异常**。同学那边看到的应该是「已保存，等有网再传」。
 */
class SyncEngineTest {

    private lateinit var tmp: File
    private lateinit var filesDir: File
    private lateinit var baselineDir: File
    private lateinit var transport: FakeTransport
    private lateinit var store: HwkStore
    private lateinit var queue: SyncQueue
    private lateinit var engine: SyncEngine
    private val tempDirs = mutableListOf<File>()

    @Before
    fun setUp() {
        tmp = Files.createTempDirectory("jins-engine-").toFile()
        tempDirs.add(tmp)
        filesDir = File(tmp, "files/hwk")
        baselineDir = File(tmp, "baseline").apply { mkdirs() }
        for (n in listOf("hwk-n261010.json", "hwk-n261017.json", "index.json")) {
            File(baselineDir, n).writeBytes(
                javaClass.classLoader!!.getResourceAsStream("hwk-baseline/$n")!!.readBytes(),
            )
        }
        transport = FakeTransport()
        store = HwkStore(filesDir, baselineDir, File(tmp, "files/sync/outbox"))
        store.seed()
        queue = SyncQueue(File(tmp, "files/sync/queue"))
        engine = SyncEngine(store, transport, queue)
    }

    @After
    fun tearDown() {
        tempDirs.forEach { runCatching { it.deleteRecursively() } }
        tempDirs.clear()
    }

    private fun pushRemote(stamp: String, files: Map<String, String>) {
        Inbox.pushInbox(
            transport, "hwk",
            files.map { (path, body) -> Inbox.Entry(path, body.toByteArray(Charsets.UTF_8)) },
            stamp = stamp, from = "家里",
        )
    }

    /* ═══════════ 读方向 ═══════════ */

    @Test
    fun pull_writes_remote_days_into_files_dir() {
        pushRemote("20261015-2218", mapOf(
            "hwk/hwk-n261101.json" to "{\n\t\"id\": \"n261101\",\n\t\"date\": \"2026-11-01\",\n\t\"title\": \"家里写的\",\n\t\"bg\": {\n\t\t\"value\": \"default\"\n\t},\n\t\"语文\": \"1. 抄写\"\n}\n",
            "hwk/index.json" to "[]\n",
        ))

        val r = engine.pull()
        assertEquals(listOf("20261015-2218"), r.stamps)
        assertTrue("应该写进 filesDir/hwk/", File(filesDir, "hwk-n261101.json").isFile)
        assertEquals("家里写的", store.read("n261101")!!["title"])
        assertTrue(r.dirty.contains("n261101"))

        /* 索引被重建过：新那天排在最前 */
        assertEquals("n261101", store.latest()?.id)
    }

    @Test
    fun pull_does_not_clobber_days_the_phone_changed() {
        pushRemote("20261015-2218", mapOf(
            "hwk/hwk-n261017.json" to "{\n\t\"id\": \"n261017\",\n\t\"date\": \"2026-10-17\",\n\t\"title\": \"云端的旧标题\",\n\t\"bg\": {\n\t\t\"value\": \"default\"\n\t},\n\t\"语文\": \"云端的\"\n}\n",
        ))

        /* 同学在手机上改了同一天 —— 这天是 dirty */
        store.save("n261017", "2026-10-17", "同学改的", "default", listOf("语文" to "我自己的"))
        assertTrue(store.dirtyIds().contains("n261017"))

        val r = engine.pull()
        assertEquals("云端的标题不许盖掉同学的", "同学改的", store.read("n261017")!!["title"])
        assertEquals("我自己的", store.read("n261017")!!["语文"])
        assertTrue("要如实报出跳过了哪天", r.skipped.contains("n261017"))
    }

    @Test
    fun pull_ignores_non_hwk_entries_in_the_pack() {
        pushRemote("20261015-2218", mapOf(
            "hwk/hwk-n261101.json" to "{\n\t\"id\": \"n261101\",\n\t\"date\": \"2026-11-01\",\n\t\"title\": \"x\",\n\t\"语文\": \"y\"\n}\n",
            "hwk/README.txt" to "不该被当作业",
            "hwk/.state.json" to "{\"seeded\":true}",
        ))
        val r = engine.pull()
        assertEquals(1, r.written)
        assertFalse(File(filesDir, "README.txt").exists())
        assertTrue(".state.json 不许被云端盖掉", store.readState().seeded)
    }

    @Test
    fun pull_cleans_its_incoming_directory() {
        pushRemote("20261015-2218", mapOf(
            "hwk/hwk-n261101.json" to "{\n\t\"id\": \"n261101\",\n\t\"date\": \"2026-11-01\",\n\t\"title\": \"x\"\n}\n",
        ))
        engine.pull()
        val incoming = File(tmp, "files/sync/incoming")
        assertTrue("拉完必须清干净，别在手机上堆", !incoming.exists() || (incoming.list() ?: emptyArray()).isEmpty())
    }

    /* ═══════════ 写方向 ═══════════ */

    @Test
    fun push_uploads_tar_gz_then_manifest_and_clears_dirty() {
        store.save("n261101", "2026-11-01", "今天", "default", listOf("语文" to "1. 抄写"))
        val r = engine.pushDirty(from = "Pixel 8", stamp = "20261015-2218")

        assertFalse(r.queued)
        assertEquals(1, r.stamp?.let { 1 } ?: 0)
        assertTrue(r.count >= 2)          // index.json + 那一天的记录

        /* ★ 形状：tar.gz 先，清单后 */
        val tarAt = transport.calls.indexOf("put:inbox/20261015-2218/hwk.tar.gz@inbox")
        val manAt = transport.calls.indexOf("put:inbox/20261015-2218/_manifest.json@inbox")
        assertTrue(manAt > tarAt)
        /* ★ put 之前先 stat。
           注意别只写 `a < b` —— indexOf 找不到会回 -1，`-1 < tarAt` 恒真，
           这条断言就会「假通过」（这里栽过一次）。先判存在，再判先后。 */
        val statAt = transport.calls.indexOf("stat:inbox/20261015-2218/hwk.tar.gz@inbox")
        assertTrue("put 之前必须**发生过** stat（实际流水：${transport.calls}）", statAt >= 0)
        assertTrue("stat 必须在 put 之前（statAt=$statAt tarAt=$tarAt）", statAt < tarAt)

        /* 包里就是 hwk/… 那套路径 */
        val names = xyz.rth1.jinsuper811.InboxTarGz
            .unpackTarGz(transport.body("inbox/20261015-2218/hwk.tar.gz")).map { it.name }
        assertTrue(names.contains("hwk/hwk-n261101.json"))
        assertTrue(names.contains("hwk/index.json"))

        assertTrue("传完就不该再是脏的", store.dirtyIds().isEmpty())
        assertEquals("20261015-2218", store.readState().lastSyncStamp)
    }

    @Test
    fun push_with_nothing_dirty_does_nothing() {
        val r = engine.pushDirty(from = "Pixel 8", stamp = "20261015-2218")
        assertFalse(r.queued)
        assertEquals(0, r.count)
        assertTrue("没改动就不该发任何请求", transport.puts.isEmpty())
    }

    @Test
    fun push_failure_queues_instead_of_throwing() {
        store.save("n261101", "2026-11-01", "今天", "default", listOf("语文" to "1. 抄写"))
        transport.failNext = TransportException("连不上", 0)

        val r = engine.pushDirty(from = "Pixel 8", stamp = "20261015-2218")
        assertTrue("失败要排队，不许抛", r.queued)
        assertTrue(r.error.contains("连不上"))
        assertEquals(listOf("n261101"), queue.pendingIds())
        assertTrue("还欠着，不该被标成同步过", store.dirtyIds().contains("n261101"))
    }

    @Test
    fun retry_queue_resends_everything_that_is_pending() {
        store.save("n261101", "2026-11-01", "今天", "default", listOf("语文" to "1. 抄写"))
        transport.failNext = TransportException("连不上", 0)
        engine.pushDirty(from = "Pixel 8", stamp = "20261015-2218")
        assertEquals(1, queue.pendingIds().size)

        val again = engine.retryQueue(from = "Pixel 8")
        assertFalse("第二次成功", again.queued)
        assertTrue("队列该空了", queue.pendingIds().isEmpty())
        assertTrue(store.dirtyIds().isEmpty())
    }

    @Test
    fun queue_summary_is_shown_on_the_panel() {
        store.save("n261101", "2026-11-01", "今天", "default", listOf("语文" to "1. 抄写"))
        transport.failNext = TransportException("连不上", 0)
        engine.pushDirty(from = "Pixel 8", stamp = "20261015-2218")
        val s = engine.queueSummary()
        assertTrue("面板上要说清攒了几次：$s", s.contains("待重试"))
        assertTrue(s.contains("连不上"))
    }

    @Test
    fun push_only_sends_the_ids_it_was_given() {
        store.save("n261101", "2026-11-01", "今天", "default", listOf("语文" to "1. 抄写"))
        store.save("n261102", "2026-11-02", "明天", "default", listOf("语文" to "2. 背诵"))
        engine.push(listOf("n261102"), from = "Pixel 8", stamp = "20261015-2300")

        val names = xyz.rth1.jinsuper811.InboxTarGz
            .unpackTarGz(transport.body("inbox/20261015-2300/hwk.tar.gz")).map { it.name }
        assertTrue(names.contains("hwk/hwk-n261102.json"))
        assertFalse("没点的那天不该被传", names.contains("hwk/hwk-n261101.json"))
        assertTrue("没传的那天还得留着脏标记", store.dirtyIds().contains("n261101"))
    }

    @Test
    fun push_uses_the_configured_inbox_branch() {
        store.save("n261101", "2026-11-01", "今天", "default", listOf("语文" to "1. 抄写"))
        engine.pushDirty(from = "Pixel 8", stamp = "20261015-2218")
        assertTrue("收件箱必须写到 inbox 分支",
            transport.puts.all { it.branch == "inbox" })
    }
}
