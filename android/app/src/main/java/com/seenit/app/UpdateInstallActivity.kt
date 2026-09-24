package com.seenit.app

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Bundle

class UpdateInstallActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleInstallStatus(intent)
    }

    private fun handleInstallStatus(statusIntent: Intent) {
        when (
            statusIntent.getIntExtra(
                PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE,
            )
        ) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmationIntent = getConfirmationIntent(statusIntent)
                if (confirmationIntent == null) {
                    relaunchSeenIt()
                    return
                }

                confirmationIntent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
                startActivity(confirmationIntent)
                overridePendingTransition(0, 0)
                finish()
            }

            PackageInstaller.STATUS_SUCCESS -> relaunchSeenIt()
            else -> relaunchSeenIt()
        }
    }

    @Suppress("DEPRECATION")
    private fun getConfirmationIntent(statusIntent: Intent): Intent? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            statusIntent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            statusIntent.getParcelableExtra(Intent.EXTRA_INTENT)
        }
    }

    private fun relaunchSeenIt() {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java)

        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_NO_ANIMATION,
        )
        startActivity(launchIntent)
        overridePendingTransition(0, 0)
        finish()
    }

    companion object {
        const val ACTION_UPDATE_INSTALL_STATUS =
            "com.seenit.app.action.UPDATE_INSTALL_STATUS"
    }
}
