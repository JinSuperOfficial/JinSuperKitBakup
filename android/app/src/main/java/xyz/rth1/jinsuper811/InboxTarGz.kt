package xyz.rth1.jinsuper811

import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * InboxTarGz.kt —— 收件箱用的 tar / tar.gz 读写（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 这是 `sync/lib/tar.mjs` 的 Kotlin 侧实现，**必须逐字节兼容** —— 家里那条
 * `部署.cmd sync apply` 吃的是 Node 那份实现解出来的包，学校（安卓）传上去的
 * 包也由家里解。两边任一处格式不一致，就是「手机上录了作业，家里 apply 不开」。
 *
 * 为什么是 tar.gz 而不是 zip：
 *   Gitee 的 contents 接口一次请求写一个文件 —— 一批文件打成一个包 = 一次请求，
 *   不会被「文件数 × 限流」卡住；而且收件箱的规矩是「`_manifest.json` 最后写」，
 *   家里只认有清单的时间戳，传到一半断线不会产生「半个收件箱」。
 *
 * ★ ustar 头逐字段（偏移 / 长度 / 写法）**与 tar.mjs 的 makeHeader() 完全一致**：
 *
 *     偏移  长度  内容
 *        0   100  文件名（UTF-8，尾随 NUL）
 *      100     8  权限（八进制，7 位 + NUL）
 *      108     8  uid（0）
 *      116     8  gid（0）
 *      124    12  文件大小（八进制，11 位 + NUL）
 *      136    12  mtime 秒（八进制，11 位 + NUL）
 *      148     8  校验和：先填 8 个空格算，再写成 6 位八进制 + NUL + 空格
 *      156     1  类型标志（`0` = 普通文件）
 *      257     6  `ustar` + NUL
 *      263     2  `00`
 *      345   155  prefix（路径太长时的前半段，UTF-8）
 *
 * 换行 / 缩进无关，但**字段偏移错一位，家里就解不开** ——
 * `build/test-android.mjs` 会拿 Node 的 packTar 产物当固定样本喂给这里（见那边说明）。
 */
object InboxTarGz {

    const val BLOCK = 512

    /** 单个文件上限，与 tar.mjs 的 MAX_FILE 对齐（防手滑解出一个巨型包） */
    const val MAX_FILE = 256 * 1024 * 1024

    /** 一条 tar 条目 */
    data class Entry(val name: String, val data: ByteArray)

    class TarException(message: String) : RuntimeException(message)

    /* ═══════════════════════════════════════════════════
       打包
       ═══════════════════════════════════════════════════ */

    /**
     * @param entries 顺序会被保留（Node 那边也一样，所以两边产出的字节一致）
     * @param mtimeMillis 毫秒时间戳（**注意是毫秒，不是秒** —— Node 那边的
     *        `packTar` 直接 `Math.floor((e.mtime || Date.now()) / 1000)`，
     *        也就是「毫秒进、秒出」。传秒的话头里的 mtime 会差三个数量级，
     *        两边产出的字节就对不上了 —— 这里栽过一次，`InboxTarGzTest` 盯着）。
     */
    fun packTar(entries: List<Entry>, mtimeMillis: Long = System.currentTimeMillis()): ByteArray {
        val mtimeSeconds = mtimeMillis / 1000L
        val out = ByteArrayOutputStream()
        for (e in entries) {
            val (name, prefix) = splitName(e.name)
            out.write(makeHeader(name, prefix, e.data.size.toLong(), mtimeSeconds))
            out.write(e.data)
            val pad = (BLOCK - (e.data.size % BLOCK)) % BLOCK
            if (pad > 0) out.write(ByteArray(pad))
        }
        out.write(ByteArray(BLOCK * 2))   // 结束标记：两个全零块
        return out.toByteArray()
    }

    /** 与 [packTar] 同口径：`mtimeMillis` 是**毫秒** */
    fun packTarGz(entries: List<Entry>, mtimeMillis: Long = System.currentTimeMillis()): ByteArray {
        val raw = packTar(entries, mtimeMillis)
        val bos = ByteArrayOutputStream(raw.size / 2 + 1024)
        // 压缩级别只影响大小，不影响解压结果 —— 两边不要求字节一致
        GZIPOutputStream(bos).use { it.write(raw) }
        return bos.toByteArray()
    }

