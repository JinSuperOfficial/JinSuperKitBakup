// android/build.gradle.kts —— 根工程（只声明插件，不写依赖）
//
// 版本选型（改动前先看这里，别随手升）：
//   AGP     8.5.2   —— 与 Gradle 8.7 / JDK 17 这一组是稳定搭配
//   Kotlin  1.9.24  —— 对应 Compose 编译器扩展 1.5.14
// 升级要三处一起动：这里的 AGP、gradle/wrapper/gradle-wrapper.properties 的 Gradle、
// 以及 app/build.gradle.kts 里的 kotlinCompilerExtensionVersion。
//
// 注意：本文件**必须用 `//` 行注释**，不要用块注释开头。
// 踩过的坑：`.gradle.kts` 顶上写块注释时，Kotlin 脚本编译器会把它编译成空脚本
// （不报错），plugin / 依赖全都不生效。settings.gradle.kts 上栽过一次，
// 三个 build 文件都按这条来写最省事。

plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
