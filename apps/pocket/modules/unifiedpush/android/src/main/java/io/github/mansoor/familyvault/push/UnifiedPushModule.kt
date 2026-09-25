package io.github.mansoor.familyvault.push

import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.unifiedpush.android.connector.UnifiedPush

/** The one registration this app makes: a phone talks to one vault at a time. */
internal const val INSTANCE = "vault"

/**
 * UnifiedPush for the app's JavaScript (4.14): which distributors are
 * installed, choosing one, registering with the vault's VAPID key, and
 * what has happened since — the address, a failure, a tap, a session that
 * ended. The JavaScript tells the vault; nothing here talks to it.
 */
class UnifiedPushModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun labelOf(pkg: String): String =
    try {
      val pm = context.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
      pkg
    }

  /**
   * A tap's word, taken off the intent: once only — not again when the app
   * is reopened from Recents (Android hands over the first intent again),
   * and not for a tap already followed.
   */
  private fun wordOf(intent: Intent): String? {
    val word = intent.getStringExtra(Notifier.EXTRA_OPEN) ?: return null
    val id = intent.getStringExtra(Notifier.EXTRA_OPEN_ID)
    intent.removeExtra(Notifier.EXTRA_OPEN)
    intent.removeExtra(Notifier.EXTRA_OPEN_ID)
    if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null
    val store = Store(context)
    if (id == null || id == store.lastOpenId) return null
    store.lastOpenId = id
    return word
  }

  override fun definition() = ModuleDefinition {
    Name("FdvUnifiedPush")
    Events("onPush")

    OnCreate { PushEvents.listener = { body -> sendEvent("onPush", body) } }
    OnDestroy { PushEvents.listener = null }

    // A notification tapped while the app is open.
    OnNewIntent { intent ->
      val word = wordOf(intent)
      if (word != null) {
        Store(context).pendingOpen = word
        sendEvent("onPush", mapOf("kind" to "open"))
      }
    }

    Function("distributors") {
      UnifiedPush.getDistributors(context)
        .filter { it != context.packageName }
        .map { mapOf("id" to it, "name" to labelOf(it)) }
    }

    Function("savedDistributor") { UnifiedPush.getSavedDistributor(context) }

    Function("chooseDistributor") { id: String -> UnifiedPush.saveDistributor(context, id) }

    // The address arrives later, through the service (an "endpoint" event).
    Function("register") { vapid: String ->
      Store(context).failure = null
      UnifiedPush.register(
        context,
        INSTANCE,
        context.getString(R.string.fv_push_register_label),
        vapid,
      )
    }

    Function("unregister") {
      UnifiedPush.unregister(context, INSTANCE)
      Store(context).clearEndpoint()
    }

    Function("state") {
      Store(context).snapshot() +
        ("allowed" to NotificationManagerCompat.from(context).areNotificationsEnabled())
    }

    // Where a tapped notification asked to go: the one that started the app, or a later one.
    Function("takeOpen") {
      val store = Store(context)
      val started = appContext.currentActivity?.intent?.let { wordOf(it) }
      val word = started ?: store.pendingOpen
      store.pendingOpen = null
      word
    }

    Function("sessionEnded") { Store(context).sessionEnded }

    Function("clearSessionEnded") { Store(context).sessionEnded = false }
  }
}
