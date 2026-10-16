package xyz.rth1.jinsuper811.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Theme.kt —— 壳层的配色与圆角（**和站点 CSS 完全隔离**）
 * ===========================================================
 * AGENTS.md 那条「改站点样式不用管桌面版」在这里同样成立：
 * 壳层的颜色、圆角、字号都只活在这个文件里，不进站点页面、不注入任何样式。
 *
 * 两点对齐站点：
 *   · 颜色取自站点暗色 / 浅色那一套的基色（暖纸 + 陶土橘 + 橄榄），
 *     这样从网页切到壳层面板时不会像换了个 App；
 *   · **圆角按 theme-plus 规范**：窗口 / 主面板最多 12dp，按钮 8dp，标签 6dp，
 *     只有状态点用胶囊。不要出现 rounded-2xl 那种大圆角。
 *
 * 明暗跟随系统（站点也是 prefers-color-scheme），不硬钉暗色。
 */

/* ── 浅色（站点浅色一侧的基色） ── */
private val LightBg = Color(0xFFF8F3EC)
private val LightPaper = Color(0xFFFFFCF7)
private val LightInk = Color(0xFF2E2A26)
private val LightInkSoft = Color(0xFF6B635A)
private val LightAccent = Color(0xFFB0552F)
private val LightOlive = Color(0xFF8E9867)
private val LightLine = Color(0x1F2E2A26)

/* ── 暗色（站点暗色一侧的基色） ── */
private val DarkBg = Color(0xFF14120E)
private val DarkPaper = Color(0xFF1E1B17)
private val DarkInk = Color(0xFFEDE7DF)
private val DarkInkSoft = Color(0xFFA29A8E)
private val DarkAccent = Color(0xFFC9683D)
private val DarkOlive = Color(0xFFA8B57C)
private val DarkLine = Color(0x24EDE7DF)

/* ── 角半径：按 theme-plus 规范分层 ──
   xs 4 / sm 6 / md 8 / lg 10 / xl 12 / pill 999
   窗口与弹窗用 xl，卡片与浮层用 lg，按钮与输入框用 md，标签用 sm。 */
object Radii {
    const val xs = 4
    const val sm = 6
    const val md = 8
    const val lg = 10
    const val xl = 12
    const val pill = 999
}

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) {
        darkColorScheme(
            primary = DarkAccent,
            onPrimary = Color(0xFFFFFCF7),
            secondary = DarkOlive,
            background = DarkBg,
            onBackground = DarkInk,
            surface = DarkPaper,
            onSurface = DarkInk,
            surfaceVariant = Color(0xFF262218),
            onSurfaceVariant = DarkInkSoft,
            outline = DarkLine,
            error = Color(0xFFE88B6D),
            onError = Color(0xFF2E1208),
        )
    } else {
        lightColorScheme(
            primary = LightAccent,
            onPrimary = Color(0xFFFFFCF7),
            secondary = LightOlive,
            background = LightBg,
            onBackground = LightInk,
            surface = LightPaper,
            onSurface = LightInk,
            surfaceVariant = Color(0xFFF1EAE0),
            onSurfaceVariant = LightInkSoft,
            outline = LightLine,
            error = Color(0xFFB3261E),
            onError = Color(0xFFFFFFFF),
        )
    }

    MaterialTheme(
        colorScheme = scheme,
        typography = appTypography(),
        content = content,
    )
}

/**
 * 字号。正文 16sp 起（和站点那条「正文 >= 16px」一个口径）——
 * 手机上比这个小会显得很挤，也更容易被系统放大。
 */
private fun appTypography() = Typography().let { base ->
    base.copy(
        titleLarge = base.titleLarge.copy(fontSize = 20.sp, fontWeight = FontWeight.Medium),
        titleMedium = base.titleMedium.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium),
        bodyLarge = base.bodyLarge.copy(fontSize = 16.sp),
        bodyMedium = base.bodyMedium.copy(fontSize = 14.5.sp),
        labelLarge = base.labelLarge.copy(fontSize = 14.5.sp),
    )
}
