package xyz.rth1.jinsuper811

import android.app.Application
import android.webkit.WebView
import java.io.File

/**
 * JinSuperApp.kt —— 进程级的东西都在这儿
 * ===========================================================
 * 只有三件事，但每一件都得在「任何 Activity 起来之前」做好：
 *
 *   1. **WebView 数据目录**：默认落在应用私有目录里（不用外部存储）。
 *   2. **WebView 调试开关**：只在 debug 包里开 —— release 包里开着等于把
 *      页面内容暴露给任何能连 adb 的人。
 *   3. **给壳层提供几个共享的路径**（hwk / sync / 离线副本），
 *      免得每个 Activity 自己拼一遍 `filesDir` 的路径。
 *
 * ★ 注意：这里**不**做「清缓存」「建目录」这类带副作用的活儿 ——
 *   那些是用户点了才该发生的事（AGENTS.md：改代码别顺手加副作用）。
 */
class JinSuperApp : Application() {

    override fun onCreate() {
        super.onCreate()

        /* release 包里 WebView 不能调试（debug 包留着，方便同学群里丢 logcat 过来） */
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        /* WebView 的数据目录固定在应用私有目录下（别的应用看不到） */
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            WebView.setDataDirectorySuffix("jinsuper")
        }
    }

    companion object {
        /**
         * 作业数据的家：`filesDir/hwk/`
         *
         * ★ 一定是 `filesDir`，**不是**外部存储（Android 那个 getExternal… 开头的 API）：
         *   外部存储会被系统清理、也会被别的应用看见。
         *   `HwkStoreTest` 有一条专门盯这个。
         */
        fun hwkDir(context: android.content.Context): File = File(context.filesDir, "hwk")

        /** 同步的临时区：收件箱下载、本地快照、断网队列 */
        fun syncDir(context: android.content.Context): File = File(context.filesDir, "sync")

        /** 云端同步下来的站点更新（**优先于 assets 里的离线副本**） */
        fun siteDir(context: android.content.Context): File = File(context.filesDir, "site")

        /**
         * 随包离线副本在 assets 里的位置。
         * 与 `SiteAssets.ASSET_ROOT` 一致；`LocalContentHandler` 用它拼 asset 路径。
         */
        const val ASSETS_SITE = "site"

        /** 作业编辑器界面（直接复用 desktop/src/ui/hwk/ 那套 HTML/CSS/JS） */
        const val ASSETS_HWK_UI = "hwk-ui"
    }
}
