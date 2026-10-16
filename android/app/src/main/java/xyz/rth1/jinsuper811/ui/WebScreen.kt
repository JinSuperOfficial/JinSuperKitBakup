package xyz.rth1.jinsuper811.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import xyz.rth1.jinsuper811.AppServices
import xyz.rth1.jinsuper811.HomeworkBridge
import xyz.rth1.jinsuper811.LocalContentHandler
import xyz.rth1.jinsuper811.MainActivity
import xyz.rth1.jinsuper811.Origins
import xyz.rth1.jinsuper811.R

/**
 * WebScreen.kt —— 网页那一屏（两种用法）
 * ===========================================================
 * ① `SiteWebScreen`  —— 「看作业」：按回落链挑一个能开的站点
 * ② `EditorWebScreen` —— 「录作业」：加载**本机**的编辑器界面
 *    （直接复用 `desktop/src/ui/hwk/` 那套 HTML/CSS/JS，一个字节不改）
 *
 * 两屏共同的规矩：
 *   · **不往站点页面注入任何 DOM / 样式** —— 和桌面版同一条；
 *     顶栏是原生层，不是页面里的一块；
 *   · 本地内容一律走 `LocalContentHandler`（固定虚拟 origin / Range / `.php` 404）。
 *
 * ①的来源回落链对齐桌面版 `desktop/src/main.js`：
 *     cn 主站 → rth 热铁盒 → gh GitHub Pages → local 离线副本
 *   判失败 = 主框架 `onReceivedError`（忽略 `ERR_ABORTED`）+ 12 秒看门狗。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SiteWebScreen(services: AppServices) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val chain = remember { services.settings.chain() }
    var step by remember { mutableStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }

    val localHandler = remember { LocalContentHandler(context) }
    val handler = remember { Handler(Looper.getMainLooper()) }

    /* ★ 换源这件事需要一个「可重入的引用」：
       `advance` 与 `load` 互相调用，而 WebView 的 onReceivedError 又要在
       WebView 构造完成之前就引用到它 —— 所以先占一个 lambda 变量，
       真正的实现等 WebView 建好之后再赋值（第一次调用必然在赋值之后）。 */
    var advance: () -> Unit = {}

    val webView = remember {
        WebView(context).apply {
            applyWebSettings()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?) =
                    request?.let { localHandler.intercept(it) }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    failed = false
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    /* 页面起来了就把看门狗撤掉，否则 12 秒后会莫名其妙换源 */
                    handler.removeCallbacksAndMessages(null)
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?,
                ) {
                    /* 只认主框架的失败 —— 子资源（一张图、一个字体）挂了不该换源。
                       ERR_ABORTED 是「我们自己 loadUrl 打断上一次加载」，桌面版也忽略它。 */
                    if (request?.isForMainFrame != true) return
                    if (error?.description?.contains("ERR_ABORTED") == true) return
                    advance()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onReceivedTitle(view: WebView?, t: String?) {
                    title = t.orEmpty()
                }
            }
        }
    }

    fun loadImpl() {
        val url = Origins.urlOf(chain[step]).trimEnd('/') + "/class/homework.html"
        title = ""
        webView.loadUrl(url)
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ advance() }, 12_000)
    }

    fun advanceImpl() {
        if (step < chain.size - 1) {
            step += 1
            failed = false
            loadImpl()
        } else {
            failed = true
        }
    }

    /* 把真正的实现接到上面那个占位的 lambda 上。
       放在这里（而不是更早）是因为它要用到 webView 和 loadImpl —— 都已经建好了。 */
    advance = { advanceImpl() }

    DisposableEffect(Unit) {
        /* 只在进来时加载一次（外面是 composable，重组不该重新拉页面） */
        loadImpl()
        onDispose {
            handler.removeCallbacksAndMessages(null)
            webView.stopLoading()
            webView.destroy()
        }
    }

    BackHandler(enabled = true) {
        if (webView.canGoBack()) webView.goBack() else goHome(context)
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ShellTopBar(
                title = context.getString(R.string.view_title),
                subtitle = title.ifBlank { sourceLabel(chain[step]) },
            ) {
                TopBarAction(context.getString(R.string.open_edit)) { openEditor(context, services) }
                TopBarAction(context.getString(R.string.open_settings)) { openSettings(context) }
            }

            Box(Modifier.weight(1f)) {
                AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize())
                if (failed) {
                    ErrorPane(
                        onRetry = {
                            step = 0
                            failed = false
                            loadImpl()
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }
}

/**
 * 「录作业」：加载**本机**的编辑器界面。
 *
 * ★ 这一屏是整个安卓侧复用价值最高的地方：界面就是 `desktop/src/ui/hwk/` 那套
 *   HTML/CSS/JS（构建期由 `android/tools/sync-site-assets.mjs` 拷进 assets），
 *   桥只有两个入口（`window.hwk.getState()` / `window.hwk.action()`），
 *   由 `HomeworkBridge` 实现 —— 和桌面版的 `hwk-preload.js` 是同一份契约。
 *
 * 用的是 `WebViewAssetLoader` 那条固定虚拟域，所以 localStorage 的 origin 稳定，
 * 「改过的草稿」这类本机状态不会因为重启应用而漂走。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EditorWebScreen(services: AppServices, onBack: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val localHandler = remember { LocalContentHandler(context) }
    val bridge = remember { HomeworkBridge(services) }

    val webView = remember {
        WebView(context).apply {
            applyWebSettings()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?) =
                    request?.let { localHandler.intercept(it) }
            }
            webChromeClient = WebChromeClient()
            /* 桥只暴露这两个方法名（和 desktop/src/ui/hwk-preload.js 的 contextBridge 一样）。
               页面是**本机 assets**，不是站点页面 —— 所以这里加接口是安全的。 */
            addJavascriptInterface(bridge, "hwk")
        }
    }

    DisposableEffect(Unit) {
        webView.loadUrl("${Origins.LOCAL_BASE}/${LocalContentHandler.HWK_UI_PREFIX}/index.html")
        onDispose {
            webView.stopLoading()
            webView.destroy()
        }
    }

    BackHandler(enabled = true) { onBack() }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ShellTopBar(
                title = context.getString(R.string.edit_title),
                subtitle = services.hwkStore.stats(),
            ) {
                TopBarAction(context.getString(R.string.open_view)) { onBack() }
                TopBarAction(context.getString(R.string.open_settings)) { openSettings(context) }
            }
            AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize())
        }
    }
}

