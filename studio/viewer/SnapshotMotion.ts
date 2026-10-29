/** Visual interpolation of sampled positions. Never invents route steps or extrapolates. */
export class SnapshotMotion {
    private samples = new WeakMap<object, { fromX: number; fromZ: number; x: number; z: number; at: number; duration: number; level: number }>();
    accept(e: any, x: number, z: number, level: number, now: number, duration: number): void {
        const targetX = x * 128 + e.size * 64, targetZ = z * 128 + e.size * 64;
        const previous = this.samples.get(e);
        if (previous && previous.x === targetX && previous.z === targetZ && previous.level === level) return;
        this.step(e, now);
        const jump = (previous && previous.level !== level) || Math.hypot(e.x - targetX, e.z - targetZ) > 16 * 128;
        if (jump) { e.x = targetX; e.z = targetZ; }
        e.routeLength = 0; e.routeX[0] = x; e.routeZ[0] = z;
        this.samples.set(e, { fromX: e.x, fromZ: e.z, x: targetX, z: targetZ, level, at: now, duration: Math.min(500, Math.max(50, duration)) });
    }
    step(e: any, now: number): boolean {
        const s = this.samples.get(e);
        if (!s) return false;
        const t = Math.min(1, Math.max(0, (now - s.at) / s.duration));
        e.x = s.fromX + (s.x - s.fromX) * t;
        e.z = s.fromZ + (s.z - s.fromZ) * t;
        const moving = t < 1 && (s.x !== s.fromX || s.z !== s.fromZ);
        if (moving) e.dstYaw = ((Math.atan2(s.fromX - s.x, s.fromZ - s.z) * 325.949) | 0) & 0x7ff;
        e.secondaryAnim = moving ? e.walkanim : e.readyanim;
        return true;
    }
}
