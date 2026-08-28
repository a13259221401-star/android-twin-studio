plugins {
    id("com.android.application")
}

android {
    namespace = "com.motioncast.tracker"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.motioncast.tracker"
        minSdk = 24
        targetSdk = 36
        versionCode = 4
        versionName = "2.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.16.0")
    implementation("androidx.activity:activity:1.10.1")
    implementation("com.google.ar:core:1.54.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
