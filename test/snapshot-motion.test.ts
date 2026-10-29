import { expect, test } from 'bun:test';
import { SnapshotMotion } from '../studio/viewer/SnapshotMotion';

test('sampled movement interpolates without stationary packets extending the route or restarting motion', () => {
    const motion = new SnapshotMotion();
    const e = { x: 64, z: 64, size: 1, routeX: [0], routeZ: [0], routeLength: 0, walkanim: 1, readyanim: 0, secondaryAnim: 0 };
    motion.accept(e, 3, 0, 0, 1000, 250);
    motion.step(e, 1125);
    expect(e.x).toBe(256);
    motion.accept(e, 3, 0, 0, 1125, 250);
    motion.step(e, 1250);
    expect(e.x).toBe(448);
    expect(e.routeLength).toBe(0);
    expect(e.secondaryAnim).toBe(0);
    motion.step(e, 5000);
    expect(e.x).toBe(448); // no extrapolation after feed loss
    motion.accept(e, 100, 0, 0, 5000, 250);
    expect(e.x).toBe(12864); // real teleports snap instead of flying across the map
});
