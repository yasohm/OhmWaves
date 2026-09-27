package com.ohmwave.music;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlayerPlugin.class);
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
}
