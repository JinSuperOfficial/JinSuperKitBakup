package xyz.rth1.jinsuper811

/**
 * Json.kt —— 极小的 JSON 读写（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 为什么自己写、不用 `org.json`：
 *
 *   1. **键序要可控**。作业记录写回文件时必须保持「id / date / title / bg / 各科 / 笔记」，
 *      `JSONObject` 内部是 HashMap —— 键序会乱，家里 `git diff` 每次都像改了一大片。
 *      这里用 `LinkedHashMap`，插入顺序就是输出顺序。
 *   2. **格式要逐字节对齐**。`sync/lib/hwk-schema.mjs` 的 `dumpJson` 是
 *      `JSON.stringify(data, null, '\t') + '\n'` —— 制表符缩进 + 结尾一个换行。
 *      这里照着实现一模一样的一份。
 *   3. **能在 JVM 单测里直接跑**。Android 自带的 `org.json` 在单元测试里是
 *      stub（方法都抛异常），碰它就等于这段逻辑永远测不了。
 *
 * 只实现 JSON 该有的那点东西（对象 / 数组 / 字符串 / 数字 / 布尔 / null），
 * 够用来读写 `hwk-<id>.json` 与 `_manifest.json` 这类小文件。
 * **不做**流式解析、不做注释、不做宽松语法（`parseLoose` 那种多余逗号容错是控制台的事，
 * 安卓这边只读自己写出来的文件，不需要）。
 */
object Json {

    /** 数字保留原文（`1.50` 不会被改写成 `1.5` —— 少一次没必要的 diff） */
    data class Num(val raw: String)

    class JsonException(message: String) : RuntimeException(message)

    /* ═══════════════ 解析 ═══════════════ */

    fun parse(text: String): Any? = Parser(text).let { p ->
        p.skipWs()
        val v = p.value()
        p.skipWs()
        if (!p.eof()) throw JsonException("JSON 尾部还有多余内容（位置 ${p.pos}）")
        v
    }

    private class Parser(val s: String) {
        var pos = 0
        fun eof() = pos >= s.length
        fun peek(): Char = if (eof()) '\u0000' else s[pos]
        fun skipWs() {
            while (!eof() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\n' || s[pos] == '\r')) pos++
        }
        fun expect(c: Char) {
            if (eof() || s[pos] != c) throw JsonException("JSON 期望 '$c'（位置 $pos 附近）")
            pos++
        }

        fun value(): Any? {
            skipWs()
            if (eof()) throw JsonException("JSON 是空的")
            return when (peek()) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> num()
            }
        }

        fun obj(): LinkedHashMap<String, Any?> {
            expect('{')
            val m = LinkedHashMap<String, Any?>()
            skipWs()
            if (peek() == '}') { pos++; return m }
            while (true) {
                skipWs()
                val k = str()
                skipWs()
                expect(':')
                m[k] = value()
                skipWs()
                when (peek()) {
                    ',' -> { pos++; continue }
                    '}' -> { pos++; return m }
                    else -> throw JsonException("JSON 对象里期望 ',' 或 '}'（位置 $pos 附近）")
                }
            }
        }

        fun arr(): MutableList<Any?> {
            expect('[')
            val l = mutableListOf<Any?>()
            skipWs()
            if (peek() == ']') { pos++; return l }
            while (true) {
                l.add(value())
                skipWs()
                when (peek()) {
                    ',' -> { pos++; continue }
                    ']' -> { pos++; return l }
                    else -> throw JsonException("JSON 数组里期望 ',' 或 ']'（位置 $pos 附近）")
                }
            }
        }