    /** 路径太长时按 ustar 的 prefix/name 两段切（与 tar.mjs 的 splitName 同规则） */
    private fun splitName(name: String): Pair<String, String> {
        val raw = name.replace('\\', '/').removePrefix("./")
        if (raw.toByteArray(Charsets.UTF_8).size <= 100) return raw to ""
        var i = raw.length - 1
        while (i > 0) {
            if (raw[i] == '/') {
                val head = raw.substring(0, i)
                val tail = raw.substring(i + 1)
                if (head.toByteArray(Charsets.UTF_8).size <= 155 && tail.toByteArray(Charsets.UTF_8).size <= 100) {
                    return tail to head
                }
            }
            i--
        }
        throw TarException("tar：路径太长了，放不进 ustar 头：$raw")
    }

    /** 八进制字段：N 位里前 N-1 位是八进制数字，最后一位是 NUL（与 tar.mjs 的 octal 完全同形） */
    private fun octal(value: Long, length: Int): ByteArray {
        val s = java.lang.Long.toOctalString(maxOf(0L, value))
        if (s.length > length - 1) throw TarException("tar：数字放不下（$value > ${length - 1} 位八进制）")
        val padded = s.padStart(length - 1, '0')
        val bytes = ByteArray(length)
        for (i in padded.indices) bytes[i] = padded[i].code.toByte()
        bytes[length - 1] = 0
        return bytes
    }

    /** 把七/十二位那种「数字 + NUL」的字段直接写进头（写 NUL 字节，不写 `\0` 两个字符） */
    private fun writeOctal(buf: ByteArray, at: Int, value: Long, len: Int) {
        val f = octal(value, len)
        System.arraycopy(f, 0, buf, at, len)
    }

    private fun makeHeader(name: String, prefix: String, size: Long, mtime: Long): ByteArray {
        val buf = ByteArray(BLOCK)
        put(buf, 0, name)
        writeOctal(buf, 100, 0x1A4 /* 0o644 = 420 */, 8)   // 权限
        writeOctal(buf, 108, 0, 8)                          // uid
        writeOctal(buf, 116, 0, 8)                          // gid
        writeOctal(buf, 124, size, 12)
        writeOctal(buf, 136, mtime, 12)
        put(buf, 148, "        ")                           // 校验和先填 8 个空格
        put(buf, 156, "0")                                  // 普通文件
        put(buf, 257, "ustar\u0000")
        put(buf, 263, "00")
        if (prefix.isNotEmpty()) put(buf, 345, prefix)

        /* 校验和 = 头 512 字节的**无符号**字节和，写成 6 位八进制 + NUL + 空格 */
        var sum = 0L
        for (b in buf) sum += (b.toInt() and 0xFF).toLong()
        val chk = java.lang.Long.toOctalString(sum).padStart(6, '0') + "\u0000 "
        put(buf, 148, chk)
        return buf
    }

    /** 把字符串按 UTF-8 写进 buf 的 at 处（不越界、不写终止符 —— 字段本来就靠 NUL 结尾） */
    private fun put(buf: ByteArray, at: Int, s: String) {
        val b = s.toByteArray(Charsets.UTF_8)
        System.arraycopy(b, 0, buf, at, minOf(b.size, buf.size - at))
    }

    /* ═══════════════════════════════════════════════════
       解包
       ═══════════════════════════════════════════════════ */

    fun unpackTarGz(buf: ByteArray): List<Entry> = unpackTar(gunzip(buf))

    private fun gunzip(buf: ByteArray): ByteArray {
        GZIPInputStream(buf.inputStream()).use { gz ->
            val out = ByteArrayOutputStream(maxOf(buf.size * 4, 8192))
            val chunk = ByteArray(64 * 1024)
            while (true) {
                val n = gz.read(chunk)
                if (n <= 0) break
                out.write(chunk, 0, n)
            }
            return out.toByteArray()
        }
    }

