self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || "bitbudget"
  const options = {
    body: data.body || "Time to log your spending!",
    icon: "/icon-vanilla.svg",
    badge: "/icon-vanilla.svg",
    data: { url: data.url || "/" },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"
  event.waitUntil(clients.openWindow(url))
})
