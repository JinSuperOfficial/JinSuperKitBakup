package xyz.rth1.jinsuper811.ui

import android.webkit.WebView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import xyz.rth1.jinsuper811.AppServices
import xyz.rth1.jinsuper811.Origins
import xyz.rth1.jinsuper811.R

/**
 * SyncSettingsScreen.kt —— 「设置与同步」面板
 * ===========================================================
 * 这一屏是给**想管一管的人**看的，不是同学日常要用的：
 *
 *   ① 打开的是哪个站 + 两档回落开关（默认零输入就能用）
 *   ② 本机数据摘要（几天作业 / 几天待同步 / 最近哪天）
 *   ③ **同步**：一个按钮，同时做「拉家里的」和「传本机改过的」
 *   ④ 维护动作：清网页缓存、重新导入随包基线
 *
 * 两件刻意不做的事：
 *   · **不做后台同步**（H5）：没有 WorkManager、没有通知权限 ——
 *     系统会把后台进程杀掉，同学还会以为已经传上去了。同步只发生在按下按钮那一刻。
 *   · **不显示令牌**：`SyncConfig.describe()` 只说仓库和分支，不打印令牌
 *     （截图发群里也不会泄）。
 */
@Composable
fun SyncSettingsScreen(services: AppServices, onOpenSite: () -> Unit) {
    val context = LocalContext.current
    val scope = remember { CoroutineScope(Dispatchers.Main) }

    var origin by remember { mutableStateOf(services.settings.originId) }
    var autoFallback by remember { mutableStateOf(services.settings.autoFallback) }
    var offlineFallback by remember { mutableStateOf(services.settings.offlineFallback) }

    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var stats by remember { mutableStateOf(services.hwkStore.stats()) }
    var queueText by remember { mutableStateOf(services.syncEngine.queueSummary()) }

    fun refreshTexts() {
        stats = services.hwkStore.stats()
        queueText = services.syncEngine.queueSummary()
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ShellTopBar(
                title = context.getString(R.string.sync_title),
                subtitle = stats,
            ) {
                TopBarAction(context.getString(R.string.open_view)) { onOpenSite() }
            }

            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) {
                /* ── ① 站点来源 ── */
                SectionTitle(context.getString(R.string.settings_origin))
                InfoCard(
                    label = Origins.get(origin).label,
                    value = Origins.get(origin).desc,
                    hint = context.getString(R.string.settings_origin_hint),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Origins.ALL.forEach { o ->
                        val on = o.id == origin
                        OutlinedButton(
                            onClick = {
                                origin = o.id
                                services.settings.originId = o.id
                            },
                            shape = RoundedCornerShape(Radii.md.dp),
                            modifier = Modifier.height(48.dp),
                        ) {
                            Text(
                                text = o.label,
                                color = if (on) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                ToggleRow(
                    label = "云端之间互相顶替",
                    hint = "主站连不上就试热铁盒、GitHub Pages",
                    checked = autoFallback,
                ) { autoFallback = it; services.settings.autoFallback = it }

                ToggleRow(
                    label = context.getString(R.string.settings_offline),
                    hint = "断网时看随包的那份（只能看，不能传）",
                    checked = offlineFallback,
                ) { offlineFallback = it; services.settings.offlineFallback = it }

                /* ── ② 同步 ── */
                SectionTitle("同步")
                InfoCard(
                    label = context.getString(R.string.sync_config),
                    value = services.syncConfig.describe(),
                    hint = services.syncConfig.problems().firstOrNull()
                        ?: "手机上传走 Gitee 收件箱；看作业走上面那条回落链，两条路各管各的。",
                )
                InfoCard(
                    label = context.getString(R.string.sync_queue),
                    value = queueText,
                    hint = "只在前台重试：点「立刻同步」才会重放队列。",
                )

                Button(
                    onClick = {
                        busy = true
                        status = context.getString(R.string.sync_pulling)
                        scope.launch {
                            val text = withContext(Dispatchers.IO) { doSync(services) }
                            status = text
                            busy = false
                            refreshTexts()
                        }
                    },
                    enabled = !busy,
                    shape = RoundedCornerShape(Radii.md.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                ) { Text(context.getString(R.string.sync_now)) }

                if (status.isNotBlank()) {
                    Text(
                        text = status,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                /* ── ③ 维护 ── */
                SectionTitle("维护")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = {
                            /* WebView 只能在主线程创建 —— 这里本来就在主线程（onClick） */
                            clearWebCache(context)
                            status = context.getString(R.string.settings_clear_done)
                        },
                        shape = RoundedCornerShape(Radii.md.dp),
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp),
                    ) { Text(context.getString(R.string.settings_clear_cache)) }

                    OutlinedButton(
                        onClick = {
                            val r = services.hwkStore.reseed()
                            refreshTexts()
                            status = context.getString(R.string.settings_reseed_done) +
                                "（${r.count} 天）"
                        },
                        shape = RoundedCornerShape(Radii.md.dp),
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp),
                    ) { Text(context.getString(R.string.settings_reseed)) }
                }

                /* ── ④ 关于 ── */
                SectionTitle(context.getString(R.string.settings_about))
                InfoCard(
                    label = context.getString(R.string.app_name),
                    value = "安卓版 v" + xyz.rth1.jinsuper811.BuildConfig.VERSION_NAME,
                    hint = "和桌面版吃同一份作业数据；家里一条 sync apply 两边都能收。",
                )
                Text(
                    text = context.getString(R.string.trouble_alias),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

/**
 * 一次「立刻同步」：**先拉后传**。
 *
 * 顺序不能反：先把家里推上来的并进来（本机改过的不覆盖），
 * 再把本机的改动传上去 —— 反过来的话，云端那份会被本机旧数据当成「已改」而跳过。
 */
private fun doSync(services: AppServices): String {
    val cfg = services.syncConfig
    val problems = cfg.problems()
    if (problems.isNotEmpty()) return "同步没配好：" + problems.joinToString("；")

    return try {
        val pull = services.syncEngine.pull()
        val push = services.syncEngine.pushDirty(from = cfg.from)
        val parts = mutableListOf<String>()
        parts.add("拉下来 ${pull.written} 天")
        if (pull.skipped.isNotEmpty()) parts.add("${pull.skipped.size} 天本机改过，没被覆盖")
        parts.add(
            if (push.queued) "本机改动没传上去（已排队）"
            else if (push.count > 0) "传上去 ${push.count} 个文件"
            else "本机没有要传的改动",
        )
        parts.joinToString("；")
    } catch (e: Exception) {
        "同步失败：" + (e.message ?: e.javaClass.simpleName) + "（等有网再点一次）"
    }
}

/**
 * 清网页缓存。
 *
 * ★ **只清 HTTP 缓存，绝不动 localStorage / WebStorage。**
 *   勾选状态就存在 `localStorage`（键 `hw:<id>:<条目哈希>`），
 *   顺手清掉等于把同学勾过的作业全弄没了。
 *   （早期版本的 `WebView.clearCache(true)` 在某些 ROM 上会连带清掉
 *   WebStorage —— 所以这里显式只做这一件事，并把「不清 localStorage」
 *   写成注释留在原地，免得以后有人「顺手补一刀」。）
 *
 * 必须在**主线程**调用（WebView 不是线程安全的）。
 */
private fun clearWebCache(context: android.content.Context) {
    WebView(context).apply {
        clearCache(true)      // HTTP 缓存
        clearFormData()       // 自动填充记录
        destroy()
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(top = 6.dp),
    )
}

@Composable
private fun ToggleRow(label: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(Radii.lg.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Text(
                    hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = checked, onCheckedChange = onChange, modifier = Modifier.size(52.dp, 40.dp))
        }
    }
}
