package com.motioncast.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.ResultReceiver;
import android.util.DisplayMetrics;
import android.view.Surface;
import android.view.WindowManager;
import android.view.WindowMetrics;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public final class ScreenCaptureService extends Service implements ScreenStreamClient.Listener {
    public static final String ACTION_START = "com.motioncast.tracker.START_CAPTURE";
    public static final String ACTION_STOP = "com.motioncast.tracker.STOP_CAPTURE";
    public static final String EXTRA_RESULT_CODE = "result_code";
    public static final String EXTRA_RESULT_DATA = "result_data";
    public static final String EXTRA_STATUS_RECEIVER = "status_receiver";
    public static final String EXTRA_STATUS_MESSAGE = "status_message";
    public static final int STATUS_STARTING = 1;
    public static final int STATUS_RUNNING = 2;
    public static final int STATUS_STOPPED = 3;
    public static final int STATUS_ERROR = 4;
    private static final String CHANNEL_ID = "motioncast_projection";
    private static final int NOTIFICATION_ID = 1107;
    private static final int FPS = 30;
    private static final int BITRATE = 8_000_000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable poseLoop = new Runnable() {
        @Override public void run() {
            if (sensorTracker != null && streamClient != null) {
                streamClient.sendPose(sensorTracker.sample(), sensorTracker.acceleration(), FPS);
            }
            mainHandler.postDelayed(this, 33);
        }
    };

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private MediaCodec encoder;
    private Surface encoderSurface;
    private HandlerThread codecThread;
    private ScreenStreamClient streamClient;
    private SensorPoseTracker sensorTracker;
    private byte[] csd0;
    private byte[] csd1;
    private int captureWidth;
    private int captureHeight;
    private boolean stopping;
    private boolean captureRunning;
    private ResultReceiver statusReceiver;

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopCapture();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action) || intent == null) return START_NOT_STICKY;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            statusReceiver = intent.getParcelableExtra(EXTRA_STATUS_RECEIVER, ResultReceiver.class);
        } else {
            statusReceiver = intent.getParcelableExtra(EXTRA_STATUS_RECEIVER);
        }

        startProjectionForeground();
        sendStatus(STATUS_STARTING, "正在启动屏幕编码器…");
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultData == null) {
            failCapture("系统没有返回有效的录屏授权");
            return START_NOT_STICKY;
        }

        try {
            startCapture(resultCode, resultData);
            captureRunning = true;
            getSharedPreferences("motioncast_capture", MODE_PRIVATE).edit().putBoolean("active", true).apply();
            sendStatus(STATUS_RUNNING, "屏幕与姿态正在通过 Wi-Fi 同步");
        } catch (Exception error) {
            String message = error.getMessage();
            failCapture(message == null || message.trim().isEmpty() ? "投屏启动失败，请重试" : "投屏启动失败：" + message);
        }
        return START_NOT_STICKY;
    }

    private void startProjectionForeground() {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setContentTitle("MotionCast 正在实时投屏")
            .setContentText("屏幕和手机姿态正在同步到本地网页")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startCapture(int resultCode, Intent resultData) throws Exception {
        stopping = true;
        stopCaptureResources();
        stopping = false;

        String endpoint = getSharedPreferences("motioncast_connection", MODE_PRIVATE)
            .getString("endpoint", "ws://127.0.0.1:8787/pose/publish");
        String token = getSharedPreferences("motioncast_connection", MODE_PRIVATE)
            .getString("token", "");
        streamClient = new ScreenStreamClient(this, endpoint, token);
        streamClient.connect();

        sensorTracker = new SensorPoseTracker(this);
        sensorTracker.start();
        mainHandler.post(poseLoop);

        int[] size = captureSize();
        captureWidth = size[0];
        captureHeight = size[1];

        MediaFormat format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, captureWidth, captureHeight);
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        format.setInteger(MediaFormat.KEY_BIT_RATE, BITRATE);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, FPS);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
        format.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) format.setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) format.setInteger(MediaFormat.KEY_PREPEND_HEADER_TO_SYNC_FRAMES, 1);

        codecThread = new HandlerThread("MotionCastEncoder");
        codecThread.start();
        encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        encoder.setCallback(codecCallback, new Handler(codecThread.getLooper()));
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        encoderSurface = encoder.createInputSurface();
        encoder.start();

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) throw new IllegalStateException("MediaProjection permission missing");
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() {
                stopCapture();
            }
        }, mainHandler);

        int density = getResources().getDisplayMetrics().densityDpi;
        virtualDisplay = projection.createVirtualDisplay(
            "MotionCastScreen",
            captureWidth,
            captureHeight,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            encoderSurface,
            null,
            null
        );
    }

    private final MediaCodec.Callback codecCallback = new MediaCodec.Callback() {
        @Override public void onInputBufferAvailable(@NonNull MediaCodec codec, int index) { }

        @Override public void onOutputBufferAvailable(@NonNull MediaCodec codec, int index, @NonNull MediaCodec.BufferInfo info) {
            try {
                ByteBuffer buffer = codec.getOutputBuffer(index);
                if (buffer == null || info.size <= 0) return;
                buffer.position(info.offset);
                buffer.limit(info.offset + info.size);
                byte[] encoded = new byte[info.size];
                buffer.get(encoded);
                if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) return;

                boolean keyFrame = (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0;
                byte[] accessUnit = toAnnexB(encoded);
                if (keyFrame) accessUnit = withParameterSets(accessUnit);
                ScreenStreamClient client = streamClient;
                if (client != null) client.sendVideoFrame(accessUnit, keyFrame, info.presentationTimeUs);
            } finally {
                try { codec.releaseOutputBuffer(index, false); } catch (Exception ignored) { }
            }
        }

        @Override public void onError(@NonNull MediaCodec codec, @NonNull MediaCodec.CodecException error) {
            mainHandler.post(() -> failCapture("屏幕编码器异常：" + error.getDiagnosticInfo()));
        }

        @Override public void onOutputFormatChanged(@NonNull MediaCodec codec, @NonNull MediaFormat format) {
            csd0 = copyBuffer(format.getByteBuffer("csd-0"));
            csd1 = copyBuffer(format.getByteBuffer("csd-1"));
            ScreenStreamClient client = streamClient;
            if (client != null) client.sendVideoConfig(captureWidth, captureHeight, FPS, BITRATE);
        }
    };

    @Override public void onStreamConnectionChanged(boolean connected) {
        if (connected) {
            ScreenStreamClient client = streamClient;
            if (client != null && captureWidth > 0) client.sendVideoConfig(captureWidth, captureHeight, FPS, BITRATE);
            requestKeyFrame();
        } else if (!stopping) {
            mainHandler.postDelayed(() -> {
                ScreenStreamClient current = streamClient;
                if (!stopping && current != null) current.connect();
            }, 1500);
        }
    }

    @Override public void onStreamCalibrationRequested() {
        mainHandler.post(() -> {
            if (sensorTracker != null) sensorTracker.calibrate();
        });
    }

    @Override public void onStreamKeyFrameRequested() {
        mainHandler.post(this::requestKeyFrame);
    }

    private void requestKeyFrame() {
        MediaCodec current = encoder;
        if (current == null) return;
        try {
            Bundle parameters = new Bundle();
            parameters.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
            current.setParameters(parameters);
        } catch (Exception ignored) { }
    }

    private int[] captureSize() {
        WindowManager windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        int width;
        int height;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowMetrics metrics = windowManager.getMaximumWindowMetrics();
            Rect bounds = metrics.getBounds();
            width = bounds.width();
            height = bounds.height();
        } else {
            DisplayMetrics metrics = new DisplayMetrics();
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
            width = metrics.widthPixels;
            height = metrics.heightPixels;
        }
        double scale = Math.min(1.0, Math.min(1080.0 / Math.min(width, height), 1920.0 / Math.max(width, height)));
        return new int[]{even((int) Math.round(width * scale)), even((int) Math.round(height * scale))};
    }

    private static int even(int value) {
        return Math.max(2, value - (value % 2));
    }

    private byte[] withParameterSets(byte[] accessUnit) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (csd0 != null) output.write(toAnnexB(csd0));
            if (csd1 != null) output.write(toAnnexB(csd1));
            output.write(accessUnit);
            return output.toByteArray();
        } catch (Exception ignored) {
            return accessUnit;
        }
    }

    private static byte[] copyBuffer(ByteBuffer source) {
        if (source == null) return null;
        ByteBuffer copy = source.duplicate();
        byte[] result = new byte[copy.remaining()];
        copy.get(result);
        return result;
    }

    private static byte[] toAnnexB(byte[] value) {
        if (value.length < 4 || startsWithStartCode(value)) return value;
        try {
            ByteBuffer input = ByteBuffer.wrap(value).order(ByteOrder.BIG_ENDIAN);
            ByteArrayOutputStream output = new ByteArrayOutputStream(value.length + 32);
            while (input.remaining() >= 4) {
                int length = input.getInt();
                if (length <= 0 || length > input.remaining()) throw new IllegalArgumentException("invalid NAL length");
                output.write(new byte[]{0, 0, 0, 1});
                byte[] nal = new byte[length];
                input.get(nal);
                output.write(nal);
            }
            if (input.hasRemaining()) throw new IllegalArgumentException("trailing NAL bytes");
            return output.toByteArray();
        } catch (Exception ignored) {
            byte[] result = new byte[value.length + 4];
            result[3] = 1;
            System.arraycopy(value, 0, result, 4, value.length);
            return result;
        }
    }

    private static boolean startsWithStartCode(byte[] value) {
        return value.length >= 4 && value[0] == 0 && value[1] == 0 &&
            (value[2] == 1 || (value[2] == 0 && value[3] == 1));
    }

    private void stopCapture() {
        if (stopping) return;
        stopping = true;
        stopCaptureResources();
        captureRunning = false;
        getSharedPreferences("motioncast_capture", MODE_PRIVATE).edit().putBoolean("active", false).apply();
        sendStatus(STATUS_STOPPED, "屏幕投影已停止");
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void failCapture(String message) {
        if (stopping) return;
        stopping = true;
        stopCaptureResources();
        captureRunning = false;
        getSharedPreferences("motioncast_capture", MODE_PRIVATE).edit().putBoolean("active", false).apply();
        sendStatus(STATUS_ERROR, message);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void sendStatus(int status, String message) {
        ResultReceiver receiver = statusReceiver;
        if (receiver == null) return;
        Bundle payload = new Bundle();
        payload.putString(EXTRA_STATUS_MESSAGE, message);
        receiver.send(status, payload);
    }

    private void stopCaptureResources() {
        mainHandler.removeCallbacks(poseLoop);
        if (sensorTracker != null) sensorTracker.stop();
        sensorTracker = null;
        if (virtualDisplay != null) virtualDisplay.release();
        virtualDisplay = null;
        if (projection != null) projection.stop();
        projection = null;
        if (encoder != null) {
            try { encoder.stop(); } catch (Exception ignored) { }
            encoder.release();
        }
        encoder = null;
        if (encoderSurface != null) encoderSurface.release();
        encoderSurface = null;
        if (codecThread != null) codecThread.quitSafely();
        codecThread = null;
        if (streamClient != null) streamClient.close();
        streamClient = null;
        csd0 = null;
        csd1 = null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "实时屏幕同步",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("MotionCast 本地网页实时投屏状态");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Nullable @Override public IBinder onBind(Intent intent) {
        return null;
    }

    @Override public void onDestroy() {
        stopping = true;
        stopCaptureResources();
        getSharedPreferences("motioncast_capture", MODE_PRIVATE).edit().putBoolean("active", false).apply();
        if (captureRunning) sendStatus(STATUS_STOPPED, "屏幕投影已停止");
        captureRunning = false;
        super.onDestroy();
    }
}
