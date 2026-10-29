/** Preserve direction when outgoing PM echoes use the recipient's name as sender. */
export function formatGameFeedbackLine(message: { type: number; sender: string; fromSelf: boolean; text: string }): string {
    const label = message.type === 6 ? `[Sent PM to ${message.sender}] `
        : message.fromSelf ? '[Sent] '
        : message.type === 3 || message.type === 7 ? `[PM from ${message.sender}] `
        : message.sender ? `${message.sender}: ` : '[Game] ';
    return label + message.text;
}
