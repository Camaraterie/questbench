"""Apply/revert only QuestBench's known adaptations before checking the pinned Palanti patch."""
from pathlib import Path
import shutil, sys

mode, source = sys.argv[1:]
root = Path(source)
old_url = '''export function getDefaultFeedUrl(): string | undefined {
    const configured = process.env.REACT_APP_WORLD_FEED_URL;
    if (configured) {
        return configured;
    }
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return "ws://localhost:8888/worldfeed";
    }
    return undefined;
}'''
local_url = '''export function getDefaultFeedUrl(): string | undefined {
    return (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/observer-feed";
}'''
motion = '''        if ((record as any).qbSampleMs) {
            this.snapshotMotion.accept(e, record.x, record.z, record.l ?? e.level, performance.now(), (record as any).qbSampleMs);
            return;
        }

'''
cycle = '''        if (this.snapshotMotion.step(e, performance.now())) {
            this.entityFace(e);
            this.entityAnim(e);
            return;
        }
'''
edits = {
    'src/live/LiveController.ts': [(old_url, local_url)],
    'src/live/LiveWorld.ts': [
        ('export class LiveWorld {', 'export class LiveWorld {\n    private snapshotMotion = new SnapshotMotion();'),
        ('import { TypeLoader }', 'import { SnapshotMotion } from "./SnapshotMotion";\nimport { TypeLoader }'),
        ('        if (record.m) {', motion + '        if (record.m) {'),
        ('    private moveEntity(e: LiveEntity): void {\n', '    private moveEntity(e: LiveEntity): void {\n' + cycle),
        ('    private applyMasks(e: LiveEntity, record: FeedEntity, isPlayer: boolean): void {', '    private applyMasks(e: LiveEntity, record: FeedEntity, isPlayer: boolean): void {\n        (e as any).qbOverlay = (record as any).qbOverlay;'),
    ],
    'src/live/LiveOverlay.ts': [
        ('import {researchView', 'import {drawObserverBubbles} from "./ObserverBubbles";\nimport {researchView'),
        ('            o.headIcons.forEach((icon, index) => this.drawHeadIcon(controller, icon, o.top.x, o.iconY + index * 25, o.nameAlpha));\n        }', '            o.headIcons.forEach((icon, index) => this.drawHeadIcon(controller, icon, o.top.x, o.iconY + index * 25, o.nameAlpha));\n        }\n        drawObserverBubbles(ctx, overlays, width, height);'),
    ],
}
for file, replacements in edits.items():
    path = root/file
    if not path.exists() and mode == 'restore': continue
    text = path.read_text()
    for before, after in reversed(replacements) if mode == 'restore' else replacements:
        if mode == 'restore': text = text.replace(after, before)
        else:
            if text.count(before) != 1: raise ValueError(f'Unexpected anchor: {file}: {before}')
            text = text.replace(before, after)
    path.write_text(text)
if mode != 'restore':
    for name in ['SnapshotMotion.ts', 'ObserverBubbles.ts']: shutil.copyfile(Path(__file__).with_name(name), root/'src/live'/name)
