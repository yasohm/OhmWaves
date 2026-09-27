package com.ohmwave.music;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** index.html calls ready() once its launch screen has painted, so the native splash can hand over without a gap. */
@CapacitorPlugin(name = "Launch")
public class LaunchPlugin extends Plugin {

    static volatile boolean pageReady;

    @PluginMethod
    public void ready(PluginCall call) {
        pageReady = true;
        call.resolve();
    }
}
