# Android Twin Studio：实时手机数字孪生 Demo

一个本地运行的完整演示：MotionCast Tracker APK 通过 Wi-Fi 同时发送 Android 真机屏幕和手机姿态，网页将实时画面贴到可自由观察的 3D 手机模型上。

## 架构

```text
Android 屏幕 → MediaProjection → MediaCodec H.264 → Wi-Fi WebSocket → WebCodecs → 3D 屏幕平面
Android 姿态 → Tracker APK Sensor / ARCore → 同一局域网连接 → Three.js Quaternion
网页控制台 → 机身材质 / 镜头视角 / 平滑度 / 背景 / 演示模式
```

- 页面：React 19 + Vite + TypeScript。
- 3D 舞台：Three.js + React Three Fiber + Drei。
- 连接：同一局域网内扫码，二维码携带进程级随机令牌，不需要输入 IP 或端口。
- 主投屏通道：APK 使用 MediaProjection + MediaCodec，长边最高 1920、30fps、8Mbps。
- 浏览器：WebCodecs 解码 Annex B H.264，Canvas 直接渲染进 3D 手机屏幕。
- 兼容通道：原有 Wi-Fi ADB + ws-scrcpy-web 保留为高级备用方式。
- 姿态：支持 `GAME_ROTATION_VECTOR` 3DoF；支持 ARCore 的设备可启用 6DoF。

## 已构建 APK

可直接安装的调试包：

```text
output/MotionCast-Tracker-debug.apk
```

重新构建：

```powershell
cd android-tracker
.\gradlew.bat assembleDebug
```

## 在另一台 Windows 电脑运行

要求：

- Windows 10/11。
- Node.js 22 LTS（最低建议 Node.js 20.19）。
- Android 手机和电脑连接同一个局域网。
- Windows 防火墙允许 Node.js 使用专用网络，手机需要访问电脑的 TCP `8787` 端口。

克隆并启动主 APK 直连方案：

```powershell
git clone https://github.com/a13259221401-star/android-twin-studio.git
cd android-twin-studio
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173>。安装仓库内的：

```text
output/MotionCast-Tracker-debug.apk
```

APK 扫码直连不需要安装 ADB、scrcpy 或 Android SDK。只有需要 ADB 备用投屏时，再运行：

```powershell
npm run runtime:install
npm run demo
```

## 本机首次安装

要求 Windows 10/11、Android 手机和电脑处于同一 Wi-Fi。

```powershell
npm install
npm run runtime:install
npm run demo
```

打开 <http://127.0.0.1:5173>。

## 推荐：扫码连接

1. 手机和电脑连接同一 Wi-Fi。
2. 打开网页“连接 Android 手机”，页面会显示当前电脑的连接二维码。
3. 安装并打开 MotionCast Tracker 2.0，点击“扫码连接电脑”。
4. 扫描网页二维码。
5. Android 自动弹出“开始录制或投射”系统确认框，点击允许。
6. 手机屏幕和姿态会自动出现在网页 3D 手机中，不需要再点击开始投屏。
7. 拿稳手机后执行一次“重置至初始姿态”。

电脑端服务重启后二维码令牌会更新，重新扫描一次即可。整个过程不需要手动输入电脑 IP、WebSocket 端口或令牌。

每次重新开始屏幕捕获时，Android 都会要求用户确认一次录屏，这是系统安全要求，无法静默绕过。

## ADB / scrcpy 备用方式

只有 APK 直连在特定设备上不可用时，才需要使用以下兼容方式。

### Android 11+ 无线调试

1. 手机进入“开发者选项 → 无线调试”。
2. 选择“使用配对码配对设备”，查看配对地址和六位配对码。
3. 网页展开“高级连接方式 → 无线配对”，完成一次配对。
4. 返回无线调试主页；若自动发现暂时不可用，可在“Wi-Fi 连接”中输入一次当前连接地址。
5. 后续直接点击“自动发现投屏设备”。

### USB 转 Wi-Fi

1. USB 连接手机并允许调试。
2. 网页展开“高级连接方式 → USB 转 Wi-Fi”。
3. 点击切换按钮，成功后即可拔掉 USB。

## 操作说明

姿态校准时只需保持手机静止约 1 秒，不要求平放。新版校准只归零水平航向，不会清除由重力决定的俯仰和翻转：手机平放时网页也会平放，竖直拿起时网页才会竖直。系统会连续采集稳定样本，并自动过滤约 0.28° 内的微小旋转噪声。投屏服务与前台 ARCore 同时在线时，服务端只选用一个姿态源：ARCore `TRACKING` 优先，离开 Tracker 后由后台 Sensor 3DoF 接管；网页会对追踪源切换做短暂连续性补偿。

- “真实姿态 / 展示姿态”：切换物理同步与固定产品展示角度。
- “稳定度”：建议 65%–80%，越高越稳定但响应略慢。
- “校准水平朝向”：只重置 yaw，保留真实 pitch / roll。

## 本地 API

- `GET /api/devices`：列出 ADB 设备。
- `GET /api/runtime`：检查 ws-scrcpy-web 是否可用。
- `GET /api/pose`：查看 Tracker APK 连接状态与最新 Pose。
- `GET /api/quick-connect`：生成局域网 WebSocket 地址和临时令牌。
- `POST /api/pose/prepare`：为指定设备建立兼容的本机反向姿态端口。
- `POST /api/pose/calibrate`：通知 APK 采样稳定航向并更新 yaw 零点。
- `POST /api/adb/auto-connect`：通过 ADB mDNS 自动发现已配对设备。
- `POST /api/adb/pair`：手动无线配对备用接口。
- `POST /api/adb/connect`：手动连接地址备用接口。
- `POST /api/wifi/enable`：USB 设备切换到 TCP/IP 调试。

ADB 参数使用 `execFile` 参数数组执行，连接地址、端口和设备状态均经过校验。局域网姿态发布必须携带二维码令牌；本机 `adb reverse` 方式保持兼容。

## 能力边界

- Sensor 3DoF 稳定同步 Pitch、Yaw、Roll。
- ARCore 6DoF 可提供 X/Y/Z 空间位移，但要求设备支持 ARCore 且摄像头保持追踪。
- 切换到其他 App 后，前台服务继续发送屏幕和 Sensor 3DoF 姿态。
- ARCore 6DoF 依赖 Tracker 的前台相机追踪；切到其他 App 后会降级为 Sensor 3DoF，因此可继续同步旋转但不保证真实 X/Y/Z 位移。
- Android 系统录屏授权必须由用户在系统弹窗中确认。

## 许可证

页面代码用于本地 Demo。ws-scrcpy-web 运行时采用 GPL-3.0-only，并由安装脚本独立下载到被忽略的 `.runtime/` 目录；正式产品化前请复核分发方式和许可证要求。
