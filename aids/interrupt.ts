/**
 * Chat interrupt (coordination-aids condition). Run any long piece of work, but stop and return
 * as soon as a chosen player messages you, so a grinding script never makes you miss a meetup.
 *
 *   const { untilMessage } = await import('/qb/aids/interrupt.ts');
 *   const r = await untilMessage(sdk, async (signal) => { while (!signal.aborted) await bot.chopTree(); }, { from: 'partner01' });
 *   if (r.interrupted) console.log('partner said:', r.message.text);
 */
export interface ChatSdk {
    waitForChat(opts: { from?: string; matching?: RegExp | string; timeout?: number }): Promise<{ text: string; sender: string } | null>;
}

export async function untilMessage<T>(
    sdk: ChatSdk,
    work: (signal: AbortSignal) => Promise<T>,
    opts: { from?: string; matching?: RegExp | string; timeoutMs?: number } = {},
): Promise<{ interrupted: false; result: T } | { interrupted: true; message: { text: string; sender: string } }> {
    const ctrl = new AbortController();
    const chat = sdk.waitForChat({ from: opts.from, matching: opts.matching, timeout: opts.timeoutMs ?? 24 * 3600_000 })
        .then(m => (m ? { interrupted: true as const, message: m } : null));
    const job = work(ctrl.signal).then(result => ({ interrupted: false as const, result }));
    const first = await Promise.race([job, chat.then(r => r ?? job)]);
    ctrl.abort();
    return first;
}
