import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const script = readFileSync(new URL('../studio/index.html', import.meta.url), 'utf8').split('<script>')[1]!.split('</script>')[0]!;

test('live polling recovers from stalled fetches and images, ignoring stale image callbacks', async () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0, fetches = 0, stall = true;
    const elements = new Map<string, any>();
    const element = () => ({ classList: { toggle() {} }, innerHTML: '', textContent: '', appendChild(img: unknown) { this.img = img; }, img: null as unknown });
    const get = (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const images: any[] = [];
    class Image {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';
        constructor() { images.push(this); }
        removeAttribute(name: string) { if (name === 'src') this.src = ''; }
    }
    const live = { live: true, steps: [], events: [], progress: { reached: [] }, partnerLoggedIn: true };
    const context = createContext({
        window: {}, document: { getElementById: get, querySelectorAll: () => [], addEventListener() {} },
        Image, AbortController, Date,
        setInterval() {}, clearTimeout(id: number) { timers.delete(id); },
        setTimeout(fn: () => void) { const id = ++nextTimer; timers.set(id, fn); return id; },
        fetch(_path: string, opts: RequestInit) {
            fetches++;
            if (stall) return new Promise((_resolve, reject) => opts.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
            return Promise.resolve({ json: async () => live });
        },
    });
    const poll = () => runInContext('pollLive()', context) as Promise<void>;
    const expire = () => { const [id, callback] = timers.entries().next().value!; timers.delete(id); callback(); };
    runInContext(script, context); // initial stalled fetch
    await poll();
    expect(fetches).toBe(1);
    expire();
    await Bun.sleep(0);
    stall = false;
    await poll();
    expect(fetches).toBe(2);
    expect(images).toHaveLength(1);
    const staleLoad = images[0].onload, staleError = images[0].onerror;
    await poll();
    expect(images).toHaveLength(1);
    expire(); // screenshot timeout clears its source and releases shotLoading
    expect(images[0].src).toBe('');
    await poll();
    expect(images).toHaveLength(2);
    staleLoad(); staleError();
    expect(get('live-screen').img).toBeNull();
    await poll();
    expect(images).toHaveLength(2); // stale handlers cannot release the newer guard
    images[1].onload();
    expect(get('live-screen').img).toBe(images[1]);
    await poll();
    expect(images).toHaveLength(3);
    images[2].onerror();
    expect(timers.size).toBe(0);
});
