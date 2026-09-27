package com.seenit.app

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SeenItPlexBackground")
class SeenItPlexBackgroundPlugin : Plugin() {

    @PluginMethod
    fun setCredentials(call: PluginCall) {
        val uid = call.getString("uid")?.trim()
        val token = call.getString("token")?.trim()
        if (uid.isNullOrEmpty() || token.isNullOrEmpty()) {
            call.reject("PLEX_BACKGROUND_CREDENTIALS_MISSING")
            return
        }

        try {
            PlexBackgroundCredentialStore.store(context, uid, token)
            call.resolve()
        } catch (error: Exception) {
            call.reject("PLEX_BACKGROUND_CREDENTIALS_FAILED", error)
        }
    }

    @PluginMethod
    fun clearCredentials(call: PluginCall) {
        val uid = call.getString("uid")?.trim()
        if (!uid.isNullOrEmpty()) {
            PlexBackgroundCredentialStore.clearForUid(context, uid)
        }
        call.resolve()
    }

    @PluginMethod
    fun readDiagnostics(call: PluginCall) {
        val uid = call.getString("uid")?.trim()
        if (uid.isNullOrEmpty()) {
            call.reject("PLEX_BACKGROUND_DIAGNOSTIC_UID_MISSING")
            return
        }
        val snapshot = PlexAvailabilityDiagnosticStore.readForUid(context, uid)
        val events = JSArray()
        snapshot.events.forEach { events.put(it) }
        val result = JSObject()
        result.put("events", events)
        result.put("beforeTimestamp", snapshot.beforeTimestamp.toString())
        call.resolve(result)
    }

    @PluginMethod
    fun clearDiagnostics(call: PluginCall) {
        val uid = call.getString("uid")?.trim()
        val beforeTimestamp = call.getString("beforeTimestamp")?.toLongOrNull() ?: 0L
        if (!uid.isNullOrEmpty() && beforeTimestamp > 0L) {
            PlexAvailabilityDiagnosticStore.clearForUidBefore(context, uid, beforeTimestamp)
        }
        call.resolve()
    }
}
