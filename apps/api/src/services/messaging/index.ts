import { env } from '../../config/env';
import { decrypt } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import type { FirmDoc } from '../../models';

export interface OutgoingMessage {
  to: string; // 10-digit Nepali mobile
  body: string;
  senderId?: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  response?: unknown;
  error?: string;
}

export interface MessageProvider {
  name: 'console' | 'sms' | 'viber';
  channel: 'console' | 'sms' | 'viber';
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/** Dev provider: prints messages to the API console. */
export class ConsoleProvider implements MessageProvider {
  name = 'console' as const;
  channel = 'console' as const;
  async send(msg: OutgoingMessage): Promise<SendResult> {
    logger.info({ to: msg.to, sender: msg.senderId }, `📱 [ConsoleProvider] SMS → ${msg.to}\n${msg.body}`);
    return { ok: true, providerMessageId: `console-${Date.now()}`, response: { console: true } };
  }
}

/**
 * Generic HTTP SMS gateway adapter (Sparrow SMS / Aakash SMS style):
 * POSTs form fields token/from/to/text. Field names are configurable via env
 * (SMS_FIELD_*) because Nepali gateways differ slightly.
 */
export class HttpSmsProvider implements MessageProvider {
  name = 'sms' as const;
  channel = 'sms' as const;
  constructor(private cfg: { url: string; token: string; senderId: string }) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (!this.cfg.url || !this.cfg.token) return { ok: false, error: 'SMS gateway not configured' };
    const form = new URLSearchParams({
      [env.SMS_FIELD_TOKEN]: this.cfg.token,
      [env.SMS_FIELD_FROM]: msg.senderId || this.cfg.senderId,
      [env.SMS_FIELD_TO]: msg.to,
      [env.SMS_FIELD_TEXT]: msg.body,
    });
    try {
      const res = await fetch(this.cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let response: unknown = text;
      try {
        response = JSON.parse(text);
      } catch {
        /* plain text response */
      }
      if (!res.ok) return { ok: false, response, error: `Gateway HTTP ${res.status}` };
      return { ok: true, response };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/** Placeholder for Viber Business Messages — to be built later. */
export class ViberProvider implements MessageProvider {
  name = 'viber' as const;
  channel = 'viber' as const;
  async send(): Promise<SendResult> {
    return { ok: false, error: 'Viber provider not implemented yet' };
  }
}

/** Picks the provider for a firm: firm settings first, then env defaults. */
export function providerForFirm(firm: Pick<FirmDoc, 'messaging'>): MessageProvider {
  const kind = firm.messaging?.provider && firm.messaging.provider !== 'console' ? firm.messaging.provider : env.MESSAGE_PROVIDER;
  if (kind === 'sms') {
    const token = firm.messaging?.smsTokenEnc ? decrypt(firm.messaging.smsTokenEnc) : env.SMS_API_TOKEN;
    return new HttpSmsProvider({
      url: firm.messaging?.smsApiUrl || env.SMS_API_URL,
      token,
      senderId: firm.messaging?.smsSenderId || env.SMS_SENDER_ID,
    });
  }
  if (kind === 'viber') return new ViberProvider();
  return new ConsoleProvider();
}

/** Test hook: override the provider globally. */
export let providerOverride: MessageProvider | null = null;
export function setProviderOverride(p: MessageProvider | null) {
  providerOverride = p;
}
