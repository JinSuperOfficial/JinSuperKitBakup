package xyz.rth1.jinsuper811

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * OriginsTest —— 来源表与回落链
 * ===========================================================
 * 这一组是 `desktop/test/origins.test.cjs` 的安卓侧对位。
 * 两边是**两份实现**（JS 一份、Kotlin 一份），所以除了这里的行为断言，
 * `build/test-android.mjs` 还会把两份代码里的来源 id / host / 顺序逐条比对 ——
 * 光靠行为测试盖不住「两边表不一样」这种事。
 */
class OriginsTest {

    @Test
    fun origin_table_matches_the_desktop_one() {
        assertEquals(listOf("cn", "rth", "gh", "local"), Origins.ALL.map { it.id })
        assertEquals("www.jinsuper.cn", Origins.ALL.first { it.id == "cn" }.host)
        assertEquals("jinsuper.rth1.xyz", Origins.ALL.first { it.id == "rth" }.host)
        assertEquals("jinsuperofficial.github.io", Origins.ALL.first { it.id == "gh" }.host)
        assertEquals("cn", Origins.DEFAULT_ORIGIN)
    }

    @Test
    fun local_origin_is_the_fixed_virtual_host() {
        /* ★ 这一条是整个安卓侧最容易出错的约定：
           域名必须固定，不能带随机端口 —— 否则 localStorage 的 origin 每次都变，
           同学勾过的作业会全部消失。 */
        assertEquals("appassets.androidplatform.net", Origins.LOCAL_HOST)
        assertEquals("https://appassets.androidplatform.net", Origins.LOCAL_BASE)
        assertFalse("本地 origin 里不许出现端口", Origins.LOCAL_BASE.contains(":").let {
            // "https:" 里本来就有冒号，所以只查 host 部分
            Origins.LOCAL_HOST.contains(":")
        })
        assertFalse(Origins.LOCAL_HOST.contains("127.0.0.1"))
        assertFalse(Origins.LOCAL_HOST.contains("localhost"))
    }

    @Test
    fun default_chain_is_cn_rth_gh_local() {
        assertEquals(listOf("cn", "rth", "gh", "local"), Origins.buildChain())
    }

    @Test
    fun chain_starts_from_the_selected_origin() {
        assertEquals(listOf("rth", "cn", "gh", "local"), Origins.buildChain(originId = "rth"))
        assertEquals(listOf("gh", "cn", "rth", "local"), Origins.buildChain(originId = "gh"))
    }

    @Test
    fun choosing_local_stays_local() {
        /* 明确选了「内置离线副本」就别再跳回云端 —— 用户要的就是不联网 */
        assertEquals(listOf("local"), Origins.buildChain(originId = "local"))
        assertEquals(listOf("local"), Origins.buildChain(originId = "cn", startId = "local"))
    }

    @Test
    fun fallbacks_can_be_turned_off() {
        assertEquals(listOf("cn"), Origins.buildChain(autoFallback = false, offlineFallback = false))
        assertEquals(listOf("cn", "rth", "gh"), Origins.buildChain(autoFallback = true, offlineFallback = false))
        assertEquals(listOf("cn", "local"), Origins.buildChain(autoFallback = false, offlineFallback = true))
    }

    @Test
    fun unknown_start_id_falls_back_to_configured_origin() {
        assertEquals(listOf("cn", "rth", "gh", "local"), Origins.buildChain(originId = "cn", startId = "nope"))
    }

    @Test
    fun get_falls_back_to_the_default_origin() {
        assertEquals("cn", Origins.get("nope").id)
        assertEquals("cn", Origins.get(null).id)
        assertEquals("gh", Origins.get("gh").id)
    }

    @Test
    fun url_of_local_is_the_virtual_base() {
        assertEquals("https://www.jinsuper.cn", Origins.urlOf("cn"))
        assertEquals(Origins.LOCAL_BASE, Origins.urlOf("local"))
    }

    @Test
    fun match_origin_recognizes_every_host() {
        assertEquals("cn", Origins.matchOrigin("https://www.jinsuper.cn/class/homework.html"))
        assertEquals("rth", Origins.matchOrigin("https://jinsuper.rth1.xyz/"))
        assertEquals("gh", Origins.matchOrigin("https://jinsuperofficial.github.io/p/"))
        assertEquals("local", Origins.matchOrigin("https://appassets.androidplatform.net/class/index.html"))
        assertEquals("local", Origins.matchOrigin("http://127.0.0.1:8080/x"))
        assertEquals("local", Origins.matchOrigin("http://localhost/x"))
        assertNull(Origins.matchOrigin("https://example.com/"))
        assertNull(Origins.matchOrigin("about:blank"))
        assertNull(Origins.matchOrigin(""))
        assertNull(Origins.matchOrigin(null))
    }

    @Test
    fun match_origin_handles_ports_and_userinfo_without_java_net() {
        assertEquals("cn", Origins.matchOrigin("https://www.jinsuper.cn:8443/x"))
        assertEquals("cn", Origins.matchOrigin("https://user:pw@www.jinsuper.cn/x"))
    }

    @Test
    fun is_cloud_is_false_only_for_local() {
        assertTrue(Origins.isCloud("cn"))
        assertTrue(Origins.isCloud("rth"))
        assertTrue(Origins.isCloud("gh"))
        assertFalse(Origins.isCloud("local"))
    }

    @Test
    fun nav_entries_point_at_real_site_paths() {
        assertEquals(listOf("home", "class", "homework"), Origins.NAV.map { it.id })
        assertTrue(Origins.NAV.all { it.path.startsWith("/") })
        assertEquals("/class/homework.html", Origins.NAV.first { it.id == "homework" }.path)
    }
}
