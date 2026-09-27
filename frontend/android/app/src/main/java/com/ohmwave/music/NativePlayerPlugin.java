package com.ohmwave.music;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

/**
 * Bridge between the web player and {@link PlaybackService}. The web side treats it like an
 * &lt;audio&gt; element: it loads one track at a time and receives HTML-media-style events back.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin implements PlaybackService.RemoteListener {

    private static final String EXTRA_TRACK = "ohmwaves.track";
    private static final long TICK_MS = 500;

    private ListenableFuture<MediaController> controllerFuture;
    private final Handler main = new Handler(Looper.getMainLooper());

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            MediaController controller = readyController();
            if (controller == null || !controller.isPlaying()) return;
            emit("timeupdate", controller);
            main.postDelayed(this, TICK_MS);
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
            MediaController controller = readyController();
            if (controller != null) emit(playWhenReady ? "play" : "pause", controller);
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            MediaController controller = readyController();
            if (controller == null) return;
            if (state == Player.STATE_BUFFERING) emit("waiting", controller);
            else if (state == Player.STATE_READY) {
                emit("durationchange", controller);
                emit("canplay", controller);
            } else if (state == Player.STATE_ENDED) emit("ended", controller);
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            MediaController controller = readyController();
            if (controller == null) return;
            main.removeCallbacks(tick);
            if (isPlaying) {
                emit("playing", controller);
                main.post(tick);
            }
        }

        @Override
        public void onPositionDiscontinuity(@NonNull Player.PositionInfo oldPosition, @NonNull Player.PositionInfo newPosition, int reason) {
            MediaController controller = readyController();
            if (controller != null && reason == Player.DISCONTINUITY_REASON_SEEK) emit("timeupdate", controller);
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            JSObject data = new JSObject();
            data.put("type", "error");
            data.put("message", error.getErrorCodeName());
            notifyListeners("media", data);
        }
    };

    @Override
    public void load() {
        PlaybackService.remoteListener = this;
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
        controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
        controllerFuture.addListener(() -> {
            MediaController controller = readyController();
            if (controller != null) controller.addListener(listener);
        }, ContextCompat.getMainExecutor(getContext()));
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(tick);
        if (PlaybackService.remoteListener == this) PlaybackService.remoteListener = null;
        // Releasing the controller does not stop playback: the service keeps the current track going.
        MediaController.releaseFuture(controllerFuture);
    }

    @Override
    public void onRemoteAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("remote", data);
    }

    private MediaController readyController() {
        if (controllerFuture == null || !controllerFuture.isDone()) return null;
        try {
            return controllerFuture.get();
        } catch (Exception e) {
            return null;
        }
    }

    /** Runs `action` on the main thread once the controller is connected; `action` must settle the call. */
    private void onController(PluginCall call, Consumer<MediaController> action) {
        controllerFuture.addListener(() -> {
            MediaController controller = readyController();
            if (controller == null) call.reject("The player isn't available.");
            else action.accept(controller);
        }, ContextCompat.getMainExecutor(getContext()));
    }

    /** Like {@link #onController}, resolving the call once `action` has run. */
    private void withController(PluginCall call, Consumer<MediaController> action) {
        onController(call, controller -> {
            action.accept(controller);
            call.resolve();
        });
    }

    private void emit(String type, MediaController controller) {
        JSObject data = new JSObject();
        data.put("type", type);
        data.put("position", controller.getCurrentPosition() / 1000.0);
        long duration = controller.getDuration();
        data.put("duration", duration > 0 ? duration / 1000.0 : 0);
        notifyListeners("media", data);
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A url is required.");
            return;
        }
        Bundle extras = new Bundle();
        extras.putString(EXTRA_TRACK, call.getString("track", ""));
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .setTitle(call.getString("title"))
                .setArtist(call.getString("artist"))
                .setAlbumTitle(call.getString("album"))
                .setExtras(extras);
        String artwork = call.getString("artwork");
        if (artwork != null && !artwork.isEmpty()) metadata.setArtworkUri(Uri.parse(artwork));
        MediaItem item = new MediaItem.Builder().setMediaId(url).setUri(url).setMediaMetadata(metadata.build()).build();
        long startMs = Math.round(call.getDouble("position", 0.0) * 1000);
        boolean autoplay = call.getBoolean("autoplay", true);

        withController(call, controller -> {
            controller.setMediaItem(item, startMs);
            controller.prepare();
            controller.setPlayWhenReady(autoplay);
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        withController(call, controller -> {
            if (controller.getPlaybackState() == Player.STATE_ENDED) controller.seekTo(0);
            controller.play();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(call, Player::pause);
    }

    @PluginMethod
    public void seek(PluginCall call) {
        long positionMs = Math.round(call.getDouble("position", 0.0) * 1000);
        withController(call, controller -> controller.seekTo(positionMs));
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        float volume = call.getFloat("volume", 1f);
        withController(call, controller -> controller.setVolume(Math.max(0f, Math.min(1f, volume))));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withController(call, controller -> {
            controller.stop();
            controller.clearMediaItems();
        });
    }

    /** What is loaded right now, so a reopened app can pick up a track that kept playing without it. */
    @PluginMethod
    public void getState(PluginCall call) {
        onController(call, controller -> {
            JSObject data = new JSObject();
            MediaItem item = controller.getCurrentMediaItem();
            if (item != null) {
                Bundle extras = item.mediaMetadata.extras;
                data.put("url", item.mediaId);
                data.put("track", extras != null ? extras.getString(EXTRA_TRACK, "") : "");
                data.put("position", controller.getCurrentPosition() / 1000.0);
                long duration = controller.getDuration();
                data.put("duration", duration > 0 ? duration / 1000.0 : 0);
                data.put("playing", controller.getPlayWhenReady());
            }
            call.resolve(data);
        });
    }
}
