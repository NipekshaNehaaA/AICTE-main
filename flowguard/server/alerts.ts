/**
 * Real-world Alert Channels:
 * - Email: via Resend SDK
 * - WhatsApp: via Twilio WhatsApp API
 *
 * Designed for SIH / AICTE FlowGuard:
 * - When API keys are configured in .env, sends real emails and WhatsApp messages.
 * - When keys are not yet configured, gracefully logs mock dispatches without throwing errors.
 */
import { Resend } from 'resend';
import twilio from 'twilio';
import type { Db } from './db/index.ts';

const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM || 'AICTE FlowGuard <onboarding@resend.dev>';

const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+17372212163';
const twilioContentSid = process.env.TWILIO_CONTENT_SID || 'HX7cf5a23fe00549e2ed931e272889fb49';

const resendClient = resendApiKey ? new Resend(resendApiKey) : null;
const twilioClient = twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

export interface SendEmailOptions {
  to: string;
  subject: string;
  title: string;
  message: string;
  actionUrl?: string;
}

export interface SendWhatsAppOptions {
  to: string;
  title: string;
  message: string;
  eventType?: string;
}

/** Formats an AICTE branded HTML email */
function renderEmailHtml(title: string, message: string, actionUrl: string = 'http://localhost:3000'): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 24px; color: #171717; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e5e5; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .badge { display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: #e0f2fe; color: #0369a1; border-radius: 6px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; color: #0a0a0a; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 15px; line-height: 1.6; color: #404040; margin-bottom: 24px; }
    .btn { display: inline-block; background-color: #0a0a0a; color: #ffffff !important; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; }
    .footer { font-size: 12px; color: #737373; margin-top: 32px; padding-top: 16px; border-top: 1px solid #f0f0f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">AICTE FlowGuard Alert</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${actionUrl}" class="btn">Open Approval Portal</a>
    <div class="footer">
      AICTE Approval Workflow &amp; Compliance Management Portal (SIH26262)<br>
      This is an automated statutory notification. Do not reply to this email.
    </div>
  </div>
</body>
</html>
`;
}

/** Sends real email via Resend (or logs if unconfigured). Supports single or comma-separated emails. */
/** Resolves the appropriate Resend client for each recipient address */
function getResendClientForEmail(email: string): Resend | null {
  const norm = email.toLowerCase().trim();
  let key = process.env.RESEND_API_KEY;
  if (norm.includes('nipeksha')) {
    key = process.env.RESEND_API_KEY_NIPEKSHA || 're_ckXar2av_5g7oD9DMmBZwvHDpFiMPAg4Y';
  } else if (norm.includes('nilla')) {
    key = process.env.RESEND_API_KEY_NILLA || process.env.RESEND_API_KEY || 're_VB2Zr8ju_LUffooQnMYNTYLtqaZt6ZkHw';
  }
  return key ? new Resend(key) : resendClient;
}

/** Sends real email via Resend (or logs if unconfigured). Supports single or comma-separated emails. */
export async function sendEmailAlert(opts: SendEmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
  const raw = process.env.DEMO_ALERT_EMAIL || opts.to;
  if (!raw) return { success: false, error: 'No recipient email configured' };

  // Parse comma or semicolon separated emails
  const recipients = raw
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));

  if (recipients.length === 0) {
    return { success: false, error: 'No valid recipient email address' };
  }

  const sids: string[] = [];
  const errors: string[] = [];

  for (const to of recipients) {
    const client = getResendClientForEmail(to);
    if (!client) {
      console.log(`[Resend Email: Mock Mode for ${to} (No API key)]`);
      console.log(`  Subject: ${opts.subject}`);
      console.log(`  Message: ${opts.message}`);
      sids.push('mock-resend-id');
      continue;
    }

    try {
      const result = await client.emails.send({
        from: resendFrom,
        to,
        subject: opts.subject,
        html: renderEmailHtml(opts.title, opts.message, opts.actionUrl),
        text: `${opts.title}\n\n${opts.message}\n\nAICTE Approval Portal: ${opts.actionUrl ?? 'http://localhost:3000'}`,
      });

      if (result.error) {
        console.warn(`[Resend Email Notice for ${to}]`, result.error.message);
        errors.push(`${to}: ${result.error.message}`);
      } else if (result.data?.id) {
        console.log(`[Resend Email Delivered to ${to}] ID: ${result.data.id}`);
        sids.push(result.data.id);
      }
    } catch (err: any) {
      console.error(`[Resend Email Exception for ${to}]`, err.message);
      errors.push(`${to}: ${err.message}`);
    }
  }

  if (sids.length > 0) {
    return { success: true, id: sids.join(', ') };
  }
  return { success: false, error: errors.join('; ') };
}

/** Formats a phone number into Twilio E.164 whatsapp: format */
function formatWhatsAppNumber(phone: string): string {
  let p = phone.trim().replace(/[^\d+]/g, '');
  if (!p.startsWith('+')) {
    // Default to +91 (India) if 10 digits
    p = p.length === 10 ? `+91${p}` : `+${p}`;
  }
  return `whatsapp:${p}`;
}

/** Sends real WhatsApp message via Twilio (or logs if unconfigured). Supports single or comma-separated phone numbers. */
/** Sends real WhatsApp message via Twilio (or logs if unconfigured). Supports single or comma-separated phone numbers. */
export async function sendWhatsAppAlert(opts: SendWhatsAppOptions): Promise<{ success: boolean; sid?: string; error?: string }> {
  const raw = process.env.DEMO_ALERT_PHONE || opts.to;
  if (!raw) {
    return { success: false, error: 'No phone number configured for recipient' };
  }

  // Parse comma or semicolon separated phone numbers
  const recipients = raw
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 7)
    .map(formatWhatsAppNumber);

  if (recipients.length === 0) {
    return { success: false, error: 'No valid phone numbers found' };
  }

  const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const body = `🚨 *AICTE FlowGuard Alert*\n\n📌 *${opts.title}*\n${opts.message}\n\n🕒 ${istTime} IST\n🔗 Portal: http://localhost:3000`;

  const client = twilioClient || (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN) : null);
  const from = process.env.TWILIO_WHATSAPP_FROM || twilioFrom;
  const contentSid = process.env.TWILIO_CONTENT_SID || twilioContentSid;

  if (!client) {
    console.log(`[Twilio WhatsApp: Mock Mode (TWILIO credentials not set)]`);
    console.log(`  To (${recipients.length} recipients): ${recipients.join(', ')}`);
    console.log(`  Body:\n${body}`);
    return { success: true, sid: 'mock-twilio-sid' };
  }

  try {
    const sids: string[] = [];
    for (const to of recipients) {
      let msg;
      try {
        if (contentSid) {
          msg = await client.messages.create({
            from,
            to,
            contentSid,
          });
        } else {
          msg = await client.messages.create({
            from,
            to,
            body,
          });
        }
      } catch (err: any) {
        // Fallback to body message if ContentSid fails
        msg = await client.messages.create({
          from,
          to,
          body,
        });
      }
      if (msg?.sid) {
        console.log(`[Twilio WhatsApp Delivered to ${to}] SID: ${msg.sid}`);
        sids.push(msg.sid);
      }
    }
    return { success: true, sid: sids.join(', ') };
  } catch (err: any) {
    console.error('[Twilio WhatsApp Exception]', err);
    return { success: false, error: err.message };
  }
}

