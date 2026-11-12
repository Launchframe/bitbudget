import type { Metadata } from "next"
import Link from "next/link"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

export const metadata: Metadata = {
  title: "FAQ & Passkey Compatibility | BitBudget",
  description: "Wallet setup help, recovery questions, and an evidence-based guide to passkey manager encryption support.",
}

type CompatibilityEntry = {
  manager: string
  status: "Documented support" | "Source evidence" | "Known limitation" | "Unconfirmed"
  detail: string
  sources: { label: string; href: string }[]
}

const compatibility: CompatibilityEntry[] = [
  {
    manager: "Apple Passwords / iCloud Keychain",
    status: "Documented support",
    detail: "Apple documents PRF support in Safari 18.0. Chromium’s iCloud Keychain integration enables it on macOS 15.0 and later. Installing Safari 18 on an older Mac does not by itself establish provider support. These are documented prerequisites and source evidence, not a verified BitBudget combination or a promise covering every Apple platform. Touch ID alone is not a compatibility guarantee.",
    sources: [
      { label: "Apple: Safari 18.0 passkey features", href: "https://webkit.org/blog/15865/webkit-features-in-safari-18-0/" },
      { label: "Chromium: iCloud Keychain macOS requirement", href: "https://github.com/chromium/chromium/blob/14d8f8788839e5ceb6c08b68aa73de3ab4475f75/device/fido/mac/icloud_keychain.mm#L79-L81" },
    ],
  },
  {
    manager: "Google Password Manager",
    status: "Source evidence",
    detail: "Chromium’s Google Password Manager flow includes code and browser tests for PRF during both passkey creation and authentication. We have not established the first shipping version or full operating system coverage, including Android, or verified a combination with BitBudget. Not every passkey used in Chrome is stored in Google Password Manager.",
    sources: [
      { label: "Chromium: Google Password Manager creation test", href: "https://github.com/chromium/chromium/blob/14d8f8788839e5ceb6c08b68aa73de3ab4475f75/chrome/browser/webauthn/enclave_authenticator_browsertest.cc#L1440-L1456" },
      { label: "Chromium: authentication test", href: "https://github.com/chromium/chromium/blob/14d8f8788839e5ceb6c08b68aa73de3ab4475f75/chrome/browser/webauthn/enclave_authenticator_browsertest.cc#L1515-L1528" },
    ],
  },
  {
    manager: "Proton Pass",
    status: "Source evidence",
    detail: "Proton’s published passkey response code supplies PRF support information and encryption results to websites. This is separate from using a passkey to unlock Proton itself. Released extension versions, platform coverage, and a working BitBudget combination have not yet been verified.",
    sources: [{ label: "Proton: provider-facing PRF responses", href: "https://github.com/ProtonMail/WebClients/blob/a37f752deb623ae05a8e6859ae90d87afb74e0d0/packages/pass/lib/passkeys/webauthn.ts#L45-L76" }],
  },
  {
    manager: "Bitwarden browser extension",
    status: "Known limitation",
    detail: "The public browser authenticator implementation checked on September 7, 2026 returns ordinary passkey results but not the encryption feature this wallet requires. A setup failure has also been reported with the extension; its exact version was not recorded. This finding is not a claim about every Bitwarden product or future release. Using a passkey to unlock Bitwarden itself is a different feature.",
    sources: [{ label: "Bitwarden source checked September 7, 2026", href: "https://github.com/bitwarden/clients/blob/5b6242f15550b16d789da6f22d3d99bda0b31683/libs/common/src/platform/services/fido2/fido2-client.service.ts#L255-L272" }],
  },
  {
    manager: "KeePassXC",
    status: "Known limitation",
    detail: "Core PRF support is still in development: the desktop implementation proposal was open when checked on September 7, 2026. The related browser-extension change merged on August 25, but that alone does not establish a released working combination. Desktop app, extension, and browser versions must be checked together.",
    sources: [
      { label: "KeePassXC: open desktop PRF proposal", href: "https://github.com/keepassxreboot/keepassxc/pull/13529" },
      { label: "KeePassXC: merged browser-extension change", href: "https://github.com/keepassxreboot/keepassxc-browser/pull/3048" },
    ],
  },
  {
    manager: "1Password",
    status: "Unconfirmed",
    detail: "We have not established PRF support in the shipping password-manager product. Its published passkey library supports PRF, but that is not proof that the released extension or app offers it to websites. No verified BitBudget combination or minimum product version is recorded yet; unconfirmed does not mean unsupported.",
    sources: [{ label: "1Password: library support discussion (not product certification)", href: "https://github.com/1Password/passkey-rs/issues/79#issuecomment-3633807975" }],
  },
]

