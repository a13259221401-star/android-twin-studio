package com.motioncast.tracker;

import android.Manifest;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;
import java.util.Locale;

public final class MainActivity extends ComponentActivity implements PoseWebSocketClient.Listener {
    private static final int CAMERA_PERMISSION = 41;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable sampleLoop = new Runnable() {
        @Override public void run() {
            publishSample();
            handler.postDelayed(this, 33);
        }
    };

    private SensorPoseTracker sensorTracker;
    private PoseWebSocketClient socketClient;
    private GLSurfaceView glSurfaceView;
    private ArCoreRenderer arRenderer;
    private Session arSession;
    private volatile MotionSample arSample;
    private boolean trackingEnabled = true;
    private boolean socketConnected;
    private boolean activityResumed;

    private TextView connectionSummary;
    private TextView trackingMode;
    private TextView trackingState;
    private TextView positionValue;
    private TextView rotationValue;
    private TextView arcoreStatus;
    private Button trackingButton;
    private String endpoint;
    private String connectionToken;
    private boolean screenSharing;
    private boolean projectionRequestInFlight;
    private boolean pendingAutoShare;
    private Button screenShareButton;
    private TextView screenShareStatus;
    private ResultReceiver captureStatusReceiver;
    private final ActivityResultLauncher<ScanOptions> barcodeLauncher = registerForActivityResult(
        new ScanContract(), this::handleScanResult
    );
    private final ActivityResultLauncher<Intent> projectionLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            projectionRequestInFlight = false;
            if (result.getResultCode() != RESULT_OK || result.getData() == null) {
                pendingAutoShare = false;
                screenSharing = false;
                screenShareButton.setText("开始实时投屏");
                screenShareStatus.setText("未授权屏幕录制，点击按钮可重新授权");
                return;
            }
            Intent serviceIntent = new Intent(this, ScreenCaptureService.class);
            serviceIntent.setAction(ScreenCaptureService.ACTION_START);
            serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
            serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
            serviceIntent.putExtra(ScreenCaptureService.EXTRA_STATUS_RECEIVER, captureStatusReceiver);
            ContextCompat.startForegroundService(this, serviceIntent);
            screenShareButton.setEnabled(false);
            screenShareStatus.setText("正在启动编码器与 Wi-Fi 画面通道…");
        }
    );

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(R.layout.activity_main);

        connectionSummary = findViewById(R.id.connection_summary);
        trackingMode = findViewById(R.id.tracking_mode);
        trackingState = findViewById(R.id.tracking_state);
        positionValue = findViewById(R.id.position_value);
        rotationValue = findViewById(R.id.rotation_value);
        arcoreStatus = findViewById(R.id.arcore_status);
        trackingButton = findViewById(R.id.tracking_button);
        screenShareButton = findViewById(R.id.screen_share_button);
        screenShareStatus = findViewById(R.id.screen_share_status);
        captureStatusReceiver = new ResultReceiver(handler) {
            @Override protected void onReceiveResult(int resultCode, Bundle resultData) {
                String message = resultData == null ? null : resultData.getString(ScreenCaptureService.EXTRA_STATUS_MESSAGE);
                handleCaptureStatus(resultCode, message);
            }
        };

        sensorTracker = new SensorPoseTracker(this);
        SharedPreferences preferences = getSharedPreferences("motioncast_connection", MODE_PRIVATE);
        endpoint = preferences.getString("endpoint", "ws://127.0.0.1:8787/pose/publish");
        connectionToken = preferences.getString("token", "");
        socketClient = new PoseWebSocketClient(this);
        socketClient.configure(endpoint, connectionToken);
        arRenderer = new ArCoreRenderer(pose -> arSample = pose);
        glSurfaceView = new GLSurfaceView(this);
        glSurfaceView.setEGLContextClientVersion(2);
        glSurfaceView.setPreserveEGLContextOnPause(true);
        glSurfaceView.setRenderer(arRenderer);
        glSurfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        ((FrameLayout) findViewById(R.id.ar_surface_container)).addView(glSurfaceView);

        findViewById(R.id.calibrate_button).setOnClickListener(view -> calibrate());
        trackingButton.setOnClickListener(view -> toggleTracking());
        findViewById(R.id.arcore_button).setOnClickListener(view -> enableArCore(true));
        findViewById(R.id.scan_button).setOnClickListener(view -> startQrScan());
        screenShareButton.setOnClickListener(view -> toggleScreenShare());

        updateArCoreAvailability();
    }

    private void startQrScan() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt("扫描电脑网页上的 MotionCast 连接码");
        options.setBeepEnabled(false);
        options.setOrientationLocked(false);
        barcodeLauncher.launch(options);
    }

    private void handleScanResult(ScanIntentResult result) {
        String contents = result.getContents();
        if (contents == null || contents.trim().isEmpty()) {
            connectionSummary.setText("未扫描连接码，请重试");
            return;
        }
        try {
            Uri payload = Uri.parse(contents);
            if (!"motioncast".equals(payload.getScheme()) || !"connect".equals(payload.getHost())) {
                throw new IllegalArgumentException("不是 MotionCast 连接码");
            }
            String scannedEndpoint = payload.getQueryParameter("ws");
            String scannedToken = payload.getQueryParameter("token");
            Uri websocketUri = Uri.parse(scannedEndpoint);
            String scheme = websocketUri.getScheme();
            if (!("ws".equals(scheme) || "wss".equals(scheme)) || websocketUri.getHost() == null || !"/pose/publish".equals(websocketUri.getPath())) {
                throw new IllegalArgumentException("连接地址无效");
            }

            endpoint = scannedEndpoint;
            connectionToken = scannedToken == null ? "" : scannedToken;
            getSharedPreferences("motioncast_connection", MODE_PRIVATE).edit()
                .putString("endpoint", endpoint)
                .putString("token", connectionToken)
                .apply();
            socketClient.close();
            socketClient.configure(endpoint, connectionToken);
            socketClient.connect();
            connectionSummary.setText("正在连接电脑 " + websocketUri.getHost() + "…");
            pendingAutoShare = true;
            screenShareStatus.setText("连接成功后将请求一次系统录屏授权");
        } catch (Exception error) {
            connectionSummary.setText("连接码无效，请扫描网页当前显示的二维码");
        }
    }

    private void toggleScreenShare() {
        if (screenSharing) {
            Intent stopIntent = new Intent(this, ScreenCaptureService.class);
            stopIntent.setAction(ScreenCaptureService.ACTION_STOP);
            startService(stopIntent);
            screenShareButton.setEnabled(false);
            screenShareStatus.setText("正在停止屏幕投影…");
        } else {
            requestScreenShare();
        }
    }

    private void requestScreenShare() {
        if (projectionRequestInFlight || screenSharing || !activityResumed) return;
        projectionRequestInFlight = true;
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        screenShareStatus.setText("请在系统弹窗中允许录制屏幕");
        projectionLauncher.launch(manager.createScreenCaptureIntent());
    }

    @Override protected void onResume() {
        super.onResume();
        activityResumed = true;
        syncScreenShareState();
        if (pendingAutoShare && socketConnected && !screenSharing) {
            pendingAutoShare = false;
            handler.postDelayed(() -> {
                if (activityResumed && socketConnected && !screenSharing) requestScreenShare();
            }, 450);
        }
        sensorTracker.start();
        socketClient.connect();
        glSurfaceView.onResume();
        if (arSession != null) {
            try { arSession.resume(); } catch (Exception ignored) { }
        }
        handler.removeCallbacks(sampleLoop);
        handler.post(sampleLoop);
    }

    @Override protected void onPause() {
        activityResumed = false;
        arSample = null;
        if (arSession != null) arSession.pause();
        glSurfaceView.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        handler.removeCallbacks(sampleLoop);
        sensorTracker.stop();
        socketClient.close();
        if (arSession != null) arSession.close();
        super.onDestroy();
    }

    private void updateArCoreAvailability() {
        ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
        if (availability.isSupported()) {
            arcoreStatus.setText("ARCore：设备支持，可启用 6DoF");
            if (availability == ArCoreApk.Availability.SUPPORTED_INSTALLED) enableArCore(false);
        } else if (availability.isTransient()) {
            arcoreStatus.setText("ARCore：正在检测设备能力…");
            handler.postDelayed(this::updateArCoreAvailability, 500);
        } else {
            arcoreStatus.setText("ARCore：此设备未认证，使用 Sensor 3DoF");
        }
    }

    private void enableArCore(boolean userRequested) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
            return;
        }
        try {
            ArCoreApk.InstallStatus installStatus = ArCoreApk.getInstance().requestInstall(this, userRequested);
            if (installStatus == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                arcoreStatus.setText("ARCore：请完成 Google Play Services for AR 安装");
                return;
            }
            if (arSession == null) {
                arSession = new Session(this);
                Config config = new Config(arSession);
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                arSession.configure(config);
                arRenderer.setSession(arSession);
            }
            arSession.resume();
            arcoreStatus.setText("ARCore：6DoF 已启用");
        } catch (Exception error) {
            arcoreStatus.setText("ARCore：不可用，已自动使用 Sensor 3DoF");
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            enableArCore(true);
        }
    }

    private void calibrate() {
        sensorTracker.calibrate();
        arRenderer.calibrate();
        trackingState.setText("● 静置采样中…");
        handler.postDelayed(() -> {
            if (sensorTracker.isCalibrating()) {
                trackingState.setText("● 请保持手机静止");
            } else {
                trackingState.setText("● 校准完成");
                handler.postDelayed(() -> trackingState.setText("● TRACKING"), 700);
            }
        }, 1100);
    }

    private void toggleTracking() {
        trackingEnabled = !trackingEnabled;
        trackingButton.setText(trackingEnabled ? "暂停追踪" : "继续追踪");
        trackingState.setText(trackingEnabled ? "● TRACKING" : "Ⅱ PAUSED");
    }

    private void publishSample() {
        MotionSample sample = arSample != null && "TRACKING".equals(arSample.tracking) ? arSample : sensorTracker.sample();
        if (trackingEnabled) socketClient.send(sample, sensorTracker.acceleration(), 30f);
        trackingMode.setText(sample.mode.replace('_', ' '));
        if (trackingEnabled) trackingState.setText("● " + sample.tracking);
        positionValue.setText(String.format(Locale.US, "X %+1.3f   Y %+1.3f   Z %+1.3f", sample.x, sample.y, sample.z));
        rotationValue.setText(String.format(Locale.US, "QX %+1.3f  QY %+1.3f\nQZ %+1.3f  QW %+1.3f", sample.qx, sample.qy, sample.qz, sample.qw));
    }

    @Override public void onConnectionChanged(boolean connected) {
        runOnUiThread(() -> {
            socketConnected = connected;
            connectionSummary.setText(connected ? "● 已连接电脑 · WebSocket 30Hz" : "未连接 · 点击下方按钮扫描网页连接码");
            if (connected && pendingAutoShare && activityResumed) {
                pendingAutoShare = false;
                handler.postDelayed(() -> {
                    if (activityResumed && socketConnected && !screenSharing) requestScreenShare();
                }, 450);
            }
            if (!connected && activityResumed) {
                handler.postDelayed(() -> {
                    if (activityResumed && !socketConnected) socketClient.connect();
                }, 1500);
            }
        });
    }

    @Override public void onCalibrationRequested() {
        runOnUiThread(this::calibrate);
    }

    private void syncScreenShareState() {
        boolean active = getSharedPreferences("motioncast_capture", MODE_PRIVATE).getBoolean("active", false);
        screenSharing = active;
        screenShareButton.setEnabled(true);
        screenShareButton.setText(active ? "停止实时投屏" : "开始实时投屏");
        if (active) screenShareStatus.setText("● 屏幕与姿态正在通过 Wi-Fi 同步");
    }

    private void handleCaptureStatus(int status, String message) {
        screenShareButton.setEnabled(true);
        if (status == ScreenCaptureService.STATUS_RUNNING) {
            screenSharing = true;
            screenShareButton.setText("停止实时投屏");
            screenShareStatus.setText("● " + (message == null ? "屏幕与姿态正在通过 Wi-Fi 同步" : message));
            return;
        }
        if (status == ScreenCaptureService.STATUS_STARTING) {
            screenShareButton.setEnabled(false);
            screenShareStatus.setText(message == null ? "正在启动实时投屏…" : message);
            return;
        }
        screenSharing = false;
        screenShareButton.setText("开始实时投屏");
        screenShareStatus.setText(message == null ? (status == ScreenCaptureService.STATUS_ERROR ? "投屏启动失败，请重试" : "屏幕投影已停止") : message);
    }
}
