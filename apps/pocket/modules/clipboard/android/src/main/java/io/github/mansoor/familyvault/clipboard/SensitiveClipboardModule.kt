package io.github.mansoor.familyvault.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Copying an identity number for the app's JavaScript (5.31): on the
 * clipboard marked sensitive, and cleared after a minute — on the main
 * thread's clock, which keeps running while the app is at the back, where
 * the number is pasted. The number is handed to the clipboard and kept
 * nowhere here.
 */
class SensitiveClipboardModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val handler = Handler(Looper.getMainLooper())

  /** The clear still to come, if any: one at a time, the latest copy's (set from JavaScript's thread, run on the main one). */
  @Volatile private var pending: Runnable? = null

  private fun manager(): ClipboardManager? =
    context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager

  /** Clears the clipboard, unless what is on it is something else the app can see. */
  private fun clearIfOurs(cm: ClipboardManager): Boolean {
    val description =
      try {
        cm.primaryClipDescription
      } catch (e: Exception) {
        null
      }
    if (!ClipRules.shouldClear(description != null, description?.label)) return false
    return try {
      cm.clearPrimaryClip()
      true
    } catch (e: Exception) {
      false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("FdvClipboard")

    Function("copySensitive") { text: String, clearAfterMs: Int ->
      val cm = manager()
      if (cm == null) {
        false
      } else {
        val clip = ClipData.newPlainText(ClipRules.LABEL, text)
        val extras = PersistableBundle()
        extras.putBoolean(ClipRules.EXTRA_IS_SENSITIVE, true)
        clip.description.setExtras(extras)
        cm.setPrimaryClip(clip)
        pending?.let { handler.removeCallbacks(it) }
        val clear = Runnable {
          pending = null
          clearIfOurs(cm)
        }
        pending = clear
        handler.postDelayed(clear, ClipRules.delay(clearAfterMs))
        true
      }
    }

    Function("clearIfOurs") {
      val cm = manager()
      if (cm == null) false else clearIfOurs(cm)
    }

    // The JavaScript going away (a reload) would take nothing with it: a
    // clear still to come is done now instead.
    OnDestroy {
      pending?.let {
        handler.removeCallbacks(it)
        it.run()
      }
    }
  }
}
