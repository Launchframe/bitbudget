import Link from "next/link"
import { ArrowLeft, Binary, FileText, Shield } from "lucide-react"
import { BitbudgetLogo } from "@/components/bitbudget-logo"

const manifestoParagraphs = [
  "Privacy is necessary for an open society in the electronic age. Privacy is not secrecy. A private matter is something one doesn't want the whole world to know, but a secret matter is something one doesn't want anybody to know. Privacy is the power to selectively reveal oneself to the world.",
  "If two parties have some sort of dealings, then each has a memory of their interaction. Each party can speak about their own memory of this; how could anyone prevent it? One could pass laws against it, but the freedom of speech, even more than privacy, is fundamental to an open society; we seek not to restrict any speech at all. If many parties speak together in the same forum, each can speak to all the others and aggregate together knowledge about individuals and other parties. The power of electronic communications has enabled such group speech, and it will not go away merely because we might want it to.",
  "Since we desire privacy, we must ensure that each party to a transaction have knowledge only of that which is directly necessary for that transaction. Since any information can be spoken of, we must ensure that we reveal as little as possible. In most cases personal identity is not salient. When I purchase a magazine at a store and hand cash to the clerk, there is no need to know who I am. When I ask my electronic mail provider to send and receive messages, my provider need not know to whom I am speaking or what I am saying or what others are saying to me; my provider only need know how to get the message there and how much I owe them in fees. When my identity is revealed by the underlying mechanism of the transaction, I have no privacy. I cannot here selectively reveal myself; I must always reveal myself.",
  "Therefore, privacy in an open society requires anonymous transaction systems. Until now, cash has been the primary such system. An anonymous transaction system is not a secret transaction system. An anonymous system empowers individuals to reveal their identity when desired and only when desired; this is the essence of privacy.",
  "Privacy in an open society also requires cryptography. If I say something, I want it heard only by those for whom I intend it. If the content of my speech is available to the world, I have no privacy. To encrypt is to indicate the desire for privacy, and to encrypt with weak cryptography is to indicate not too much desire for privacy. Furthermore, to reveal one's identity with assurance when the default is anonymity requires the cryptographic signature.",
  "We cannot expect governments, corporations, or other large, faceless organizations to grant us privacy out of their beneficence. It is to their advantage to speak of us, and we should expect that they will speak. To try to prevent their speech is to fight against the realities of information. Information does not just want to be free, it longs to be free. Information expands to fill the available storage space. Information is Rumor's younger, stronger cousin; Information is fleeter of foot, has more eyes, knows more, and understands less than Rumor.",
  "We must defend our own privacy if we expect to have any. We must come together and create systems which allow anonymous transactions to take place. People have been defending their own privacy for centuries with whispers, darkness, envelopes, closed doors, secret handshakes, and couriers. The technologies of the past did not allow for strong privacy, but electronic technologies do.",
  "We the Cypherpunks are dedicated to building anonymous systems. We are defending our privacy with cryptography, with anonymous mail forwarding systems, with digital signatures, and with electronic money.",
  "Cypherpunks write code. We know that someone has to write software to defend privacy, and since we can't get privacy unless we all do, we're going to write it. We publish our code so that our fellow Cypherpunks may practice and play with it. Our code is free for all to use, worldwide. We don't much care if you don't approve of the software we write. We know that software can't be destroyed and that a widely dispersed system can't be shut down.",
  "Cypherpunks deplore regulations on cryptography, for encryption is fundamentally a private act. The act of encryption, in fact, removes information from the public realm. Even laws against cryptography reach only so far as a nation's border and the arm of its violence. Cryptography will ineluctably spread over the whole globe, and with it the anonymous transactions systems that it makes possible.",
  "For privacy to be widespread it must be part of a social contract. People must come and together deploy these systems for the common good. Privacy only extends so far as the cooperation of one's fellows in society. We the Cypherpunks seek your questions and your concerns and hope we may engage you so that we do not deceive ourselves. We will not, however, be moved out of our course because some may disagree with our goals.",
  "The Cypherpunks are actively engaged in making the networks safer for privacy. Let us proceed together apace.",
]

const archiveStats = [
  { icon: FileText, label: "Recovered text", value: "Berkeley mailing list" },
  { icon: Shield, label: "Core theme", value: "Privacy by design" },
  { icon: Binary, label: "Published", value: "9 March 1993" },
]

export default function CypherpunkManifesto() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(247,147,26,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(247,147,26,0.08),transparent_30%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(247,147,26,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(247,147,26,0.12) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/80 backdrop-blur-[120px]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <Link href="/" className="transition-opacity hover:opacity-90">
            <BitbudgetLogo />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-btc-orange/40 hover:bg-btc-orange/10"
          >
            <ArrowLeft className="h-4 w-4 text-btc-orange" />
            Back Home
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 md:px-6 md:py-14">
        <section className="max-w-3xl space-y-5">
          <span className="inline-flex items-center rounded-full border border-btc-orange/25 bg-btc-orange/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-[#F7B35A]">
            Buried wisdom // early internet archive
          </span>
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-[0.28em] text-muted-foreground">
              Recovered whitepaper
            </p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
              A Cypherpunk&apos;s Manifesto
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              A foundational text from the internet&apos;s privacy frontier, redistributed here with no permission or endorsement.
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {archiveStats.map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-white/3 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <div className="mb-3 inline-flex rounded-full bg-btc-orange/10 p-2">
                <Icon className="h-4 w-4 text-btc-orange" />
              </div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
              <p className="mt-2 text-lg font-medium text-foreground">{value}</p>
            </div>
          ))}
        </section>

        <article className="relative overflow-hidden rounded-4xl border border-btc-orange/20 bg-[linear-gradient(180deg,rgba(33,25,18,0.96),rgba(19,17,20,0.98))] shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-btc-orange/60 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,220,170,0.08),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(247,147,26,0.08),transparent_38%)]" />

          <div className="relative border-b border-white/10 px-6 py-6 md:px-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.28em] text-[#D1A56B]">
                  Originally circulated on the cypherpunks list
                </p>
            
              </div>
              <div className="space-y-1 text-sm text-[#E7D9C5]/72 md:text-right">
                <p>Eric Hughes</p>
                <a
                  href="ftp://soda.berkeley.edu/pub/cypherpunks/people/hughes.html"
                  className="text-[#F7B35A] transition-colors hover:text-btc-orange"
                >
                  Source archive
                </a>
              </div>
            </div>
          </div>

          <div className="relative px-6 py-8 md:px-10 md:py-12">
            <div className="mx-auto max-w-3xl space-y-6 text-[1.045rem] leading-8 text-[#F4EDE2]">
              {manifestoParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}

              <div className="space-y-2 pt-6 text-[#F4EDE2]">
                <p>Onward.</p>
                <p>Eric Hughes</p>
                <p>
                  <a
                    href="mailto:hughes@soda.berkeley.edu"
                    className="text-[#F7B35A] transition-colors hover:text-btc-orange"
                  >
                    &lt;hughes@soda.berkeley.edu&gt;
                  </a>
                </p>
                <p className="text-sm uppercase tracking-[0.24em] text-[#D1A56B]">9 March 1993</p>
              </div>
            </div>
          </div>
        </article>
      </main>
    </div>
  )
}
