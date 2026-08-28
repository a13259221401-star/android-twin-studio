package com.motioncast.tracker;

import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import com.google.ar.core.Camera;
import com.google.ar.core.Frame;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

public final class ArCoreRenderer implements GLSurfaceView.Renderer {
    private static final float POSITION_DEAD_ZONE_METERS = 0.0025f;
    private static final float ROTATION_DEAD_ZONE_DEGREES = 0.22f;
    public interface Listener { void onPose(MotionSample pose); }

    private final Listener listener;
    private volatile Session session;
    private Pose calibrationPose;
    private final float[] yawZero = new float[]{0f, 0f, 0f, 1f};
    private final float[] filteredTranslation = new float[3];
    private final float[] filteredRotation = new float[]{0f, 0f, 0f, 1f};
    private boolean filterReady;
    private int cameraTexture;

    public ArCoreRenderer(Listener listener) {
        this.listener = listener;
    }

    public void setSession(Session session) {
        this.session = session;
        this.calibrationPose = null;
        if (cameraTexture != 0) session.setCameraTextureName(cameraTexture);
    }

    public void clearSession() {
        session = null;
        calibrationPose = null;
    }

    public void calibrate() {
        calibrationPose = null;
        yawZero[0] = yawZero[1] = yawZero[2] = 0f;
        yawZero[3] = 1f;
        filterReady = false;
    }

    @Override public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        cameraTexture = textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTexture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        Session active = session;
        if (active != null) active.setCameraTextureName(cameraTexture);
    }

    @Override public void onSurfaceChanged(GL10 gl, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
    }

    @Override public void onDrawFrame(GL10 gl) {
        GLES20.glClearColor(0f, 0f, 0f, 0f);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        Session active = session;
        if (active == null) return;
        try {
            active.setCameraTextureName(cameraTexture);
            Frame frame = active.update();
            Camera camera = frame.getCamera();
            if (camera.getTrackingState() != TrackingState.TRACKING) {
                listener.onPose(new MotionSample(0, 0, 0, 0, 0, 0, 1, "ARCORE_6DOF", "LIMITED"));
                return;
            }
            Pose current = camera.getDisplayOrientedPose();
            if (calibrationPose == null) {
                calibrationPose = current;
                setYawZero(current.getRotationQuaternion());
            }
            Pose relative = calibrationPose.inverse().compose(current);
            float[] translation = relative.getTranslation();
            float[] rotation = multiply(inverse(yawZero), current.getRotationQuaternion());
            stabilize(translation, rotation);
            listener.onPose(new MotionSample(
                filteredTranslation[0], filteredTranslation[1], filteredTranslation[2],
                filteredRotation[0], filteredRotation[1], filteredRotation[2], filteredRotation[3],
                "ARCORE_6DOF", "TRACKING"
            ));
        } catch (Exception ignored) { }
    }

    private void setYawZero(float[] rotation) {
        float x = rotation[0];
        float y = rotation[1];
        float z = rotation[2];
        float w = rotation[3];
        float forwardX = 2f * (x * z + w * y);
        float forwardZ = 1f - 2f * (x * x + y * y);
        float upX = 2f * (x * y - w * z);
        float upZ = 2f * (y * z + w * x);
        float forwardLength = forwardX * forwardX + forwardZ * forwardZ;
        float upLength = upX * upX + upZ * upZ;
        float yaw = forwardLength >= upLength
            ? (float) Math.atan2(forwardX, forwardZ)
            : (float) Math.atan2(upX, upZ);
        float half = yaw * 0.5f;
        yawZero[0] = 0f;
        yawZero[1] = (float) Math.sin(half);
        yawZero[2] = 0f;
        yawZero[3] = (float) Math.cos(half);
    }

    private static float[] inverse(float[] value) {
        return new float[]{-value[0], -value[1], -value[2], value[3]};
    }

    private static float[] multiply(float[] a, float[] b) {
        return new float[]{
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
        };
    }

    private void stabilize(float[] translation, float[] rotation) {
        if (!filterReady) {
            System.arraycopy(translation, 0, filteredTranslation, 0, 3);
            System.arraycopy(rotation, 0, filteredRotation, 0, 4);
            filterReady = true;
            return;
        }

        for (int index = 0; index < 3; index++) {
            float delta = translation[index] - filteredTranslation[index];
            if (Math.abs(delta) > POSITION_DEAD_ZONE_METERS) {
                filteredTranslation[index] += delta * (Math.abs(delta) > 0.08f ? 0.46f : 0.18f);
            }
        }

        float dot = filteredRotation[0] * rotation[0] + filteredRotation[1] * rotation[1]
            + filteredRotation[2] * rotation[2] + filteredRotation[3] * rotation[3];
        float angle = (float) Math.toDegrees(2.0 * Math.acos(Math.min(1.0, Math.abs(dot))));
        if (angle <= ROTATION_DEAD_ZONE_DEGREES) return;
        float sign = dot < 0f ? -1f : 1f;
        float alpha = angle > 10f ? 0.45f : angle > 2f ? 0.26f : 0.16f;
        float length = 0f;
        for (int index = 0; index < 4; index++) {
            filteredRotation[index] += (rotation[index] * sign - filteredRotation[index]) * alpha;
            length += filteredRotation[index] * filteredRotation[index];
        }
        length = (float) Math.sqrt(length);
        if (length > 0.000001f) {
            for (int index = 0; index < 4; index++) filteredRotation[index] /= length;
        }
    }
}