const supportCodes = [
  ["browser-unavailable", "Passkeys are unavailable in this browser or connection. Use an updated browser and a secure connection. Local development can use localhost."],
  ["not-supported", "The selected provider did not report the required encryption support. Check the manager and version, not just the browser name."],
  ["missing-output", "The passkey verification finished without the encryption result the wallet needs. Setup remains blocked."],
  ["invalid-output", "The provider returned an encryption result the wallet could not safely use. Do not try to edit or paste the result."],
]

const linkClass = "text-[#F7931A] underline underline-offset-4 hover:text-[#F7931A]/80"

export default function FaqPage() {
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-[#1F1F1F] bg-background/80">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href="/welcome" aria-label="BitBudget home"><BitbudgetLogo variant="vanilla" /></Link>
        <Link href="/" className="rounded-xl bg-[#F7931A] px-5 py-2 text-sm font-semibold text-[#0D0D0D] hover:bg-[#F7931A]/90">Open BitBudget</Link>
      </div>
    </header>
    <div className="mx-auto max-w-5xl space-y-8 px-6 pb-20 pt-12 md:pt-20">
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">Last reviewed: <time dateTime="2026-09-07">September 7, 2026</time></p>
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">Frequently asked questions</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">Starting with wallet protection, passkey compatibility, and recovery. This guide will grow as we verify more combinations.</p>
      </div>
      <nav aria-label="FAQ topics" className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <a href="#why-passkeys" className={linkClass}>Passkey basics</a>
        <a href="#passkey-compatibility" className={linkClass}>Manager compatibility</a>
        <a href="#retry-setup" className={linkClass}>Setup help</a>
        <a href="#support-codes" className={linkClass}>Support codes</a>
        <a href="#recovery" className={linkClass}>Recovery</a>
        <a href="#report-compatibility" className={linkClass}>Report a result</a>
      </nav>
      <FaqSection id="why-passkeys" title="Why can a working passkey fail wallet setup?">
        <p>A passkey normally proves that you can sign in. BitBudget also needs an extra passkey encryption feature, called <strong className="text-foreground">PRF</strong>, to protect the wallet share stored in your browser. Not every passkey manager provides that feature.</p>
        <p>Your browser, operating system, selected passkey manager, and their versions all matter. Brave or Chrome alone is not a compatibility guarantee. A password manager extension may handle the request instead of your device’s built-in provider.</p>
        <p>BitBudget checks the result during setup. If the required encryption is unavailable, setup stops rather than using password-only protection for your device share.</p>
      </FaqSection>
      <FaqSection id="passkey-compatibility" title="Which passkey managers can I use?">
        <p><strong className="text-foreground">No real passkey manager is listed as verified with BitBudget yet.</strong> Automated browser tests exercise wallet setup, but they do not certify a consumer passkey manager. We will record exact manager, browser, and operating system versions as real combinations are verified.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong className="text-foreground">Documented support:</strong> a primary source describes the required encryption feature. This is a candidate to test, not a BitBudget compatibility guarantee.</li>
          <li><strong className="text-foreground">Source evidence:</strong> published provider code or tests include the feature, but released versions and platforms still need checking.</li>
          <li><strong className="text-foreground">Known limitation:</strong> evidence identifies a blocker in the specific implementation or combination described.</li>
          <li><strong className="text-foreground">Unconfirmed:</strong> we do not have enough evidence to classify the released product. This does not mean unsupported.</li>
        </ul>
        <div role="region" aria-label="Passkey compatibility table, scroll horizontally on small screens" tabIndex={0} className="overflow-x-auto rounded-xl border border-[#1F1F1F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F7931A]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="p-4 text-left font-semibold text-foreground">Passkey manager compatibility — evidence as of September 7, 2026</caption>
            <thead className="border-y border-[#1F1F1F] bg-[#1A1A1A] text-foreground"><tr><th scope="col" className="p-4">Manager</th><th scope="col" className="p-4">Encryption support</th><th scope="col" className="p-4">Scope and evidence</th></tr></thead>
            <tbody>{compatibility.map(entry => <tr key={entry.manager} className="border-b border-[#1F1F1F] last:border-0">
              <th scope="row" className="p-4 align-top font-semibold text-foreground">{entry.manager}</th>
              <td className="p-4 align-top"><span className={entry.status === "Known limitation" ? "text-amber-200" : entry.status === "Unconfirmed" ? "text-muted-foreground" : "text-blue-300"}>{entry.status}</span></td>
              <td className="p-4 align-top"><p>{entry.detail}</p><ul className="mt-3 space-y-2">{entry.sources.map(source => <li key={source.href}><a className={linkClass} href={source.href} target="_blank" rel="noopener noreferrer">{source.label} (opens in a new tab)</a></li>)}</ul></td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-sm">Support can change between releases. We do not recommend buying a device or switching a password manager solely on this initial list. The live encryption check remains required.</p>
      </FaqSection>
      <FaqSection id="retry-setup" title="What should I do if setup rejects my passkey?">
        <ol className="list-decimal space-y-3 pl-5">
          <li>Keep the setup tab open while reading this guide. Note the support code, if one is shown.</li>
          <li>Check which app is actually saving or supplying the passkey. If an extension handles the request, use the browser’s provider chooser or temporarily turn off that extension’s passkey handling before retrying.</li>
          <li>For a new wallet, retry with a provider that supplies the required encryption. A device or system provider is another option to test where supported, not a guaranteed fix.</li>
          <li>If an error returns you to the protection step, both recovery-password fields are kept in the open form so you can retry. BitBudget does not save them to browser storage. Closing or reloading setup means you will need to enter them again.</li>
        </ol>
        <p className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-amber-200">Do not delete an existing wallet’s passkey, clear its browser storage, or create replacement keys to fix this error. If a wallet was already created, return to its setup or recovery flow. Changing providers does not move or re-encrypt an existing device share.</p>
      </FaqSection>
      <FaqSection id="support-codes" title="What do the passkey support codes mean?">
        <dl className="space-y-5">{supportCodes.map(([code, description]) => <div key={code}><dt className="break-words font-mono text-sm text-foreground">{code}</dt><dd className="mt-1">{description}</dd></div>)}</dl>
        <p>A cancellation or a general device-verification error does not establish that your provider is unsupported. Retry before drawing that conclusion.</p>
      </FaqSection>
      <FaqSection id="recovery" title="Does my recovery password replace the passkey?">
        <p>No. The passkey protects the wallet share on this device. The recovery password protects a different share in your downloaded recovery file. They serve different purposes; entering a recovery password cannot add encryption support to a passkey manager.</p>
        <p>Keep the recovery file private and store its password separately. Downloading alone does not finish setup: reopen the saved file and complete the verification that checks it works with your protected device share.</p>
        <p>The recovery file cannot spend alone. The current wallet preview uses test networks and does not yet enable sending or fundable receive addresses. Successful setup is not a signal to send real funds.</p>
      </FaqSection>
      <FaqSection id="report-compatibility" title="How can I help improve this list?">
        <p>When reporting a success or failure to BitBudget, include only:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>The manager name and version, including the extension version if applicable.</li>
          <li>The browser and operating system names and versions.</li>
          <li>Whether you selected a device provider or a password manager, the date tested, and the support code shown.</li>
          <li>Which steps worked: passkey creation, wallet creation, reopening and unlocking, and recovery-file verification. A saved passkey alone is not a successful wallet test.</li>
        </ul>
        <p className="font-medium text-foreground">Never share your password, recovery file, private keys, or raw passkey responses. Avoid full console logs or screenshots containing private wallet or account details.</p>
        <p>We will distinguish user reports from independently verified combinations and keep the tested versions and review date with each result.</p>
      </FaqSection>
      <footer className="flex flex-wrap gap-6 border-t border-[#1F1F1F] pt-6 text-sm"><Link href="/privacy" className={linkClass}>Privacy policy</Link><Link href="/welcome" className={linkClass}>About BitBudget</Link></footer>
    </div>
  </main>
}

function FaqSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="min-w-0 scroll-mt-6 rounded-3xl border border-[#1F1F1F] bg-[#0D0D0D] p-5 sm:p-8">
    <h2 className="mb-4 text-2xl font-bold">{title}</h2>
    <div className="space-y-4 leading-relaxed text-muted-foreground">{children}</div>
  </section>
}
