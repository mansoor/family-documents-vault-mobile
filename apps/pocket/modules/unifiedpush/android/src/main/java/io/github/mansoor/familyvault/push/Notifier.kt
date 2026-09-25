package io.github.mansoor.familyvault.push

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.UUID

/**
 * Shows what a push rendered to, in the app's own words, on the Reminders
 * or Security channel. A tap opens the app with one word for where to go
 * (`EXTRA_OPEN`): no token, no link, no action — the app goes there once
 * it is unlocked.
 */
internal object Notifier {
  const val EXTRA_OPEN = "io.github.mansoor.familyvault.push.OPEN"
  /** Which tap this was: followed once, even if Android hands the intent over again. */
  const val EXTRA_OPEN_ID = "io.github.mansoor.familyvault.push.OPEN_ID"

  fun text(context: Context, r: Rendered): String =
    when (r.type) {
      Rendered.Type.DIGEST ->
        context.resources.getQuantityString(R.plurals.fv_push_digest, r.count, r.count)
      Rendered.Type.NEW_DEVICE -> context.getString(R.string.fv_push_new_device)
      Rendered.Type.OWNER_CHANGE -> context.getString(R.string.fv_push_owner_change)
      Rendered.Type.SESSION_ENDED -> context.getString(R.string.fv_push_session_ended)
      Rendered.Type.TEST -> context.getString(R.string.fv_push_test)
    }

  private fun channels(context: Context) {
    NotificationManagerCompat.from(context)
      .createNotificationChannelsCompat(
        listOf(
          NotificationChannelCompat.Builder(
              Channel.REMINDERS.id,
              NotificationManagerCompat.IMPORTANCE_DEFAULT,
            )
            .setName(context.getString(R.string.fv_push_channel_reminders))
            .setDescription(context.getString(R.string.fv_push_channel_reminders_about))
            .build(),
          NotificationChannelCompat.Builder(
              Channel.SECURITY.id,
              NotificationManagerCompat.IMPORTANCE_HIGH,
            )
            .setName(context.getString(R.string.fv_push_channel_security))
            .setDescription(context.getString(R.string.fv_push_channel_security_about))
            .build(),
        )
      )
  }

  // Notifications off (or not allowed, on Android 13 and later) is checked first.
  @SuppressLint("MissingPermission")
  fun show(context: Context, r: Rendered) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    channels(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    r.type.opens.word?.let {
      launch.putExtra(EXTRA_OPEN, it)
      launch.putExtra(EXTRA_OPEN_ID, UUID.randomUUID().toString())
    }
    // One request code per type: each notification keeps its own word.
    val tap =
      PendingIntent.getActivity(
        context,
        r.type.notificationId,
        launch,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    val notification =
      NotificationCompat.Builder(context, r.type.channel.id)
        .setSmallIcon(R.drawable.fv_push_small)
        .setContentTitle(context.applicationInfo.loadLabel(context.packageManager).toString())
        .setContentText(text(context, r))
        .setContentIntent(tap)
        .setAutoCancel(true)
        // Nothing in it is private: the words are the same for every family.
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setCategory(
          if (r.type.channel == Channel.REMINDERS) NotificationCompat.CATEGORY_REMINDER
          else NotificationCompat.CATEGORY_STATUS
        )
        .build()
    try {
      manager.notify(r.type.notificationId, notification)
    } catch (e: SecurityException) {
      // Permission taken away between the check and now: nothing shown.
    }
  }
}