/** Dispatches external alerts (Email + WhatsApp) for a notification event */
export async function dispatchExternalAlerts(
  db: Db,
  opts: {
    recipientUserId: string;
    eventType: string;
    title: string;
    message: string;
    applicationId?: string | null;
  },
): Promise<{ emailSent: boolean; whatsappSent: boolean; errors: string[] }> {
  const errors: string[] = [];
  let emailSent = false;
  let whatsappSent = false;

  const u = await db.one<{ email: string; phone: string | null; full_name: string }>(
    'SELECT email, phone, full_name FROM users WHERE id = $1',
    [opts.recipientUserId],
  );

  if (!u) return { emailSent: false, whatsappSent: false, errors: ['User not found'] };

  // 1. Send Email Alert via Resend
  const emailRes = await sendEmailAlert({
    to: u.email,
    subject: `AICTE Alert: ${opts.title}`,
    title: opts.title,
    message: opts.message,
    actionUrl: opts.applicationId ? `http://localhost:3000/applications/${opts.applicationId}` : 'http://localhost:3000',
  });
  if (emailRes.success) {
    emailSent = true;
  } else if (emailRes.error) {
    errors.push(`Email: ${emailRes.error}`);
  }

  // 2. Send WhatsApp Alert via Twilio
  const phone = u.phone || process.env.DEMO_ALERT_PHONE;
  if (phone) {
    const waRes = await sendWhatsAppAlert({
      to: phone,
      title: opts.title,
      message: opts.message,
      eventType: opts.eventType,
    });
    if (waRes.success) {
      whatsappSent = true;
    } else if (waRes.error) {
      errors.push(`WhatsApp: ${waRes.error}`);
    }
  }

  return { emailSent, whatsappSent, errors };
}
