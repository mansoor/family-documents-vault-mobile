package io.github.mansoor.familyvault.push

import org.json.JSONObject

/** Where a notification is filed, as Android's notification settings show it. */
enum class Channel(val id: String) {
  REMINDERS("reminders"),
  SECURITY("security"),
}

/** What a tap on a notification opens — once the app is unlocked, never before. */
enum class Opens(val word: String?) {
  NEEDS_ATTENTION("needs-attention"),
  DEVICES("devices"),
  APP(null),
}

/**
 * What one push may show: a type and, for the day's reminders and for files
 * waiting to be looked at, a count.
 * The words are the app's own (strings.xml, named by `text`); nothing
 * else in the message is read — no title, no name, no link — so nothing
 * else can reach a lock screen, whatever a vault or anybody between sends.
 */
data class Rendered(val type: Type, val count: Int = 0) {
  enum class Type(
    val wire: String,
    val channel: Channel,
    val text: String,
    val opens: Opens,
    val notificationId: Int,
  ) {
    DIGEST("digest", Channel.REMINDERS, "fv_push_digest", Opens.NEEDS_ATTENTION, 1),
    NEW_DEVICE("new_device", Channel.SECURITY, "fv_push_new_device", Opens.DEVICES, 2),
    OWNER_CHANGE("owner_change", Channel.SECURITY, "fv_push_owner_change", Opens.APP, 3),
    SESSION_ENDED("session_ended", Channel.SECURITY, "fv_push_session_ended", Opens.APP, 4),
    TEST("test", Channel.REMINDERS, "fv_push_test", Opens.APP, 5),
    /**
     * Files sent through a request wait for this person to look at (vault
     * 5.23): how many, and nothing else. They are looked at in the browser.
     */
    INCOMING("incoming", Channel.REMINDERS, "fv_push_incoming", Opens.APP, 6),
    /**
     * Something about the person's details is changing — more people will
     * see their identity details (vault 5.26). The app says what, on Home.
     */
    NOTICE("notice", Channel.SECURITY, "fv_push_notice", Opens.APP, 7),
  }
}

object Payloads {
  /** A count no family's day comes near; anything past it is not a count. */
  const val MAX_COUNT = 99_999

  /** The types that say how many, and are shown as nothing without a count. */
  private val COUNTED = setOf(Rendered.Type.DIGEST, Rendered.Type.INCOMING)

  /** The message as the vault sends it (4.13), or null: shown as nothing at all. */
  fun render(payload: String): Rendered? {
    val o =
      try {
        JSONObject(payload)
      } catch (e: Exception) {
        return null
      }
    if (!isOne(o.opt("v"))) return null
    val type = Rendered.Type.values().firstOrNull { it.wire == o.opt("type") } ?: return null
    if (type !in COUNTED) return Rendered(type)
    val count = countOf(o.opt("count")) ?: return null
    return Rendered(type, count)
  }

  private fun isOne(v: Any?): Boolean = (v is Int && v == 1) || (v is Long && v == 1L)

  private fun countOf(c: Any?): Int? {
    val n =
      when (c) {
        is Int -> c.toLong()
        is Long -> c
        else -> return null
      }
    return if (n in 1..MAX_COUNT) n.toInt() else null
  }
}
