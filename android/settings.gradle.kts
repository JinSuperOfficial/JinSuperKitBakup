// android/settings.gradle.kts —— 移动端（第三端）的 Gradle 工程
// ===========================================================
// ⚠️ 这个文件**故意全部用 `//` 行注释**，不用块注释（/* ... */）。
//
// 踩过的坑：文件顶上写一段块注释时，Kotlin 脚本编译器会把它编译成**空脚本** ——
// 不报错、不警告，直接静默丢掉整个文件内容，于是 pluginManagement 里的 google()
// 根本没注册，报出来的却是「Plugin com.android.application not found /
// Searched in: Gradle Central Plugin Repository」——看上去像「仓库没配」，极难查。
// 同样的内容换成 `//` 行注释就正常。**别改回块注释。**
//
// 这个目录的形状是**镜像 desktop/** 的：一份代码、一次构建、多个入口。
//   · desktop/  同一个 exe + 一个参数（--app=homework）
//   · android/  同一个 APK + 三个 <activity-alias>（详见 AndroidManifest.xml）
//
// 依赖仓库只有 Google 与 Maven Central 两个 —— 没有内网私服、没有镜像站，
// 这样 GitHub Actions 上的 android.yml 和本机跑的是同一条路。
//
// 另外两条也被踩过：
//   1. pluginManagement 里的 google() **不要**加 includeGroupByRegex 之类的过滤，
//      AGP 的插件标记会因此解析不到；
//   2. 配置缓存会把「评估 settings 失败」的结果一起缓存住，所以改了本文件之后
//      第一次跑要加 --no-configuration-cache 才看得见真实结果。

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "JinSuper811"
include(":app")
