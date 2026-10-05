// The Activity Bar sidebar's side of the protocol. It asks for nothing but
// "ready" and "open dashboard"; everything it draws arrives in one message.
import { getDailyTargetMs } from "../shared/config"
import type { MiniMessage } from "../shared/types"
import type { StorageService } from "../tracker/storageService"
import { Poster, sendSettings } from "./messageHandler"
import { buildMini } from "./payloads"

export function postMini(storage: StorageService, view: Poster): void {
  view.postMessage({ type: "mini", ...buildMini(storage, new Date(), getDailyTargetMs()) })
}

export function handleMiniMessage(msg: MiniMessage, storage: StorageService, view: Poster, openDashboard: () => void): void {
  switch (msg?.type) {
    case "ready":
      // settings first: the CRT layers are drawn from them
      sendSettings(storage, view)
      postMini(storage, view)
      break
    case "openDashboard":
      openDashboard()
      break
  }
}

// Settings edited anywhere reach the sidebar too: the CRT look and, for a new
// daily target, streaks re-judged against it.
export function onMiniConfigChanged(affects: (section: string) => boolean, storage: StorageService, view: Poster): void {
  if (!affects("rabbithole")) return
  if (affects("rabbithole.dailyTargetMinutes")) {
    storage.updateStreak()
    storage.updateProjectStreak(storage.getCurrentProjectId())
  }
  sendSettings(storage, view)
  postMini(storage, view)
}
