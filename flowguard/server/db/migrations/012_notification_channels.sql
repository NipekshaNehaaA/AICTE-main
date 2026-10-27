-- AICTE FlowGuard — Email (Resend) and WhatsApp (Twilio) channels

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_sent boolean NOT NULL DEFAULT false;
