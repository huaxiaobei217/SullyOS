# 诺亚手机 APK（个人二改）

GitHub Actions 里的「打包安卓 App」流程用这里的文件生成一个 Capacitor 壳：

- `capacitor.config.json`：包名 `com.kythie.sullyos`，直接打开线上网站（`server.url`），网页更新不用重装。
- `MainActivity.java`：藏起底部导航条，保留系统状态栏（颜色由网页跟着页面设）。
- `offline.html`：没网时显示的页面。

需要的仓库 Secrets（Settings → Secrets and variables → Actions）：

- `GOOGLE_SERVICES_JSON`：Firebase 里下载的 `google-services.json` 全文（主动消息推送用）。没有的话 App 照样能用，只是收不到推送。
- `ANDROID_KEYSTORE_BASE64`：签名用的 keystore（base64）。**一定要配**：签名每次都一样，新 APK 才能直接覆盖安装、数据不丢。
- `ANDROID_KEYSTORE_PASSWORD`：keystore 和 key 的密码。

打包好的 APK 发在 Releases 的 `android-latest` 里，手机浏览器打开就能下载。
