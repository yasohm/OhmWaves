package com.ohmwave.music;

import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

import java.util.Locale;

public class MainActivity extends BridgeActivity {

    /** How long the logo takes to draw in (drawable-v31/splash_icon.xml). */
    private static final long LOGO_DRAW_MS = 850;
    /** Never hold the splash longer than this, even if the page doesn't report in. */
    private static final long MAX_SPLASH_MS = 3500;
    private static final long HANDOFF_FADE_MS = 220;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The splash draws the logo while the app starts, then stays until the page's launch screen has painted,
        // so there is no blank screen between them.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        long shownAt = SystemClock.uptimeMillis();
        LaunchPlugin.pageReady = false;
        splash.setKeepOnScreenCondition(() -> {
            long elapsed = SystemClock.uptimeMillis() - shownAt;
            return elapsed < MAX_SPLASH_MS && (!LaunchPlugin.pageReady || elapsed < LOGO_DRAW_MS);
        });
        splash.setOnExitAnimationListener(provider -> {
            revealPageLaunch(provider.getIconView());
            provider.getView().animate().alpha(0f).setDuration(HANDOFF_FADE_MS).withEndAction(provider::remove).start();
        });

        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(LaunchPlugin.class);
        super.onCreate(savedInstanceState);

        // Back walks the app's history; at the start it sends the app to the background (like Spotify)
        // instead of closing it, so the web player and its queue stay alive while music plays.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    /** Line the page's logo up with the splash logo (in CSS pixels), then start its waves. */
    private void revealPageLaunch(View icon) {
        WebView webView = getBridge().getWebView();
        String js = "window.ohmLaunchReveal && ohmLaunchReveal()";
        if (icon != null) {
            int[] iconAt = new int[2];
            int[] webAt = new int[2];
            icon.getLocationOnScreen(iconAt);
            webView.getLocationOnScreen(webAt);
            float density = getResources().getDisplayMetrics().density;
            float x = (iconAt[0] + icon.getWidth() / 2f - webAt[0]) / density;
            float y = (iconAt[1] + icon.getHeight() / 2f - webAt[1]) / density;
            js = String.format(Locale.ROOT, "window.ohmLaunchReveal && ohmLaunchReveal(%.1f, %.1f)", x, y);
        }
        webView.evaluateJavascript(js, null);
    }
}
