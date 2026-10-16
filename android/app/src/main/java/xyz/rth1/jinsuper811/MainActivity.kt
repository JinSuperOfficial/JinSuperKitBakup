package xyz.rth1.jinsuper811

import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import xyz.rth1.jinsuper811.ui.AppTheme
import xyz.rth1.jinsuper811.ui.EditorWebScreen
import xyz.rth1.jinsuper811.ui.PasswordGateScreen
import xyz.rth1.jinsuper811.ui.SiteWebScreen
import xyz.rth1.jinsuper811.ui.SyncSettingsScreen

/**
 * MainActivity.kt —— 唯一的 Activity，三种模式都从这儿分流
 * ===========================================================
 * 「一个 APK + 三个 activity-alias」，对齐桌面版的「同一个 exe + 一个参数」：
 *
 *   .ViewAlias  mode=view  811 看作业（默认、桌面主图标）
 *   .EditAlias  mode=edit  811 录作业（进去先验密码）
 *   .SyncAlias  mode=sync  811 设置与同步
 *
 * ★ mode 为什么不读 intent extra：
 *   从桌面图标启动**没有** extra —— 用户只是点了图标，没人给他塞参数。
 *   所以每个 alias 用 `<meta-data android:name="jsd.mode">` 声明自己的模式，
 *   这里用 `componentName` 反查自己的 alias，再读那条 meta-data。
 *   用 extra 的话「点图标」这条路永远是 view，edit 那个图标就废了。
 *
 * ★ 密码门必须在**壳层**：
 *   验证未过就进不了编辑那一屏，不存在「绕过」的入口 —— 网页 JS 里的密码
 *   F12 就能看到，所以密码不能写在页面里（见 PasswordGate.kt）。
 */
class MainActivity : ComponentActivity() {

    /** 三种模式。取值与 AndroidManifest 里 activity-alias 的 jsd.mode 一一对应。 */
    enum class Mode(val id: String) {
        VIEW("view"),
        EDIT("edit"),
        SYNC("sync");

        companion object {
            fun of(id: String?): Mode = entries.firstOrNull { it.id == id } ?: VIEW
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mode = readMode()
        val services = AppServices(application)

        /* 编辑模式：先过密码门。没过就只显示这道门，进不去编辑界面。
           注意 onCancel 是**回桌面**（不是 finish 就走 —— 从「看作业」跳过来的话
           finish() 正好回到看作业那一屏，两种来路都对）。 */
        if (mode == Mode.EDIT && !PasswordGate.unlocked) {
            setContent {
                AppTheme {
                    PasswordGateScreen(
                        onPass = { setContent { render(services, Mode.EDIT) { finish() } } },
                        onCancel = { finish() },
                    )
                }
            }
            return
        }

        setContent { render(services, mode) { finish() } }
    }

    /**
     * 从自己的 activity-alias 上读出模式。
     * 拿不到（比如直接从别处 `startActivity` 起 MainActivity）就按 VIEW 处理 ——
     * 「看作业」是零风险的默认模式，别默认成编辑。
     *
     * 另外认两种情况：**壳层自己拉起别的模式**时会带对应的 action
     * （顶栏「设置」走 `ACTION_OPEN_SYNC`、「录作业」走 `ACTION_OPEN_EDIT`）——
     * 这时不看 alias 的 meta-data，直接用 action 指定的模式。
     */
    private fun readMode(): Mode {
        when (intent?.action) {
            ACTION_OPEN_SYNC -> return Mode.SYNC
            ACTION_OPEN_EDIT -> return Mode.EDIT
        }
        return try {
            val info = packageManager.getActivityInfo(componentName, PackageManager.GET_META_DATA)
            val raw = info.metaData?.getString(KEY_MODE)
            Mode.of(raw)
        } catch (e: Exception) {
            Mode.VIEW
        }
    }

    companion object {
        /** 与 AndroidManifest.xml 里三处 `<meta-data android:name="jsd.mode">` 一致 */
        const val KEY_MODE = "jsd.mode"

        /** 壳层内部跳「设置与同步」用的 action（不走 alias 那条路） */
        const val ACTION_OPEN_SYNC = "xyz.rth1.jinsuper811.action.OPEN_SYNC"

        /** 壳层内部跳「录作业」用的 action（同样不走 alias） */
        const val ACTION_OPEN_EDIT = "xyz.rth1.jinsuper811.action.OPEN_EDIT"
    }
}

/**
 * 按模式渲染。三块界面分别在 ui/ 下，各管一摊。
 *
 * @param onExit 关掉当前这一屏（就是 `Activity.finish()`）
 */
@Composable
private fun render(services: AppServices, mode: MainActivity.Mode, onExit: () -> Unit) {
    when (mode) {
        MainActivity.Mode.VIEW ->
            SiteWebScreen(services)

        MainActivity.Mode.EDIT ->
            /* 编辑模式：进去以后 Back / 顶栏「看作业」都会退出这一屏 ——
               从桌面图标（EditAlias）直接进来的没有上一屏，exit 就是回桌面；
               从「看作业」跳过来的，回到看作业那一屏。两种来路都对。 */
            EditorWebScreen(services, onBack = onExit)

        MainActivity.Mode.SYNC -> {
            var toView by remember { mutableStateOf(false) }
            if (toView) {
                SiteWebScreen(services)
            } else {
                SyncSettingsScreen(services, onOpenSite = { toView = true })
            }
        }
    }
}
