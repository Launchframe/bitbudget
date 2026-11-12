"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Users, Mail, InboxIcon, ScrollText, ArrowLeft, Users2, Gift, MessageSquare, Activity } from "lucide-react"

const adminNavItems = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/referrals", label: "Referrals", icon: Users2 },
  { href: "/admin/offers", label: "Offer Codes", icon: Gift },
  { href: "/admin/surveys", label: "Surveys", icon: MessageSquare },
  { href: "/admin/senders", label: "Receipt Senders", icon: Mail },
  { href: "/admin/sender-review", label: "Sender Review", icon: InboxIcon },
  { href: "/admin/ops", label: "Ops", icon: Activity },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-[#0D0D0D] flex flex-col py-8 px-6 border-r border-[#1F1F1F]">
      <div className="mb-8">
        <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to App
        </Link>
      </div>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Admin Portal</h2>
      <nav className="flex flex-col gap-2">
        {adminNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[#F7931A]/10 text-[#F7931A]"
                  : "text-[#919191] hover:text-[#E7E7E7] hover:bg-[#1A1A1A]"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
