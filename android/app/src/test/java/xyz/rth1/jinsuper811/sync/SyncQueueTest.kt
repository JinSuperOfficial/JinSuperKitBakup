package xyz.rth1.jinsuper811.sync

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * SyncQueueTest —— 断网时的上传队列
 * ===========================================================
 * H5：**只做前台一次性重试**。这一组盯住：
 *   · 失败进队列、成功出队列；
 *   · 部分成功只清掉成功的那几天（别把没成的也抹了）；
 *   · 队列**有上限**（别让手机被失败记录撑爆）；
 *   · 队列项里记的是 **id**，不是当年那份包 —— 重试时传的是最新版本。
 */
class SyncQueueTest {

    private lateinit var tmp: File
    private val tempDirs = mutableListOf<File>()

    @Before
    fun setUp() {
        tmp = Files.createTempDirectory("jins-queue-").toFile()
        tempDirs.add(tmp)
    }

    @After
    fun tearDown() {
        tempDirs.forEach { runCatching { it.deleteRecursively() } }
        tempDirs.clear()
    }

    private fun q() = SyncQueue(File(tmp, "queue"))

    @Test
    fun enqueue_then_clear_round_trip() {
        val q = q()
        assertTrue(q.pendingIds().isEmpty())
        assertEquals("没有待重试的", q.summary())

        q.enqueue(listOf("n261017", "n261101"), "20261015-2218", "连不上 Gitee")
        assertEquals(listOf("n261017", "n261101"), q.pendingIds())
        /* summary 里两个数字含义不同：`1 次` = 队列里有 1 条记录（一次失败），
           `2 天` = 这条记录欠着 2 天。别把「次」写成「天」。 */
        assertTrue("实际：" + q.summary(), q.summary().contains("1 次"))
        assertTrue("实际：" + q.summary(), q.summary().contains("2 天"))
        assertTrue(q.summary().contains("连不上 Gitee"))

        q.clear(listOf("n261017", "n261101"))
        assertTrue("清完就该空了", q.pendingIds().isEmpty())
        assertTrue("文件也该删掉", q.list().isEmpty())
    }

    @Test
    fun clear_keeps_the_days_that_did_not_succeed() {
        val q = q()
        q.enqueue(listOf("n261017", "n261101", "n261102"), "20261015-2218", "网络抖了")
        q.clear(listOf("n261017"))          // 只有这天传上去了

        assertEquals(listOf("n261101", "n261102"), q.pendingIds())
        assertEquals("记录还在（改了内容，不是删掉）", 1, q.list().size)
    }

    @Test
    fun pending_ids_dedupe_across_multiple_attempts() {
        val q = q()
        q.enqueue(listOf("n261017"), "20261015-2218", "第一次失败")
        q.enqueue(listOf("n261017", "n261101"), "20261015-2310", "第二次失败")
        assertEquals(listOf("n261017", "n261101"), q.pendingIds())
        assertEquals(2, q.list().size)
        assertTrue(q.summary().contains("2 次"))
    }

    @Test
    fun queue_has_an_upper_bound() {
        val q = q()
        for (i in 0 until SyncQueue.MAX_ITEMS + 10) {
            q.enqueue(listOf("n2610$i"), "20261015-${(2200 + i) % 2400}", "失败 $i")
        }
        assertTrue("队列不能无限长（实际 ${q.list().size}）", q.list().size <= SyncQueue.MAX_ITEMS)
    }

    @Test
    fun items_are_written_as_json_with_the_agreed_fields() {
        val q = q()
        val f = q.enqueue(listOf("n261017"), "20261015-2218", "超时")
        val text = f.readText(Charsets.UTF_8)
        assertTrue(text.contains("\"stamp\": \"20261015-2218\""))
        assertTrue(text.contains("\"ids\""))
        assertTrue(text.contains("\"error\": \"超时\""))
        assertTrue(text.contains("\"at\""))
    }

    @Test
    fun broken_queue_items_are_ignored_not_fatal() {
        val dir = File(tmp, "queue")
        dir.mkdirs()
        File(dir, "20261015-2200-1.json").writeText("{ this is not json")
        val q = SyncQueue(dir)
        assertTrue("坏文件不该让整个队列炸掉", q.pendingIds().isEmpty())
        q.enqueue(listOf("n261017"), "20261015-2218", "ok")
        assertEquals(listOf("n261017"), q.pendingIds())
    }

    @Test
    fun clearing_an_unknown_id_is_a_no_op() {
        val q = q()
        q.enqueue(listOf("n261017"), "20261015-2218", "x")
        q.clear(listOf("n261999"))
        assertEquals(listOf("n261017"), q.pendingIds())
        q.clear(emptyList())
        assertEquals(listOf("n261017"), q.pendingIds())
    }

    @Test
    fun queue_stores_ids_not_payloads() {
        /* 重试时要传**最新**那份，所以队列里只许有 id —— 不许塞包 / 不许塞正文 */
        val q = q()
        val f = q.enqueue(listOf("n261017"), "20261015-2218", "x")
        val text = f.readText(Charsets.UTF_8)
        assertFalse("队列项里不该出现作业正文", text.contains("背诵"))
        assertFalse("队列项里不该出现 base64 的包", text.length > 500)
    }
}
