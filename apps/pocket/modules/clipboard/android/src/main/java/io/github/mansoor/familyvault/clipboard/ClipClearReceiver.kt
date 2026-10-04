package io.github.mansoor.familyvault.clipboard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The alarm a copy sets (5.31): its minute is up, so the clipboard is
 * cleared — whether or not the app is still running. Clearing needs no
 * focus; reading does, so at the back the app cannot tell whose copy is
 * there, and clears it (ClipRules.shouldClear). Not exported: only the
 * app's own alarm reaches it.
 */
class ClipClearReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ClipClearing.clearIfOurs(context.applicationContext)
  }
}
