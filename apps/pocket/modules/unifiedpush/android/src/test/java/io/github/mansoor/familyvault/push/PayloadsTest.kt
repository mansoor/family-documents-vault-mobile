package io.github.mansoor.familyvault.push

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * What a push can put on a lock screen (4.14): the app's own words, from
 * strings.xml, picked by the message's type — never anything the message
 * itself carries, whatever a vault or anybody between adds to it.
 */
class PayloadsTest {
  private val res = File(System.getProperty("fdv.res") ?: "src/main/res")

  private val strings = mutableMapOf<String, String>()
  private val plurals = mutableMapOf<String, Map<String, String>>()

  init {
    val doc =
      DocumentBuilderFactory.newInstance()
        .newDocumentBuilder()
        .parse(File(res, "values/strings.xml"))
    val string = doc.getElementsByTagName("string")
    for (i in 0 until string.length) {
      val e = string.item(i) as Element
      strings[e.getAttribute("name")] = e.textContent
    }
    val plural = doc.getElementsByTagName("plurals")
    for (i in 0 until plural.length) {
      val e = plural.item(i) as Element
      val items = e.getElementsByTagName("item")
      plurals[e.getAttribute("name")] =
        (0 until items.length)
          .map { items.item(it) as Element }
          .associate { it.getAttribute("quantity") to it.textContent }
    }
  }

  /** As Android would show it, in English. */
  private fun shown(r: Rendered): String {
    strings[r.type.text]?.let {
      return it
    }
    val forms = plurals[r.type.text] ?: error("no words for ${r.type}")
    val form = forms[if (r.count == 1) "one" else "other"] ?: error("no form for ${r.count}")
    return String.format(form, r.count)
  }

  // Everything a message might carry besides its type, and must never show.
  private val extras =
    """"title":"Anna Example passport","body":"Renew by 3 October","name":"Anna",""" +
      """"url":"https://elsewhere.example/steal","kind":"Passport","note":"<b>urgent</b>""""
  private val leaks = listOf("Anna", "passport", "Passport", "Renew", "elsewhere", "<b>", "urgent")

  @Test
  fun eachPayloadTypeRendersItsFixedTextAndNothingFromThePayload() {
    val cases =
      listOf(
        """{"v":1,"type":"digest","count":3,"date":"2026-10-03"}""" to "3 things need attention",
        """{"v":1,"type":"digest","count":1,"date":"2026-10-03"}""" to "1 thing needs attention",
        """{"v":1,"type":"new_device"}""" to "A new device signed in to your vault",
        """{"v":1,"type":"owner_change"}""" to
          "Something changed about who owns your family vault",
        """{"v":1,"type":"session_ended"}""" to "You were signed out on this phone",
        """{"v":1,"type":"test"}""" to "Notifications are working.",
      )
    for ((payload, words) in cases) {
      val plain = Payloads.render(payload)
      assertNotNull(payload, plain)
      val loaded = Payloads.render("{" + extras + "," + payload.drop(1))
      assertEquals(payload, plain, loaded)
      val text = shown(loaded!!)
      assertEquals(payload, words, text)
      for (leak in leaks) assertFalse("$payload shows $leak", text.contains(leak))
    }
  }

  @Test
  fun eachTypeHasItsChannelAndWhereATapGoes() {
    assertEquals(Channel.REMINDERS, Rendered.Type.DIGEST.channel)
    assertEquals(Opens.NEEDS_ATTENTION, Rendered.Type.DIGEST.opens)
    assertEquals(Channel.SECURITY, Rendered.Type.NEW_DEVICE.channel)
    assertEquals(Opens.DEVICES, Rendered.Type.NEW_DEVICE.opens)
    assertEquals(Channel.SECURITY, Rendered.Type.SESSION_ENDED.channel)
    assertEquals(Opens.APP, Rendered.Type.SESSION_ENDED.opens)
    for (type in Rendered.Type.values()) {
      assertTrue("$type has words", strings.containsKey(type.text) || plurals.containsKey(type.text))
    }
    // Each notification replaces only its own kind.
    assertEquals(
      Rendered.Type.values().size,
      Rendered.Type.values().map { it.notificationId }.toSet().size,
    )
    for (name in
      listOf(
        "fv_push_channel_reminders",
        "fv_push_channel_security",
        "fv_push_register_label",
      )) {
      assertTrue(name, strings.containsKey(name))
    }
  }

  @Test
  fun anythingElseShowsNothing() {
    for (payload in
      listOf(
        "",
        "not json",
        "[]",
        """{"type":"test"}""",
        """{"v":2,"type":"test"}""",
        """{"v":"1","type":"test"}""",
        """{"v":1,"type":"TEST"}""",
        """{"v":1,"type":"something_new"}""",
        """{"v":1}""",
        """{"v":1,"type":"digest"}""",
        """{"v":1,"type":"digest","count":0}""",
        """{"v":1,"type":"digest","count":-2}""",
        """{"v":1,"type":"digest","count":"3"}""",
        """{"v":1,"type":"digest","count":2.5}""",
        """{"v":1,"type":"digest","count":100000}""",
      )) {
      assertNull(payload, Payloads.render(payload))
    }
  }
}
