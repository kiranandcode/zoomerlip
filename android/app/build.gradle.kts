plugins { id("com.android.application") }
android {
    namespace = "me.kirancodes.zoomerlip"
    compileSdk = 35
    defaultConfig {
        applicationId = "me.kirancodes.zoomerlip"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("zoomerlipVersionCode") as String?)?.toInt() ?: 3
        versionName = (project.findProperty("zoomerlipVersionName") as String?) ?: "0.1.2"
    }
    buildTypes { getByName("release") { isMinifyEnabled = false; isDebuggable = false } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("web-assets"))
    testOptions { unitTests.isIncludeAndroidResources = true }
}
val buildWeb by tasks.registering(Exec::class) {
    workingDir(rootProject.file(".."))
    inputs.files(rootProject.file("../package.json"), rootProject.file("../package-lock.json"), rootProject.file("../vite.config.ts"), rootProject.file("../index.html"), rootProject.file("../tsconfig.json"))
    inputs.dir(rootProject.file("../src"))
    inputs.dir(rootProject.file("../public"))
    outputs.dir(rootProject.file("../dist"))
    commandLine("npm", "run", "build")
}
val bundleWeb by tasks.registering(Sync::class) {
    dependsOn(buildWeb)
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
