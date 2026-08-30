package com.motioncast.tracker;

import android.content.SharedPreferences;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.view.Window;
import android.widget.Button;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;
import java.util.Locale;

public final class MainActivity extends ComponentActivity implements PoseWebSocketClient.Listener {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable sampleLoop = new Runnable() {
        @Override public void run() {
            publishSample();
            handler.postDelayed(this, 33);
        }
    };

    private SensorPoseTracker sensorTracker;
    private PoseWebSocketClient socketClient;
    private boolean trackingEnabled = true;
    private boolean socketConnected;
    private boolean activityResumed;
    private boolean connectionRequested;

    private TextView connectionSummary;
    private TextView trackingMode;
    private TextView trackingState;
    private TextView rotationValue;
    private Button trackingButton;
    private String endpoint;
    private String connectionToken;
    private boolean screenSharing;
    private boolean projectionRequestInFlight;
    private boolean stopRequestInFlight;
    private Button screenShareButton;
    private Button stopScreenShareButton;
    private TextView screenShareStatus;
    private ResultReceiver captureStatusReceiver;
    private final ActivityResultLauncher<ScanOptions> barcodeLauncher = registerForActivityResult(
        new ScanContract(), this::handleScanResult
    );
    private final ActivityResultLauncher<Intent> projectionLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            projectionRequestInFlight = false;
            if (result.getResultCode() != RESULT_OK || result.getData() == null) {
                screenSharing = false;
                screenShareStatus.setText("未授权屏幕录制，点击按钮可重新授权");
                updateScreenShareControls();
                return;
            }
            try {
                Intent serviceIntent = new Intent(this, ScreenCaptureService.class);
                serviceIntent.setAction(ScreenCaptureService.ACTION_START);
                serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
                serviceIntent.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, result.getData());
                serviceIntent.putExtra(ScreenCaptureService.EXTRA_STATUS_RECEIVER, captureStatusReceiver);
                ContextCompat.startForegroundService(this, serviceIntent);
                screenSharing = true;
                screenShareStatus.setText("正在启动编码器与 Wi-Fi 画面通道…");
                updateScreenShareControls();
            } catch (Exception error) {
                screenSharing = false;
                screenShareStatus.setText("无法启动实时投屏，请重试");
                updateScreenShareControls();
            }
        }
    );

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(R.layout.activity_main);

        connectionSummary = findViewById(R.id.connection_summary);
        trackingMode = findViewById(R.id.tracking_mode);
        trackingState = findViewById(R.id.tracking_state);
        rotationValue = findViewById(R.id.rotation_value);
        trackingButton = findViewById(R.id.tracking_button);
        screenShareButton = findViewById(R.id.screen_share_button);
        stopScreenShareButton = findViewById(R.id.stop_screen_share_button);
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

        findViewById(R.id.calibrate_button).setOnClickListener(view -> calibrate());
        trackingButton.setOnClickListener(view -> toggleTracking());
        findViewById(R.id.scan_button).setOnClickListener(view -> startQrScan());
        screenShareButton.setOnClickListener(view -> requestScreenShare());
        stopScreenShareButton.setOnClickListener(view -> stopScreenShare());
        updateScreenShareControls();
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
            connectionRequested = true;
            socketClient.connect();
            connectionSummary.setText("正在连接电脑 " + websocketUri.getHost() + "…");
            screenShareStatus.setText("正在连接，成功后可手动开始实时投屏");
            updateScreenShareControls();
        } catch (Exception error) {
            connectionSummary.setText("连接码无效，请扫描网页当前显示的二维码");
        }
    }

    private void stopScreenShare() {
        boolean active = getSharedPreferences("motioncast_capture", MODE_PRIVATE).getBoolean("active", false);
        if (stopRequestInFlight || (!screenSharing && !active)) return;
        stopRequestInFlight = true;
        Intent stopIntent = new Intent(this, ScreenCaptureService.class);
        stopIntent.setAction(ScreenCaptureService.ACTION_STOP);
        startService(stopIntent);
        screenShareStatus.setText("正在停止屏幕投影…");
        updateScreenShareControls();
        handler.postDelayed(() -> {
            stopRequestInFlight = false;
            syncScreenShareState();
        }, 800);
    }

    private void requestScreenShare() {
        if (projectionRequestInFlight || screenSharing || !activityResumed) return;
        if (!socketConnected) {
            screenShareStatus.setText("请先扫码并等待电脑连接成功");
            updateScreenShareControls();
            return;
        }
        projectionRequestInFlight = true;
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        screenShareStatus.setText("请在系统弹窗中允许录制屏幕");
        updateScreenShareControls();
        projectionLauncher.launch(manager.createScreenCaptureIntent());
    }

    @Override protected void onResume() {
        super.onResume();
        activityResumed = true;
        syncScreenShareState();
        sensorTracker.start();
        if (connectionRequested) socketClient.connect();
        handler.removeCallbacks(sampleLoop);
        handler.post(sampleLoop);
    }

    @Override protected void onPause() {
        activityResumed = false;
        super.onPause();
    }

    @Override protected void onDestroy() {
        handler.removeCallbacks(sampleLoop);
        sensorTracker.stop();
        connectionRequested = false;
        socketClient.close();
        if (isFinishing() && getSharedPreferences("motioncast_capture", MODE_PRIVATE).getBoolean("active", false)) {
            Intent stopIntent = new Intent(this, ScreenCaptureService.class);
            stopIntent.setAction(ScreenCaptureService.ACTION_STOP);
            startService(stopIntent);
        }
        super.onDestroy();
    }

    private void calibrate() {
        sensorTracker.calibrate();
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
        MotionSample sample = sensorTracker.sample();
        if (trackingEnabled) socketClient.send(sample, sensorTracker.acceleration(), 30f);
        trackingMode.setText(sample.mode.replace('_', ' '));
        if (trackingEnabled) trackingState.setText("● " + sample.tracking);
        rotationValue.setText(String.format(Locale.US, "QX %+1.3f  QY %+1.3f\nQZ %+1.3f  QW %+1.3f", sample.qx, sample.qy, sample.qz, sample.qw));
    }

    @Override public void onConnectionChanged(boolean connected) {
        runOnUiThread(() -> {
            socketConnected = connected;
            connectionSummary.setText(connected ? "● 已连接电脑 · WebSocket 30Hz" : "未连接 · 点击下方按钮扫描网页连接码");
            if (!screenSharing) {
                screenShareStatus.setText(connected ? "电脑已连接，点击下方按钮开始实时投屏" : "请先扫码连接电脑");
            } else if (!connected) {
                screenShareStatus.setText("电脑连接中断，画面通道正在重连…");
            }
            updateScreenShareControls();
            if (!connected && activityResumed && connectionRequested) {
                handler.postDelayed(() -> {
                    if (activityResumed && connectionRequested && !socketConnected) socketClient.connect();
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
        if (active) screenShareStatus.setText("● 屏幕与姿态正在通过 Wi-Fi 同步");
        updateScreenShareControls();
    }

    private void handleCaptureStatus(int status, String message) {
        stopRequestInFlight = false;
        if (status == ScreenCaptureService.STATUS_RUNNING) {
            screenSharing = true;
            screenShareStatus.setText("● " + (message == null ? "屏幕与姿态正在通过 Wi-Fi 同步" : message));
            updateScreenShareControls();
            return;
        }
        if (status == ScreenCaptureService.STATUS_STARTING) {
            screenSharing = true;
            screenShareStatus.setText(message == null ? "正在启动实时投屏…" : message);
            updateScreenShareControls();
            return;
        }
        screenSharing = false;
        screenShareStatus.setText(message == null ? (status == ScreenCaptureService.STATUS_ERROR ? "投屏启动失败，请重试" : "屏幕投影已停止") : message);
        updateScreenShareControls();
    }

    private void updateScreenShareControls() {
        if (stopRequestInFlight) {
            screenShareButton.setEnabled(false);
            screenShareButton.setText("正在停止");
            stopScreenShareButton.setEnabled(false);
            return;
        }
        if (projectionRequestInFlight) {
            screenShareButton.setEnabled(false);
            screenShareButton.setText("等待系统授权");
            stopScreenShareButton.setEnabled(false);
            return;
        }
        if (screenSharing) {
            screenShareButton.setEnabled(false);
            screenShareButton.setText("投屏进行中");
            stopScreenShareButton.setEnabled(true);
            return;
        }
        screenShareButton.setEnabled(socketConnected);
        screenShareButton.setText(socketConnected ? "开始投屏" : "请先连接电脑");
        stopScreenShareButton.setEnabled(false);
    }
}
