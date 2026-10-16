package xyz.rth1.jinsuper811

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JsonTest —— 自己那份 JSON 读写
 * ===========================================================
 * 为什么值得单测：作业记录写回文件的**键序与缩进**靠它保证 ——
 * 和 `sync/lib/hwk-schema.mjs` 的 `dumpJson`（`JSON.stringify(…, null, '\t') + '\n'`）
 * 必须一致，否则家里每拉一次都是一大片没意义的 diff。
 */
class JsonTest {

    @Test
    fun dump_uses_tabs_and_a_trailing_newline() {
        val m = LinkedHashMap<String, Any?>()
        m["id"] = "n261017"
        m["bg"] = linkedMapOf<String, Any?>("value" to "default")
        m["语文"] = "1. 抄写\n2. 背诵"

        val text = Json.dump(m)
        assertEquals(
            "{\n\t\"id\": \"n261017\",\n\t\"bg\": {\n\t\t\"value\": \"default\"\n\t},\n\t\"语文\": \"1. 抄写\\n2. 背诵\"\n}\n",
            text,
        )
        assertTrue("结尾必须只有一个换行", text.endsWith("}\n"))
    }

    @Test
    fun empty_containers_are_compact() {
        assertEquals("{}\n", Json.dump(LinkedHashMap<String, Any?>()))
        assertEquals("[]\n", Json.dump(emptyList<Any>()))
    }

    @Test
    fun key_order_is_preserved() {
        val m = LinkedHashMap<String, Any?>()
        m["z"] = 1
        m["a"] = 2
        m["m"] = 3
        val keys = Regex("\"(z|a|m)\"\\s*:").findAll(Json.stringify(m)).map { it.groupValues[1] }.toList()
        assertEquals(listOf("z", "a", "m"), keys)
    }

    @Test
    fun parse_handles_the_real_record_shape() {
        val text = javaClass.classLoader!!.getResourceAsStream("hwk-baseline/hwk-n261017.json")!!
            .readBytes().toString(Charsets.UTF_8)
        val m = Json.asMap(Json.parse(text))!!
        assertEquals("n261017", Json.asString(m["id"]))
        assertEquals("作业-n20261017", Json.asString(m["title"]))
        assertEquals("default", Json.asString(Json.asMap(m["bg"])!!["value"]))
        assertTrue(m.containsKey("笔记"))
        assertTrue(Json.asString(m["笔记"])!!.contains("素质教育"))
    }

    @Test
    fun parse_handles_arrays_and_nested_objects() {
        val m = Json.asMap(Json.parse("""{"a":[1,{"b":true},null,"s"],"c":{}}"""))!!
        val a = Json.asList(m["a"])!!
        assertEquals(4, a.size)
        assertEquals("1", (a[0] as Json.Num).raw)
        assertEquals(true, Json.asMap(a[1])!!["b"])
        assertNull(a[2])
        assertEquals("s", a[3])
        assertTrue(Json.asMap(m["c"])!!.isEmpty())
    }

    @Test
    fun parse_handles_escapes_including_unicode() {
        val m = Json.asMap(Json.parse("""{"s":"a\"b\\c\nd\te\u4e2d"}"""))!!
        assertEquals("a\"b\\c\nd\te中", Json.asString(m["s"]))
    }

    @Test
    fun numbers_keep_their_literal_form() {
        /* 1.50 不该被改写成 1.5 —— 少一次没必要的 diff */
        val m = Json.asMap(Json.parse("""{"v":1.50,"i":-3,"e":1e3}"""))!!
        assertEquals("1.50", (m["v"] as Json.Num).raw)
        assertTrue("写回去还得是 1.50", Json.stringify(linkedMapOf<String, Any?>("v" to m["v"])).contains("1.50"))
        assertEquals(-3, Json.asInt(m["i"]))
        assertEquals(1000, Json.asInt(m["e"]))
    }

    @Test
    fun bad_json_throws_instead_of_returning_garbage() {
        for (bad in listOf("", "{", "{\"a\":}", "[1,", "nope", "{\"a\" 1}")) {
            val e = runCatching { Json.parse(bad) }.exceptionOrNull()
            assertTrue("「$bad」应该抛 JsonException，实际：$e", e is Json.JsonException)
        }
    }

    @Test
    fun trailing_content_is_rejected() {
        assertTrue(runCatching { Json.parse("{} {}") }.exceptionOrNull() is Json.JsonException)
    }

    @Test
    fun control_chars_are_escaped_on_write() {
        val text = Json.stringify(linkedMapOf<String, Any?>("k" to "a\u0001b"))
        assertTrue("控制字符必须转义：$text", text.contains("\\u0001"))
    }

    @Test
    fun roundtrip_is_stable() {
        val text = javaClass.classLoader!!.getResourceAsStream("hwk-baseline/hwk-n261010.json")!!
            .readBytes().toString(Charsets.UTF_8)
        val once = Json.dump(Json.parse(text))
        val twice = Json.dump(Json.parse(once))
        assertEquals("解析→输出→再解析→再输出 必须稳定", once, twice)
    }
}
