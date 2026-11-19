plugins { id("com.android.application") }
android {
    namespace = "me.kirancodes.zoomerlip"
    compileSdk = 35
    defaultConfig {
        applicationId = "me.kirancodes.zoomerlip"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("zoomerlipVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("zoomerlipVersionName") as String?) ?: "0.1.0"
    }
    buildTypes { getByName("release") { isMinifyEnabled = false; isDebuggable = false } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("web-assets"))
    testOptions { unitTests.isIncludeAndroidResources = true }
}
val bundleWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../dist"))
    into(layout.buildDirectory.dir("web-assets"))
    doFirst { check(rootProject.file("../dist/index.html").exists()) { "Run npm run build first." } }
}
tasks.named("preBuild") { dependsOn(bundleWeb) }
dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
