package com.seenit.app

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "SeenItAuth")
class SeenItAuthPlugin : Plugin() {

    @PluginMethod
    fun signInWithGoogle(call: PluginCall) {
        val currentActivity = activity
        if (currentActivity == null) {
            call.reject("AUTH_ACTIVITY_UNAVAILABLE")
            return
        }

        val clientIdResource = context.resources.getIdentifier(
            "default_web_client_id",
            "string",
            context.packageName,
        )

        if (clientIdResource == 0) {
            call.reject(
                "AUTH_FIREBASE_ANDROID_CONFIG_MISSING: ajoute google-services.json pour com.seenit.app",
            )
            return
        }

        val serverClientId = context.getString(clientIdResource).trim()
        if (serverClientId.isEmpty()) {
            call.reject("AUTH_GOOGLE_CLIENT_ID_MISSING")
            return
        }

        val googleIdOption = GetGoogleIdOption.Builder()
            .setServerClientId(serverClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        val credentialManager = CredentialManager.create(context)

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val response = credentialManager.getCredential(currentActivity, request)
                val credential = response.credential

                if (
                    credential is CustomCredential &&
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                    val result = JSObject()
                    result.put("idToken", googleCredential.idToken)
                    call.resolve(result)
                    return@launch
                }

                call.reject("AUTH_UNSUPPORTED_GOOGLE_CREDENTIAL")
            } catch (error: GetCredentialCancellationException) {
                call.reject("AUTH_GOOGLE_CANCELLED", error)
            } catch (error: GetCredentialException) {
                call.reject(
                    "AUTH_GOOGLE_CREDENTIAL_FAILED: ${error.message ?: error.javaClass.simpleName}",
                    error,
                )
            } catch (error: Exception) {
                call.reject(
                    "AUTH_GOOGLE_FAILED: ${error.message ?: error.javaClass.simpleName}",
                    error,
                )
            }
        }
    }
}
