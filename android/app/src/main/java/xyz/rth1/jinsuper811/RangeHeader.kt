package xyz.rth1.jinsuper811

/**
 * RangeHeader.kt —— HTTP Range 头的解析（**纯逻辑，零 Android 依赖**）
 * ===========================================================
 * 单拎出来是为了能测。听力页的 `<audio>` 拖进度条靠的就是这条 ——
 * 解析写错一位，表现是「能播但拖不动」或者「干脆不播」，
 * 在真机上极难查；放在纯逻辑里就能在 JVM 上一条条钉死。
 *
 * 支持三种写法（RFC 7233 里浏览器真正会发的那几种）：
 *
 *   `bytes=100-200`  闭区间，从 100 读到 200
 *   `bytes=100-`     从 100 到文件结尾
 *   `bytes=-500`     最后 500 字节（suffix range）
 *
 * 认得出来的返回已按文件大小夹好的闭区间；认不出 / 没有 / 越界返回 null
 * （调用方按 200 整份回，或者 416）。
 */
object RangeHeader {

    /** 解析结果：闭区间 [start, end] */
    data class Span(val start: Long, val end: Long) {
        val length: Long get() = end - start + 1
    }

    fun parse(header: String?, size: Long): Span? {
        val h = header?.trim() ?: return null
        if (size <= 0) return null
        if (!h.startsWith("bytes=")) return null

        /* 多段 Range（`bytes=0-99,200-299`）只取第一段：
           我们从不广告 multipart/byteranges，浏览器也不会对单文件发多段。 */
        val spec = h.removePrefix("bytes=").substringBefore(',').trim()
        if (spec.isEmpty()) return null

        val dash = spec.indexOf('-')
        if (dash < 0) return null
        val fromPart = spec.substring(0, dash).trim()
        val toPart = spec.substring(dash + 1).trim()

        return try {
            when {
                /* `bytes=-N`：最后 N 字节 */
                fromPart.isEmpty() && toPart.isNotEmpty() -> {
                    val last = toPart.toLong()
                    if (last <= 0) null
                    else {
                        val start = maxOf(0L, size - last)
                        Span(start, size - 1)
                    }
                }
                /* `bytes=N-` / `bytes=N-M` */
                fromPart.isNotEmpty() -> {
                    val start = fromPart.toLong()
                    if (start < 0 || start >= size) null      // 越界 → 调用方回 416
                    else {
                        val end = if (toPart.isEmpty()) size - 1 else toPart.toLong()
                        if (end < start) null
                        else Span(start, minOf(end, size - 1))
                    }
                }
                else -> null
            }
        } catch (e: NumberFormatException) {
            null
        }
    }

    /**
     * 给 `Content-Range` 用：`bytes 0-99/1024`
     *
     * 注意注释里别写「星号 + 斜杠」那两个字符 —— 它会**提前关掉这个注释块**，
     * 后面的代码就跑到注释外面去了（这里栽过一次，编译报的是
     * 「Expecting member declaration」，看不出跟注释有关）。
     */
    fun contentRange(span: Span, total: Long): String = "bytes ${span.start}-${span.end}/$total"

    /** 416 时要回的那条：`bytes 星号斜杠 1024`（同样的原因，这里不能写成那两个字面字符） */
    fun unsatisfiable(total: Long): String = "bytes */$total"
}