    /**
     * 解 tar，**只认普通文件**。
     *
     * 安全：绝对路径、`..`、软/硬链接一律拒掉 —— 收件箱内容来自另一台机器，
     * 不能让它往上级目录写东西（和 tar.mjs 的 safeRel 同一套规则）。
     */
    fun unpackTar(buf: ByteArray): List<Entry> {
        val out = mutableListOf<Entry>()
        var at = 0
        while (at + BLOCK <= buf.size) {
            /* 两种「结束」：真正的全零块，或者剩下的不够一个头（传了一半）。
               后者不是错误 —— tar 允许在最后补零，但**不能少数据块**（下面单独判）。 */
            if (buf.copyOfRange(at, at + BLOCK).all { it.toInt() == 0 }) break
            if (at + 2 * BLOCK > buf.size) throw TarException("tar：包在这里截断了（头部不完整）")

            val nameField = cstr(buf, at, 100)
            val prefix = cstr(buf, at + 345, 155)
            val size = parseOctal(buf, at + 124, 12)
            val type = (buf[at + 156].toInt() and 0xFF).toChar().toString()
            val full = if (prefix.isNotEmpty()) "$prefix/$nameField" else nameField
            at += BLOCK

            if (size > MAX_FILE) {
                throw TarException("tar：包里有个 ${size / 1048576}MB 的文件，超上限")
            }
            val end = (at + size).toInt()
            /* ★ 声明的大小超出实际剩余 = 包被截断。**必须报错**：
               静默少解一个文件，家里 apply 下去就是「一天作业少了一份」，
               而且没有任何线索说它少了。 */
            if (end > buf.size || size < 0) {
                throw TarException("tar：包在这里截断了（$full 声明 $size 字节，只剩 ${buf.size - at}）")
            }
            val data = buf.copyOfRange(at, end)
            val blocks = ((size + BLOCK - 1) / BLOCK).toInt()
            at += blocks * BLOCK

            if (type == "1" || type == "2") throw TarException("tar：不接受链接（$full）")
            if (type == "5") continue                       // 目录不用建，文件路径自带
            if (type != "0" && type != "\u0000" && type != "") continue   // pax 头等跳过
            out.add(Entry(safeRel(full), data))
        }
        return out
    }

    /** NUL 结尾的 UTF-8 字符串 */
    private fun cstr(buf: ByteArray, at: Int, len: Int): String {
        var end = at
        val stop = minOf(at + len, buf.size)
        while (end < stop && buf[end].toInt() != 0) end++
        return String(buf, at, end - at, Charsets.UTF_8)
    }

    private fun parseOctal(buf: ByteArray, at: Int, len: Int): Long {
        val s = cstr(buf, at, len).trim().trimEnd('\u0000').trim()
        if (s.isEmpty()) return 0
        return try {
            java.lang.Long.parseLong(s, 8)
        } catch (e: NumberFormatException) {
            0
        }
    }

    /** 路径安全：相对、无 `..`、无盘符、无控制字符（与 tar.mjs 的 safeRel 同规则） */
    fun safeRel(name: String?): String {
        val raw = (name ?: "").replace('\\', '/').trim()
        if (raw.isEmpty()) throw TarException("tar：空路径")
        if (raw.startsWith("/") || (raw.length >= 2 && raw[1] == ':' && raw[0].isLetter())) {
            throw TarException("tar：不接受绝对路径：$raw")
        }
        val out = mutableListOf<String>()
        for (seg in raw.split('/')) {
            if (seg.isEmpty() || seg == ".") continue
            if (seg == "..") throw TarException("tar：不接受上级目录：$raw")
            if (seg.any { it.code in 0..0x1f }) throw TarException("tar：路径里有控制字符：$raw")
            out.add(seg)
        }
        if (out.isEmpty()) throw TarException("tar：路径归一后是空的：$raw")
        return out.joinToString("/")
    }

    /* ═══════════════════════════════════════════════════
       sha256 —— 收件箱清单里要用（与 sync/lib/hash.mjs 同一个算法）
       ═══════════════════════════════════════════════════ */

    fun sha256(data: ByteArray): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        val d = md.digest(data)
        val sb = StringBuilder(d.size * 2)
        for (b in d) sb.append(String.format("%02x", b))
        return sb.toString()
    }
}
