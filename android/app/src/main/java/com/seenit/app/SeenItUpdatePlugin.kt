package com.seenit.app

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

@CapacitorPlugin(name = "SeenItUpdate")
class SeenItUpdatePlugin : Plugin() {

    @PluginMethod
    fun installApk(call: PluginCall) {
        val filePath = call.getString("filePath")?.trim()
        if (filePath.isNullOrEmpty()) {
            call.reject("UPDATE_APK_PATH_MISSING")
            return
        }

        val packageInstaller = context.packageManager.packageInstaller
        var sessionId = -1

        try {
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL,
            ).apply {
                setAppPackageName(context.packageName)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    setInstallReason(PackageManager.INSTALL_REASON_USER)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
                }
            }

            sessionId = packageInstaller.createSession(params)
            packageInstaller.openSession(sessionId).use { session ->
                openInputStream(filePath).use { input ->
                    session.openWrite("SeenIt-update.apk", 0, -1L).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }

                val statusPendingIntent = createStatusPendingIntent(sessionId)
                session.commit(statusPendingIntent.intentSender)
            }

            call.resolve(
                JSObject().apply {
                    put("sessionId", sessionId)
                },
            )
        } catch (error: Exception) {
            if (sessionId > 0) {
                runCatching { packageInstaller.abandonSession(sessionId) }
            }
            call.reject(
                "UPDATE_INSTALLER_FAILED: ${error.message ?: error.javaClass.simpleName}",
                error,
            )
        }
    }

    private fun openInputStream(filePath: String): InputStream {
        val uri = Uri.parse(filePath)
        return when (uri.scheme?.lowercase()) {
            "content" -> context.contentResolver.openInputStream(uri)
                ?: throw IllegalArgumentException("UPDATE_APK_URI_UNREADABLE")
            "file" -> FileInputStream(
                File(uri.path ?: throw IllegalArgumentException("UPDATE_APK_FILE_PATH_INVALID")),
            )
            null, "" -> FileInputStream(File(filePath))
            else -> throw IllegalArgumentException("UPDATE_APK_URI_SCHEME_UNSUPPORTED")
        }
    }

    @Suppress("DEPRECATION")
    private fun createStatusPendingIntent(sessionId: Int): PendingIntent {
        val statusIntent = Intent(context, UpdateInstallActivity::class.java).apply {
            action = UpdateInstallActivity.ACTION_UPDATE_INSTALL_STATUS
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION,
            )
        }

        val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE
        } else {
            0
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val options = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= 36) {
                options.setPendingIntentCreatorBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS,
                )
            } else {
                options.setPendingIntentCreatorBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED,
                )
            }
            return PendingIntent.getActivity(
                context,
                sessionId,
                statusIntent,
                flags,
                options.toBundle(),
            )
        }

        return PendingIntent.getActivity(context, sessionId, statusIntent, flags)
    }
}
