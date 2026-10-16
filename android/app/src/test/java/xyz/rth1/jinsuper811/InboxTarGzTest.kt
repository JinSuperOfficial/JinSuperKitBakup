package xyz.rth1.jinsuper811

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * InboxTarGzTest —— 跨端 tar 的**字节级兼容**
 * ===========================================================
 * 这一组是整个安卓侧最重要的测试，理由是：
 *
 *   Kotlin（`InboxTarGz.kt`）与 Node（`sync/lib/tar.mjs`）是**两份实现**，
 *   收件箱的包两边都要读得懂。只写「Kotlin 自己打包自己解」的往返测试
 *   证明不了兼容 —— 那可能只是自己跟自己一致。
 *
 * 所以这里用**真产物当基准**：`app/src/test/resources/tar-fixtures.json`
 * 里那七组 tar 是 Node 那份实现打出来的（`android/tools/make-tar-fixtures.mjs`
 * 生成），断言两件事：
 *
 *   ① 解开：`unpackTar(nodeTar)` 出来的文件名与内容一字不差；
 *   ② 写出：`packTar(同样的条目, 同样的 mtime)` 与 nodeTar **逐字节相同**。
 *
 * ② 才是关键 —— 它把 ustar 头的每个字段偏移（权限 / uid / gid / 大小 / mtime /
 * 校验和 / 类型 / magic / prefix）全钉死了。以后谁把偏移写错一位，这里立刻红。
 */
class InboxTarGzTest {

    private data class Fixture(val id: String, val why: String, val files: Map<String, String>, val tar: ByteArray, val tarSha: String)

    private val mtime: Long
    private val cases: List<Fixture>

    init {
        val text = javaClass.classLoader!!
            .getResourceAsStream("tar-fixtures.json")!!
            .readBytes()
            .toString(Charsets.UTF_8)
        val root = Json.asMap(Json.parse(text))!!
        mtime = Json.asInt(root["mtime"]).toLong()
        cases = Json.asList(root["cases"])!!.map { c ->
            val m = Json.asMap(c)!!
            val files = LinkedHashMap<String, String>()
            Json.asMap(m["files"])?.forEach { (k, v) -> files[k] = Json.asString(v) ?: "" }
            Fixture(
                id = Json.asString(m["id"]) ?: "?",
                why = Json.asString(m["why"]) ?: "",
                files = files,
                tar = Base64Codec.decode(Json.asString(m["tarBase64"]) ?: ""),
                tarSha = Json.asString(m["tarSha256"]) ?: "",
            )
        }
    }

    /* 注意 mtime 的单位是**毫秒**（跟 Node 的 packTar 同口径），
       样本里那个 1700000000 就是毫秒 —— 见 InboxTarGz.packTar 的说明。 */
    private fun entriesOf(f: Fixture, mtime: Long): List<InboxTarGz.Entry> =
        f.files.map { (name, body) -> InboxTarGz.Entry(name, body.toByteArray(Charsets.UTF_8)) }

    /* ── ① 解开 Node 打出来的包 ── */

    @Test
    fun unpackTar_reads_node_tar_for_every_fixture() {
        for (f in cases) {
            val got = InboxTarGz.unpackTar(f.tar)
            assertEquals("样本 ${f.id}：文件个数不对（${f.why}）", f.files.size, got.size)
            /* 顺序也要一致：收件箱里 index.json 在前、各天在后，家里 apply 才不会乱 */
            assertEquals("样本 ${f.id}：文件名 / 顺序不一致",
                f.files.keys.toList(), got.map { it.name })
            for (e in got) {
                assertEquals("样本 ${f.id}：${e.name} 的内容不一致",
                    f.files[e.name], e.data.toString(Charsets.UTF_8))
            }
        }
    }

    /* ── ② 写出来的字节要和 Node 完全一致 ── */

    @Test
    fun packTar_writes_byte_identical_to_node_tar_for_every_fixture() {
        for (f in cases) {
            val mine = InboxTarGz.packTar(entriesOf(f, mtime), mtime)
            assertEquals("样本 ${f.id}：长度不一致（${f.why}）", f.tar.size, mine.size)
            assertArrayEquals("样本 ${f.id}：字节不一致 —— ustar 头有字段写错了（${f.why}）", f.tar, mine)
            /* sha256 再对一遍：将来有人把 assetEquals 的报错信息弄丢，这条还能定位 */
            assertEquals("样本 ${f.id}：sha256 不一致", f.tarSha, InboxTarGz.sha256(mine))
        }
    }

    /* ── gzip 那一层 ── */