/* ═══════════════ 小工具 ═══════════════ */

private fun openSettings(context: android.content.Context) {
    context.startActivity(
        Intent(context, MainActivity::class.java).setAction(MainActivity.ACTION_OPEN_SYNC),
    )
}

private fun openEditor(context: android.content.Context, services: AppServices) {
    /* 编辑模式必须先过密码门：这里只跳转，验证在 MainActivity 里做
       （没过就 finish，不留半截状态）。 */
    val i = Intent(context, MainActivity::class.java).setAction(MainActivity.ACTION_OPEN_EDIT)
    context.startActivity(i)
}

private fun goHome(context: android.content.Context) {
    val i = Intent(Intent.ACTION_MAIN)
    i.addCategory(Intent.CATEGORY_HOME)
    i.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    context.startActivity(i)
}

/** 来源的中文名（顶栏那行小字，同学一眼知道现在看的是哪一份） */
private fun sourceLabel(id: String): String = when (id) {
    "cn" -> "主站"
    "rth" -> "热铁盒"
    "gh" -> "GitHub Pages"
    "local" -> "离线副本"
    else -> id
}

/**
 * 打不开时的整屏兜底。**只说一句人话 + 一个重试按钮**，不暴露技术细节
 * （同学看到「net::ERR_NAME_NOT_RESOLVED」只会更慌）。
 */
@Composable
private fun ErrorPane(onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = modifier) {
        Column(
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .padding(28.dp),
        ) {
            Text("🌧", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(12.dp))
            Text(
                text = "打不开这个页面",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "网络好像不太顺。点「重试」再来一次；断网时也能看离线副本里存着的那份。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = onRetry,
                shape = RoundedCornerShape(Radii.md.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) { Text("重试") }
        }
    }
}

/**
 * ★ WebView 的配置常量 —— **这几条不许随手改**（每条都对应一个线上会犯的错）：
 *
 *   domStorageEnabled = true     不配 = 作业页的勾选状态（localStorage）写不进去，
 *                                表现是「勾了没反应 / 刷新就没」
 *   javaScriptEnabled = true     站点是 JS 渲染的，关了整页空白
 *   databaseEnabled = true       老 WebView 上 localStorage 依赖它
 *   mixedContentMode = COMPAT    线上是 https，但个别镜像会引 http 图；
 *                                不放宽就是一片灰框（站点本身不做 http 外链）
 *   cacheMode = LOAD_DEFAULT     有网走网络、没网走缓存（默认值，写出来是给人看）
 *   allowFileAccess = false      我们不走 file://：清单是 fetch 出来的，会被 CORS 拦
 *                                （而且关掉它本身也更安全）
 *   userAgent 保留系统默认       站点按 UA 做过适配，别伪装
 */
@SuppressLint("SetJavaScriptEnabled")
private fun WebView.applyWebSettings() {
    settings.apply {
        domStorageEnabled = true
        javaScriptEnabled = true
        databaseEnabled = true
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        cacheMode = WebSettings.LOAD_DEFAULT
        allowFileAccess = false
        allowContentAccess = false
        loadsImagesAutomatically = true
        useWideViewPort = true
        loadWithOverviewMode = false
        /* 站点自己是响应式的（viewport meta + 媒体查询），
           所以这里**不**用 setInitialScale 去硬缩，交给页面自己排版。 */
        builtInZoomControls = false
        displayZoomControls = false
        textZoom = 100
    }
    isVerticalScrollBarEnabled = true
    isHorizontalScrollBarEnabled = false
    overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
}
