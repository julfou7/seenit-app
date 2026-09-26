package com.seenit.app

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
}
