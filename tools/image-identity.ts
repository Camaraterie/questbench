/** Associate a registry digest only with the repository actually requested. */
function repository(ref: string) {
    const raw = ref.split('@')[0]!.replace(/:[^/:]+$/, '');
    const first = raw.split('/')[0]!;
    if (!raw.includes('/')) return 'docker.io/library/' + raw;
    return first.includes('.') || first.includes(':') || first === 'localhost' ? raw : 'docker.io/' + raw;
}
export function imageIdentity(ref: string, inspected: { Id: string; RepoDigests?: string[] }) {
    const requested = ref.split('@')[1];
    const matched = inspected.RepoDigests?.find(d => repository(d) === repository(ref) && (!requested || d.split('@')[1] === requested));
    const digest = matched?.split('@')[1] ?? inspected.Id;
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid inspected image digest');
    return { digest, kind: matched ? 'registry-manifest' : 'base-image-config' };
}
if (import.meta.main) {
    const data = imageIdentity(process.argv[2]!, (await Bun.stdin.json())[0]);
    console.log(data.digest + ' ' + data.kind);
}
