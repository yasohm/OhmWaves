package com.ohmwave.music;

import android.content.Intent;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

/**
 * Plays audio outside the WebView so it survives the app going to the background, and publishes the
 * media session that Android turns into the notification / lock-screen controls.
 *
 * The queue lives in the web player, so "next", "previous" and "stop" from the notification or a headset
 * are handed back to it through {@link RemoteListener}.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlaybackService extends MediaSessionService {

    static final String ACTION_NEXT = "next";
    static final String ACTION_PREVIOUS = "previous";
    static final String ACTION_STOP = "stop";
    private static final String COMMAND_STOP = "com.ohmwave.music.STOP";

    interface RemoteListener {
        void onRemoteAction(String action);
    }

    /** Set by {@link NativePlayerPlugin} while the web player is alive. Main thread only. */
    static RemoteListener remoteListener;

    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
        ExoPlayer exoPlayer = new ExoPlayer.Builder(this)
                // Pause for calls and other apps, and when headphones are unplugged.
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                        .build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

        SessionCommand stopCommand = new SessionCommand(COMMAND_STOP, Bundle.EMPTY);
        CommandButton stopButton = new CommandButton.Builder()
                .setDisplayName(getString(R.string.action_stop))
                .setIconResId(R.drawable.ic_stop)
                .setSessionCommand(stopCommand)
                .build();

        session = new MediaSession.Builder(this, new QueueForwardingPlayer(exoPlayer))
                .setCustomLayout(ImmutableList.of(stopButton))
                .setCallback(new MediaSession.Callback() {
                    @NonNull
                    @Override
                    public MediaSession.ConnectionResult onConnect(@NonNull MediaSession mediaSession, @NonNull MediaSession.ControllerInfo controller) {
                        SessionCommands commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(stopCommand).build();
                        return new MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
                                .setAvailableSessionCommands(commands)
                                .build();
                    }

                    @NonNull
                    @Override
                    public ListenableFuture<SessionResult> onCustomCommand(@NonNull MediaSession mediaSession, @NonNull MediaSession.ControllerInfo controller,
                                                                           @NonNull SessionCommand command, @NonNull Bundle args) {
                        if (COMMAND_STOP.equals(command.customAction)) {
                            stopPlayback();
                            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                        }
                        return MediaSession.Callback.super.onCustomCommand(mediaSession, controller, command, args);
                    }
                })
                .build();

        DefaultMediaNotificationProvider notifications = new DefaultMediaNotificationProvider.Builder(this).build();
        notifications.setSmallIcon(R.drawable.ic_stat_ohmwaves);
        setMediaNotificationProvider(notifications);
    }

    /** Stop: silence playback and clear the item, which also removes the notification. */
    private void stopPlayback() {
        Player player = session.getPlayer();
        player.stop();
        player.clearMediaItems();
        dispatch(ACTION_STOP);
    }

    private static boolean dispatch(String action) {
        if (remoteListener == null) return false;
        remoteListener.onRemoteAction(action);
        return true;
    }

    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away from recents: keep playing if music is on, otherwise shut down cleanly.
        Player player = session.getPlayer();
        if (!player.getPlayWhenReady() || player.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    /** Always offers next/previous so the notification shows them; the web player's queue decides what they do. */
    private static final class QueueForwardingPlayer extends ForwardingPlayer {
        QueueForwardingPlayer(Player player) {
            super(player);
        }

        @NonNull
        @Override
        public Commands getAvailableCommands() {
            return super.getAvailableCommands().buildUpon()
                    .addAll(COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build();
        }

        @Override
        public boolean isCommandAvailable(int command) {
            return command == COMMAND_SEEK_TO_NEXT || command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM
                    || command == COMMAND_SEEK_TO_PREVIOUS || command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM
                    || super.isCommandAvailable(command);
        }

        @Override
        public void seekToNext() {
            dispatch(ACTION_NEXT);
        }

        @Override
        public void seekToNextMediaItem() {
            dispatch(ACTION_NEXT);
        }

        @Override
        public void seekToPrevious() {
            // With the app closed there is no queue to go back through: restart the track instead.
            if (!dispatch(ACTION_PREVIOUS)) seekTo(0);
        }

        @Override
        public void seekToPreviousMediaItem() {
            seekToPrevious();
        }
    }
}
