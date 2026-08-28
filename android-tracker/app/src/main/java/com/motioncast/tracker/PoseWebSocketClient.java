package com.motioncast.tracker;

import androidx.annotation.NonNull;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class PoseWebSocketClient {
    public interface Listener {
        void onConnectionChanged(boolean connected);
        void onCalibrationRequested();
    }

    private final OkHttpClient client = new OkHttpClient.Builder().pingInterval(10, TimeUnit.SECONDS).build();
    private final Listener listener;
    private WebSocket socket;
    private long sequence;
    private String endpoint = "ws://127.0.0.1:8787/pose/publish";
    private String token = "";

    public PoseWebSocketClient(Listener listener) {
        this.listener = listener;
    }

    public void configure(String endpoint, String token) {
        this.endpoint = endpoint;
        this.token = token == null ? "" : token;
    }

    public void connect() {
        if (socket != null) return;
        String separator = endpoint.contains("?") ? "&" : "?";
        String socketUrl = token.isEmpty() ? endpoint + separator + "source=activity" : endpoint + separator + "token=" + token + "&source=activity";
        Request request = new Request.Builder().url(socketUrl).build();
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                listener.onConnectionChanged(true);
            }

            @Override public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                try {
                    JSONObject payload = new JSONObject(text);
                    if ("command".equals(payload.optString("type")) && "calibrate".equals(payload.optString("command"))) {
                        listener.onCalibrationRequested();
                    }
                } catch (JSONException ignored) { }
            }

            @Override public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                if (socket == webSocket) {
                    socket = null;
                    listener.onConnectionChanged(false);
                }
            }

            @Override public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable error, Response response) {
                if (socket == webSocket) {
                    socket = null;
                    listener.onConnectionChanged(false);
                }
            }
        });
    }

    public void send(MotionSample sample, float[] acceleration, float fps) {
        if (socket == null) return;
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

    public void close() {
        if (socket != null) socket.close(1000, "activity stopped");
        socket = null;
    }

    private static JSONObject vector(float x, float y, float z) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("x", x);
        result.put("y", y);
        result.put("z", z);
        return result;
    }
}
