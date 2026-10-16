// android/app/build.gradle.kts —— 移动端 APK 的构建脚本
//
// 体积与内核都是**硬指标**，改动这里之前先读 project.md 的「移动端」一节：
//   · 静默 APK 目标 <= 8MB（不含离线副本数据）
//   · minSdk 24 —— androidx.webkit 在 24 上没问题
//   · targetSdk / compileSdk 取当前最新稳定（这里 34）
//
// 三条不许删的开关（删了会出问题，理由写在各自旁边）：
//   · buildFeatures.buildConfig = true —— SyncConfig 的默认值要从 BuildConfig 走；
//   · packaging 里去重 META-INF —— 少一个重复文件就少一次构建失败；
//   · kotlinOptions.jvmTarget —— 与 compileOptions 对齐，否则 Kotlin/Java 目标不一致。
//
// 注意：本文件**必须用 `//` 行注释**开头 —— 顶上写块注释会让 Kotlin 脚本编译器
// 把它编译成空脚本（不报错、plugin 全不生效）。settings.gradle.kts 上栽过一次。

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "xyz.rth1.jinsuper811"
    compileSdk = 34

    defaultConfig {
        applicationId = "xyz.rth1.jinsuper811"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        /* 版本号可以被打包时覆盖：`./gradlew assembleRelease -PversionName=1.0.1`
           （CI 的 android.yml 就是这么把 workflow_dispatch 的输入传进来的）。
           不传就用下面这个默认值。 */
        versionName = (findProperty("versionName") as String?)?.takeIf { it.isNotBlank() } ?: "1.0.0"

        /* 单元测试跑在 JVM 上（不需要真机、不需要模拟器）——
           check:android 就是靠这一条在 CI 上覆盖纯逻辑的。 */
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        /* 只留中英文：省掉几十种语言资源，APK 小一截 */
        resourceConfigurations += listOf("zh", "en")
    }

    /* 签名配置从环境变量 / gradle.properties 读，**不写死在仓库里**。
       keystore 本体不进 git（见 .gitignore），CI 上从 Secrets 还原。
       没配就出一个未签名的 release —— 打包不会失败，只是装不上（覆盖安装才需要签名）。 */
    /* ★ 这里有个坑（踩过）：`create("release")` **总是**会建出这个配置对象，
       哪怕我们一个字段都没填 —— 于是 `findByName("release")` 拿到的不是 null，
       buildTypes 里一挂上去，`packageRelease` 就直接报
       「SigningConfig "release" is missing required property "storeFile"」，
       **构建失败**，而文档里写的是「没配就出未签名包」。两回事。
       所以要用一个显式开关来判断「到底配没配 keystore」，别用「配置对象存不存在」。 */
    var hasReleaseKeystore = false
    signingConfigs {
        create("release") {
            val storePath = System.getenv("JINS_KEYSTORE") ?: (findProperty("jins.keystore") as String?)
            val storePass = System.getenv("JINS_KEYSTORE_PASSWORD") ?: (findProperty("jins.keystorePassword") as String?)
            val keyAliasEnv = System.getenv("JINS_KEY_ALIAS") ?: (findProperty("jins.keyAlias") as String?)
            val keyPass = System.getenv("JINS_KEY_PASSWORD") ?: (findProperty("jins.keyPassword") as String?)
            if (!storePath.isNullOrBlank() && !storePass.isNullOrBlank()) {
                /* ★ 用 `rootProject.file(...)`，**不要**用 `file(...)`：
                   这个脚本在 `:app` 模块里，而 `file()` 是相对**模块目录**（`android/app/`）解析的；
                   `rootProject.file()` 才是相对 `android/`。
                   所以 `JINS_KEYSTORE=keystore/jinsuper.jks` 这样写要配 rootProject.file ——
                   换成 `file()` 会去找 `android/app/keystore/…`，报
                   「Keystore file '…/android/app/keystore/jinsuper.jks' not found」。
                   （绝对路径两种情况都对，脚本里照旧支持。） */
                storeFile = rootProject.file(storePath)
                storePassword = storePass
                keyAlias = if (keyAliasEnv.isNullOrBlank()) "jinsuper811" else keyAliasEnv
                keyPassword = if (keyPass.isNullOrBlank()) storePass else keyPass
                hasReleaseKeystore = true
            }
        }
    }
    val releaseSigning = signingConfigs.findByName("release")

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            /* 只有真的配了 keystore 才挂签名配置（见上面那段注释：
               挂了但没填字段 = packageRelease 直接失败） */
            if (hasReleaseKeystore && releaseSigning != null) signingConfig = releaseSigning
        }
    }

    buildFeatures {
        buildConfig = true          /* SyncConfig 的默认值走 BuildConfig */
        compose = true
    }

    composeOptions {
        /* 与上面 Kotlin 1.9.24 配套；升 Kotlin 必须一起升 */
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
                "DebugProbesKt.bin",
                "kotlin-tooling-metadata.json",
            )
        }
    }

    sourceSets {
        /* 离线副本与作业编辑器界面都当 assets 打进去：
             assets/site      —— 「看作业」链路的最小离线集（不含听力音频、不含 docs-md.js）
             assets/hwk-ui    —— 直接复用 desktop/src/ui/hwk/ 那套 HTML/CSS/JS
           assets 会在构建期由 tools/sync-site-assets.mjs 同步，见该脚本头部说明。 */
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        /* lint 不该拦住打包（CI 上跑得动就跑，跑不动别红）。
           真要严格审查用 ./gradlew lint。 */
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.2")
    /* 同步面板要开协程把 IO 挪出主线程（轻量，且 lifecycle-runtime-ktx 已经间接带进来了，
       但显式写一行更清楚：这个包是我们自己在用的） */
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    /* WebViewAssetLoader 在这个包里；**音视频不走它**（它不支持 Range），
       页面本身用它来伺服，Range 由 LocalContentHandler 自己接管。 */
    implementation("androidx.webkit:webkit:1.11.0")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
