package io.github.mansoor.familyvault.clipboard

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.os.SystemClock

/**
 * Copying an identity number, and clearing it after a minute (5.31), on
 * Android's own clocks rather than only the app's: an inexact alarm
 * (AlarmManager, ELAPSED_REALTIME_WAKEUP, allowed while idle) fires
 * ClipClearReceiver even when the app's process was killed or frozen, and
 * when the phone was asleep. Kept besides: when the minute is over (wall
 * clock), so a start or a return to the front clears a copy left behind.
 * Neither keeps the number: only when to clear.
 */
internal object ClipClearing {
  private const val PREFS = "fdv_clipboard"
  private const val DUE_AT = "due_at"
  private const val REQUEST = 5310

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun clipboard(c: Context): ClipboardManager? =
    c.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager

  private fun alarms(c: Context): AlarmManager? =
    c.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

  /** The one alarm's intent: another copy replaces it (FLAG_UPDATE_CURRENT on the same request code). */
  private fun alarm(c: Context): PendingIntent =
    PendingIntent.getBroadcast(
      c,
      REQUEST,
      Intent(c, ClipClearReceiver::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** On the clipboard marked sensitive, with its clear set; false if there is no clipboard. */
  fun copy(c: Context, text: String, askedMs: Int): Boolean {
    val cm = clipboard(c) ?: return false
    val clip = ClipData.newPlainText(ClipRules.LABEL, text)
    val extras = PersistableBundle()
    extras.putBoolean(ClipRules.EXTRA_IS_SENSITIVE, true)
    clip.description.setExtras(extras)
    cm.setPrimaryClip(clip)
    prefs(c).edit().putLong(DUE_AT, System.currentTimeMillis() + ClipRules.delay(askedMs)).apply()
    alarms(c)?.setAndAllowWhileIdle(
      AlarmManager.ELAPSED_REALTIME_WAKEUP,
      ClipRules.clearAt(SystemClock.elapsedRealtime(), askedMs),
      alarm(c),
    )
    return true
  }

  /** The waiting clear is done with: the alarm and the time go. */
  private fun forget(c: Context) {
    prefs(c).edit().remove(DUE_AT).apply()
    alarms(c)?.cancel(alarm(c))
  }

  private fun clear(c: Context, cm: ClipboardManager): Boolean {
    forget(c)
    return try {
      cm.clearPrimaryClip()
      true
    } catch (e: Exception) {
      false
    }
  }

  /** When the minute is up: cleared, unless what is on it is something else the app can see. */
  fun clearIfOurs(c: Context): Boolean {
    val cm = clipboard(c) ?: return false
    val description =
      try {
        cm.primaryClipDescription
      } catch (e: Exception) {
        null
      }
    if (!ClipRules.shouldClear(description != null, description?.label)) {
      // Somebody else's copy is there now: nothing of the app's to clear.
      forget(c)
      return false
    }
    return clear(c, cm)
  }

  /**
   * At a start or back in front: a copy of the app's whose minute is over,
   * or that has no time kept, goes now; one not yet due has its alarm set
   * again for what is left (a force stop drops the app's alarms, not the
   * time). Returns that time in ms when it re-armed, so the caller can
   * clear it on the dot while it runs; null otherwise.
   */
  fun sweep(c: Context): Long? {
    val cm = clipboard(c) ?: return null
    val description =
      try {
        cm.primaryClipDescription
      } catch (e: Exception) {
        null
      }
    val p = prefs(c)
    val due = if (p.contains(DUE_AT)) p.getLong(DUE_AT, 0L) else null
    return when (val next = ClipRules.sweep(description != null, description?.label, due, System.currentTimeMillis())) {
      is ClipRules.Sweep.Leave -> null
      is ClipRules.Sweep.Clear -> {
        clear(c, cm)
        null
      }
      is ClipRules.Sweep.Rearm -> {
        // The same request code: a live alarm is replaced, a dropped one comes back.
        alarms(c)?.setAndAllowWhileIdle(
          AlarmManager.ELAPSED_REALTIME_WAKEUP,
          SystemClock.elapsedRealtime() + next.inMs,
          alarm(c),
        )
        next.inMs
      }
    }
  }
}
