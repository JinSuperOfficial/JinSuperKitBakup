package xyz.rth1.jinsuper811.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.rth1.jinsuper811.InboxTarGz
import xyz.rth1.jinsuper811.Json

/**
 * InboxTest —— 收件箱的**请求形状**
 * ===========================================================
 * 这一组才真正对应 `build/test-sync.mjs` 里那几条假 fetch 用例
 * （`pushInbox 走 Gitee 后端时写的是 tar.gz + 最后写 _manifest.json`）。
 *
 * 最要紧的一条：**`_manifest.json` 必须最后写**。
 * 家里只认有清单的时间戳 —— 先写清单、再传包，传到一半断线就会让家里
 * 把「半个收件箱」当成一份完整的，apply 下去就是一堆缺文件的作业。
 */
class InboxTest {

    private fun t() = FakeTransport()

    @Test
    fun pushInbox_writes_tar_gz_before_manifest() {
        val tr = t()
        Inbox.pushInbox(tr, "hwk", listOf(
            Inbox.Entry("hwk/hwk-n261017.json", "{\"id\":\"n261017\"}".toByteArray()),
        ), stamp = "20261015-2218", from = "Pixel 8")

        /* 两个文件都写上了 */
        assertTrue(tr.files.containsKey("inbox/20261015-2218/hwk.tar.gz"))
        assertTrue(tr.files.containsKey("inbox/20261015-2218/_manifest.json"))

        /* ★ 顺序：tar.gz 在前，清单在后 */
        val tarAt = tr.calls.indexOf("put:inbox/20261015-2218/hwk.tar.gz@inbox")
        val manAt = tr.calls.indexOf("put:inbox/20261015-2218/_manifest.json@inbox")
        assertTrue("两个 put 都该发生（tarAt=$tarAt manAt=$manAt）", tarAt >= 0 && manAt >= 0)
        assertTrue("★ _manifest.json 必须最后写（tarAt=$tarAt manAt=$manAt）", manAt > tarAt)
    }

    @Test
    fun manifest_carries_the_agreed_fields() {
        val tr = t()
        val body = "{\n\t\"id\": \"n261017\"\n}\n".toByteArray()
        Inbox.pushInbox(tr, "hwk", listOf(Inbox.Entry("hwk/hwk-n261017.json", body)),
            stamp = "20261015-2218", from = "Pixel 8")

        val m = Json.asMap(Json.parse(tr.body("inbox/20261015-2218/_manifest.json").toString(Charsets.UTF_8)))!!
        assertEquals(1, Json.asInt(m["v"]))
        assertEquals("20261015-2218", Json.asString(m["stamp"]))
        assertEquals("hwk", Json.asString(m["root"]))
        assertEquals("Pixel 8", Json.asString(m["from"]))
        assertTrue("createdAt 得是个 ISO 时间", (Json.asString(m["createdAt"]) ?: "").contains("T"))

        /* files[]：path / size / sha256，且按 path 排序（和 inbox.mjs 一样） */
        val files = Json.asList(m["files"])!!
        assertEquals(1, files.size)
        val f = Json.asMap(files[0])!!
        assertEquals("hwk/hwk-n261017.json", Json.asString(f["path"]))
        assertEquals(body.size, Json.asInt(f["size"]))
        assertEquals(InboxTarGz.sha256(body), Json.asString(f["sha256"]))

        /* pack：key / size / sha256 / parts */
        val pack = Json.asMap(m["pack"])!!
        assertEquals("inbox/20261015-2218/hwk.tar.gz", Json.asString(pack["key"]))
        assertEquals(tr.body("inbox/20261015-2218/hwk.tar.gz").size, Json.asInt(pack["size"]))
        assertEquals(InboxTarGz.sha256(tr.body("inbox/20261015-2218/hwk.tar.gz")), Json.asString(pack["sha256"]))
        assertTrue(Json.asInt(pack["parts"]) >= 1)
    }

    @Test
    fun tarball_is_a_real_tar_gz_that_the_node_side_can_open() {
        val tr = t()
        val a = "{\n\t\"id\": \"n261017\"\n}\n".toByteArray()
        val b = "[]\n".toByteArray()
        Inbox.pushInbox(tr, "hwk", listOf(
            Inbox.Entry("hwk/index.json", b),
            Inbox.Entry("hwk/hwk-n261017.json", a),
        ), stamp = "20261015-2218")

        val entries = InboxTarGz.unpackTarGz(tr.body("inbox/20261015-2218/hwk.tar.gz"))
        assertEquals(listOf("hwk/index.json", "hwk/hwk-n261017.json"), entries.map { it.name })
        assertEquals("[]\n", entries[0].data.toString(Charsets.UTF_8))
        assertEquals(a.size, entries[1].data.size)
    }

