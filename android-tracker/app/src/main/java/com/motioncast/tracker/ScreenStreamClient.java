package com.motioncast.tracker;

import androidx.annotation.NonNull;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONException;
import org.json.JSONObject;

public final class ScreenStreamClient {
    public interface Listener {
        void onStreamConnectionChanged(boolean connected);
        void onStreamCalibrationRequested();
        void onStreamKeyFrameRequested();
    }

    private static final byte[] MAGIC = new byte[]{'M', 'C', 'S', 'V'};
    private final OkHttpClient client = new OkHttpClient.Builder()
        .pingInterval(8, TimeUnit.SECONDS)
        .build();
    private final Listener listener;
    private WebSocket socket;
    private boolean connected;
    private String endpoint;
    private String token;
    private long sequence;

    public ScreenStreamClient(Listener listener, String endpoint, String token) {
        this.listener = listener;
        this.endpoint = endpoint;
        this.token = token == null ? "" : token;
    }

    public synchronized void connect() {
        if (socket != null) return;
        String separator = endpoint.contains("?") ? "&" : "?";
        String url = token.isEmpty() ? endpoint + separator + "source=projection" : endpoint + separator + "token=" + token + "&source=projection";
        Request request = new Request.Builder().url(url).build();
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                synchronized (ScreenStreamClient.this) {
                    if (socket != webSocket) return;
                    connected = true;
                }
                listener.onStreamConnectionChanged(true);
            }

            @Override public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                try {
                    JSONObject payload = new JSONObject(text);
                    if ("command".equals(payload.optString("type"))) {
                        String command = payload.optString("command");
                        if ("calibrate".equals(command)) listener.onStreamCalibrationRequested();
                        if ("request-keyframe".equals(command)) listener.onStreamKeyFrameRequested();
                    }
                } catch (JSONException ignored) { }
            }

            @Override public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                clearSocket(webSocket);
            }

            @Override public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable error, Response response) {
                clearSocket(webSocket);
            }
        });
    }

    private synchronized void clearSocket(WebSocket webSocket) {
        if (socket == webSocket) {
            socket = null;
            connected = false;
            listener.onStreamConnectionChanged(false);
        }
    }

    public synchronized void sendVideoConfig(int width, int height, int fps, int bitrate) {
        if (socket == null || !connected) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("type", "video-config");
            payload.put("codec", "avc1.42E032");
            payload.put("width", width);
            payload.put("height", height);
            payload.put("fps", fps);
            payload.put("bitrate", bitrate);
            socket.send(payload.toString());
        } catch (JSONException ignored) { }
    }

    public synchronized boolean sendVideoFrame(byte[] accessUnit, boolean keyFrame, long timestampUs) {
        if (socket == null || !connected || accessUnit.length == 0) return false;
        ByteBuffer packet = ByteBuffer.allocate(16 + accessUnit.length).order(ByteOrder.BIG_ENDIAN);
        packet.put(MAGIC);
        packet.put((byte) 1);
        packet.put((byte) (keyFrame ? 1 : 0));
        packet.putShort((short) 0);
        packet.putLong(timestampUs);
        packet.put(accessUnit);
        return socket.send(ByteString.of(packet.array()));
    }

    public synchronized void sendPose(MotionSample sample, float[] acceleration, float fps) {
        if (socket == null || !connected) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("type", "pose");
            payload.put("seq", ++sequence);
            payload.put("timestamp", System.currentTimeMillis());
            payload.put("tracking", sample.tracking);
            payload.put("mode", sample.mode);
            payload.put("fps", fps);
            payload.put("position", vector(sample.x, sample.y, sample.z));
            JSONObject rotation = new JSONObject();
            rotation.put("x", sample.qx);
            rotation.put("y", sample.qy);
            rotation.put("z", sample.qz);
            rotation.put("w", sample.qw);
            payload.put("rotation", rotation);
            payload.put("acceleration", vector(acceleration[0], acceleration[1], acceleration[2]));
            socket.send(payload.toString());
        } catch (JSONException ignored) { }
    }

    public synchronized void close() {
        WebSocket current = socket;
        socket = null;
        connected = false;
        if (current != null) current.close(1000, "screen capture stopped");
        listener.onStreamConnectionChanged(false);
    }

    private static JSONObject vector(float x, float y, float z) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("x", x);
        result.put("y", y);
        result.put("z", z);
        return result;
    }
}
