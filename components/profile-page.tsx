"use client"

import { useSession } from "next-auth/react"
import { User } from "lucide-react"

export function ProfilePage() {
  const { data: session } = useSession()
  const userName = session?.user?.name
  const userEmail = session?.user?.email
  const userImage = session?.user?.image

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-foreground">Profile</h2>

      <div className="p-6 bg-[#0D0D0D] rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#8B5CF6]/10">
            <User className="h-5 w-5 text-[#8B5CF6]" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Account Details</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-[#F7931A] to-[#E2761B]">
            {userImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userImage} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-foreground truncate">
              {userName || "Anonymous"}
            </p>
            {userEmail && (
              <p className="text-sm text-muted-foreground truncate">{userEmail}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