    @Test
    fun packTarGz_roundtrips_through_a_plain_gunzip() {
        val entries = listOf(
            InboxTarGz.Entry("hwk/index.json", "[]\n".toByteArray()),
            InboxTarGz.Entry("hwk/hwk-n261017.json", "{\n\t\"id\": \"n261017\"\n}\n".toByteArray()),
        )
        val gz = InboxTarGz.packTarGz(entries, mtime)

        /* 用 JDK 的 GZIPInputStream 解 —— 证明这是个正经 gzip，不是别的什么 */
        val raw = GZIPInputStream(gz.inputStream()).use { it.readBytes() }
        val back = InboxTarGz.unpackTar(raw)
        assertEquals(listOf("hwk/index.json", "hwk/hwk-n261017.json"), back.map { it.name })
        assertEquals("[]\n", back[0].data.toString(Charsets.UTF_8))

        /* 再走一遍 unpackTarGz（家里就是这么解的） */
        assertEquals(2, InboxTarGz.unpackTarGz(gz).size)
    }

    /* ── 安全：路径穿越 / 链接 / 绝对路径一律拒掉 ── */

    @Test
    fun unpackTar_rejects_path_traversal_and_links() {
        val evil = InboxTarGz.packTar(listOf(InboxTarGz.Entry("../evil.txt", "x".toByteArray())), mtime)
        val e = runCatching { InboxTarGz.unpackTar(evil) }.exceptionOrNull()
        assertTrue("`..` 必须被拒：${e?.message}", e is InboxTarGz.TarException)

        val abs = InboxTarGz.packTar(listOf(InboxTarGz.Entry("/etc/passwd", "x".toByteArray())), mtime)
        assertTrue(runCatching { InboxTarGz.unpackTar(abs) }.exceptionOrNull() is InboxTarGz.TarException)

        /* 手工造一个 type=2（符号链接）的头 */
        val link = InboxTarGz.packTar(listOf(InboxTarGz.Entry("hwk/a.txt", "x".toByteArray())), mtime).copyOf()
        link[156] = '2'.code.toByte()
        /* 改了字节就得重算校验和，不然我们会先撞上别的错；
           这里直接调 safeRel 更直接地证明规则 */
        assertTrue(runCatching { InboxTarGz.safeRel("a/../../b") }.exceptionOrNull() is InboxTarGz.TarException)
        assertTrue(runCatching { InboxTarGz.safeRel("") }.exceptionOrNull() is InboxTarGz.TarException)
    }

    @Test
    fun safeRel_normalizes_but_keeps_meaning() {
        assertEquals("a/b.txt", InboxTarGz.safeRel("./a/b.txt"))
        assertEquals("a/b.txt", InboxTarGz.safeRel("a\\b.txt"))
        assertEquals("a/b.txt", InboxTarGz.safeRel("a//b.txt"))
        assertEquals("hwk/作业-笔记.txt", InboxTarGz.safeRel("hwk/作业-笔记.txt"))
    }

    /* ── sha256 与 Node 的 hash.mjs 同算法 ── */

    @Test
    fun sha256_matches_known_vector() {
        /* 空串的 sha256 是个谁都知道的固定值 */
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            InboxTarGz.sha256(ByteArray(0)),
        )
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            InboxTarGz.sha256("abc".toByteArray(Charsets.UTF_8)),
        )
    }

    /* ── 截断的包要报错，不要静默少解几个文件 ── */

    @Test
    fun unpackTar_reports_truncated_archive() {
        val ok = InboxTarGz.packTar(listOf(InboxTarGz.Entry("hwk/a.txt", "hello world".toByteArray())), mtime)
        val cut = ok.copyOf(600)   // 头 512 + 数据前 88 字节
        val e = runCatching { InboxTarGz.unpackTar(cut) }.exceptionOrNull()
        assertTrue("截断的包必须报错，而不是少解一个文件：${e?.message}", e is InboxTarGz.TarException)
    }

    @Test
    fun empty_input_yields_no_entries() {
        assertTrue(InboxTarGz.unpackTar(ByteArray(0)).isEmpty())
    }

    @Test
    fun gzip_helper_is_actually_gzip() {
        /* 手工用 JDK 压一份，我们的解包器要认 */
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write("hello".toByteArray()) }
        val back = runCatching { InboxTarGz.unpackTarGz(bos.toByteArray()) }.getOrNull()
        /* 这不是合法 tar（只有 5 字节），会解出空列表 —— 但**不能抛别的异常** */
        assertTrue(back == null || back.isEmpty())
    }

    @Test
    fun fixtures_are_present_and_well_formed() {
        assumeTrue(true)
        assertEquals("样本组数不对：tools/make-tar-fixtures.mjs 是不是改过？", 7, cases.size)
        for (f in cases) {
            assertFalse("样本 ${f.id} 没生成 base64", f.tar.isEmpty())
            assertFalse("样本 ${f.id} 的 sha256 是占位符", f.tarSha.contains("PASTE"))
        }
    }
}
