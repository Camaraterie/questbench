// Host-side declarations for the narrow engine API used by the injected Control module.
// The actual SDK modules are resolved and exercised inside the container, not vendored here.
declare module '#/cache/config/ObjType.js' {
    const ObjType: { readonly count: number; get(id: number): { name: string; stackable: boolean; wearpos: number } };
    export default ObjType;
}
declare module '#/engine/routefinder/index.js' {
    export const CollisionFlag: { WALK_BLOCKED: number };
    export function isFlagged(x: number, z: number, level: number, mask: number): boolean;
    export function isZoneAllocated(x: number, z: number, level: number): boolean;
}
declare module '#/cache/config/InvType.js' {
    const InvType: { SCOPE_TEMP: number; get(id: number): { scope: number } | undefined };
    export default InvType;
}
