# android/app/proguard-rules.pro
# ---------------------------------------------------------------
# release 开了 minify + shrinkResources。下面这些**不许删**：
#   · 应用类的名字要稳（activity-alias 的 targetActivity 是名字字符串；
#     MainActivity 被混淆掉的话，alias 就指不到东西，桌面图标直接闪退）
#   · View/Activity 的生命周期方法是反射调的
#   · JSON 解析走 org.json（Android 自带的），不用保
#   · assets 里的东西不参与混淆，不用管

# 壳里的类全保住（名字要能被 AndroidManifest 找到）
-keep class xyz.rth1.jinsuper811.** { *; }

# Activity / Application 的生命周期方法
-keepclassmembers class * extends android.app.Activity {
    public void *(android.view.View);
}
-keepclassmembers class * extends android.app.Application {
    *;
}

# 枚举的 values() / valueOf()
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# 别把行号全抹了：线上崩溃栈要看得懂
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