        fun str(): String {
            expect('"')
            val sb = StringBuilder()
            while (true) {
                if (eof()) throw JsonException("JSON 字符串没闭合")
                when (val c = s[pos++]) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        if (eof()) throw JsonException("JSON 转义没写完")
                        when (val e = s[pos++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (pos + 4 > s.length) throw JsonException("JSON \\u 转义不完整")
                                val hex = s.substring(pos, pos + 4)
                                pos += 4
                                sb.append(hex.toInt(16).toChar())
                            }
                            else -> throw JsonException("JSON 不认得转义 \\$e")
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }

        fun num(): Num {
            val start = pos
            if (peek() == '-') pos++
            while (!eof() && (s[pos].isDigit() || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' || s[pos] == '+' || s[pos] == '-')) pos++
            if (pos == start) throw JsonException("JSON 里有认不出的字符 '${peek()}'（位置 $pos）")
            return Num(s.substring(start, pos))
        }

        fun <T> lit(word: String, v: T): T {
            if (!s.startsWith(word, pos)) throw JsonException("JSON 里期望 $word（位置 $pos）")
            pos += word.length
            return v
        }
    }

    /* ═══════════════ 生成 ═══════════════ */

    /** `JSON.stringify(data, null, '\t')` 的等价物（**不带**结尾换行） */
    fun stringify(v: Any?): String {
        val sb = StringBuilder()
        write(sb, v, 0)
        return sb.toString()
    }

    /** `dumpJson` 的等价物：制表符缩进 + 结尾一个换行（写文件用这个） */
    fun dump(v: Any?): String = stringify(v) + "\n"

    private fun write(sb: StringBuilder, v: Any?, depth: Int) {
        when (v) {
            null -> sb.append("null")
            is Num -> sb.append(v.raw)
            is Boolean -> sb.append(if (v) "true" else "false")
            is String -> writeString(sb, v)
            is Number -> sb.append(v.toString())
            is Map<*, *> -> writeObject(sb, v, depth)
            is List<*> -> writeArray(sb, v, depth)
            else -> writeString(sb, v.toString())
        }
    }

    private fun writeObject(sb: StringBuilder, m: Map<*, *>, depth: Int) {
        if (m.isEmpty()) { sb.append("{}"); return }
        sb.append('{')
        var first = true
        for ((k, v) in m) {
            if (!first) sb.append(',')
            first = false
            sb.append('\n')
            indent(sb, depth + 1)
            writeString(sb, k.toString())
            sb.append(": ")
            write(sb, v, depth + 1)
        }
        sb.append('\n')
        indent(sb, depth)
        sb.append('}')
    }

    private fun writeArray(sb: StringBuilder, l: List<*>, depth: Int) {
        if (l.isEmpty()) { sb.append("[]"); return }
        sb.append('[')
        var first = true
        for (v in l) {
            if (!first) sb.append(',')
            first = false
            sb.append('\n')
            indent(sb, depth + 1)
            write(sb, v, depth + 1)
        }
        sb.append('\n')
        indent(sb, depth)
        sb.append(']')
    }

    private fun indent(sb: StringBuilder, depth: Int) {
        for (i in 0 until depth) sb.append('\t')
    }

    private fun writeString(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c.code < 0x20) {
                    sb.append("\\u").append(String.format("%04x", c.code))
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
    }

    /* ═══════════════ 便利取值 ═══════════════ */

    @Suppress("UNCHECKED_CAST")
    fun asMap(v: Any?): LinkedHashMap<String, Any?>? = v as? LinkedHashMap<String, Any?>

    fun asList(v: Any?): List<Any?>? = v as? List<Any?>

    fun asString(v: Any?): String? = when (v) {
        null -> null
        is String -> v
        is Num -> v.raw
        else -> v.toString()
    }

    /** 数字字段：按 Int 取，取不到给默认值 */
    fun asInt(v: Any?, dflt: Int = 0): Int = when (v) {
        null -> dflt
        is Num -> v.raw.toDoubleOrNull()?.toInt() ?: dflt
        is Number -> v.toInt()
        is String -> v.toDoubleOrNull()?.toInt() ?: dflt
        else -> dflt
    }
}
