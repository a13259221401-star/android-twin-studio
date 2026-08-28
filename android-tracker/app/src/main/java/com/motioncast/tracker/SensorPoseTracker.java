package com.motioncast.tracker;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.content.SharedPreferences;

public final class SensorPoseTracker implements SensorEventListener {
    private static final int CALIBRATION_SAMPLES = 30;
    private static final float CALIBRATION_MAX_STEP_DEGREES = 0.7f;
    private static final float ROTATION_DEAD_ZONE_DEGREES = 0.28f;
    private final SensorManager sensorManager;
    private final SharedPreferences preferences;
    private final Sensor rotationSensor;
    private final Sensor accelerationSensor;
    private final float[] quaternion = new float[]{1f, 0f, 0f, 0f};
    private final float[] zero = new float[]{1f, 0f, 0f, 0f};
    private final float[] acceleration = new float[3];
    private final float[] calibrationSum = new float[4];
    private final float[] previousCalibrationSample = new float[4];
    private final float[] filteredRelative = new float[]{1f, 0f, 0f, 0f};
    private boolean calibrated;
    private boolean calibrating;
    private boolean filterReady;
    private int calibrationSampleCount;

    public SensorPoseTracker(Context context) {
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        preferences = context.getSharedPreferences("motioncast_pose", Context.MODE_PRIVATE);
        Sensor gameRotation = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
        rotationSensor = gameRotation != null ? gameRotation : sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        accelerationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
        float savedYaw = preferences.getFloat("sensor_yaw_zero", Float.NaN);
        if (Float.isFinite(savedYaw)) {
            setYawZero(savedYaw);
            calibrated = true;
        }
    }

    public void start() {
        if (rotationSensor != null) sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
        if (accelerationSensor != null) sensorManager.registerListener(this, accelerationSensor, SensorManager.SENSOR_DELAY_GAME);
    }

    public void stop() {
        sensorManager.unregisterListener(this);
    }

    public boolean hasRotationSensor() {
        return rotationSensor != null;
    }

    public synchronized void calibrate() {
        calibrating = true;
        calibrated = false;
        filterReady = false;
        calibrationSampleCount = 0;
        for (int index = 0; index < 4; index++) calibrationSum[index] = 0f;
    }

    public synchronized boolean isCalibrating() {
        return calibrating;
    }

    public synchronized MotionSample sample() {
        if (!calibrated && !calibrating) calibrate();
        if (calibrating || !calibrated) {
            return new MotionSample(0f, 0f, 0f, 0f, 0f, 0f, 1f, "SENSOR_3DOF", "CALIBRATING");
        }

        float[] relative = normalize(multiply(inverse(zero), quaternion));
        if (relative[0] < 0f) negate(relative);
        if (!filterReady) {
            System.arraycopy(relative, 0, filteredRelative, 0, 4);
            filterReady = true;
        } else {
            float angle = angleDegrees(filteredRelative, relative);
            if (angle > ROTATION_DEAD_ZONE_DEGREES) {
                float alpha = angle > 12f ? 0.42f : angle > 3f ? 0.25f : 0.14f;
                nlerp(filteredRelative, relative, alpha, filteredRelative);
            }
        }
        return new MotionSample(0f, 0f, 0f, filteredRelative[1], filteredRelative[2], filteredRelative[3], filteredRelative[0], "SENSOR_3DOF", "TRACKING");
    }

    public float[] acceleration() {
        return acceleration.clone();
    }

    @Override
    public synchronized void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_GAME_ROTATION_VECTOR || event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
            SensorManager.getQuaternionFromVector(quaternion, event.values);
            normalizeInPlace(quaternion);
            collectCalibrationSample();
        } else if (event.sensor.getType() == Sensor.TYPE_LINEAR_ACCELERATION) {
            System.arraycopy(event.values, 0, acceleration, 0, Math.min(3, event.values.length));
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private void collectCalibrationSample() {
        if (!calibrating) return;
        if (calibrationSampleCount > 0 && angleDegrees(previousCalibrationSample, quaternion) > CALIBRATION_MAX_STEP_DEGREES) {
            calibrationSampleCount = 0;
            for (int index = 0; index < 4; index++) calibrationSum[index] = 0f;
        }

        float sign = calibrationSampleCount > 0 && dot(calibrationSum, quaternion) < 0f ? -1f : 1f;
        for (int index = 0; index < 4; index++) {
            calibrationSum[index] += quaternion[index] * sign;
            previousCalibrationSample[index] = quaternion[index];
        }
        calibrationSampleCount++;

        if (calibrationSampleCount >= CALIBRATION_SAMPLES) {
            float[] stableZero = normalize(calibrationSum);
            float yaw = yawRadians(stableZero);
            setYawZero(yaw);
            preferences.edit().putFloat("sensor_yaw_zero", yaw).apply();
            calibrated = true;
            calibrating = false;
            filterReady = false;
        }
    }

    private void setYawZero(float yaw) {
        float half = yaw * 0.5f;
        zero[0] = (float) Math.cos(half);
        zero[1] = 0f;
        zero[2] = 0f;
        zero[3] = (float) Math.sin(half);
    }

    private static float yawRadians(float[] value) {
        float w = value[0];
        float x = value[1];
        float y = value[2];
        float z = value[3];
        return (float) Math.atan2(
            2f * (w * z + x * y),
            1f - 2f * (y * y + z * z)
        );
    }

    private static float[] inverse(float[] value) {
        return new float[]{value[0], -value[1], -value[2], -value[3]};
    }

    private static float[] multiply(float[] a, float[] b) {
        return new float[]{
            a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
            a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
            a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
            a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
        };
    }

    private static float dot(float[] a, float[] b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    }

    private static float angleDegrees(float[] a, float[] b) {
        float cosine = Math.min(1f, Math.abs(dot(a, b)));
        return (float) Math.toDegrees(2.0 * Math.acos(cosine));
    }

    private static float[] normalize(float[] value) {
        float[] result = value.clone();
        normalizeInPlace(result);
        return result;
    }

    private static void normalizeInPlace(float[] value) {
        float length = (float) Math.sqrt(dot(value, value));
        if (length < 0.000001f) {
            value[0] = 1f;
            value[1] = value[2] = value[3] = 0f;
            return;
        }
        for (int index = 0; index < 4; index++) value[index] /= length;
    }

    private static void negate(float[] value) {
        for (int index = 0; index < 4; index++) value[index] = -value[index];
    }

    private static void nlerp(float[] from, float[] to, float alpha, float[] output) {
        float sign = dot(from, to) < 0f ? -1f : 1f;
        for (int index = 0; index < 4; index++) {
            output[index] = from[index] + (to[index] * sign - from[index]) * alpha;
        }
        normalizeInPlace(output);
    }
}
