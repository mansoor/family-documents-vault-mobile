package io.github.mansoor.familyvault.clipboard

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Copying an identity number for the app's JavaScript (5.31): on the
 * clipboard marked sensitive, and cleared after a minute. ClipClearing sets
 * an alarm that clears it even if the app is swiped away, killed or frozen
 * within the minute; while the app runs, the main thread's clock clears it
 * on the dot too. Whenever the app starts or comes back to the front, a
 * copy of its own whose minute is over goes. The number is handed to the
 * clipboard and kept nowhere here.
 */
class SensitiveClipboardModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  private val handler = Handler(Looper.getMainLooper())

  /** The in-process clear still to come, if any: the latest copy's (set from JavaScript's thread, run on the main one). */
  @Volatile private var pending: Runnable? = null

  /** A moment after coming to the front: the window has its focus by then, so the clipboard can be read. */
  private val sweep = Runnable { context?.let { ClipClearing.sweep(it) } }

  override fun definition() = ModuleDefinition {
    Name("FdvClipboard")

    OnCreate { handler.postDelayed(sweep, SWEEP_DELAY_MS) }

    OnActivityEntersForeground {
      handler.removeCallbacks(sweep)
      handler.postDelayed(sweep, SWEEP_DELAY_MS)
    }

    Function("copySensitive") { text: String, clearAfterMs: Int ->
      val c = context
      if (c == null || !ClipClearing.copy(c, text, clearAfterMs)) {
        false
      } else {
        pending?.let { handler.removeCallbacks(it) }
        val clear = Runnable {
          pending = null
          ClipClearing.clearIfOurs(c)
        }
        pending = clear
        handler.postDelayed(clear, ClipRules.delay(clearAfterMs))
        true
      }
    }

    Function("clearIfOurs") {
      val c = context
      if (c == null) false else ClipClearing.clearIfOurs(c)
    }

    // The alarm clears it on time, whatever becomes of this module.
    OnDestroy {
      pending?.let { handler.removeCallbacks(it) }
      pending = null
      handler.removeCallbacks(sweep)
    }
  }

  private companion object {
    const val SWEEP_DELAY_MS = 1_000L
  }
}
