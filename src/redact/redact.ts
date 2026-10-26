/**
 * Scrub secrets and machine-identifying details from run artifacts before they leave the
 * contributor's machine. Deliberately broader than rs-sdk's redactCredentials (which only handles
 * credentials embedded in URLs). Contributors should still inspect the bundle before submitting:
 * pattern-based redaction reduces risk, it does not eliminate it.
 */

export interface RedactRule { name: string; re: RegExp; replace: string }

export const RULES: RedactRule[] = [
    // Provider API keys (order matters: specific before generic)
    { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replace: '[REDACTED:anthropic_key]' },
    { name: 'openai_key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g, replace: '[REDACTED:openai_key]' },
    { name: 'google_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: '[REDACTED:google_key]' },
    { name: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, replace: '[REDACTED:github_token]' },
    { name: 'aws_key_id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: '[REDACTED:aws_key_id]' },
    { name: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: '[REDACTED:slack_token]' },
    { name: 'hf_token', re: /\bhf_[A-Za-z0-9]{30,}\b/g, replace: '[REDACTED:hf_token]' },
    { name: 'bearer', re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, replace: '$1[REDACTED]' },
    { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: '[REDACTED:jwt]' },
    { name: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: '[REDACTED:private_key]' },
    // KEY=value style env lines (bot.env PASSWORD=, *_API_KEY=, *_TOKEN=, *_SECRET=)
    { name: 'env_secret', re: /\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/g, replace: '$1[REDACTED]' },
    // Credentials in URLs (same intent as rs-sdk redactCredentials)
    { name: 'url_query_secret', re: /([?&](?:password|token|secret|api[_-]?key|key)=)[^&#\s"'\\]*/gi, replace: '$1[REDACTED]' },
    { name: 'url_userinfo', re: /(\b(?:wss?|https?):\/\/)[^\s/@:]+:[^\s/@]+@/gi, replace: '$1[REDACTED]@' },
    // Machine identity
    { name: 'home_path', re: /(\/(?:home|Users)\/)[^/\s"'`]+/g, replace: '$1[user]' },
    { name: 'windows_home', re: /([A-Za-z]:\\Users\\)[^\\\s"'`]+/g, replace: '$1[user]' },
    { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: '[REDACTED:email]' },
    { name: 'ipv4_private', re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g, replace: '[REDACTED:ip]' },
];

export interface RedactResult { text: string; hits: Record<string, number> }

export function redact(text: string, rules: RedactRule[] = RULES): RedactResult {
    const hits: Record<string, number> = {};
    let out = text;
    for (const rule of rules) {
        out = out.replace(rule.re, (...args) => {
            hits[rule.name] = (hits[rule.name] ?? 0) + 1;
            const match = args[0] as string;
            // Re-run the single replacement so $1-style groups work.
            return match.replace(new RegExp(rule.re.source, rule.re.flags.replace('g', '')), rule.replace);
        });
    }
    return { text: out, hits };
}
