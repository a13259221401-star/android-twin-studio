package com.motioncast.tracker;

public final class MotionSample {
    public final float x;
    public final float y;
    public final float z;
    public final float qx;
    public final float qy;
    public final float qz;
    public final float qw;
    public final String mode;
    public final String tracking;

    public MotionSample(float x, float y, float z, float qx, float qy, float qz, float qw, String mode, String tracking) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.qx = qx;
        this.qy = qy;
        this.qz = qz;
        this.qw = qw;
        this.mode = mode;
        this.tracking = tracking;
    }
}
