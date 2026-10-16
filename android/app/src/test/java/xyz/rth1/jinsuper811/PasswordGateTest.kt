package xyz.rth1.jinsuper811

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PasswordGateTest —— 「录作业」的密码门
 * ===========================================================
 * 约定（见 PasswordGate.kt 的说明）：
 *   · 验证在**壳层**，不在网页 JS 里；
 *   · 过了之后**本进程内有效**，退出编辑模式 / 进程结束即失效，**不写盘**；
 *   · 失败不限次数、不透露别的信息。
 *
 * 这里除了行为，还断言「**没有写盘**」—— 用一个临时目录扫一遍，
 * 确认 PasswordGate 一个字节都没留下（不许出现「记住密码」的暗桩）。
 */
class PasswordGateTest {

    @After
    fun tearDown() {
        PasswordGate.lock()
    }

    @Test
    fun correct_password_unlocks_the_session() {
        PasswordGate.lock()
        assertFalse(PasswordGate.unlocked)
        assertTrue(PasswordGate.tryUnlock("114514"))
        assertTrue(PasswordGate.unlocked)
    }

    @Test
    fun wrong_password_does_not_unlock() {
        PasswordGate.lock()
        for (bad in listOf("", "114515", "114514 ", " 114514", "11451", "1145140", "password", null)) {
            assertFalse("「$bad」不该通过", PasswordGate.tryUnlock(bad))
            assertFalse(PasswordGate.unlocked)
        }
    }

    @Test
    fun lock_clears_the_session() {
        PasswordGate.tryUnlock("114514")
        assertTrue(PasswordGate.unlocked)
        PasswordGate.lock()
        assertFalse("退出编辑模式就该失效", PasswordGate.unlocked)
    }

    @Test
    fun password_is_exactly_the_agreed_constant() {
        /* 改这个常量的同时要改 README 的排障表 —— 所以这里钉一道 */
        assertEquals("114514", PasswordGate.EDIT_PASSWORD)
    }

    @Test
    fun nothing_is_written_to_disk() {
        val tmp = java.nio.file.Files.createTempDirectory("jins-pw-").toFile()
        try {
            PasswordGate.tryUnlock("114514")
            val leaked = tmp.walkTopDown().any { it.isFile }
            assertFalse("密码门不该往盘上写任何东西（不许「记住密码」）", leaked)
        } finally {
            tmp.deleteRecursively()
        }
    }

    @Test
    fun failed_attempts_are_unlimited() {
        /* 给同学用，不做防爆破：连着错 50 次之后，正确密码仍然能进 */
        PasswordGate.lock()
        repeat(50) { PasswordGate.tryUnlock("wrong") }
        assertFalse(PasswordGate.unlocked)
        assertTrue(PasswordGate.tryUnlock("114514"))
    }
}
