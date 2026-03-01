import nodemailer from "nodemailer"

const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD

function getTransport() {
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  }
  return null
}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const subject = `${code} is your BitBudget login code`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #F7931A; margin-bottom: 8px;">BitBudget</h2>
      <p style="color: #666; font-size: 14px; margin-bottom: 24px;">Enter this code to sign in:</p>
      <div style="background: #0D0D0D; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #F7931A;">${code}</span>
      </div>
      <p style="color: #999; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore it.</p>
    </div>
  `

  const transport = getTransport()
  if (transport) {
    await transport.sendMail({
      from: `BitBudget <${GMAIL_USER}>`,
      to: email,
      subject,
      html,
    })
    return
  }

  console.log(`\n━━━ Verification Code for ${email} ━━━`)
  console.log(`  Code: ${code}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}