    @Test
    fun files_in_the_manifest_are_sorted_by_path() {
        val tr = t()
        Inbox.pushInbox(tr, "hwk", listOf(
            Inbox.Entry("hwk/zz.json", "z".toByteArray()),
            Inbox.Entry("hwk/aa.json", "a".toByteArray()),
        ), stamp = "20261015-2218")
        val m = Json.asMap(Json.parse(tr.body("inbox/20261015-2218/_manifest.json").toString(Charsets.UTF_8)))!!
        val paths = Json.asList(m["files"])!!.map { Json.asString(Json.asMap(it)!!["path"]) }
        assertEquals(listOf("hwk/aa.json", "hwk/zz.json"), paths)
    }

    @Test
    fun root_falls_back_to_misc_for_unknown_values() {
        val tr = t()
        val r = Inbox.pushInbox(tr, "nope", listOf(Inbox.Entry("x.txt", "x".toByteArray())), stamp = "20261015-2300")
        assertEquals("misc", r.root)
        assertTrue(tr.files.containsKey("inbox/20261015-2300/misc.tar.gz"))
    }

    @Test
    fun existing_key_is_overwritten_with_put_and_sha() {
        val tr = t()
        tr.seed("inbox/20261015-2218/hwk.tar.gz", ByteArray(10))
        Inbox.pushInbox(tr, "hwk", listOf(Inbox.Entry("hwk/a.json", "a".toByteArray())), stamp = "20261015-2218")
        /* 同一个时间戳再传一次（重试那条路）：已存在 → PUT 带 sha */
        assertEquals("PUT", tr.putOf("inbox/20261015-2218/hwk.tar.gz").method)
        assertNotNull(tr.putOf("inbox/20261015-2218/hwk.tar.gz").sha)
    }

    @Test
    fun new_key_is_posted_without_sha() {
        val tr = t()
        Inbox.pushInbox(tr, "hwk", listOf(Inbox.Entry("hwk/a.json", "a".toByteArray())), stamp = "20261015-2219")
        val p = tr.putOf("inbox/20261015-2219/hwk.tar.gz")
        assertEquals("POST", p.method)
        assertEquals(null, p.sha)
    }

    @Test
    fun empty_entry_list_is_rejected() {
        val tr = t()
        val e = runCatching { Inbox.pushInbox(tr, "hwk", emptyList(), stamp = "x") }.exceptionOrNull()
        assertTrue("空上传必须直接被拦：$e", e is IllegalArgumentException)
    }

    @Test
    fun listInbox_reports_incomplete_stamps() {
        val tr = t()
        /* 只有包、没有清单（模拟传到一半断线） */
        tr.seed("inbox/20261015-1000/hwk.tar.gz", ByteArray(4))
        /* 完整的一份 */
        Inbox.pushInbox(tr, "hwk", listOf(Inbox.Entry("hwk/a.json", "a".toByteArray())), stamp = "20261015-2218")

        val list = Inbox.listInbox(tr)
        val byStamp = list.associateBy { it.stamp }
        assertEquals(false, byStamp["20261015-1000"]!!.complete)
        assertTrue(byStamp["20261015-1000"]!!.reason.contains("_manifest.json"))
        assertEquals(true, byStamp["20261015-2218"]!!.complete)
        assertEquals(1, byStamp["20261015-2218"]!!.fileCount)
    }

    @Test
    fun pullInbox_verifies_sha_and_unpacks_under_the_root() {
        val tr = t()
        val body = "{\"id\":\"n261017\"}".toByteArray()
        Inbox.pushInbox(tr, "hwk", listOf(Inbox.Entry("hwk/hwk-n261017.json", body)), stamp = "20261015-2218")

        val tmp = java.nio.file.Files.createTempDirectory("jins-pull-").toFile()
        try {
            val got = Inbox.pullInbox(tr, tmp, "20261015-2218")
            assertEquals(1, got.size)
            val f = java.io.File(tmp, "20261015-2218/hwk/hwk-n261017.json")
            assertTrue(f.isFile)
            assertEquals(body.size, f.readBytes().size)
        } finally {
            tmp.deleteRecursively()
        }
    }

    @Test
    fun pullInbox_refuses_a_pack_whose_sha_does_not_match() {
        val tr = t()
        Inbox.pushInbox(tr, "hwk", listOf(Inbox.Entry("hwk/a.json", "a".toByteArray())), stamp = "20261015-2218")
        /* 包被改过（下载断了一半之类的场景） */
        tr.files["inbox/20261015-2218/hwk.tar.gz"] = InboxTarGz.packTarGz(listOf(InboxTarGz.Entry("hwk/a.json", "TAMPERED".toByteArray())), 1)

        val tmp = java.nio.file.Files.createTempDirectory("jins-pull-").toFile()
        try {
            val e = runCatching { Inbox.pullInbox(tr, tmp, "20261015-2218") }.exceptionOrNull()
            assertTrue("sha 不符必须报错：$e", e is TransportException)
            assertTrue("错误里要说清是哪一份", e!!.message!!.contains("20261015-2218"))
        } finally {
            tmp.deleteRecursively()
        }
    }

    @Test
    fun default_stamp_shape_is_sortable() {
        val s = Inbox.defaultStamp(java.util.Date(1700000000000L))
        assertTrue("时间戳要能按字典序排（家里就是这么排的）：$s", s.matches(Regex("^\\d{8}-\\d{4}$")))
    }
}
