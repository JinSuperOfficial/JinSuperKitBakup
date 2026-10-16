package xyz.rth1.jinsuper811

/**
 * Base64Codec.kt —— 最小的 Base64 编解码（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 为什么不用 `android.util.Base64`：它在 JVM 单元测试里是 **stub**（方法直接抛
 * `RuntimeException("Stub!")`），一旦用它，Gitee 写路径的请求体就永远没法在
 * `./gradlew test` 里被断言 —— 而那条路径正是当年「学校上传失败」的地方
 * （见 project.md §15.2 的第一条教训）。
 *
 * 用自己写的这一份，`FakeTransport` 的用例就能直接把 body 解出来比对。
 */
object Base64Codec {

    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    /** 标准 Base64（带 `=` 补齐，**不换行** —— 与 Node 的 `buf.toString('base64')` 同形） */
    fun encode(data: ByteArray): String {
        val sb = StringBuilder(((data.size + 2) / 3) * 4)
        var i = 0
        while (i + 2 < data.size) {
            val n = ((data[i].toInt() and 0xFF) shl 16) or
                ((data[i + 1].toInt() and 0xFF) shl 8) or
                (data[i + 2].toInt() and 0xFF)
            sb.append(ALPHABET[(n ushr 18) and 0x3F])
            sb.append(ALPHABET[(n ushr 12) and 0x3F])
            sb.append(ALPHABET[(n ushr 6) and 0x3F])
            sb.append(ALPHABET[n and 0x3F])
            i += 3
        }
        when (data.size - i) {
            1 -> {
                val n = (data[i].toInt() and 0xFF) shl 16
                sb.append(ALPHABET[(n ushr 18) and 0x3F])
                sb.append(ALPHABET[(n ushr 12) and 0x3F])
                sb.append("==")
            }
            2 -> {
                val n = ((data[i].toInt() and 0xFF) shl 16) or ((data[i + 1].toInt() and 0xFF) shl 8)
                sb.append(ALPHABET[(n ushr 18) and 0x3F])
                sb.append(ALPHABET[(n ushr 12) and 0x3F])
                sb.append(ALPHABET[(n ushr 6) and 0x3F])
                sb.append('=')
            }
        }
        return sb.toString()
    }

    /** 解 Base64；非法字符直接跳过，长度不整就抛 */
    fun decode(text: String): ByteArray {
        val clean = text.filter { !it.isWhitespace() }
        val out = java.io.ByteArrayOutputStream()
        var buf = 0
        var bits = 0
        for (c in clean) {
            if (c == '=') break
            val v = ALPHABET.indexOf(c)
            if (v < 0) continue
            buf = (buf shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buf ushr bits) and 0xFF)
            }
        }
        return out.toByteArray()
    }
}
