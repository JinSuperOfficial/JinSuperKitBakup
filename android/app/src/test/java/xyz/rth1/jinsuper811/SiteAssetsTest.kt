package xyz.rth1.jinsuper811

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SiteAssetsTest —— 本地内容的路由规则
 * ===========================================================
 * 这里最关键的一条是 **`.php` 一律回 404**：它不是「没实现」，
 * 而是阅读器回落逻辑**依赖**的行为 —— 阅读器先试 `p/raw.php`，
 * 404 之后才按设计退回直接取 `.md`；真把 PHP 源码发回去，
 * 页面会把源码当正文显示（桌面版踩过这个坑，见 project.md §4.8）。
 */
class SiteAssetsTest {

    @Test
    fun root_maps_to_index_html() {
        assertEquals("index.html", SiteAssets.resolve("/").rel)
        assertEquals("index.html", SiteAssets.resolve("/index.html").rel)
    }

    @Test
    fun directory_requests_get_index_html() {
        assertEquals("class/index.html", SiteAssets.resolve("/class/").rel)
        assertEquals("Skills/index.html", SiteAssets.resolve("/Skills/").rel)
    }

    @Test
    fun php_always_404() {
        val r = SiteAssets.resolve("/p/raw.php")
        assertTrue("`.php` 必须 404", r.notFound)
        assertEquals("p/raw.php", r.rel)

        assertTrue(SiteAssets.resolve("/Skills/tools/hw-api.php").notFound)
        assertTrue(SiteAssets.resolve("/RAW.PHP").notFound)   // 大小写也不认
        assertFalse("普通页面不该 404", SiteAssets.resolve("/class/homework.html").notFound)
    }

    @Test
    fun query_and_fragment_are_stripped() {
        assertEquals("class/data/hwk/index.json", SiteAssets.resolve("/class/data/hwk/index.json?v=2").rel)
        assertEquals("class/data/hwk/index.json", SiteAssets.resolve("/class/data/hwk/index.json#top").rel)
    }

    @Test
    fun traversal_is_rejected() {
        /* `..` 一律拒掉：这是虚拟 host，绝不能让页面读到站点根之外的东西 */
        assertTrue(SiteAssets.resolve("/../../etc/passwd").notFound)
        assertTrue(SiteAssets.resolve("/class/../../../x").notFound)
        assertEquals("", SiteAssets.toRelPath("/.."))
    }

    @Test
    fun dots_inside_a_segment_are_fine() {
        assertEquals("p/idea/1.归途且慢.md", SiteAssets.resolve("/p/idea/1.归途且慢.md").rel)
        assertEquals("asset/homework/bg_grid.jpg", SiteAssets.resolve("/asset/homework/bg_grid.jpg").rel)
    }

    @Test
    fun mime_covers_everything_the_offline_copy_contains() {
        assertEquals("text/html", SiteAssets.mimeOf("class/homework.html"))
        assertEquals("text/javascript", SiteAssets.mimeOf("lib/manifest.js"))
        assertEquals("text/css", SiteAssets.mimeOf("a.css"))
        assertEquals("application/json", SiteAssets.mimeOf("class/data/hwk/index.json"))
        assertEquals("image/svg+xml", SiteAssets.mimeOf("asset/icon/logo.svg"))
        assertEquals("image/jpeg", SiteAssets.mimeOf("asset/homework/bg_grid.jpg"))
        assertEquals("audio/mpeg", SiteAssets.mimeOf("class/data/english/U1/a.mp3"))
        assertEquals("text/plain", SiteAssets.mimeOf("robots.txt"))
        assertEquals("font/woff2", SiteAssets.mimeOf("p/fonts/x.woff2"))
        /* 认不出的类型一律 octet-stream（别猜、别当 HTML 解析 —— 那是 XSS 的口子） */
        assertEquals(SiteAssets.MIME_OCTET, SiteAssets.mimeOf("a.bin"))
        assertEquals(SiteAssets.MIME_OCTET, SiteAssets.mimeOf("noext"))
    }

    @Test
    fun only_media_needs_range() {
        assertTrue(SiteAssets.isMedia("audio/mpeg"))
        assertTrue(SiteAssets.isMedia("video/mp4"))
        assertFalse(SiteAssets.isMedia("text/html"))
        assertFalse(SiteAssets.isMedia("image/jpeg"))
        assertFalse(SiteAssets.isMedia(SiteAssets.MIME_OCTET))
    }

    @Test
    fun backslashes_are_normalized() {
        assertEquals("class/homework.html", SiteAssets.resolve("\\class\\homework.html").rel)
    }

    @Test
    fun empty_path_is_the_root_not_a_crash() {
        assertEquals("index.html", SiteAssets.resolve("").rel)
        assertEquals("index.html", SiteAssets.resolve(null).rel)
    }
}
